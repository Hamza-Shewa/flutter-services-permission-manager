import * as fs from "fs";
import * as path from "path";
import { Language, Node as SyntaxNode, Parser } from "web-tree-sitter";
import { invocationFromArguments, normalizePath, offsetPosition, type Invocation } from "./dart-source.js";
import type {
  ContractParam,
  InteractiveFinding,
  InteractiveScannerOptions,
  Remediation,
  SemanticsContract,
  SharedWidgetSummary,
} from "./types.js";

/**
 * Project widget index: which project-owned widget classes exist, what their
 * constructors accept, and which definition every widget invocation resolves
 * to (through relative imports, `package:` imports and `export` barrels).
 *
 * It is a name + import-graph resolver, not the Dart analyzer: when a name
 * cannot be told apart it is reported as ambiguous instead of guessed.
 */

const WIDGET_BASES = new Set([
  "StatelessWidget", "StatefulWidget", "ConsumerWidget", "ConsumerStatefulWidget",
  "HookWidget", "HookConsumerWidget", "StatefulHookWidget",
]);
const STATE_BASES = new Set(["State", "ConsumerState", "HookConsumerState"]);

const IDENTIFIER_PARAM = /^(?:semantics?(?:Identifier|Id)|automationId|testId|identifier)$/i;
const LABEL_PARAM = /^(?:semantics?Label|tooltip)$/i;
const HINT_PARAM = /^semantics?Hint$/i;
const PREFIX_PARAM = /^(?:semantics?(?:Identifier|Id)?Prefix|identifierPrefix|automationPrefix)$/i;

/** Names a semantics parameter is matched with when the invoked widget cannot be resolved. */
export const DEFAULT_IDENTIFIER_ARGS = ["semanticsIdentifier", "semanticIdentifier", "semanticsId", "semanticId", "automationId", "testId"];
export const DEFAULT_LABEL_ARGS = ["semanticsLabel", "semanticLabel"];
export const DEFAULT_HINT_ARGS = ["semanticsHint", "semanticHint"];
export const DEFAULT_PREFIX_ARGS = ["semanticsIdentifierPrefix", "semanticIdentifierPrefix", "semanticsPrefix", "identifierPrefix"];

/** Directories (relative to lib/) whose controls are shared by design, even before they have many call sites. */
const DEFAULT_SHARED_DIRS = ["shared", "common", "components", "widgets", "core/widgets", "core/ui", "design_system", "ui_kit", "uikit"];
const VISIBLE_TEXT = /\b(?:Text|RichText|SelectableText|AutoSizeText)\s*(?:\.\s*\w+)?\s*\(|\b(?:labelText|hintText)\s*:/;

export interface ParamInfo {
  name: string;
  type?: string;
  required: boolean;
  nullable: boolean;
  hasDefault: boolean;
}

export interface ConstructorInfo {
  /** Empty string for the default constructor. */
  name: string;
  params: ParamInfo[];
}

export interface WidgetDefinition {
  className: string;
  path: string;
  line: number;
  /** Class span plus the span of its State class, if any (offsets in this file). */
  spans: Array<{ start: number; end: number }>;
  constructors: ConstructorInfo[];
  contracts: Map<string, SemanticsContract>;
  contract: SemanticsContract;
  hasVisibleText: boolean;
  existingSemanticsLine?: number;
}

interface ImportEdge {
  kind: "import" | "export";
  target?: string;
  show?: Set<string>;
  hide?: Set<string>;
}

interface FileIndex {
  path: string;
  edges: ImportEdge[];
  definitions: WidgetDefinition[];
  /** Widget name -> number of invocations in this file. */
  invocationCounts: Map<string, number>;
}

export interface WidgetResolution {
  definition?: WidgetDefinition;
  ambiguous: WidgetDefinition[];
  resolution?: "imports" | "unique-name";
}

export interface ProjectWidgetIndex {
  packageName?: string;
  definitions: WidgetDefinition[];
  resolve(fromPath: string, widgetType: string): WidgetResolution;
  ownerAt(filePath: string, offset: number): WidgetDefinition | undefined;
  callCounts: Map<WidgetDefinition, { calls: number; files: Set<string> }>;
}

function readPackageName(root: string): string | undefined {
  try {
    const pubspec = fs.readFileSync(path.join(root, "pubspec.yaml"), "utf8");
    return /^name:\s*([A-Za-z0-9_]+)/m.exec(pubspec)?.[1];
  } catch {
    return undefined;
  }
}

function unquote(value: string): string {
  return value.trim().replace(/^['"]|['"]$/g, "");
}

function combinatorNames(node: SyntaxNode, keyword: "show" | "hide"): Set<string> | undefined {
  const names = node.descendantsOfType("combinator")
    .filter((combinator) => combinator.text.trim().startsWith(keyword))
    .flatMap((combinator) => combinator.text.trim().slice(keyword.length).split(",").map((name) => name.trim()).filter(Boolean));
  return names.length ? new Set(names) : undefined;
}

function resolveImportTarget(uri: string, fromPath: string, packageName: string | undefined, known: Set<string>): string | undefined {
  if (uri.startsWith("dart:")) {
    return undefined;
  }
  let candidate: string;
  if (uri.startsWith("package:")) {
    const match = /^package:([^/]+)\/(.+)$/.exec(uri);
    if (!match || match[1] !== packageName) {
      return undefined;
    }
    candidate = `lib/${match[2]}`;
  } else {
    candidate = path.posix.normalize(path.posix.join(path.posix.dirname(fromPath), uri));
  }
  return known.has(candidate) ? candidate : undefined;
}

function baseOf(classNode: SyntaxNode): { base?: string; typeArg?: string } {
  const superclass = classNode.namedChildren.find((child) => child.type === "superclass");
  const match = superclass && /extends\s+([A-Za-z_$][\w$]*)(?:\s*<\s*([A-Za-z_$][\w$]*))?/.exec(superclass.text);
  return { base: match?.[1], typeArg: match?.[2] };
}

function paramInfo(node: SyntaxNode, source: string, fieldNullable: Map<string, boolean>): ParamInfo | undefined {
  const bound = node.namedChildren.find((child) => child.type === "constructor_param" || child.type === "super_formal_parameter");
  const identifiers = (bound ?? node).namedChildren.filter((child) => child.type === "identifier");
  const name = identifiers[identifiers.length - 1]?.text;
  if (!name) {
    return undefined;
  }
  const text = node.text.trim();
  const before = source.slice(Math.max(0, node.startIndex - 24), node.startIndex);
  const required = /\brequired\s+(?:(?:covariant|final)\s+)?$/.test(before);
  const typed = !bound;
  const type = typed ? text.slice(0, text.lastIndexOf(name)).trim() || undefined : undefined;
  const nullable = typed ? !!type && type.endsWith("?") : fieldNullable.get(name) ?? false;
  const sibling = node.nextNamedSibling;
  return { name, type, required, nullable, hasDefault: !!sibling && sibling.type !== "formal_parameter" };
}

function constructorsOf(classNode: SyntaxNode, className: string, source: string): ConstructorInfo[] {
  const body = classNode.namedChildren.find((child) => child.type === "class_body");
  if (!body) {
    return [];
  }
  const fieldNullable = new Map<string, boolean>();
  for (const declaration of body.namedChildren.filter((child) => child.type === "declaration")) {
    const list = declaration.namedChildren.find((child) => child.type === "initialized_identifier_list");
    if (!list) {
      continue;
    }
    const header = declaration.text.slice(0, list.startIndex - declaration.startIndex);
    for (const item of list.namedChildren.filter((child) => child.type === "initialized_identifier")) {
      const fieldName = item.namedChildren.find((child) => child.type === "identifier")?.text;
      if (fieldName) {
        fieldNullable.set(fieldName, header.includes("?"));
      }
    }
  }
  const constructors: ConstructorInfo[] = [];
  const signatures = body.descendantsOfType(["constant_constructor_signature", "constructor_signature", "factory_constructor_signature"]);
  for (const signature of signatures) {
    const identifiers = signature.namedChildren.filter((child) => child.type === "identifier");
    if (identifiers[0]?.text !== className) {
      continue;
    }
    const list = signature.namedChildren.find((child) => child.type === "formal_parameter_list");
    const params = (list?.descendantsOfType("formal_parameter") ?? [])
      .map((node) => paramInfo(node, source, fieldNullable))
      .filter((value): value is ParamInfo => !!value);
    constructors.push({ name: identifiers.length > 1 ? identifiers[1].text : "", params });
  }
  if (constructors.length === 0) {
    constructors.push({ name: "", params: [] });
  }
  return constructors;
}

function contractParam(param: ParamInfo): ContractParam {
  return { name: param.name, required: param.required, nullable: param.nullable };
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Whether `paramName` is handed to an invocation argument of the given semantic family. */
function isForwarded(paramName: string, invocations: Invocation[], family: RegExp): boolean {
  const usage = new RegExp(`\\b${escapeRegExp(paramName)}\\b`);
  return invocations.some((invocation) =>
    [...invocation.named.entries()].some(([argName, value]) => family.test(argName) && usage.test(value.text)));
}

function contractFor(constructor: ConstructorInfo, invocations: Invocation[]): SemanticsContract {
  const identifier = constructor.params.find((param) => IDENTIFIER_PARAM.test(param.name));
  const prefix = constructor.params.find((param) => PREFIX_PARAM.test(param.name));
  const label = constructor.params.find((param) => LABEL_PARAM.test(param.name));
  const hint = constructor.params.find((param) => HINT_PARAM.test(param.name));
  const identifierFamily = /^(?:identifier|semantics?(?:Identifier|Id)|automationId|testId)$/i;
  const prefixFamily = /^(?:identifier|semantics?(?:Identifier|Id)?Prefix|identifierPrefix|automationPrefix|semantics?(?:Identifier|Id))$/i;
  const forwardedStatus = (param: ParamInfo, family: RegExp) =>
    isForwarded(param.name, invocations, family) ? "complete" as const : "declaredNotForwarded" as const;
  const status = identifier
    ? forwardedStatus(identifier, identifierFamily)
    : prefix ? forwardedStatus(prefix, prefixFamily) : "missing" as const;
  return {
    identifier: identifier && contractParam(identifier),
    prefix: prefix && contractParam(prefix),
    label: label && contractParam(label),
    hint: hint && contractParam(hint),
    status,
  };
}

function parseFile(
  root: string,
  absolutePath: string,
  language: Language,
  packageName: string | undefined,
  known: Set<string>,
): FileIndex | undefined {
  const source = fs.readFileSync(absolutePath, "utf8");
  const relativePath = normalizePath(path.relative(root, absolutePath));
  const parser = new Parser();
  parser.setLanguage(language);
  const tree = parser.parse(source);
  if (!tree) {
    parser.delete();
    return undefined;
  }
  try {
    const edges: ImportEdge[] = tree.rootNode.descendantsOfType(["library_import", "library_export"]).map((node) => {
      const uri = unquote(node.descendantsOfType("uri")[0]?.text ?? "");
      return {
        kind: node.type === "library_export" ? "export" : "import",
        target: uri ? resolveImportTarget(uri, relativePath, packageName, known) : undefined,
        show: combinatorNames(node, "show"),
        hide: combinatorNames(node, "hide"),
      } satisfies ImportEdge;
    });

    const invocations = tree.rootNode.descendantsOfType("arguments")
      .map((node) => invocationFromArguments(node, source))
      .filter((value): value is Invocation => !!value);
    const invocationCounts = new Map<string, number>();
    for (const invocation of invocations) {
      invocationCounts.set(invocation.widgetType, (invocationCounts.get(invocation.widgetType) ?? 0) + 1);
    }

    const definitions: WidgetDefinition[] = [];
    const states: Array<{ widget: string; start: number; end: number }> = [];
    for (const classNode of tree.rootNode.namedChildren.filter((node) => node.type === "class_definition")) {
      const className = classNode.namedChildren.find((child) => child.type === "identifier")?.text;
      if (!className) {
        continue;
      }
      const { base, typeArg } = baseOf(classNode);
      if (base && STATE_BASES.has(base) && typeArg) {
        states.push({ widget: typeArg, start: classNode.startIndex, end: classNode.endIndex });
        continue;
      }
      if (!base || !WIDGET_BASES.has(base)) {
        continue;
      }
      const constructors = constructorsOf(classNode, className, source);
      definitions.push({
        className,
        path: relativePath,
        line: offsetPosition(source, classNode.startIndex).line,
        spans: [{ start: classNode.startIndex, end: classNode.endIndex }],
        constructors,
        contracts: new Map(),
        contract: { status: "missing" },
        hasVisibleText: false,
      });
    }

    for (const state of states) {
      const owner = definitions.find((definition) => definition.className === state.widget);
      if (owner) {
        owner.spans.push({ start: state.start, end: state.end });
      }
    }

    for (const definition of definitions) {
      const inside = invocations.filter((invocation) =>
        definition.spans.some((span) => invocation.startOffset >= span.start && invocation.endOffset <= span.end));
      for (const constructor of definition.constructors) {
        definition.contracts.set(constructor.name, contractFor(constructor, inside));
      }
      definition.contract = definition.contracts.get("") ?? [...definition.contracts.values()][0] ?? { status: "missing" };
      const spanSource = definition.spans.map((span) => source.slice(span.start, span.end)).join("\n");
      definition.hasVisibleText = VISIBLE_TEXT.test(spanSource);
      const semantics = inside.find((invocation) => invocation.widgetType === "Semantics");
      if (semantics) {
        definition.existingSemanticsLine = offsetPosition(source, semantics.startOffset).line;
      }
    }

    return { path: relativePath, edges, definitions, invocationCounts };
  } finally {
    tree.delete();
    parser.delete();
  }
}

export async function buildWidgetIndex(root: string, files: string[], language: Language): Promise<ProjectWidgetIndex> {
  const packageName = readPackageName(root);
  const known = new Set(files.map((file) => normalizePath(path.relative(root, file))));
  const fileIndexes = new Map<string, FileIndex>();
  for (const file of files) {
    try {
      const parsed = parseFile(root, file, language, packageName, known);
      if (parsed) {
        fileIndexes.set(parsed.path, parsed);
      }
    } catch {
      // A file that cannot be parsed simply contributes no definitions; the scanner reports the diagnostic.
    }
  }

  const definitions = [...fileIndexes.values()].flatMap((file) => file.definitions);
  const byName = new Map<string, WidgetDefinition[]>();
  for (const definition of definitions) {
    const list = byName.get(definition.className) ?? [];
    list.push(definition);
    byName.set(definition.className, list);
  }

  const exportsCache = new Map<string, Map<string, WidgetDefinition[]>>();
  const exportsOf = (filePath: string, stack: Set<string> = new Set()): Map<string, WidgetDefinition[]> => {
    const cached = exportsCache.get(filePath);
    if (cached) {
      return cached;
    }
    const result = new Map<string, WidgetDefinition[]>();
    const file = fileIndexes.get(filePath);
    if (!file || stack.has(filePath)) {
      return result;
    }
    stack.add(filePath);
    for (const definition of file.definitions.filter((item) => !item.className.startsWith("_"))) {
      result.set(definition.className, [definition]);
    }
    for (const edge of file.edges.filter((item) => item.kind === "export" && item.target)) {
      addFiltered(result, exportsOf(edge.target!, stack), edge);
    }
    stack.delete(filePath);
    exportsCache.set(filePath, result);
    return result;
  };

  const visibleCache = new Map<string, Map<string, WidgetDefinition[]>>();
  const visibleIn = (filePath: string): Map<string, WidgetDefinition[]> => {
    const cached = visibleCache.get(filePath);
    if (cached) {
      return cached;
    }
    const file = fileIndexes.get(filePath);
    const result = new Map<string, WidgetDefinition[]>();
    for (const definition of file?.definitions ?? []) {
      result.set(definition.className, [definition]);
    }
    for (const edge of (file?.edges ?? []).filter((item) => item.kind === "import" && item.target)) {
      addFiltered(result, exportsOf(edge.target!), edge);
    }
    visibleCache.set(filePath, result);
    return result;
  };

  const resolutionCache = new Map<string, WidgetResolution>();
  const resolve = (fromPath: string, widgetType: string): WidgetResolution => {
    const key = `${fromPath}\u0000${widgetType}`;
    const cached = resolutionCache.get(key);
    if (cached) {
      return cached;
    }
    let result: WidgetResolution = { ambiguous: [] };
    const visible = visibleIn(fromPath).get(widgetType) ?? [];
    if (visible.length === 1) {
      result = { definition: visible[0], ambiguous: [], resolution: "imports" };
    } else if (visible.length > 1) {
      const local = visible.find((definition) => definition.path === fromPath);
      result = local
        ? { definition: local, ambiguous: [], resolution: "imports" }
        : { ambiguous: visible };
    } else {
      const candidates = byName.get(widgetType) ?? [];
      if (candidates.length === 1) {
        result = { definition: candidates[0], ambiguous: [], resolution: "unique-name" };
      } else if (candidates.length > 1) {
        result = { ambiguous: candidates };
      }
    }
    resolutionCache.set(key, result);
    return result;
  };

  const callCounts = new Map<WidgetDefinition, { calls: number; files: Set<string> }>();
  for (const file of fileIndexes.values()) {
    for (const [widgetType, count] of file.invocationCounts) {
      const { definition } = resolve(file.path, widgetType);
      if (!definition || definition.path === file.path) {
        continue;
      }
      const entry = callCounts.get(definition) ?? { calls: 0, files: new Set<string>() };
      entry.calls += count;
      entry.files.add(file.path);
      callCounts.set(definition, entry);
    }
  }

  return {
    packageName,
    definitions,
    resolve,
    ownerAt: (filePath, offset) => fileIndexes.get(filePath)?.definitions.find((definition) =>
      definition.spans.some((span) => offset >= span.start && offset <= span.end)),
    callCounts,
  };
}

function addFiltered(target: Map<string, WidgetDefinition[]>, source: Map<string, WidgetDefinition[]>, edge: ImportEdge): void {
  for (const [name, defs] of source) {
    if (edge.show && !edge.show.has(name)) {
      continue;
    }
    if (edge.hide?.has(name)) {
      continue;
    }
    const existing = target.get(name) ?? [];
    for (const definition of defs) {
      if (!existing.includes(definition)) {
        existing.push(definition);
      }
    }
    target.set(name, existing);
  }
}

// ---------------------------------------------------------------------------
// Post-scan analysis: shared classification, layers, summaries
// ---------------------------------------------------------------------------

const keyOf = (definition: { path: string; className: string }) => `${definition.path}#${definition.className}`;

function inSharedDirectory(relativePath: string, dirs: string[]): boolean {
  const inLib = relativePath.replace(/^lib\//, "").toLowerCase();
  return dirs.some((dir) => {
    const prefix = dir.replace(/^\/+|\/+$/g, "").toLowerCase();
    return prefix.length > 0 && inLib.startsWith(`${prefix}/`);
  });
}

/**
 * Screens and pages are containers reached through navigation, never reusable controls.
 * `...View` only counts under a views/screens/pages directory, because `ErrorView` in a shared
 * folder is an ordinary widget.
 */
function isScreen(className: string, filePath: string): boolean {
  if (/(?:Screen|Page)$/.test(className)) {
    return true;
  }
  return /View$/.test(className) && /(?:^|\/)(?:views|screens|pages|routes)\//i.test(filePath);
}

export interface InteractiveWidgetKeys {
  /** Widgets with exactly one interactive root: fix the definition once. */
  controls: Set<string>;
  /** Reused widgets with several roots: each instance needs its own identifier prefix. */
  composites: Set<string>;
}

/**
 * Splits the project widgets that contain interactive roots:
 *  - controls have exactly one root (an SDK widget, or a single call to another control),
 *  - composites have several and are reused, so one required parameter is not enough:
 *    they take an identifier prefix and derive their inner identifiers from it,
 *  - screens and one-off widgets with several roots are neither; their controls just
 *    get literal identifiers (Phase 3, `wrap`).
 */
export function classifyInteractiveWidgets(
  findings: InteractiveFinding[],
  index: ProjectWidgetIndex,
  options: InteractiveScannerOptions,
): InteractiveWidgetKeys {
  const minCallSites = options.sharedWidgetMinCallSites ?? 2;
  const counts = new Map<string, number>();
  for (const finding of findings) {
    if (finding.owner && !isScreen(finding.owner.className, finding.owner.path)) {
      const key = keyOf(finding.owner);
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
  }
  const controls = new Set<string>();
  const composites = new Set<string>();
  const byKey = new Map(index.definitions.map((definition) => [keyOf(definition), definition]));
  for (const [key, count] of counts) {
    if (count === 1) {
      controls.add(key);
    } else {
      const definition = byKey.get(key);
      if (definition && (index.callCounts.get(definition)?.calls ?? 0) >= minCallSites) {
        composites.add(key);
      }
    }
  }
  return { controls, composites };
}

/** Keys of every widget whose call sites are interactive findings. */
export function interactiveWidgetKeys(
  findings: InteractiveFinding[],
  index: ProjectWidgetIndex,
  options: InteractiveScannerOptions,
): Set<string> {
  const { controls, composites } = classifyInteractiveWidgets(findings, index, options);
  return new Set([...controls, ...composites]);
}

/** Parameter names to suggest for widgets that do not have a contract yet. */
function suggestedNames(definition: WidgetDefinition): { identifier: string; label: string; hint: string } {
  return {
    identifier: definition.contract.identifier?.name ?? "semanticsIdentifier",
    label: definition.contract.label?.name ?? "semanticsLabel",
    hint: definition.contract.hint?.name ?? "semanticsHint",
  };
}

export function requiredCompositeParamsToAdd(definition: WidgetDefinition): string[] {
  const { prefix } = definition.contract;
  if (!prefix) {
    return [`required String ${DEFAULT_PREFIX_ARGS[0]}`];
  }
  return prefix.required ? [] : [`make ${prefix.name} required`];
}

export function requiredParamsToAdd(definition: WidgetDefinition, hasVisibleText: boolean): string[] {
  const names = suggestedNames(definition);
  const additions: string[] = [];
  const { identifier, label } = definition.contract;
  if (!identifier) {
    additions.push(`required String ${names.identifier}`);
  } else if (!identifier.required) {
    additions.push(`make ${identifier.name} required`);
  }
  if (!hasVisibleText) {
    if (!label) {
      additions.push(`required String ${names.label}`);
    } else if (!label.required) {
      additions.push(`make ${label.name} required`);
    }
  }
  return additions;
}

/**
 * Fills in what only the whole scan can know (shared status, layers, propagated
 * visible text), fixes each finding's role, and returns the shared widget summaries.
 */
export function analyzeSharedWidgets(
  index: ProjectWidgetIndex,
  findings: InteractiveFinding[],
  options: InteractiveScannerOptions,
): { widgets: SharedWidgetSummary[]; composites: SharedWidgetSummary[] } {
  const minCallSites = options.sharedWidgetMinCallSites ?? 2;
  const dirs = options.sharedWidgetDirs?.length ? options.sharedWidgetDirs : DEFAULT_SHARED_DIRS;
  const definitionByKey = new Map(index.definitions.map((definition) => [keyOf(definition), definition]));

  const { controls, composites: compositeKeys } = classifyInteractiveWidgets(findings, index, options);
  const ownedBy = new Map<string, InteractiveFinding[]>();
  for (const finding of findings) {
    if (finding.owner && controls.has(keyOf(finding.owner))) {
      const list = ownedBy.get(keyOf(finding.owner)) ?? [];
      list.push(finding);
      ownedBy.set(keyOf(finding.owner), list);
    }
  }

  const wrapsOf = (definition: WidgetDefinition): WidgetDefinition[] => {
    const wrapped = new Map<string, WidgetDefinition>();
    for (const finding of ownedBy.get(keyOf(definition)) ?? []) {
      if (finding.resolved) {
        const target = definitionByKey.get(keyOf({ path: finding.resolved.path, className: finding.resolved.className }));
        if (target && target !== definition) {
          wrapped.set(keyOf(target), target);
        }
      }
    }
    return [...wrapped.values()];
  };

  const layers = new Map<string, number>();
  const visibleText = new Map<string, boolean>();
  const visit = (definition: WidgetDefinition, stack: Set<string>): void => {
    const key = keyOf(definition);
    if (layers.has(key)) {
      return;
    }
    if (stack.has(key)) {
      layers.set(key, 0);
      visibleText.set(key, definition.hasVisibleText);
      return;
    }
    stack.add(key);
    let layer = 0;
    let text = definition.hasVisibleText;
    for (const wrapped of wrapsOf(definition)) {
      visit(wrapped, stack);
      layer = Math.max(layer, (layers.get(keyOf(wrapped)) ?? 0) + 1);
      text = text || (visibleText.get(keyOf(wrapped)) ?? false);
    }
    stack.delete(key);
    layers.set(key, layer);
    visibleText.set(key, text);
  };
  for (const definition of index.definitions) {
    if ((ownedBy.get(keyOf(definition)) ?? []).length > 0) {
      visit(definition, new Set());
    }
  }

  const sharedReason = new Map<string, "call-sites" | "directory">();
  for (const definition of index.definitions) {
    const key = keyOf(definition);
    if ((ownedBy.get(key) ?? []).length === 0) {
      continue;
    }
    const counts = index.callCounts.get(definition);
    if (counts && counts.calls >= minCallSites && counts.files.size >= 2) {
      sharedReason.set(key, "call-sites");
    } else if (inSharedDirectory(definition.path, dirs)) {
      sharedReason.set(key, "directory");
    }
  }

  const summaries: SharedWidgetSummary[] = [];
  for (const definition of index.definitions) {
    const key = keyOf(definition);
    const reason = sharedReason.get(key);
    if (!reason) {
      continue;
    }
    const counts = index.callCounts.get(definition);
    const roots = ownedBy.get(key) ?? [];
    const callSiteFindings = findings.filter((finding) =>
      finding.resolved && finding.resolved.path === definition.path && finding.resolved.className === definition.className &&
      finding.owner && keyOf(finding.owner) !== key);
    const text = visibleText.get(key) ?? definition.hasVisibleText;
    summaries.push({
      kind: "control",
      rootCount: roots.length,
      className: definition.className,
      path: definition.path,
      line: definition.line,
      sharedReason: reason,
      layer: layers.get(key) ?? 0,
      callSites: counts?.calls ?? 0,
      callSiteFiles: counts?.files.size ?? 0,
      callSitesMissing: callSiteFindings.filter((finding) => finding.automation !== "present").length,
      contract: definition.contract,
      hasVisibleText: text,
      wraps: wrapsOf(definition).map((wrapped) => wrapped.className),
      interactiveRootLines: [...new Set(roots.map((finding) => finding.source.line))].sort((a, b) => a - b),
      existingSemanticsLine: definition.existingSemanticsLine,
      requiredParamsToAdd: requiredParamsToAdd(definition, text),
    });
  }
  summaries.sort((left, right) => left.layer - right.layer || right.callSites - left.callSites || left.className.localeCompare(right.className));

  const compositeSummaries: SharedWidgetSummary[] = [];
  for (const definition of index.definitions) {
    const key = keyOf(definition);
    if (!compositeKeys.has(key)) {
      continue;
    }
    const counts = index.callCounts.get(definition);
    const roots = findings.filter((finding) => finding.owner && keyOf(finding.owner) === key);
    compositeSummaries.push({
      kind: "composite",
      rootCount: roots.length,
      className: definition.className,
      path: definition.path,
      line: definition.line,
      sharedReason: "call-sites",
      layer: 0,
      callSites: counts?.calls ?? 0,
      callSiteFiles: counts?.files.size ?? 0,
      callSitesMissing: findings.filter((finding) =>
        finding.resolved && finding.resolved.path === definition.path && finding.resolved.className === definition.className &&
        finding.owner && keyOf(finding.owner) !== key && finding.automation !== "present").length,
      contract: definition.contract,
      hasVisibleText: definition.hasVisibleText,
      wraps: [],
      interactiveRootLines: [...new Set(roots.map((finding) => finding.source.line))].sort((a, b) => a - b),
      existingSemanticsLine: definition.existingSemanticsLine,
      requiredParamsToAdd: requiredCompositeParamsToAdd(definition),
    });
  }
  compositeSummaries.sort((left, right) => right.callSites - left.callSites || left.className.localeCompare(right.className));

  const sharedKeys = new Set(summaries.map((summary) => keyOf(summary)));
  for (const finding of findings) {
    if (finding.resolved) {
      const key = keyOf(finding.resolved);
      finding.resolved.shared = sharedKeys.has(key);
      finding.resolved.composite = compositeKeys.has(key);
      finding.resolved.layer = layers.get(key) ?? 0;
      finding.resolved.hasVisibleText = visibleText.get(key) ?? finding.resolved.hasVisibleText;
      finding.role = finding.resolved.shared ? "shared-call-site" : "local-call-site";
    } else if (finding.owner && sharedKeys.has(keyOf(finding.owner))) {
      finding.role = "shared-definition-root";
    } else if (finding.owner && compositeKeys.has(keyOf(finding.owner))) {
      finding.role = "composite-item";
    } else {
      finding.role = "sdk";
    }
    // A widget that shows the text it is given already names itself for assistive technology.
    if (finding.resolved && finding.accessibility === "uncertain" && finding.resolved.hasVisibleText && finding.resolved.passesText) {
      finding.accessibility = "ready";
    }
    // A shared widget's own root delegates its identifier to whoever builds it, which is the intended contract.
    if (finding.owner && finding.automation === "dynamic") {
      const owner = definitionByKey.get(keyOf(finding.owner));
      const param = owner?.contract.identifier?.name;
      const prefix = owner?.contract.prefix?.name;
      const expression = finding.semantics.identifierExpression?.trim();
      if (param && expression && new RegExp(`^(?:widget\\.)?${escapeRegExp(param)}$`).test(expression)) {
        finding.automation = "present";
      } else if (prefix && expression && new RegExp(`\\$\\{?(?:widget\\.)?${escapeRegExp(prefix)}\\b`).test(expression)) {
        finding.automation = "present";
      }
    }
    finding.remediation = remediationFor(finding);
  }
  return { widgets: summaries, composites: compositeSummaries };
}

/** SDK widgets that carry their own accessible name in a `tooltip` argument. */
const TOOLTIP_WIDGETS = new Set(["IconButton", "FloatingActionButton", "PopupMenuButton"]);

/** The concrete way to fix one finding, decided from what is known about the control and its widget. */
export function remediationFor(finding: InteractiveFinding): Remediation {
  if (finding.opaqueReason || finding.ambiguousWith) {
    return "manual";
  }
  if (finding.role === "shared-definition-root") {
    return "shared-widget";
  }
  if (finding.role === "composite-item") {
    return "composite-prefix";
  }
  if (finding.resolved) {
    const { contract } = finding.resolved;
    const hasContract = contract.status === "complete" && !!(contract.identifier ?? contract.prefix);
    if (hasContract) {
      return "pass-contract";
    }
    // A shared control or composite that has no contract yet has to be fixed in its definition first.
    return finding.role === "shared-call-site" || finding.resolved.composite ? "shared-widget" : "wrap";
  }
  if (finding.semantics.wrapper) {
    return "reuse-wrapper";
  }
  const unnamed = !finding.semantics.labelExpression && !finding.semantics.tooltipExpression;
  if (TOOLTIP_WIDGETS.has(finding.widgetType) && unnamed && finding.accessibility !== "ready") {
    return "builtin-label";
  }
  return "wrap";
}
