import * as fs from "fs";
import * as path from "path";
import { Language, Node as SyntaxNode, Parser } from "web-tree-sitter";
import { normalizePath, stringValue } from "../semantics/dart-source.js";
import type { TrailSourceRef, TriggerKind } from "./types.js";

/**
 * Phase 1 of the route-graph scan: everything that can be read from a single Dart file without knowing
 * the rest of the project (classes, enums, constants, router declarations and every call that might navigate).
 * Phase 2 (route-graph.ts) joins these facts across files.
 */

export interface ClassFact {
  name: string;
  kind: "class" | "mixin" | "extension";
  superclass?: string;
  /** Type arguments of the superclass, for example `LoginPage` in `State<LoginPage>`. */
  superArguments: string[];
  /** For extensions: the type being extended. */
  on?: string;
  /** Annotations such as `@RoutePage(name: 'X')` or `@TypedGoRoute<HomeRoute>(path: '/')`. */
  annotations: Array<{ name: string; typeArguments: string[]; named: Array<{ name: string; text: string }> }>;
  /** Widgets the class builds, for route classes whose page is inside the class (typed go_router, Beamer locations). */
  bodyWidgets?: string[];
  /** Beamer locations: the string patterns of `pathPatterns`. */
  beamPaths?: string[];
}

export interface EnumFact {
  name: string;
  members: Array<{ name: string; path?: string; line: number }>;
  /** The enum has a getter that builds its path as `/<member name>`. */
  derivedPath: boolean;
}

export interface FunctionFact {
  name: string;
  /** Parameters that can carry a route or widget into the body (BuildContext-like parameters are left out). */
  params: string[];
  /** Declared type of each parameter, aligned with `params` (undefined for function types and untyped parameters). */
  types: Array<string | undefined>;
}

export interface CallFact {
  /** The method or constructor being called (last segment), for example `pushNavigation`. */
  name: string;
  /** Receiver chain plus name as written, for example `GoRouter.of(context).push`. */
  callee: string;
  /** Capitalised leading segment, for example `Navigator` in `Navigator.push`. */
  receiverType?: string;
  /** The constructor the method is called on, for example `HomeRoute` in `HomeRoute(id: 1).go(context)`. */
  receiverConstructor?: string;
  positional: string[];
  named: Array<{ name: string; text: string }>;
  /** Capitalised constructor names appearing in the arguments, in source order. */
  widgetArgs: string[];
  owner?: string;
  fn?: FunctionFact;
  trigger: { kind: TriggerKind; hint?: string };
  guards: string[];
  source: TrailSourceRef;
  /** Index into `FileFacts.declarations` of the innermost route declaration this call is written inside. */
  declaration?: number;
}

/**
 * A route declared as a call: `GoRoute(path:, builder:)`, `GetPage(name:, page:)`, `ChildRoute('/x', child:)`,
 * `VWidget(path:, widget:)`, `AutoRoute(page: X.page)`, `router.define('/x', handler: h)`, `@TypedGoRoute<X>(path:)`...
 * Package-agnostic: a call that pairs a path-like value with a page widget counts.
 */
export interface RouteDeclFact {
  callee: string;
  /** Set for a top-level route of a `StatefulShellBranch`: the tabs of one bottom navigation bar share `shell`. */
  shell?: { shell: number; branch: number };
  pathExpr?: string;
  nameExpr?: string;
  /** Capitalised constructor names in the page arguments, in source order. */
  widgets: string[];
  /** Fluro: the handler variable the route points at. */
  handler?: string;
  /** auto_route: `HomeRoute` in `AutoRoute(page: HomeRoute.page)`. */
  pageKey?: string;
  /** Typed go_router: `HomeRoute` in `@TypedGoRoute<HomeRoute>`. */
  typedClass?: string;
  /** flutter_modular: the module this entry mounts at its path (`ModuleRoute('/auth', module: AuthModule())`). */
  module?: string;
  initial?: boolean;
  /** Class the declaration is written in (resolves bare constants and Modular module prefixes). */
  owner?: string;
  /** Index of the enclosing declaration (nested routes, `children:`). */
  parent?: number;
  source: TrailSourceRef;
}

export interface NamedRouteFact {
  pathExpr: string;
  widgets: string[];
  /** What declared it: a `routes:` map owner, `switch`, `if`. */
  callee: string;
  owner?: string;
  source: TrailSourceRef;
}

export interface RedirectFact {
  text: string;
  declaration?: number;
  source: TrailSourceRef;
}

export interface FileFacts {
  path: string;
  /** Project-relative path of the library root when this file is `part of '<root>'`. */
  partOf?: string;
  classes: ClassFact[];
  enums: EnumFact[];
  constants: Array<{ key: string; value: string }>;
  calls: CallFact[];
  declarations: RouteDeclFact[];
  namedRoutes: NamedRouteFact[];
  /** Fluro `Handler(...)` variables and the widgets they build. */
  handlers: Array<{ name: string; widgets: string[] }>;
  /** Expressions the app starts on (`initialLocation`, `initialRoute`, `initialPath`, `home`). */
  entries: Array<{ kind: "location" | "home"; text: string; owner?: string }>;
  redirects: RedirectFact[];
  uses: Array<{ owner: string; type: string }>;
  parseError: boolean;
}

/**
 * Methods that move to another screen, across Navigator, go_router, Fluro, GetX, flutter_modular, Beamer, auto_route,
 * Routemaster, VRouter and Qlevar. A name alone proves nothing: an edge exists only when the call's argument resolves
 * to a known route, so a collision with an unrelated `push` or `to` costs nothing.
 */
export const NAVIGATION_VERBS: Readonly<Record<string, "push" | "go" | "replace">> = {
  // Navigator, go_router, Routemaster, auto_route
  push: "push",
  pushNamed: "push",
  pushRoute: "push",
  pushPath: "push",
  restorablePush: "push",
  restorablePushNamed: "push",
  go: "go",
  goNamed: "go",
  goRelative: "go",
  navigate: "go",
  navigateNamed: "go",
  navigatePath: "go",
  replaceAll: "go",
  pushAndPopUntil: "go",
  pushAndRemoveUntil: "go",
  pushNamedAndRemoveUntil: "go",
  restorablePushAndRemoveUntil: "go",
  restorablePushNamedAndRemoveUntil: "go",
  replace: "replace",
  replaceNamed: "replace",
  replacePath: "replace",
  popAndPush: "replace",
  popAndPushNamed: "replace",
  pushReplacement: "replace",
  pushReplacementNamed: "replace",
  restorablePushReplacement: "replace",
  restorablePushReplacementNamed: "replace",
  // Fluro, Qlevar (QR.to / QR.toName), VRouter (vRouter.to / toNamed)
  navigateTo: "push",
  to: "push",
  toName: "push",
  toNamed: "push",
  // GetX
  offNamed: "replace",
  off: "replace",
  offAndToNamed: "replace",
  offAllNamed: "go",
  offAll: "go",
  // Beamer
  beamTo: "go",
  beamToNamed: "go",
  beamToReplacement: "replace",
  beamToReplacementNamed: "replace",
};

export const OVERLAY_VERBS: ReadonlySet<string> = new Set([
  "showDialog",
  "showCupertinoDialog",
  "showGeneralDialog",
  "showAdaptiveDialog",
  "showModalBottomSheet",
  "showMaterialModalBottomSheet",
  "showCupertinoModalBottomSheet",
  "showBottomSheet",
  "showCupertinoModalPopup",
  "showBarModalBottomSheet",
  // GetX: Get.dialog / Get.bottomSheet / Get.defaultDialog
  "dialog",
  "bottomSheet",
  "defaultDialog",
]);

/** Verb names generic enough that the receiver must look like a router before the call counts. */
const AMBIGUOUS_VERBS: ReadonlySet<string> = new Set(["to", "off", "offAll", "navigate", "replaceAll", "toName", "toNamed", "navigateTo"]);
const GET_ONLY_VERBS: ReadonlySet<string> = new Set(["dialog", "bottomSheet"]);
export const ROUTER_LIKE = /(?:^|\.)(?:Get|Modular|QR|Beamer|Routemaster|router|_router|appRouter|fluroRouter|navigator|Navigator|context|ctx|vRouter|GoRouter|Application|routerDelegate|Sailor)\b|Router\b|\.of\(/;

/** Whether `callee` (receiver chain plus name) is a plausible navigation call for a verb called `name`. */
export function acceptsCallee(name: string, callee: string): boolean {
  if (GET_ONLY_VERBS.has(name)) {
    return /^Get\./.test(callee);
  }
  return !AMBIGUOUS_VERBS.has(name) || ROUTER_LIKE.test(callee);
}

/** Calls that declare a route although their name is not distinctive. */
export const KNOWN_DECLARATIONS: ReadonlySet<string> = new Set([
  "GoRoute", "TypedGoRoute", "TypedRelativeGoRoute", "GetPage", "ChildRoute", "ModuleRoute", "VWidget", "VNester",
  "QRoute", "AutoRoute", "AdaptiveRoute", "CustomRoute", "MaterialRoute", "CupertinoRoute", "SailorRoute",
]);
/** Lower-case declarations: Fluro `router.define`, flutter_modular v6 `r.child` / `r.module`. */
const METHOD_DECLARATIONS: ReadonlySet<string> = new Set(["define", "child", "module", "addRoute"]);
const DECLARATION_PATH_ARGS = ["path", "route", "url", "pattern", "routeName", "location"];
/** Arguments of a declaration that hold nested routes or configuration, not the page. */
const DECLARATION_NON_PAGE_ARGS: ReadonlySet<string> = new Set([
  "routes", "children", "nestedRoutes", "branches", "redirect", "guards", "middlewares", "binding", "bindings", "transition", "module",
]);
const ENTRY_ARGS: ReadonlySet<string> = new Set(["initialLocation", "initialRoute", "initialPath", "initialUrl"]);

const ROUTER_APPS: ReadonlySet<string> = new Set(["MaterialApp", "CupertinoApp", "WidgetsApp", "GetMaterialApp", "GetCupertinoApp"]);

const CALLBACK_USER = /^on[A-Z]/;
const STATE_LABELS: ReadonlySet<string> = new Set(["listener", "listenWhen", "onStateChanged", "onData", "onSuccess", "onError", "onDone"]);
const LIFECYCLE_FUNCTIONS: ReadonlySet<string> = new Set(["initState", "didChangeDependencies", "didUpdateWidget", "dispose"]);
const LIFECYCLE_CALLS: ReadonlySet<string> = new Set(["addPostFrameCallback", "delayed", "Timer", "periodic", "scheduleMicrotask"]);
const MAX_GUARDS = 4;
const MAX_GUARD_LENGTH = 140;
const MAX_ARGUMENT_TEXT = 300;
const MAX_WIDGET_SCAN = 4000;

function compact(text: string, limit: number): string {
  // A method chain broken over lines (`context\n  .read<Bloc>()`) should read as one expression.
  const flat = text.replace(/\s*\n\s*\./g, ".").replace(/\s+/g, " ").trim();
  return flat.length > limit ? `${flat.slice(0, limit - 1)}…` : flat;
}

function refOf(node: SyntaxNode, relativePath: string): TrailSourceRef {
  return { path: relativePath, line: node.startPosition.row + 1, column: node.startPosition.column + 1 };
}

function directChild(node: SyntaxNode, type: string): SyntaxNode | undefined {
  return node.namedChildren.find((child) => child.type === type);
}

function widgetNames(text: string): string[] {
  const names: string[] = [];
  const pattern = /\b([A-Z][A-Za-z0-9_]*)\s*(?:<[^<>()]*>)?\s*(?:\.\s*[a-z_]\w*\s*)?\(/g;
  const scan = text.length > MAX_WIDGET_SCAN ? text.slice(0, MAX_WIDGET_SCAN) : text;
  for (let match = pattern.exec(scan); match; match = pattern.exec(scan)) {
    names.push(match[1]);
  }
  return names;
}

interface ParsedArguments {
  positional: Array<{ text: string; start: number; end: number }>;
  named: Array<{ name: string; text: string; start: number; end: number; node: SyntaxNode; argument: SyntaxNode }>;
}

function parseArguments(node: SyntaxNode, source: string): ParsedArguments {
  const positional: ParsedArguments["positional"] = [];
  const named: ParsedArguments["named"] = [];
  for (const child of node.namedChildren) {
    if (child.type === "named_argument") {
      const label = directChild(child, "label");
      const name = label ? directChild(label, "identifier")?.text : undefined;
      const values = child.namedChildren.filter((candidate) => candidate !== label);
      const first = values[0];
      const last = values[values.length - 1];
      if (name && first && last) {
        named.push({ name, text: source.slice(first.startIndex, last.endIndex).trim(), start: first.startIndex, end: last.endIndex, node: first, argument: child });
      }
    } else if (child.type === "argument") {
      positional.push({ text: child.text.trim(), start: child.startIndex, end: child.endIndex });
    }
  }
  return { positional, named };
}

interface Callee {
  name: string;
  callee: string;
  receiverType?: string;
  receiverConstructor?: string;
  /** `HomeRoute` in `TypedGoRoute<HomeRoute>(...)`. */
  typeArguments: string[];
}

function typeArgumentNames(node: SyntaxNode | undefined): string[] {
  return node ? node.namedChildren.filter((child) => child.type === "type_identifier").map((child) => child.text) : [];
}

/** Reads the callee of an `arguments` node: `identifier selector* selector(argument_part(arguments))`. */
function calleeOf(args: SyntaxNode, source: string): Callee | undefined {
  const owner = args.parent;
  // `const Foo()`, `const Foo.named()` and `new Foo()` carry the type next to the arguments instead of in a selector chain.
  if (owner && (owner.type === "const_object_expression" || owner.type === "new_expression")) {
    const type = owner.namedChildren.find((child) => child.type === "type_identifier");
    if (!type) {
      return undefined;
    }
    const named = owner.namedChildren.find((child) => child.type === "identifier")?.text;
    return { name: type.text, callee: named ? `${type.text}.${named}` : type.text, typeArguments: [] };
  }
  // `@RoutePage(name: 'X')` and `@TypedGoRoute<HomeRoute>(path: '/')`.
  if (owner && owner.type === "annotation") {
    const name = directChild(owner, "identifier")?.text;
    return name ? { name, callee: name, typeArguments: typeArgumentNames(directChild(owner, "type_arguments")) } : undefined;
  }
  const argumentPart = args.parent;
  if (!argumentPart || argumentPart.type !== "argument_part") {
    return undefined;
  }
  const selector = argumentPart.parent;
  if (!selector || selector.type !== "selector") {
    return undefined;
  }
  const tail = selector.previousSibling;
  if (!tail || !selector.parent) {
    return undefined;
  }
  let name: string | undefined;
  if (tail.type === "identifier") {
    name = tail.text;
  } else if (tail.type === "selector") {
    const assignable = tail.namedChildren.find((child) => child.type === "unconditional_assignable_selector" || child.type === "conditional_assignable_selector");
    name = assignable ? directChild(assignable, "identifier")?.text : undefined;
  }
  if (!name) {
    return undefined;
  }
  // The receiver chain is the run of identifier/selector siblings leading up to the callee.
  let start: SyntaxNode = tail;
  for (let sibling = tail.previousSibling; sibling && (sibling.type === "identifier" || sibling.type === "selector"); sibling = sibling.previousSibling) {
    start = sibling;
  }
  const callee = compact(source.slice(start.startIndex, tail.endIndex), 90);
  const leading = /^([A-Za-z_$][\w$]*)/.exec(callee)?.[1];
  const receiverType = leading && /^[A-Z]/.test(leading) && leading !== name ? leading : undefined;
  // `const HomeRoute().go(context)` keeps the constructor in a sibling node; `HomeRoute(id: 1).go(context)` in the chain text.
  const before = start.previousSibling;
  const receiverConstructor = before && (before.type === "const_object_expression" || before.type === "new_expression")
    ? before.namedChildren.find((child) => child.type === "type_identifier")?.text
    : /^([A-Z][\w$]*)(?:<[^()]*>)?\(/.exec(callee)?.[1];
  // Keep the constructor visible in the callee when it sits in a sibling node: `.go` -> `DetailsRoute().go`.
  const written = receiverConstructor && callee.startsWith(".") ? `${receiverConstructor}()${callee}` : callee;
  return { name, callee: written, receiverType, receiverConstructor, typeArguments: typeArgumentNames(directChild(argumentPart, "type_arguments")) };
}

const CONTEXT_PARAMETER_TYPES: ReadonlySet<string> = new Set(["BuildContext", "WidgetRef", "Ref", "GoRouterState", "NavigatorState"]);
const CONTEXT_PARAMETER_NAMES: ReadonlySet<string> = new Set(["context", "ctx", "key", "ref"]);

function signatureInfo(signature: SyntaxNode): FunctionFact | undefined {
  const inner = signature.type === "method_signature"
    ? signature.namedChildren.find((child) => /signature$/.test(child.type)) ?? signature
    : signature;
  const name = directChild(inner, "identifier")?.text;
  if (!name) {
    return undefined;
  }
  const params: string[] = [];
  const types: Array<string | undefined> = [];
  for (const parameter of inner.descendantsOfType("formal_parameter")) {
    const type = directChild(parameter, "type_identifier")?.text;
    const parameterName = directChild(parameter, "identifier")?.text;
    if (parameterName && !CONTEXT_PARAMETER_NAMES.has(parameterName) && !CONTEXT_PARAMETER_TYPES.has(type ?? "")) {
      params.push(parameterName);
      types.push(type);
    }
  }
  return { name, params, types };
}

/** `!x` for a simple condition, `!(a && b)` otherwise; negating `!x` gives `x` rather than `!!x`. */
function negate(condition: string): string {
  if (/^![\w.?]+$/.test(condition)) {
    return condition.slice(1);
  }
  return /^[\w.?]+$/.test(condition) ? `!${condition}` : `!(${condition})`;
}

function ifGuard(node: SyntaxNode, child: SyntaxNode, source: string): string | undefined {
  const consequence = node.childForFieldName("consequence");
  if (!consequence) {
    return undefined;
  }
  const head = source.slice(node.startIndex, consequence.startIndex);
  const condition = head.replace(/^\s*if\s*\(/, "").replace(/\)\s*$/, "").trim();
  if (!condition) {
    return undefined;
  }
  if (child.startIndex >= consequence.startIndex && child.endIndex <= consequence.endIndex) {
    return condition;
  }
  const alternative = node.childForFieldName("alternative");
  if (alternative && child.startIndex >= alternative.startIndex && child.endIndex <= alternative.endIndex) {
    return negate(condition);
  }
  return undefined;
}

function ternaryGuard(node: SyntaxNode, child: SyntaxNode, source: string): string | undefined {
  const question = node.children.find((candidate) => candidate.type === "?");
  const colon = node.children.find((candidate) => candidate.type === ":");
  if (!question || !colon) {
    return undefined;
  }
  const condition = source.slice(node.startIndex, question.startIndex).trim();
  if (child.startIndex >= question.endIndex && child.endIndex <= colon.startIndex) {
    return condition;
  }
  if (child.startIndex >= colon.endIndex) {
    return negate(condition);
  }
  return undefined;
}

function casePattern(node: SyntaxNode): string | undefined {
  const pattern = node.namedChildren.find((child) => child.type !== "case_builtin");
  return pattern && !/_statement$|expression_statement|^block$/.test(pattern.type) ? pattern.text : undefined;
}

function switchGuard(node: SyntaxNode): string | undefined {
  const container = node.parent?.parent;
  const subject = container && container.type === "switch_statement"
    ? container.namedChildren.find((child) => child.type === "parenthesized_expression")?.text.replace(/^\(|\)$/g, "").trim()
    : undefined;
  if (node.type === "switch_statement_default") {
    return subject ? `${subject} is none of the other cases` : "default case";
  }
  const own = casePattern(node);
  if (!own) {
    return undefined;
  }
  // `case failure: case success: body` parses as an empty case followed by the one that holds the body.
  const patterns = [own];
  for (let previous = node.previousNamedSibling; previous && previous.type === "switch_statement_case"; previous = previous.previousNamedSibling) {
    const hasBody = previous.namedChildren.some((child) => child.type !== "case_builtin" && child !== previous!.namedChildren.find((candidate) => candidate.type !== "case_builtin"));
    const pattern = casePattern(previous);
    if (hasBody || !pattern) {
      break;
    }
    patterns.unshift(pattern);
  }
  const labels = patterns.map((pattern) => `${subject} == ${pattern}`).join(" || ");
  return subject ? (patterns.length > 1 ? `(${labels})` : labels) : `case ${patterns.join(" or ")}`;
}

/** Splits `'/a': (context) => A()` at the colon that follows the key, ignoring colons inside the key's string. */
function splitMapEntry(text: string): { key: string; value: string } | undefined {
  const trimmed = text.trim();
  const quote = trimmed[0];
  let colon = -1;
  if (quote === "'" || quote === '"') {
    const end = trimmed.indexOf(quote, 1);
    colon = end >= 0 ? trimmed.indexOf(":", end + 1) : -1;
  } else {
    colon = trimmed.indexOf(":");
  }
  return colon > 0 ? { key: trimmed.slice(0, colon).trim(), value: trimmed.slice(colon + 1).trim() } : undefined;
}

/** The `StatefulShellRoute` and `StatefulShellBranch` a `GoRoute` is declared in, if any. */
function shellOf(args: SyntaxNode, source: string): RouteDeclFact["shell"] {
  let branch: number | undefined;
  for (let node: SyntaxNode | null = args.parent; node; node = node.parent) {
    if (node.type !== "arguments") {
      continue;
    }
    const callee = calleeOf(node, source);
    if (!callee) {
      continue;
    }
    if (branch === undefined && callee.name === "StatefulShellBranch") {
      branch = node.id;
    } else if (callee.name === "StatefulShellRoute" || callee.callee.startsWith("StatefulShellRoute.")) {
      return branch === undefined ? undefined : { shell: node.id, branch };
    }
  }
  return undefined;
}

function labelName(argument: SyntaxNode): string | undefined {
  const label = directChild(argument, "label");
  return label ? directChild(label, "identifier")?.text : undefined;
}

function triggerFromFunction(name: string | undefined): { kind: TriggerKind; hint?: string } {
  if (!name) {
    return { kind: "unknown" };
  }
  if (LIFECYCLE_FUNCTIONS.has(name)) {
    return { kind: "lifecycle", hint: name };
  }
  if (/listener|state|parse|react|observe|result|status|response/i.test(name)) {
    return { kind: "state", hint: name };
  }
  if (/^_?(?:on|handle)[A-Z]/.test(name) || /tap|press|click|submit|confirm|select/i.test(name)) {
    return { kind: "user", hint: name };
  }
  return { kind: "unknown", hint: name };
}

interface Context {
  owner?: string;
  fn?: FunctionFact;
  trigger: { kind: TriggerKind; hint?: string };
  guards: string[];
  goRouteNodeId?: number;
}

/** Walks from a call up to the file, collecting the class it lives in, its trigger and the conditions guarding it. */
function contextOf(args: SyntaxNode, source: string, goRouteNodes: Map<number, number>): Context {
  const guards: string[] = [];
  let trigger: Context["trigger"] | undefined;
  let fn: Context["fn"];
  let owner: string | undefined;
  let goRoute: number | undefined;
  let child: SyntaxNode = args;
  for (let node: SyntaxNode | null = args.parent; node; child = node, node = node.parent) {
    switch (node.type) {
      case "named_argument": {
        const label = labelName(node);
        if (label === "redirect" && !trigger) {
          trigger = { kind: "redirect", hint: label };
        } else if (label && !trigger && !fn) {
          if (STATE_LABELS.has(label)) {
            trigger = { kind: "state", hint: label };
          } else if (CALLBACK_USER.test(label)) {
            trigger = { kind: "user", hint: label };
          }
        }
        break;
      }
      case "arguments": {
        if (node !== args && goRoute === undefined && goRouteNodes.has(node.id)) {
          goRoute = goRouteNodes.get(node.id);
        }
        if (!trigger && !fn) {
          const outer = calleeOf(node, source);
          if (outer && LIFECYCLE_CALLS.has(outer.name)) {
            trigger = { kind: "lifecycle", hint: outer.name };
          }
        }
        break;
      }
      case "if_statement":
        if (!fn) {
          const guard = ifGuard(node, child, source);
          if (guard) {
            guards.unshift(compact(guard, MAX_GUARD_LENGTH));
          }
        }
        break;
      case "conditional_expression":
        if (!fn) {
          const guard = ternaryGuard(node, child, source);
          if (guard) {
            guards.unshift(compact(guard, MAX_GUARD_LENGTH));
          }
        }
        break;
      case "switch_statement_case":
      case "switch_statement_default":
        if (!fn) {
          const guard = switchGuard(node);
          if (guard) {
            guards.unshift(compact(guard, MAX_GUARD_LENGTH));
          }
        }
        break;
      case "function_body": {
        if (!fn) {
          const previous = node.previousSibling;
          if (previous && /^(method|function|constructor|getter|setter)_signature$/.test(previous.type)) {
            fn = signatureInfo(previous);
          }
        }
        break;
      }
      case "class_definition":
      case "mixin_declaration":
      case "extension_declaration":
        if (!owner) {
          owner = directChild(node, "identifier")?.text
            ?? (node.type === "extension_declaration" ? node.namedChildren.filter((candidate) => candidate.type === "type_identifier").pop()?.text : undefined);
        }
        break;
      default:
        break;
    }
  }
  return {
    owner,
    fn,
    trigger: trigger ?? triggerFromFunction(fn?.name),
    guards: guards.slice(0, MAX_GUARDS),
    goRouteNodeId: goRoute,
  };
}

const PAGE_CLASS_BASES = /^(?:GoRouteData|RelativeGoRouteData|BeamLocation)\b/;

function collectClasses(root: SyntaxNode, source: string): ClassFact[] {
  const classes: ClassFact[] = [];
  for (const node of root.descendantsOfType(["class_definition", "mixin_declaration", "extension_declaration"])) {
    const named = directChild(node, "identifier")?.text;
    if (node.type === "extension_declaration") {
      const on = node.namedChildren.filter((child) => child.type === "type_identifier").pop()?.text;
      classes.push({ name: named ?? `<extension on ${on ?? "?"}>`, kind: "extension", superArguments: [], on, annotations: [] });
      continue;
    }
    if (!named) {
      continue;
    }
    const superclassNode = directChild(node, "superclass");
    const superclass = superclassNode ? directChild(superclassNode, "type_identifier")?.text : undefined;
    const typeArguments = superclassNode ? directChild(superclassNode, "type_arguments") : undefined;
    const annotations = node.namedChildren.filter((child) => child.type === "annotation").map((annotation) => {
      const argumentsNode = directChild(annotation, "arguments");
      return {
        name: directChild(annotation, "identifier")?.text ?? "",
        typeArguments: typeArgumentNames(directChild(annotation, "type_arguments")),
        named: argumentsNode ? parseArguments(argumentsNode, source).named.map((item) => ({ name: item.name, text: compact(item.text, MAX_ARGUMENT_TEXT) })) : [],
      };
    }).filter((annotation) => annotation.name);
    const fact: ClassFact = {
      name: named,
      kind: node.type === "mixin_declaration" ? "mixin" : "class",
      superclass,
      superArguments: typeArguments ? typeArguments.namedChildren.filter((child) => child.type === "type_identifier").map((child) => child.text) : [],
      annotations,
    };
    // A typed go_router route or a Beamer location holds its page inside the class, not in a router table.
    if (superclass && PAGE_CLASS_BASES.test(superclass)) {
      const body = directChild(node, "class_body");
      fact.bodyWidgets = body ? widgetNames(body.text) : [];
      if (superclass.startsWith("BeamLocation") && body) {
        const patterns = /pathPatterns[\s\S]{0,400}?\[([\s\S]*?)\]/.exec(body.text)?.[1] ?? "";
        fact.beamPaths = [...patterns.matchAll(/(['"])([^'"]*)\1/g)].map((match) => match[2]);
      }
    }
    classes.push(fact);
  }
  return classes;
}

function collectEnums(root: SyntaxNode, source: string): EnumFact[] {
  const enums: EnumFact[] = [];
  for (const node of root.descendantsOfType("enum_declaration")) {
    const name = directChild(node, "identifier")?.text;
    const body = directChild(node, "enum_body");
    if (!name || !body) {
      continue;
    }
    const members = body.namedChildren
      .filter((child) => child.type === "enum_constant")
      .map((constant) => {
        const memberName = directChild(constant, "identifier")?.text ?? "";
        const argsNode = constant.descendantsOfType("arguments")[0];
        const firstArgument = argsNode ? directChild(argsNode, "argument")?.text : undefined;
        const literal = stringValue(firstArgument);
        return { name: memberName, path: literal && literal.startsWith("/") ? literal : undefined, line: constant.startPosition.row + 1 };
      })
      .filter((member) => member.name);
    enums.push({ name, members, derivedPath: false });
  }
  // `extension X on AppRoute { String get toPath => '/${toString().split('.').last}'; }` derives every path from the member name.
  for (const node of root.descendantsOfType("extension_declaration")) {
    const on = node.namedChildren.filter((child) => child.type === "type_identifier").pop()?.text;
    const target = enums.find((candidate) => candidate.name === on);
    if (target && /get\s+(?:toPath|path|route|location)\b[\s\S]{0,200}?['"]\/\$\{?(?:toString\(\)\.split\(['"]\.['"]\)\.last|name)\}?['"]/.test(source.slice(node.startIndex, node.endIndex))) {
      target.derivedPath = true;
    }
  }
  return enums;
}

function collectConstants(root: SyntaxNode): Array<{ key: string; value: string }> {
  const constants: Array<{ key: string; value: string }> = [];
  // `static const String home = '/home'` and also `static String home = '/home'` / `String home = '/home'` (Fluro-style registries).
  for (const node of root.descendantsOfType(["static_final_declaration", "initialized_identifier"])) {
    const name = directChild(node, "identifier")?.text;
    const value = node.namedChildren.find((child) => child.type === "string_literal")?.text;
    const literal = stringValue(value);
    if (!name || literal === undefined) {
      continue;
    }
    // A mutable field only counts when it holds a path; `String title = 'Hello'` is not a route.
    if (node.type === "initialized_identifier" && !literal.startsWith("/")) {
      continue;
    }
    let ownerClass: string | undefined;
    let insideFunction = false;
    for (let ancestor = node.parent; ancestor; ancestor = ancestor.parent) {
      if (ancestor.type === "function_body") {
        insideFunction = true;
        break;
      }
      if (ancestor.type === "class_definition" && !ownerClass) {
        ownerClass = directChild(ancestor, "identifier")?.text;
      }
    }
    if (!insideFunction) {
      constants.push({ key: ownerClass ? `${ownerClass}.${name}` : name, value: literal });
    }
  }
  return constants;
}

/** Fluro: `var rootHandler = Handler(handlerFunc: (context, params) => HomePage());` */
function collectHandlers(root: SyntaxNode): FileFacts["handlers"] {
  const handlers: FileFacts["handlers"] = [];
  for (const node of root.descendantsOfType(["initialized_identifier", "static_final_declaration"])) {
    const identifiers = node.namedChildren.filter((child) => child.type === "identifier");
    if (identifiers.length >= 2 && identifiers[1].text === "Handler") {
      handlers.push({ name: identifiers[0].text, widgets: widgetNames(node.text) });
    }
  }
  return handlers;
}

const ROUTE_SWITCH_SUBJECT = /(?:settings|routeSettings|routeName)\b|\.(?:name|path|location|uri)\b/;
const ROUTE_COMPARISON = /(?:\b(?:settings|routeSettings)\.name|\broute(?:Name)?|\.(?:path|location|uri))\s*==\s*([^&|)]+?)\s*(?:&&|\|\||$)/;

/**
 * `onGenerateRoute` tables written as code: `switch (settings.name) { case '/x': return MaterialPageRoute(builder: ... X()) }`,
 * Dart 3 switch expressions, and `if (settings.name == '/x') return ... X();` chains.
 */
function collectRouteTables(root: SyntaxNode, source: string, relativePath: string): NamedRouteFact[] {
  const found: NamedRouteFact[] = [];
  for (const node of root.descendantsOfType(["switch_statement_case", "switch_expression_case"])) {
    const container = node.parent?.type === "switch_block" ? node.parent.parent : node.parent;
    const subject = container
      ? (container.namedChildren.find((child) => child.type === "parenthesized_expression") ?? container.namedChildren[0])?.text ?? ""
      : "";
    if (!ROUTE_SWITCH_SUBJECT.test(subject)) {
      continue;
    }
    const pattern = node.namedChildren.find((child) => child.type !== "case_builtin");
    const widgets = widgetNames(node.text.slice(0, 2000));
    if (!pattern || /_statement$|^block$/.test(pattern.type) || !widgets.length) {
      continue;
    }
    found.push({ pathExpr: pattern.text.trim(), widgets, callee: "switch", source: refOf(node, relativePath) });
  }
  for (const node of root.descendantsOfType("if_statement")) {
    const consequence = node.childForFieldName("consequence");
    if (!consequence) {
      continue;
    }
    const comparison = ROUTE_COMPARISON.exec(source.slice(node.startIndex, consequence.startIndex).replace(/^\s*if\s*\(/, "").replace(/\)\s*$/, ""));
    const widgets = widgetNames(consequence.text.slice(0, 2000));
    if (comparison && widgets.length) {
      found.push({ pathExpr: comparison[1].trim(), widgets, callee: "if", source: refOf(node, relativePath) });
    }
  }
  return found;
}

function resolvePartOf(root: SyntaxNode, filePath: string): string | undefined {
  const directive = root.descendantsOfType("part_of_directive")[0];
  const uri = directive ? stringValue(directive.descendantsOfType("string_literal")[0]?.text) : undefined;
  if (!uri) {
    return undefined;
  }
  return normalizePath(path.posix.normalize(path.posix.join(path.posix.dirname(filePath), uri)));
}

/** A value that could be a route: a string literal, or a (possibly dotted) identifier such as `AppRoute.login` or `Routes.home`. */
function routeShaped(text: string): boolean {
  return /^(?:const\s+)?['"]/.test(text.trim()) || /^[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*$/.test(text.trim());
}

function declarationOf(
  callee: Callee,
  parsed: ParsedArguments,
  context: Context,
  args: SyntaxNode,
  source: string,
  relativePath: string,
): { fact: RouteDeclFact; redirect?: { text: string; node: SyntaxNode } } | undefined {
  const isCapital = /^[A-Z]/.test(callee.name);
  const isMethod = METHOD_DECLARATIONS.has(callee.name);
  if (!isCapital && !isMethod) {
    return undefined;
  }
  const known = KNOWN_DECLARATIONS.has(callee.name);
  const pathNamed = parsed.named.find((item) => DECLARATION_PATH_ARGS.includes(item.name));
  const nameNamed = parsed.named.find((item) => item.name === "name");
  const firstPositional = parsed.positional[0]?.text;
  let pathExpr = pathNamed?.text ?? (firstPositional && routeShaped(firstPositional) ? firstPositional : undefined);
  let nameExpr = nameNamed?.text;
  // GetX names its routes by path: `GetPage(name: '/home', page: () => HomePage())`.
  if (!pathExpr && nameNamed && /^(?:const\s+)?['"]\/|^[A-Za-z_$][\w$]*\.[A-Za-z_$]/.test(nameNamed.text)) {
    pathExpr = nameNamed.text;
    nameExpr = undefined;
  }
  const pageArguments = parsed.named.filter((item) =>
    !DECLARATION_NON_PAGE_ARGS.has(item.name) && !DECLARATION_PATH_ARGS.includes(item.name) && item.name !== "name");
  const widgets = pageArguments.flatMap((item) => widgetNames(item.text));
  const handlerText = parsed.named.find((item) => item.name === "handler")?.text;
  const handler = handlerText && /^[A-Za-z_$][\w$]*$/.test(handlerText) ? handlerText : undefined;
  const pageKey = /^([A-Za-z_$][\w$]*)\.page$/.exec(parsed.named.find((item) => item.name === "page")?.text ?? "")?.[1];
  const moduleText = parsed.named.find((item) => item.name === "module")?.text;
  const module = moduleText ? /\b([A-Z][\w$]*)/.exec(moduleText)?.[1] : undefined;
  const typedClass = callee.name.startsWith("Typed") ? callee.typeArguments[0] : undefined;

  const eligible = known
    ? !!(pathExpr || nameExpr || pageKey || typedClass || module)
    : isMethod
      ? !!pathExpr
      : !!pathExpr && (widgets.length > 0 || !!handler || !!pageKey || !!module);
  if (!eligible) {
    return undefined;
  }
  const redirect = parsed.named.find((item) => item.name === "redirect");
  return {
    fact: {
      callee: callee.name,
      shell: context.goRouteNodeId === undefined ? shellOf(args, source) : undefined,
      pathExpr,
      nameExpr,
      widgets,
      handler,
      pageKey,
      typedClass,
      module,
      initial: parsed.named.find((item) => item.name === "initial")?.text === "true" || undefined,
      owner: context.owner,
      parent: context.goRouteNodeId,
      source: refOf(args, relativePath),
    },
    redirect: redirect ? { text: redirect.text.slice(0, 3000), node: redirect.node } : undefined,
  };
}

function callFact(callee: Callee, parsed: ParsedArguments, context: Context, args: SyntaxNode, source: string, relativePath: string): CallFact {
  return {
    name: callee.name,
    callee: callee.callee,
    receiverType: callee.receiverType,
    receiverConstructor: callee.receiverConstructor,
    positional: parsed.positional.map((item) => compact(item.text, MAX_ARGUMENT_TEXT)),
    named: parsed.named.map((item) => ({ name: item.name, text: compact(item.text, MAX_ARGUMENT_TEXT) })),
    widgetArgs: widgetNames(source.slice(args.startIndex, args.endIndex)),
    owner: context.owner,
    fn: context.fn,
    trigger: context.trigger,
    guards: context.guards,
    source: refOf(args, relativePath),
    declaration: context.goRouteNodeId,
  };
}

/**
 * Every call to one of `names`, whatever its arguments. Used for destination helpers (`context.toDashboard()`),
 * which are only known after the route table is built and which have no route-shaped argument to recognise them by.
 */
export function extractNamedCalls(root: string, absolutePath: string, language: Language, names: ReadonlySet<string>): CallFact[] {
  const relativePath = normalizePath(path.relative(root, absolutePath));
  const source = fs.readFileSync(absolutePath, "utf8");
  if (![...names].some((name) => source.includes(name))) {
    return [];
  }
  const parser = new Parser();
  parser.setLanguage(language);
  const tree = parser.parse(source);
  if (!tree) {
    return [];
  }
  try {
    const calls: CallFact[] = [];
    for (const args of tree.rootNode.descendantsOfType("arguments")) {
      const callee = calleeOf(args, source);
      if (callee && names.has(callee.name)) {
        calls.push(callFact(callee, parseArguments(args, source), contextOf(args, source, new Map()), args, source, relativePath));
      }
    }
    return calls;
  } finally {
    tree.delete();
    parser.delete();
  }
}

export function extractFileFacts(
  root: string,
  absolutePath: string,
  language: Language,
): FileFacts {
  const relativePath = normalizePath(path.relative(root, absolutePath));
  const source = fs.readFileSync(absolutePath, "utf8");
  const parser = new Parser();
  parser.setLanguage(language);
  const tree = parser.parse(source);
  if (!tree) {
    throw new Error("The Dart parser returned no tree.");
  }
  try {
    const top = tree.rootNode;
    const facts: FileFacts = {
      path: relativePath,
      partOf: resolvePartOf(top, relativePath),
      classes: collectClasses(top, source),
      enums: collectEnums(top, source),
      constants: collectConstants(top),
      calls: [],
      declarations: [],
      namedRoutes: collectRouteTables(top, source, relativePath),
      handlers: collectHandlers(top),
      entries: [],
      redirects: [],
      uses: [],
      parseError: top.hasError,
    };

    const declarationNodes = new Map<number, number>();
    const seenUses = new Set<string>();

    // Document order puts a parent declaration before the routes nested in it.
    for (const args of top.descendantsOfType("arguments")) {
      const callee = calleeOf(args, source);
      if (!callee) {
        continue;
      }
      const parsed = parseArguments(args, source);
      const context = contextOf(args, source, declarationNodes);
      const constructorType = /^[A-Z]/.test(callee.name) ? callee.name : callee.receiverType;
      if (context.owner && constructorType && args.parent?.type !== "annotation") {
        const key = `${context.owner}>${constructorType}`;
        if (!seenUses.has(key)) {
          seenUses.add(key);
          facts.uses.push({ owner: context.owner, type: constructorType });
        }
      }

      // Where the app starts, and routes written as a `routes: {...}` map (MaterialApp, Beamer, Routemaster...).
      for (const item of parsed.named) {
        if (ENTRY_ARGS.has(item.name) && routeShaped(item.text)) {
          facts.entries.push({ kind: "location", text: item.text, owner: context.owner });
        } else if (item.name === "home" && ROUTER_APPS.has(callee.name)) {
          facts.entries.push({ kind: "home", text: item.text, owner: context.owner });
        } else if (item.name === "routes") {
          const map = item.argument.namedChildren.find((child) => child.type === "set_or_map_literal");
          for (const pair of map ? map.namedChildren.filter((child) => child.type === "pair") : []) {
            const split = splitMapEntry(pair.text);
            if (split && routeShaped(split.key)) {
              facts.namedRoutes.push({ pathExpr: split.key, widgets: widgetNames(split.value), callee: callee.name, owner: context.owner, source: refOf(pair, relativePath) });
            }
          }
        }
      }
      if (callee.name === "setInitialRoute" && parsed.positional[0] && routeShaped(parsed.positional[0].text)) {
        facts.entries.push({ kind: "location", text: parsed.positional[0].text, owner: context.owner });
      }
      if (callee.name === "GoRouter") {
        const redirect = parsed.named.find((item) => item.name === "redirect");
        if (redirect) {
          facts.redirects.push({ text: redirect.text.slice(0, 3000), source: refOf(redirect.node, relativePath) });
        }
        continue;
      }

      const declaration = declarationOf(callee, parsed, context, args, source, relativePath);
      if (declaration) {
        const index = facts.declarations.length;
        facts.declarations.push(declaration.fact);
        declarationNodes.set(args.id, index);
        if (declaration.redirect) {
          facts.redirects.push({ text: declaration.redirect.text, declaration: index, source: refOf(declaration.redirect.node, relativePath) });
        }
        continue;
      }

      const lowerCall = /^[a-z_]/.test(callee.name);
      if (!lowerCall) {
        continue;
      }
      const allArguments = [...parsed.positional.map((item) => item.text), ...parsed.named.map((item) => item.text)];
      if (!allArguments.length) {
        continue;
      }
      const alwaysRecorded = callee.name in NAVIGATION_VERBS || OVERLAY_VERBS.has(callee.name);
      const argumentShaped = allArguments.some((text) => /^(?:const\s+)?['"]|^[A-Za-z_$][\w$]*\.[A-Za-z_$]/.test(text.trim()));
      const forwardsParameter = !!context.fn?.params.length
        && allArguments.some((text) => context.fn!.params.some((parameter) => new RegExp(`(^|[^\\w$.])${parameter.replace(/\$/g, "\\$")}($|[^\\w$])`).test(text)));
      if (!alwaysRecorded && !argumentShaped && !forwardsParameter) {
        continue;
      }
      facts.calls.push(callFact(callee, parsed, context, args, source, relativePath));
    }
    return facts;
  } finally {
    tree.delete();
    parser.delete();
  }
}
