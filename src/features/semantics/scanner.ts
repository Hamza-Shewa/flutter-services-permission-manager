import * as fs from "fs";
import * as path from "path";
import { Language, Node as SyntaxNode, Parser } from "web-tree-sitter";
import {
  collectDartFiles,
  invocationFromArguments,
  loadDartLanguage,
  normalizePath,
  reference,
  sha256,
  stringValue,
  type Invocation,
} from "./dart-source.js";
import {
  analyzeSharedWidgets,
  buildWidgetIndex,
  interactiveWidgetKeys,
  DEFAULT_PREFIX_ARGS,
  DEFAULT_HINT_ARGS,
  DEFAULT_IDENTIFIER_ARGS,
  DEFAULT_LABEL_ARGS,
  type ProjectWidgetIndex,
} from "./widget-index.js";
import type {
  AccessibilityState,
  AutomationState,
  InteractiveFinding,
  InteractiveFileGroup,
  InteractiveScannerOptions,
  InteractiveScanResult,
  InteractionKind,
  ResolvedWidget,
  SemanticsContract,
  SemanticsEvidence,
} from "./types.js";

export { DART_GRAMMAR_SHA256, DART_GRAMMAR_VERSION, sha256 } from "./dart-source.js";

const DEFAULT_CALLBACKS = new Set([
  "onPressed", "onTap", "onLongPress", "onChanged", "onSelected", "onSubmitted",
  "onFieldSubmitted", "onEditingComplete", "onDismissed", "onDismiss", "onToggle",
  "onIncrease", "onDecrease", "onDestinationSelected", "onExpansionChanged",
]);

const KNOWN_WIDGETS: Readonly<Record<string, InteractionKind>> = {
  ElevatedButton: "button", FilledButton: "button", OutlinedButton: "button",
  TextButton: "button", IconButton: "button", FloatingActionButton: "button",
  CupertinoButton: "button", BackButton: "navigation", CloseButton: "navigation",
  MenuItemButton: "button", SubmenuButton: "button", SegmentedButton: "selection",
  ToggleButtons: "toggle", TextField: "textInput", TextFormField: "textInput",
  CupertinoTextField: "textInput", EditableText: "textInput", SearchBar: "textInput",
  DropdownButton: "selection", DropdownButtonFormField: "selection",
  PopupMenuButton: "selection", MenuAnchor: "selection", Radio: "selection",
  RadioListTile: "selection", Checkbox: "toggle", CheckboxListTile: "toggle",
  Switch: "toggle", SwitchListTile: "toggle", CupertinoSwitch: "toggle",
  Slider: "slider", RangeSlider: "slider", CupertinoSlider: "slider",
  InkWell: "gesture", InkResponse: "gesture", GestureDetector: "gesture",
  Dismissible: "gesture", Draggable: "gesture", LongPressDraggable: "gesture",
  ListTile: "navigation", NavigationRail: "navigation", NavigationBar: "navigation",
  BottomNavigationBar: "navigation", TabBar: "navigation",
};

const OPAQUE_WIDGETS: Readonly<Record<string, string>> = {
  WebView: "WebView contents require a DOM/runtime adapter.",
  WebViewWidget: "WebView contents require a DOM/runtime adapter.",
  AndroidView: "Native Android view contents are opaque to Dart source scanning.",
  UiKitView: "Native iOS view contents are opaque to Dart source scanning.",
  PlatformViewLink: "Platform view contents require runtime inspection.",
  GoogleMap: "Map hit regions require runtime inspection or manual declarations.",
  CustomPaint: "Custom-painted hit regions cannot be inferred statically.",
};


function expressionState(expression: string | undefined): AutomationState {
  if (!expression) {
    return "missing";
  }
  return stringValue(expression) === undefined ? "dynamic" : "present";
}

function enclosingClassName(node: SyntaxNode): string | undefined {
  let current: SyntaxNode | null = node;
  while (current) {
    if (current.type === "class_definition") {
      return /\bclass\s+([A-Za-z_$][\w$]*)/.exec(current.text.slice(0, 300))?.[1];
    }
    current = current.parent;
  }
  return undefined;
}

function isInConstContext(node: SyntaxNode, startOffset: number): boolean {
  if (/^const\b/.test(node.tree.rootNode.text.slice(startOffset, Math.min(startOffset + 12, node.tree.rootNode.endIndex)))) {
    return true;
  }
  let current: SyntaxNode | null = node.parent;
  while (current) {
    if (current.type === "const_object_expression" || current.type === "const_list_literal" || current.type === "const_set_or_map_literal") {
      return true;
    }
    current = current.parent;
  }
  return false;
}

function cleanIdentifierPart(value: string): string {
  return value
    .replace(/(?<=[a-z0-9])(?:Screen|Page|View|Widget|State)$/, "")
    .replace(/_(?:screen|page|view|widget|state)$/i, "")
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .replace(/[^A-Za-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .toLowerCase() || "app";
}

/** Directory names that carry no feature meaning in an identifier. */
const GENERIC_PATH_SEGMENTS = new Set([
  "lib", "app", "src", "views", "view", "screens", "screen", "pages", "page", "components", "component",
  "widgets", "widget", "shared", "common", "features", "feature", "presentation", "ui", "core",
]);

/** `lib/features/auth/login_screen.dart` -> `auth.login`; falls back to the enclosing class name. */
function identifierScope(relativePath: string, className: string | undefined): string {
  const segments = relativePath.replace(/\.dart$/, "").split("/");
  const file = cleanIdentifierPart(segments[segments.length - 1] ?? "");
  const directories = segments.slice(0, -1)
    .filter((segment) => !GENERIC_PATH_SEGMENTS.has(segment.toLowerCase()))
    .map(cleanIdentifierPart)
    .slice(-2);
  const parts = [...directories];
  if (file && file !== "app" && !["main", "index"].includes(file) && file !== directories[directories.length - 1]) {
    parts.push(file);
  }
  return parts.length ? parts.join(".") : cleanIdentifierPart(className ?? "app");
}

function suggestedIdentifier(invocation: Invocation, nested: Invocation[], relativePath: string): string {
  const scope = identifierScope(relativePath, enclosingClassName(invocation.node));
  const textCall = nested.find((candidate) => candidate.widgetType === "Text" && candidate.positional.length > 0);
  const visibleText = stringValue(textCall?.positional[0]?.text);
  const expressionIntent = textCall?.positional[0]?.text
    ?.replace(/\([^)]*\)/g, "")
    .split(".").pop()
    ?.replace(/Label$/i, "");
  // Project widgets usually take their caption as an argument (text:, title:, label:) instead of a Text child.
  const captionExpression = TEXT_ARGUMENTS.map((name) => invocation.named.get(name)?.text).find((value) => !!value);
  const captionLiteral = stringValue(captionExpression);
  const captionIntent = captionExpression && /^[A-Za-z_$][\w$.!?]*$/.test(captionExpression)
    ? captionExpression.split(".").pop()?.replace(/[!?]/g, "").replace(/Label$/i, "")
    : undefined;
  let action = visibleText
    ? cleanIdentifierPart(visibleText)
    : expressionIntent ? cleanIdentifierPart(expressionIntent)
      : captionLiteral ? cleanIdentifierPart(captionLiteral)
        : captionIntent ? cleanIdentifierPart(captionIntent) : cleanIdentifierPart(invocation.widgetType);
  const callback = [...invocation.named.keys()].find((name) => DEFAULT_CALLBACKS.has(name));
  if (!visibleText && !expressionIntent && !captionLiteral && !captionIntent && callback) {
    action = cleanIdentifierPart(callback.replace(/^on/, ""));
  }
  return `${scope}.${action}`;
}

function firstExpression(invocations: Invocation[], names: string[]): string | undefined {
  for (const invocation of invocations) {
    for (const name of names) {
      const value = invocation.named.get(name)?.text;
      if (value && value !== "null") {
        return value;
      }
    }
  }
  return undefined;
}

type ValueSpanLike = { text: string; startOffset: number; endOffset: number };

function namedArgument(invocation: Invocation, names: string[]): ValueSpanLike | undefined {
  for (const name of names) {
    const value = invocation.named.get(name);
    if (value && value.text !== "null") {
      return value;
    }
  }
  return undefined;
}

/** Where a new named argument goes in an invocation, so it can be appended without touching positional arguments. */
function argumentInsertion(invocation: Invocation, source: string): NonNullable<SemanticsEvidence["argumentInsert"]> {
  const args = invocation.node.namedChildren.filter((child) => child.type === "named_argument" || child.type === "argument");
  const last = args[args.length - 1];
  if (!last) {
    return { offset: invocation.argumentsStart + 1, leadingComma: false, empty: true };
  }
  const tail = source.slice(last.endIndex, invocation.argumentsEnd - 1);
  const comma = tail.indexOf(",");
  return comma >= 0
    ? { offset: last.endIndex + comma + 1, leadingComma: false, empty: false }
    : { offset: last.endIndex, leadingComma: true, empty: false };
}

function buildSemanticsEvidence(
  findingInvocation: Invocation,
  allInvocations: Invocation[],
  semanticsOwners: Map<Invocation, Invocation | undefined>,
  relativePath: string,
  source: string,
  hash: string,
  contract: SemanticsContract | undefined,
): SemanticsEvidence {
  const nested = allInvocations.filter((candidate) =>
    candidate.startOffset >= findingInvocation.startOffset && candidate.endOffset <= findingInvocation.endOffset,
  );
  const owner = semanticsOwners.get(findingInvocation);
  const properties = owner
    ? allInvocations.find((candidate) => candidate.widgetType === "SemanticsProperties" && candidate.startOffset > owner.startOffset && candidate.endOffset < owner.endOffset)
    : undefined;
  const argumentOwner = properties ?? owner;
  // The widget's own parameters (resolved contract, else the conventional names) count as much as a wrapper.
  const identifierNames = contract?.identifier ? [contract.identifier.name]
    : contract?.prefix ? [contract.prefix.name]
      : [...DEFAULT_IDENTIFIER_ARGS, ...DEFAULT_PREFIX_ARGS];
  const contractIdentifier = namedArgument(findingInvocation, identifierNames);
  const contractLabel = namedArgument(findingInvocation, contract?.label ? [contract.label.name, ...DEFAULT_LABEL_ARGS] : DEFAULT_LABEL_ARGS);
  const contractHint = namedArgument(findingInvocation, contract?.hint ? [contract.hint.name, ...DEFAULT_HINT_ARGS] : DEFAULT_HINT_ARGS);
  const wrapperIdentifier = argumentOwner?.named.get("identifier");
  const identifier = wrapperIdentifier ?? contractIdentifier;
  const label = owner?.named.get("label")?.text ?? properties?.named.get("label")?.text ??
    contractLabel?.text ?? firstExpression(nested, ["semanticLabel", "labelText"]);
  const hint = owner?.named.get("hint")?.text ?? properties?.named.get("hint")?.text ??
    contractHint?.text ?? firstExpression(nested, ["hintText"]);
  const tooltip = firstExpression(nested, ["tooltip"]);
  const localizedCandidates = [label, hint, tooltip]
    .filter((value): value is string => !!value && value !== "null" && stringValue(value) === undefined);
  return {
    identifierExpression: identifier?.text,
    labelExpression: label,
    hintExpression: hint,
    tooltipExpression: tooltip,
    keyExpression: findingInvocation.named.get("key")?.text,
    roleExpression: owner?.named.get("role")?.text ?? properties?.named.get("role")?.text,
    wrapper: owner ? reference(relativePath, source, hash, owner.startOffset, owner.endOffset) : undefined,
    identifierValue: identifier ? reference(relativePath, source, hash, identifier.startOffset, identifier.endOffset) : undefined,
    identifierInsertOffset: argumentOwner ? argumentOwner.argumentsStart + 1 : undefined,
    usesPropertiesConstructor: !!properties,
    argumentInsert: argumentInsertion(findingInvocation, source),
    viaWidgetContract: !wrapperIdentifier && !!contractIdentifier,
    localizedCandidates: [...new Set(localizedCandidates)],
  };
}

const TEXT_ARGUMENTS = ["text", "title", "label", "caption", "name", "content", "hint", "placeholder"];

function accessibilityState(kind: InteractionKind, invocation: Invocation, nested: Invocation[], evidence: SemanticsEvidence): AccessibilityState {
  if (evidence.labelExpression || evidence.hintExpression || evidence.tooltipExpression) {
    return "ready";
  }
  if (kind === "opaque" || kind === "custom") {
    return "uncertain";
  }
  if (["button", "navigation"].includes(kind)) {
    const text = nested.find((candidate) => candidate.widgetType === "Text" && candidate.positional[0]?.text !== "");
    return text ? "ready" : "missing";
  }
  if (kind === "textInput") {
    return firstExpression(nested, ["labelText", "hintText", "semanticLabel"]) ? "ready" : "missing";
  }
  if (["gesture", "selection", "toggle", "slider"].includes(kind)) {
    return "uncertain";
  }
  return "uncertain";
}

function resolveInvocation(
  index: ProjectWidgetIndex,
  relativePath: string,
  invocation: Invocation,
  explicitKind: InteractionKind | undefined,
  opaqueReason: string | undefined,
): { resolved?: ResolvedWidget; ambiguousWith?: string[] } {
  if (opaqueReason) {
    return {};
  }
  const resolution = index.resolve(relativePath, invocation.widgetType);
  const { definition } = resolution;
  if (!definition) {
    return resolution.ambiguous.length
      ? { ambiguousWith: resolution.ambiguous.map((candidate) => candidate.path) }
      : {};
  }
  // A project class that shares a name with an SDK widget only wins when it is really imported.
  if (explicitKind && resolution.resolution !== "imports") {
    return {};
  }
  const segments = invocation.callee.split(".");
  const constructorName = segments[segments.indexOf(invocation.widgetType) + 1] ?? "";
  return {
    resolved: {
      className: definition.className,
      path: definition.path,
      line: definition.line,
      shared: false,
      composite: false,
      layer: 0,
      contract: definition.contracts.get(constructorName) ?? definition.contract,
      hasVisibleText: definition.hasVisibleText,
      passesText: TEXT_ARGUMENTS.some((name) => invocation.named.has(name)),
      resolution: resolution.resolution ?? "imports",
    },
  };
}

async function scanFile(
  root: string,
  absolutePath: string,
  language: Language,
  options: InteractiveScannerOptions,
  index: ProjectWidgetIndex,
  interactiveControls: Set<string>,
): Promise<{ findings: InteractiveFinding[]; parseError: boolean }> {
  const source = fs.readFileSync(absolutePath, "utf8");
  const relativePath = normalizePath(path.relative(root, absolutePath));
  const hash = sha256(source);
  const parser = new Parser();
  parser.setLanguage(language);
  const tree = parser.parse(source);
  if (!tree) {
    parser.delete();
    return { findings: [], parseError: true };
  }
  const invocations = tree.rootNode.descendantsOfType("arguments")
    .map((node) => invocationFromArguments(node, source))
    .filter((value): value is Invocation => !!value)
    .sort((left, right) => left.startOffset - right.startOffset || right.endOffset - left.endOffset);
  const callbacks = new Set([...DEFAULT_CALLBACKS, ...(options.callbackNames ?? [])]);
  const customWidgets = new Set(options.customWidgets ?? []);
  const ignoredWidgets = new Set(options.ignoredWidgets ?? []);
  const candidates = invocations.filter((invocation) => {
    if (ignoredWidgets.has(invocation.widgetType) || invocation.widgetType === "SemanticsProperties") {
      return false;
    }
    if (KNOWN_WIDGETS[invocation.widgetType] || OPAQUE_WIDGETS[invocation.widgetType] || customWidgets.has(invocation.widgetType)) {
      return true;
    }
    // An invocation of a project control that contains an interactive root is interactive, whatever its callbacks are called.
    const definition = index.resolve(relativePath, invocation.widgetType).definition;
    if (definition && interactiveControls.has(`${definition.path}#${definition.className}`)) {
      return true;
    }
    return [...invocation.named.entries()].some(([name, value]) => callbacks.has(name) && value.text !== "null");
  });
  const semanticsCalls = invocations.filter((invocation) => invocation.widgetType === "Semantics");
  const semanticsOwners = new Map<Invocation, Invocation | undefined>();
  for (const candidate of candidates) {
    const owners = semanticsCalls
      .filter((owner) => owner.startOffset < candidate.startOffset && owner.endOffset >= candidate.endOffset &&
        !!owner.named.get("child") && owner.named.get("child")!.startOffset <= candidate.startOffset && owner.named.get("child")!.endOffset >= candidate.endOffset)
      .sort((left, right) => (left.endOffset - left.startOffset) - (right.endOffset - right.startOffset));
    const owner = owners[0];
    if (owner) {
      const child = owner.named.get("child")!;
      const ownedCandidates = candidates.filter((other) => other.startOffset >= child.startOffset && other.endOffset <= child.endOffset);
      semanticsOwners.set(candidate, ownedCandidates.length === 1 ? owner : undefined);
    }
  }

  const findings: InteractiveFinding[] = candidates.map((invocation) => {
    const explicitKind = KNOWN_WIDGETS[invocation.widgetType];
    const opaqueReason = OPAQUE_WIDGETS[invocation.widgetType];
    const kind: InteractionKind = opaqueReason ? "opaque" : explicitKind ?? "custom";
    const callbackEntries = [...invocation.named.entries()].filter(([name]) => callbacks.has(name));
    const callbackNames = callbackEntries.map(([name]) => name);
    const enabled = callbackEntries.length === 0
      ? "unknown"
      : callbackEntries.every(([, value]) => value.text === "null") ? "disabled" : "enabled";
    const nested = invocations.filter((candidate) => candidate.startOffset >= invocation.startOffset && candidate.endOffset <= invocation.endOffset);
    const { resolved, ambiguousWith } = resolveInvocation(index, relativePath, invocation, explicitKind, opaqueReason);
    const semantics = buildSemanticsEvidence(invocation, invocations, semanticsOwners, relativePath, source, hash, resolved?.contract);
    const owner = index.ownerAt(relativePath, invocation.startOffset);
    return {
      occurrenceId: sha256(`${relativePath}:${invocation.startOffset}:${invocation.endOffset}:${invocation.widgetType}:${hash}`).slice(0, 24),
      widgetType: invocation.widgetType,
      kind,
      callbacks: callbackNames,
      confidence: explicitKind || opaqueReason || customWidgets.has(invocation.widgetType) || resolved ? "high" : "medium",
      enabled,
      source: reference(relativePath, source, hash, invocation.startOffset, invocation.endOffset),
      semantics,
      accessibility: accessibilityState(kind, invocation, nested, semantics),
      automation: expressionState(semantics.identifierExpression),
      suggestedIdentifier: suggestedIdentifier(invocation, nested, relativePath),
      opaqueReason,
      inConstContext: isInConstContext(invocation.node, invocation.startOffset),
      role: resolved ? "local-call-site" : "sdk",
      remediation: "wrap",
      owner: owner ? { className: owner.className, path: owner.path } : undefined,
      resolved,
      ambiguousWith,
    };
  });

  const literalCounts = new Map<string, number>();
  for (const finding of findings) {
    const literal = stringValue(finding.semantics.identifierExpression);
    if (literal) {
      literalCounts.set(literal, (literalCounts.get(literal) ?? 0) + 1);
    }
  }
  for (const finding of findings) {
    const literal = stringValue(finding.semantics.identifierExpression);
    if (literal && (literalCounts.get(literal) ?? 0) > 1) {
      finding.automation = "duplicate";
    }
  }
  const parseError = tree.rootNode.hasError;
  tree.delete();
  parser.delete();
  return { findings, parseError };
}

export async function scanInteractives(rootPath: string, options: InteractiveScannerOptions = {}): Promise<InteractiveScanResult> {
  const root = path.resolve(rootPath);
  const language = await loadDartLanguage();
  const { files, excluded } = collectDartFiles(root, options.excludedGlobs ?? []);
  const diagnostics: InteractiveScanResult["diagnostics"] = [];
  const index = await buildWidgetIndex(root, files, language);

  // Which project widgets are interactive controls depends on the findings inside them, and their call
  // sites are findings too, so scan until that set is stable (a wrapper of a wrapper needs a second pass).
  let interactiveControls = new Set<string>();
  let allFindings: InteractiveFinding[] = [];
  for (let round = 0; round < 4; round++) {
    diagnostics.length = 0;
    allFindings = [];
    for (const file of files) {
      try {
        const result = await scanFile(root, file, language, options, index, interactiveControls);
        allFindings.push(...result.findings);
        if (result.parseError) {
          diagnostics.push({
            path: normalizePath(path.relative(root, file)),
            severity: "warning",
            message: "The Dart parser reported syntax errors; findings from this file may be incomplete.",
          });
        }
      } catch (error) {
        diagnostics.push({
          path: normalizePath(path.relative(root, file)),
          severity: "error",
          message: error instanceof Error ? error.message : String(error),
        });
      }
    }
    const next = interactiveWidgetKeys(allFindings, index, options);
    const stable = next.size === interactiveControls.size && [...next].every((key) => interactiveControls.has(key));
    interactiveControls = next;
    if (stable) {
      break;
    }
  }

  const { widgets, composites } = analyzeSharedWidgets(index, allFindings, options);

  const globalLiteralCounts = new Map<string, number>();
  for (const finding of allFindings) {
    const literal = stringValue(finding.semantics.identifierExpression);
    if (literal) {
      globalLiteralCounts.set(literal, (globalLiteralCounts.get(literal) ?? 0) + 1);
    }
  }
  for (const finding of allFindings) {
    const literal = stringValue(finding.semantics.identifierExpression);
    if (literal && (globalLiteralCounts.get(literal) ?? 0) > 1) {
      finding.automation = "duplicate";
    }
  }

  const byFile = new Map<string, InteractiveFinding[]>();
  for (const finding of allFindings) {
    const list = byFile.get(finding.source.path) ?? [];
    list.push(finding);
    byFile.set(finding.source.path, list);
  }
  const groups: InteractiveFileGroup[] = [...byFile.entries()].map(([filePath, findings]) => ({
    path: filePath,
    primaryReference: findings[0].source,
    readyCount: findings.filter((finding) => finding.automation === "present" && finding.accessibility === "ready").length,
    issueCount: findings.filter((finding) => finding.automation !== "present" || finding.accessibility !== "ready").length,
    findings,
  }));

  return {
    schemaVersion: 1,
    projectRoot: root,
    scannedAt: new Date().toISOString(),
    totals: {
      filesScanned: files.length,
      findings: allFindings.length,
      automationReady: allFindings.filter((finding) => finding.automation === "present").length,
      automationMissing: allFindings.filter((finding) => finding.automation === "missing").length,
      automationDynamic: allFindings.filter((finding) => finding.automation === "dynamic").length,
      automationDuplicate: allFindings.filter((finding) => finding.automation === "duplicate").length,
      accessibilityReady: allFindings.filter((finding) => finding.accessibility === "ready").length,
      accessibilityMissing: allFindings.filter((finding) => finding.accessibility === "missing").length,
      accessibilityUncertain: allFindings.filter((finding) => finding.accessibility === "uncertain").length,
      opaque: allFindings.filter((finding) => finding.kind === "opaque").length,
      sharedWidgets: widgets.length,
      sharedWidgetsMissingContract: widgets.filter((widget) => widget.requiredParamsToAdd.length > 0 || widget.contract.status !== "complete").length,
      callSitesMissingContract: allFindings.filter((finding) => finding.role === "shared-call-site" && finding.automation !== "present").length,
      composites: composites.length,
      compositeCallSitesMissing: composites.reduce((total, composite) => total + composite.callSitesMissing, 0),
    },
    excludedPaths: excluded,
    diagnostics,
    groups,
    widgets,
    composites,
  };
}

export function flattenInteractiveFindings(result: InteractiveScanResult): InteractiveFinding[] {
  return result.groups.flatMap((group) => group.findings);
}

export async function validateDartSyntax(source: string): Promise<boolean> {
  const parser = new Parser();
  parser.setLanguage(await loadDartLanguage());
  const tree = parser.parse(source);
  const valid = !!tree && !tree.rootNode.hasError;
  tree?.delete();
  parser.delete();
  return valid;
}
