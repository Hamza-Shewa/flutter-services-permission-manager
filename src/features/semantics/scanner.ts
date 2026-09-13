import * as crypto from "crypto";
import * as fs from "fs";
import * as path from "path";
import { Language, Node as SyntaxNode, Parser } from "web-tree-sitter";
import type {
  AccessibilityState,
  AutomationState,
  InteractiveFinding,
  InteractiveFileGroup,
  InteractiveScannerOptions,
  InteractiveScanResult,
  InteractionKind,
  SemanticsEvidence,
  SourceReference,
} from "./types.js";

export const DART_GRAMMAR_VERSION = "@lumis-sh/wasm-dart@0.26.3";
export const DART_GRAMMAR_SHA256 = "f743e6ecda0447cf330d012e9c8dc4f784d2a8874dbdec4b929b0dde87faec79";

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

interface ValueSpan {
  text: string;
  startOffset: number;
  endOffset: number;
}

interface Invocation {
  widgetType: string;
  callee: string;
  startOffset: number;
  endOffset: number;
  argumentsStart: number;
  argumentsEnd: number;
  named: Map<string, ValueSpan>;
  positional: ValueSpan[];
  node: SyntaxNode;
}

let parserInitialization: Promise<Language> | undefined;

export function sha256(value: string | Buffer): string {
  return crypto.createHash("sha256").update(value).digest("hex");
}

async function loadDartLanguage(): Promise<Language> {
  if (!parserInitialization) {
    parserInitialization = (async () => {
      const runtimePath = require.resolve("web-tree-sitter/web-tree-sitter.wasm");
      const grammarPath = require.resolve("@lumis-sh/wasm-dart/tree-sitter-dart.wasm");
      const actualHash = sha256(fs.readFileSync(grammarPath));
      if (actualHash !== DART_GRAMMAR_SHA256) {
        throw new Error(`Dart parser checksum mismatch: expected ${DART_GRAMMAR_SHA256}, got ${actualHash}`);
      }
      await Parser.init({ locateFile: () => runtimePath });
      return Language.load(grammarPath);
    })();
  }
  return parserInitialization;
}

function normalizePath(value: string): string {
  return value.split(path.sep).join("/");
}

function globToRegExp(glob: string): RegExp {
  let pattern = "^";
  for (let index = 0; index < glob.length; index++) {
    const char = glob[index];
    if (char === "*" && glob[index + 1] === "*") {
      pattern += ".*";
      index++;
    } else if (char === "*") {
      pattern += "[^/]*";
    } else if (char === "?") {
      pattern += "[^/]";
    } else {
      pattern += char.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    }
  }
  return new RegExp(`${pattern}$`);
}

function isGenerated(relativePath: string): boolean {
  return /(?:\.g|\.freezed|\.gr|\.config|\.mocks)\.dart$/i.test(relativePath) ||
    relativePath.includes("/generated/") || relativePath.includes("/gen/");
}

function collectDartFiles(root: string, excludedGlobs: string[]): { files: string[]; excluded: string[] } {
  const libRoot = path.join(root, "lib");
  const files: string[] = [];
  const excluded: string[] = [];
  const excludes = excludedGlobs.map(globToRegExp);
  if (!fs.existsSync(libRoot)) {
    return { files, excluded };
  }
  const stack = [libRoot];
  while (stack.length > 0) {
    const directory = stack.pop()!;
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      if (entry.isSymbolicLink()) {
        continue;
      }
      const absolute = path.join(directory, entry.name);
      const relative = normalizePath(path.relative(root, absolute));
      if (entry.isDirectory()) {
        if (["build", ".dart_tool", "node_modules"].includes(entry.name)) {
          excluded.push(relative);
        } else {
          stack.push(absolute);
        }
        continue;
      }
      if (!entry.isFile() || !entry.name.endsWith(".dart")) {
        continue;
      }
      if (isGenerated(relative) || excludes.some((regex) => regex.test(relative))) {
        excluded.push(relative);
      } else {
        files.push(absolute);
      }
    }
  }
  return { files: files.sort(), excluded: excluded.sort() };
}

function getWidgetType(callee: string): string | undefined {
  const segments = callee.split(".").filter(Boolean);
  return segments.find((segment) => /^[A-Z]/.test(segment));
}

function invocationFromArguments(node: SyntaxNode, source: string): Invocation | undefined {
  const prefixStart = Math.max(0, node.startIndex - 500);
  const prefix = source.slice(prefixStart, node.startIndex);
  const match = /(?:const\s+|new\s+)?([A-Za-z_$][\w$]*(?:\s*\.\s*[A-Za-z_$][\w$]*)*)\s*(?:<[^<>\n]*>)?\s*$/.exec(prefix);
  if (!match) {
    return undefined;
  }
  const callee = match[1].replace(/\s+/g, "");
  const widgetType = getWidgetType(callee);
  if (!widgetType) {
    return undefined;
  }
  const leading = match[0].search(/\S/);
  const startOffset = prefixStart + match.index + Math.max(0, leading);
  const named = new Map<string, ValueSpan>();
  const positional: ValueSpan[] = [];
  for (const child of node.namedChildren) {
    if (child.type === "named_argument") {
      const label = child.namedChildren.find((candidate) => candidate.type === "label");
      const name = label?.namedChildren.find((candidate) => candidate.type === "identifier")?.text;
      const valueNodes = child.namedChildren.filter((candidate) => candidate !== label);
      const firstValue = valueNodes[0];
      const lastValue = valueNodes[valueNodes.length - 1];
      if (name && firstValue && lastValue) {
        named.set(name, {
          text: source.slice(firstValue.startIndex, lastValue.endIndex).trim(),
          startOffset: firstValue.startIndex,
          endOffset: lastValue.endIndex,
        });
      }
    } else if (child.type === "argument") {
      positional.push({ text: child.text.trim(), startOffset: child.startIndex, endOffset: child.endIndex });
    }
  }
  return {
    widgetType,
    callee,
    startOffset,
    endOffset: node.endIndex,
    argumentsStart: node.startIndex,
    argumentsEnd: node.endIndex,
    named,
    positional,
    node,
  };
}

function offsetPosition(source: string, offset: number): { line: number; column: number } {
  let line = 1;
  let lastBreak = -1;
  for (let index = 0; index < offset; index++) {
    if (source.charCodeAt(index) === 10) {
      line++;
      lastBreak = index;
    }
  }
  return { line, column: offset - lastBreak };
}

function reference(relativePath: string, source: string, hash: string, startOffset: number, endOffset: number): SourceReference {
  const start = offsetPosition(source, startOffset);
  const end = offsetPosition(source, endOffset);
  return {
    path: relativePath,
    line: start.line,
    column: start.column,
    endLine: end.line,
    endColumn: end.column,
    startOffset,
    endOffset,
    sourceHash: hash,
  };
}

function stringValue(expression: string | undefined): string | undefined {
  if (!expression) {
    return undefined;
  }
  const match = /^(?:r)?(['"])([\s\S]*)\1$/.exec(expression.trim());
  return match && !match[2].includes("$") ? match[2] : undefined;
}

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
    .replace(/(?:Screen|Page|View|Widget|State)$/i, "")
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .replace(/[^A-Za-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .toLowerCase() || "app";
}

function suggestedIdentifier(invocation: Invocation, nested: Invocation[]): string {
  const scope = cleanIdentifierPart(enclosingClassName(invocation.node) ?? "app");
  const textCall = nested.find((candidate) => candidate.widgetType === "Text" && candidate.positional.length > 0);
  const visibleText = stringValue(textCall?.positional[0]?.text);
  const expressionIntent = textCall?.positional[0]?.text
    ?.replace(/\([^)]*\)/g, "")
    .split(".").pop()
    ?.replace(/Label$/i, "");
  let action = visibleText
    ? cleanIdentifierPart(visibleText)
    : expressionIntent ? cleanIdentifierPart(expressionIntent) : cleanIdentifierPart(invocation.widgetType);
  const callback = [...invocation.named.keys()].find((name) => DEFAULT_CALLBACKS.has(name));
  if (!visibleText && !expressionIntent && callback) {
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

function buildSemanticsEvidence(
  findingInvocation: Invocation,
  allInvocations: Invocation[],
  semanticsOwners: Map<Invocation, Invocation | undefined>,
  relativePath: string,
  source: string,
  hash: string,
): SemanticsEvidence {
  const nested = allInvocations.filter((candidate) =>
    candidate.startOffset >= findingInvocation.startOffset && candidate.endOffset <= findingInvocation.endOffset,
  );
  const owner = semanticsOwners.get(findingInvocation);
  const properties = owner
    ? allInvocations.find((candidate) => candidate.widgetType === "SemanticsProperties" && candidate.startOffset > owner.startOffset && candidate.endOffset < owner.endOffset)
    : undefined;
  const argumentOwner = properties ?? owner;
  const identifier = argumentOwner?.named.get("identifier");
  const label = owner?.named.get("label")?.text ?? properties?.named.get("label")?.text ??
    firstExpression(nested, ["semanticLabel", "labelText"]);
  const hint = owner?.named.get("hint")?.text ?? properties?.named.get("hint")?.text ??
    firstExpression(nested, ["hintText"]);
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
    localizedCandidates: [...new Set(localizedCandidates)],
  };
}

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

async function scanFile(
  root: string,
  absolutePath: string,
  language: Language,
  options: InteractiveScannerOptions,
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
    const semantics = buildSemanticsEvidence(invocation, invocations, semanticsOwners, relativePath, source, hash);
    return {
      occurrenceId: sha256(`${relativePath}:${invocation.startOffset}:${invocation.endOffset}:${invocation.widgetType}:${hash}`).slice(0, 24),
      widgetType: invocation.widgetType,
      kind,
      callbacks: callbackNames,
      confidence: explicitKind || opaqueReason || customWidgets.has(invocation.widgetType) ? "high" : "medium",
      enabled,
      source: reference(relativePath, source, hash, invocation.startOffset, invocation.endOffset),
      semantics,
      accessibility: accessibilityState(kind, invocation, nested, semantics),
      automation: expressionState(semantics.identifierExpression),
      suggestedIdentifier: suggestedIdentifier(invocation, nested),
      opaqueReason,
      inConstContext: isInConstContext(invocation.node, invocation.startOffset),
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
  const allFindings: InteractiveFinding[] = [];
  for (const file of files) {
    try {
      const result = await scanFile(root, file, language, options);
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
    },
    excludedPaths: excluded,
    diagnostics,
    groups,
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
