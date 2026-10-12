import * as path from "path";
import { Language } from "web-tree-sitter";
import { collectDartFiles, loadDartLanguage, normalizePath, stringValue } from "../semantics/dart-source.js";
import {
  extractFileFacts,
  extractNamedCalls,
  KNOWN_DECLARATIONS,
  NAVIGATION_VERBS,
  OVERLAY_VERBS,
  ROUTER_LIKE,
  acceptsCallee,
  type CallFact,
  type ClassFact,
  type FileFacts,
  type RouteDeclFact,
} from "./dart-facts.js";
import { detectRouters, frameworkOf } from "./routers.js";
import type {
  Attribution,
  NavigationKind,
  DetectedRouter,
  TrailEdge,
  TrailFramework,
  TrailGraph,
  TrailRoute,
  TrailScannerOptions,
  TrailSourceRef,
  UnresolvedNavigation,
} from "./types.js";

/** Widget base classes that make a project class a widget. */
const FRAMEWORK_WIDGET_BASE = /^(?:Stateless|Stateful|Consumer|ConsumerStateful|Hook|HookConsumer|Inherited|ProxyWidget)Widget$|^Widget$|^(?:Consumer|Hook)\w*Widget$/;
/** Wrappers a router builder puts around the actual page. */
const WRAPPER_WIDGET = /(?:Guard|Transition|Provider|Scope|Builder|Wrapper|Listener|Shell)$|^(?:CustomTransitionPage|MaterialPage|CupertinoPage|NoTransitionPage|Scaffold|Material|MultiBlocProvider|MultiProvider)$/;
const PATH_ACCESSORS: ReadonlySet<string> = new Set(["toPath", "path", "route", "location", "toName", "name", "toSubPath", "routeName", "value"]);
/** Named arguments that carry data to the destination rather than the destination itself. */
const DATA_ARGUMENTS: ReadonlySet<string> = new Set(["extra", "arguments", "queryParameters", "pathParameters", "params", "data", "payload", "state"]);
/** Which routing package a declaring call belongs to. Anything else that declares a route is treated as the built-in Navigator. */
const DECLARATION_FRAMEWORK: Readonly<Record<string, TrailFramework>> = {
  GoRoute: "go_router", TypedGoRoute: "go_router", TypedRelativeGoRoute: "go_router",
  GetPage: "get",
  ChildRoute: "flutter_modular", ModuleRoute: "flutter_modular", child: "flutter_modular", module: "flutter_modular",
  VWidget: "vrouter", VNester: "vrouter",
  QRoute: "qlevar_router",
  AutoRoute: "auto_route", AdaptiveRoute: "auto_route", CustomRoute: "auto_route", MaterialRoute: "auto_route", CupertinoRoute: "auto_route",
  SailorRoute: "sailor",
  define: "fluro",
};
/** Which routing package a `routes: {...}` map belongs to. */
const ROUTE_MAP_FRAMEWORK: Readonly<Record<string, TrailFramework>> = {
  RoutesLocationBuilder: "beamer", SimpleLocationBuilder: "beamer", BeamerDelegate: "beamer", RouteMap: "routemaster",
};

function joinPath(base: string, child: string): string {
  const left = base.replace(/\/+$/, "");
  const right = child.replace(/^\/+/, "");
  return right ? `${left}/${right}` : left || "/";
}
const MAX_CANDIDATE_SOURCES = 4;
const MAX_COMPOSITION_DEPTH = 8;
const MAX_UNRESOLVED_REPORTED = 200;
const ATTRIBUTION_RANK: Readonly<Record<Attribution, number>> = {
  class: 0, file: 1, composition: 2, folder: 3, shared: 4, unresolved: 5,
};

export interface RouteRef {
  id: string;
  guard?: string;
}

interface EnumMember {
  key: string;
  path?: string;
  source: TrailSourceRef;
}

interface RouteBuild {
  route: TrailRoute;
  /** Every widget class that builds this route (a page class can serve several routes). */
  widgets: Set<string>;
}

function dirname(file: string): string {
  return path.posix.dirname(file);
}

function labelFor(id: string, routePath?: string, widget?: string): string {
  if (id.startsWith("overlay:") || id.startsWith("widget:")) {
    return id.slice(id.indexOf(":") + 1);
  }
  if (/^[A-Za-z_$][\w$]*\.[A-Za-z_$][\w$]*$/.test(id)) {
    return id.slice(id.indexOf(".") + 1);
  }
  if (id.startsWith("name:")) {
    return id.slice(5);
  }
  if (routePath) {
    const last = routePath.split("/").filter(Boolean).pop();
    return last ?? "/";
  }
  return widget ?? id;
}

function splitTernary(text: string): { condition: string; whenTrue: string; whenFalse: string } | undefined {
  let depth = 0;
  let quote = "";
  let question = -1;
  for (let index = 0; index < text.length; index++) {
    const char = text[index];
    if (quote) {
      if (char === "\\") {
        index++;
      } else if (char === quote) {
        quote = "";
      }
      continue;
    }
    if (char === "'" || char === '"') {
      quote = char;
    } else if ("([{".includes(char)) {
      depth++;
    } else if (")]}".includes(char)) {
      depth--;
    } else if (depth === 0 && char === "?" && text[index + 1] !== "." && text[index + 1] !== "?" && text[index - 1] !== "?") {
      question = index;
    } else if (depth === 0 && char === ":" && question >= 0) {
      return {
        condition: text.slice(0, question).trim(),
        whenTrue: text.slice(question + 1, index).trim(),
        whenFalse: text.slice(index + 1).trim(),
      };
    }
  }
  return undefined;
}

class RouteResolver {
  readonly enumMembers = new Map<string, EnumMember>();
  /** Enums that actually name routes. `AlertType.warning` passed to a dialog helper is not a destination. */
  readonly routeEnums = new Set<string>();
  readonly constants = new Map<string, string>();
  readonly idByPath = new Map<string, string>();
  readonly idByName = new Map<string, string>();
  private pathMatchers: Array<{ id: string; pattern: RegExp }> = [];

  constructor(facts: FileFacts[]) {
    for (const file of facts) {
      for (const enumFact of file.enums) {
        for (const member of enumFact.members) {
          const key = `${enumFact.name}.${member.name}`;
          this.enumMembers.set(key, {
            key,
            path: member.path ?? (enumFact.derivedPath ? `/${member.name}` : undefined),
            source: { path: file.path, line: member.line, column: 1 },
          });
        }
      }
      for (const constant of file.constants) {
        this.constants.set(constant.key, constant.value);
      }
    }
    // An enum is a route enum when it carries paths, or when a router declaration / entry point is written with it.
    const enumNames = new Set(facts.flatMap((file) => file.enums.map((item) => item.name)));
    for (const file of facts) {
      for (const enumFact of file.enums) {
        if (enumFact.derivedPath || enumFact.members.some((member) => member.path)) {
          this.routeEnums.add(enumFact.name);
        }
      }
    }
    const mention = (expression: string | undefined): void => {
      const name = expression ? /^(?:const\s+)?([A-Za-z_$][\w$]*)\./.exec(expression.trim())?.[1] : undefined;
      if (name && enumNames.has(name)) {
        this.routeEnums.add(name);
      }
    };
    for (const file of facts) {
      file.declarations.forEach((declaration) => {
        mention(declaration.pathExpr);
        mention(declaration.nameExpr);
      });
      file.namedRoutes.forEach((named) => mention(named.pathExpr));
      file.entries.forEach((entry) => mention(entry.text));
    }
  }

  static normalizePath(value: string): string {
    const withoutQuery = value.split(/[?#]/)[0];
    const trimmed = withoutQuery.length > 1 ? withoutQuery.replace(/\/+$/, "") : withoutQuery;
    return trimmed.startsWith("/") ? trimmed : `/${trimmed}`;
  }

  /** `AppRoute.login.toPath`, `Routes.home`, `'/login'` or an identifier constant, without its accessor. */
  describe(expression: string, owner?: string): { enumKey?: string; path?: string } {
    const text = expression.trim().replace(/^const\s+/, "");
    const literal = stringValue(text);
    if (literal !== undefined) {
      return { path: literal.startsWith("/") ? RouteResolver.normalizePath(literal) : undefined };
    }
    const segments = text.split(".");
    if (segments.length >= 2) {
      const key = `${segments[0]}.${segments[1]}`;
      if (this.routeEnums.has(segments[0]) && this.enumMembers.has(key) && segments.slice(2).every((accessor) => PATH_ACCESSORS.has(accessor))) {
        return { enumKey: key, path: this.enumMembers.get(key)!.path };
      }
    }
    const withoutAccessor = segments.length > 1 && PATH_ACCESSORS.has(segments[segments.length - 1]) ? segments.slice(0, -1).join(".") : text;
    // A bare name inside the class that declares it (`router.define(root, ...)` in `class Routes { static String root = '/'; }`).
    const constant = this.constants.get(withoutAccessor) ?? this.constants.get(text)
      ?? (owner && /^[\w$]+$/.test(withoutAccessor) ? this.constants.get(`${owner}.${withoutAccessor}`) : undefined);
    if (constant !== undefined && /^[\w$.]+$/.test(text)) {
      return { path: constant.startsWith("/") ? RouteResolver.normalizePath(constant) : undefined };
    }
    return {};
  }

  registerRoute(id: string, routePath: string | undefined, name: string | undefined): void {
    if (routePath) {
      const normalized = RouteResolver.normalizePath(routePath);
      if (!this.idByPath.has(normalized)) {
        this.idByPath.set(normalized, id);
        if (/[:*]/.test(normalized)) {
          const pattern = normalized.split("/").map((segment) => segment.startsWith(":") || segment.startsWith("*") ? "[^/]+" : segment.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("/");
          this.pathMatchers.push({ id, pattern: new RegExp(`^${pattern}$`) });
        }
      }
    }
    if (name && !this.idByName.has(name)) {
      this.idByName.set(name, id);
    }
  }

  private byPath(value: string): string | undefined {
    const normalized = RouteResolver.normalizePath(value.replace(/\$\{[^}]*\}|\$\w+/g, "x"));
    return this.idByPath.get(normalized) ?? this.pathMatchers.find((matcher) => matcher.pattern.test(normalized))?.id;
  }

  /** The route a single expression points at, or undefined when it is not a recognisable route reference. */
  single(expression: string, owner?: string): string | undefined {
    const text = expression.trim().replace(/^const\s+/, "");
    const quoted = /^(?:r)?(['"])([\s\S]*)\1$/.exec(text);
    if (quoted) {
      const value = quoted[2];
      if (value.startsWith("/")) {
        return this.byPath(value);
      }
      return this.idByName.get(value);
    }
    const described = this.describe(text, owner);
    if (described.enumKey) {
      return described.enumKey;
    }
    return described.path ? this.byPath(described.path) : undefined;
  }

  /** Every route an argument can lead to; a ternary of two references yields both, each with its condition. */
  references(expression: string, owner?: string): RouteRef[] {
    const text = expression.trim();
    const ternary = splitTernary(text);
    if (ternary) {
      const negated = /^[\w.!?]+$/.test(ternary.condition) ? `!${ternary.condition}` : `!(${ternary.condition})`;
      const results: RouteRef[] = [];
      for (const [branch, guard] of [[ternary.whenTrue, ternary.condition], [ternary.whenFalse, negated]] as const) {
        const id = this.single(branch, owner);
        if (id) {
          results.push({ id, guard });
        }
      }
      return results;
    }
    const id = this.single(text, owner);
    return id ? [{ id }] : [];
  }

  /** Every known route mentioned anywhere in a snippet (used for `redirect:` closures that return a location). */
  scan(text: string): string[] {
    const found = new Set<string>();
    for (const match of text.matchAll(/\b([A-Za-z_$][\w$]*)\.([A-Za-z_$][\w$]*)\b/g)) {
      const key = `${match[1]}.${match[2]}`;
      if (this.routeEnums.has(match[1]) && this.enumMembers.has(key)) {
        found.add(key);
      }
    }
    for (const match of text.matchAll(/(['"])(\/[^'"\s]*)\1/g)) {
      const id = this.byPath(match[2]);
      if (id) {
        found.add(id);
      }
    }
    return [...found];
  }
}

class ClassTable {
  private readonly all = new Map<string, Array<ClassFact & { file: string }>>();
  readonly definedIn = new Map<string, Set<string>>();
  readonly enumNames: ReadonlySet<string>;

  constructor(facts: FileFacts[], private readonly partRoot: ReadonlyMap<string, string>) {
    const enums = new Set<string>();
    for (const file of facts) {
      const defined = new Set<string>();
      for (const fact of file.classes) {
        const list = this.all.get(fact.name) ?? [];
        list.push({ ...fact, file: file.path });
        this.all.set(fact.name, list);
        if (fact.kind === "class") {
          defined.add(this.qualified(fact.name, file.path));
        }
      }
      file.enums.forEach((item) => enums.add(item.name));
      this.definedIn.set(file.path, defined);
    }
    this.enumNames = enums;
  }

  /** Private names (`_Body`, `_SubmitListener`) repeat across files, so they are scoped to the file that declares them. */
  private qualified(name: string, file: string): string {
    return name.startsWith("_") ? `${file}::${name}` : name;
  }

  /** Looks a class up as seen from `file`: its own declarations, then its `part of` library, then the project. */
  get(name: string, file?: string): (ClassFact & { file: string }) | undefined {
    const list = this.all.get(name);
    if (!list) {
      return undefined;
    }
    if (file) {
      const root = this.partRoot.get(file);
      return list.find((fact) => fact.file === file) ?? list.find((fact) => fact.file === root) ?? list[0];
    }
    return list[0];
  }

  /** `_LoginPageState extends State<LoginPage>` and `extension on _LoginPageState` both stand for `LoginPage`. */
  canonical(name: string, file?: string, depth = 0): string {
    const fact = this.get(name, file);
    if (!fact || depth > 4) {
      return name;
    }
    if (fact.kind === "extension" && fact.on) {
      return this.canonical(fact.on, fact.file, depth + 1);
    }
    if (fact.kind === "class" && fact.superclass && /State$/.test(fact.superclass) && fact.superArguments.length === 1) {
      return this.canonical(fact.superArguments[0], fact.file, depth + 1);
    }
    return this.qualified(name, fact.file);
  }

  isWidget(name: string, file?: string, depth = 0): boolean {
    const fact = this.get(name, file);
    if (!fact || fact.kind !== "class" || depth > 8) {
      return false;
    }
    if (fact.superclass && FRAMEWORK_WIDGET_BASE.test(fact.superclass)) {
      return true;
    }
    if (fact.superclass && this.all.has(fact.superclass) && this.isWidget(fact.superclass, fact.file, depth + 1)) {
      return true;
    }
    return /(?:Page|Screen|View|Sheet|Dialog)$/.test(name) && !fact.superclass?.endsWith("Bloc") && !fact.superclass?.endsWith("Cubit");
  }

  /** The first widget a router builder constructs that is a real project page (not a guard, provider or transition wrapper). */
  pageWidget(candidates: string[]): string | undefined {
    return candidates.find((candidate) => this.isWidget(candidate) && !WRAPPER_WIDGET.test(candidate));
  }
}

const ROUTE_PARAMETER_TYPES: ReadonlySet<string> = new Set(["String", "Widget", "WidgetBuilder", "Route", "RouteBase", "Object", "dynamic", "Uri", "Page"]);

function forwardsParameter(call: CallFact, enumNames: ReadonlySet<string>, strict = false): boolean {
  const fn = call.fn;
  if (!fn) {
    return false;
  }
  // Only parameters that can carry a destination count; a Bloc state or a bool does not.
  const params = fn.params.filter((_, index) => {
    const type = fn.types[index];
    return type === undefined || ROUTE_PARAMETER_TYPES.has(type) || enumNames.has(type);
  });
  if (!params.length) {
    return false;
  }
  const texts = [...call.positional, ...call.named.map((item) => item.text)].map((text) => text.trim());
  return texts.some((text) => params.some((parameter) => {
    const escaped = parameter.replace(/\$/g, "\\$");
    return strict
      ? new RegExp(`^${escaped}(?:\\.\\w+)?$`).test(text)
      : new RegExp(`(^|[^\\w$.])${escaped}($|[^\\w$])|\\$\\{?${escaped}(?![\\w$])`).test(text);
  }));
}

function kindOfCall(call: CallFact, helpers: Map<string, NavigationKind>, extra: ReadonlySet<string>): NavigationKind | undefined {
  const helper = helpers.get(call.name);
  if (helper) {
    return helper;
  }
  if (!acceptsCallee(call.name, call.callee)) {
    return extra.has(call.name) ? "push" : undefined;
  }
  const builtin = NAVIGATION_VERBS[call.name];
  if (builtin) {
    return builtin;
  }
  if (OVERLAY_VERBS.has(call.name)) {
    return "overlay";
  }
  return extra.has(call.name) ? "push" : undefined;
}

function detectHelpers(calls: CallFact[], extra: ReadonlySet<string>, enumNames: ReadonlySet<string>): Map<string, NavigationKind> {
  const helpers = new Map<string, NavigationKind>();
  for (let round = 0; round < 3; round++) {
    let changed = false;
    for (const call of calls) {
      if (!call.fn || helpers.has(call.fn.name)) {
        continue;
      }
      const kind = kindOfCall(call, helpers, extra);
      if (kind && forwardsParameter(call, enumNames, kind !== "overlay")) {
        helpers.set(call.fn.name, kind);
        changed = true;
      }
    }
    if (!changed) {
      break;
    }
  }
  return helpers;
}

export function buildRouteGraph(
  projectRoot: string,
  facts: FileFacts[],
  options: TrailScannerOptions = {},
  diagnostics: TrailGraph["diagnostics"] = [],
  routers: DetectedRouter[] = [],
  loadNamedCalls?: (names: ReadonlySet<string>) => CallFact[],
): TrailGraph {
  const resolver = new RouteResolver(facts);
  const partRoot = new Map(facts.map((file) => [file.path, file.partOf ?? file.path]));
  const classes = new ClassTable(facts, partRoot);
  const builds = new Map<string, RouteBuild>();
  const routeOrder: string[] = [];
  const frameworks = new Set<TrailFramework>();

  const ensureRoute = (id: string, init: Partial<TrailRoute> & { kind: TrailRoute["kind"]; framework: TrailFramework }): RouteBuild => {
    let build = builds.get(id);
    if (!build) {
      build = {
        route: { id, label: labelFor(id, init.path, init.widget), ...init },
        widgets: new Set(),
      };
      builds.set(id, build);
      routeOrder.push(id);
      frameworks.add(init.framework);
    }
    return build;
  };

  const widgetSource = (widget: string): TrailSourceRef | undefined => {
    const fact = classes.get(widget);
    return fact ? { path: fact.file, line: 1, column: 1 } : undefined;
  };

  // --- Routes declared by a class: auto_route pages and Beamer locations ---------------------------------
  /** Class or generated route name (`HomeRoute`, `HomeLocation`) -> route id, for navigation written as `router.push(HomeRoute())`. */
  const routeKeys = new Map<string, string>();
  for (const file of facts) {
    for (const fact of file.classes) {
      const page = fact.annotations.find((annotation) => annotation.name === "RoutePage");
      if (page && fact.kind === "class") {
        // auto_route generates `HomePage` -> `HomeRoute` unless `@RoutePage(name: ...)` says otherwise.
        const custom = stringValue(page.named.find((item) => item.name === "name")?.text);
        const key = custom ?? `${fact.name.replace(/(?:Page|Screen)$/, "")}Route`;
        ensureRoute(key, {
          kind: "screen", framework: "auto_route", widget: fact.name, widgetSource: widgetSource(fact.name),
          source: { path: file.path, line: 1, column: 1 },
        }).widgets.add(fact.name);
        routeKeys.set(key, key);
      }
      if (fact.beamPaths && fact.kind === "class") {
        const beamPath = fact.beamPaths[0];
        const id = beamPath ? RouteResolver.normalizePath(beamPath) : fact.name;
        const widget = classes.pageWidget(fact.bodyWidgets ?? []);
        const build = ensureRoute(id, {
          kind: "screen", framework: "beamer", path: beamPath ? RouteResolver.normalizePath(beamPath) : undefined, widget,
          widgetSource: widget ? widgetSource(widget) : undefined, source: { path: file.path, line: 1, column: 1 },
        });
        if (widget) {
          build.widgets.add(widget);
        }
        routeKeys.set(fact.name, id);
        resolver.registerRoute(id, beamPath, undefined);
      }
    }
  }

  // --- flutter_modular: `ModuleRoute('/auth', module: AuthModule())` prefixes every route AuthModule declares --
  const mounts = new Map<string, { path?: string; owner?: string }>();
  for (const file of facts) {
    for (const declaration of file.declarations) {
      if (declaration.module) {
        const described = declaration.pathExpr ? resolver.describe(declaration.pathExpr, declaration.owner) : {};
        mounts.set(declaration.module, { path: described.path ?? stringValue(declaration.pathExpr), owner: declaration.owner });
      }
    }
  }
  const prefixOf = (moduleClass: string | undefined, depth = 0): string => {
    const mount = moduleClass ? mounts.get(moduleClass) : undefined;
    if (!mount || depth > 5) {
      return "";
    }
    const base = prefixOf(mount.owner, depth + 1);
    return mount.path ? joinPath(base, mount.path) : base;
  };

  const handlerWidgets = new Map<string, string[]>();
  for (const file of facts) {
    for (const handler of file.handlers) {
      handlerWidgets.set(handler.name, handler.widgets);
    }
  }

  // --- Routes declared as calls: go_router, GetX, Modular, VRouter, Qlevar, auto_route config, Fluro ---------
  const declarationIds = new Map<RouteDeclFact, string>();
  const declarationPaths = new Map<RouteDeclFact, string | undefined>();
  const entryIds: string[] = [];
  for (const file of facts) {
    file.declarations.forEach((declaration) => {
      // A module mount only prefixes the routes inside the module; it is not a screen itself.
      if (declaration.module && !declaration.widgets.length && !declaration.handler && !declaration.pageKey && !declaration.typedClass) {
        return;
      }
      const own = declaration.pathExpr ? resolver.describe(declaration.pathExpr, declaration.owner) : {};
      // A call that merely pairs some value with a widget is not a route unless the value resolves to one.
      if (!KNOWN_DECLARATIONS.has(declaration.callee) && !own.path && !own.enumKey && !declaration.handler) {
        return;
      }
      const parent = declaration.parent !== undefined ? file.declarations[declaration.parent] : undefined;
      const parentPath = parent ? declarationPaths.get(parent) : undefined;
      let fullPath = own.path;
      const literal = declaration.pathExpr ? stringValue(declaration.pathExpr) : undefined;
      if (!fullPath && literal && !literal.startsWith("/") && parentPath) {
        fullPath = joinPath(parentPath, literal);
      } else if (own.path && !own.path.startsWith("/") && parentPath) {
        fullPath = joinPath(parentPath, own.path);
      }
      if (fullPath && !parent && declaration.owner) {
        const prefix = prefixOf(declaration.owner);
        fullPath = prefix ? joinPath(prefix, fullPath) : fullPath;
      }
      declarationPaths.set(declaration, fullPath);
      const nameLiteral = declaration.nameExpr ? stringValue(declaration.nameExpr) : undefined;
      const nameEnum = declaration.nameExpr ? resolver.describe(declaration.nameExpr).enumKey : undefined;
      const typed = declaration.typedClass ? classes.get(declaration.typedClass) : undefined;
      const widget = classes.pageWidget([
        ...declaration.widgets,
        ...(typed?.bodyWidgets ?? []),
        ...(declaration.handler ? handlerWidgets.get(declaration.handler) ?? [] : []),
      ]);
      const framework = DECLARATION_FRAMEWORK[declaration.callee] ?? "navigator";
      const id = declaration.typedClass
        ?? (declaration.pageKey ? routeKeys.get(declaration.pageKey) ?? declaration.pageKey : undefined)
        ?? own.enumKey ?? nameEnum ?? fullPath ?? (nameLiteral ? `name:${nameLiteral}` : `route:${declaration.source.path}:${declaration.source.line}`);
      const build = ensureRoute(id, {
        kind: "screen",
        framework,
        path: fullPath,
        name: nameLiteral,
        widget,
        widgetSource: widget ? widgetSource(widget) : undefined,
        source: declaration.source,
        parent: parent ? declarationIds.get(parent) : undefined,
      });
      // `AutoRoute(page: HomeRoute.page, path: '/home')` adds its path to the route the @RoutePage class created.
      build.route.path ??= fullPath;
      build.route.name ??= nameLiteral;
      if (widget) {
        build.widgets.add(widget);
        build.route.widget ??= widget;
      }
      const key = declaration.typedClass ?? declaration.pageKey;
      if (key) {
        routeKeys.set(key, id);
      }
      if (declaration.initial) {
        entryIds.push(id);
      }
      declarationIds.set(declaration, id);
      resolver.registerRoute(id, fullPath, nameLiteral);
    });
  }

  // --- Routes written as a table: `routes: {...}` maps (MaterialApp, Beamer, Routemaster) and onGenerateRoute code ---
  for (const file of facts) {
    for (const named of file.namedRoutes) {
      const described = resolver.describe(named.pathExpr, named.owner);
      if (!described.path && !described.enumKey) {
        continue;
      }
      const widget = classes.pageWidget(named.widgets);
      // A `switch`/`if` on a name that builds no project page is just application code.
      if (!widget && (named.callee === "switch" || named.callee === "if")) {
        continue;
      }
      const id = described.enumKey ?? described.path!;
      const build = ensureRoute(id, {
        kind: "screen",
        framework: ROUTE_MAP_FRAMEWORK[named.callee] ?? "navigator",
        path: described.path,
        widget,
        widgetSource: widget ? widgetSource(widget) : undefined,
        source: named.source,
      });
      if (widget) {
        build.widgets.add(widget);
        build.route.widget ??= widget;
      }
      resolver.registerRoute(id, described.path, undefined);
    }
  }

  // Enum members that a router wired up with a path only we could derive still need to resolve by path.
  for (const [key, member] of resolver.enumMembers) {
    const build = builds.get(key);
    if (build && member.path) {
      build.route.path ??= member.path;
      resolver.registerRoute(key, member.path, undefined);
    }
  }

  // `MaterialApp(home: X())` is a screen even though no route table names it.
  for (const file of facts) {
    for (const item of file.entries) {
      const widget = item.kind === "home" ? /\b([A-Z][A-Za-z0-9_]*)\s*\(/.exec(item.text)?.[1] : undefined;
      if (widget && classes.isWidget(widget) && ![...builds.values()].some((build) => build.widgets.has(widget))) {
        ensureRoute(`widget:${widget}`, { kind: "screen", framework: "widget", widget, widgetSource: widgetSource(widget) }).widgets.add(widget);
      }
    }
  }

  const routesByWidget = new Map<string, string[]>();
  const indexWidgets = (): void => {
    routesByWidget.clear();
    for (const [id, build] of builds) {
      for (const widget of build.widgets) {
        const list = routesByWidget.get(widget) ?? [];
        list.push(id);
        routesByWidget.set(widget, list);
      }
    }
  };
  indexWidgets();

  const allCalls = facts.flatMap((file) => file.calls);
  const extraCallees = new Set((options.navigationCallees ?? []).map((value) => value.trim()).filter(Boolean));
  const helpers = detectHelpers(allCalls, extraCallees, classes.enumNames);

  // --- Which screen does a piece of code belong to? -----------------------------------------------------
  const usedBy = new Map<string, Set<string>>();
  for (const file of facts) {
    for (const use of file.uses) {
      const user = classes.canonical(use.owner, file.path);
      const used = classes.canonical(use.type, file.path);
      // A screen "builds" widgets; calling a static method on a utility class (AppNavigator.toHome()) does not make it part of the screen.
      if (user === used || !classes.isWidget(use.type, file.path)) {
        continue;
      }
      const users = usedBy.get(used) ?? new Set<string>();
      users.add(user);
      usedBy.set(used, users);
    }
  }
  const routeDirs = new Map<string, Set<string>>();
  const registerRouteDirs = (): void => {
    routeDirs.clear();
    for (const [widget, ids] of routesByWidget) {
      const file = classes.get(widget)?.file;
      if (!file) {
        continue;
      }
      const directory = dirname(file);
      const set = routeDirs.get(directory) ?? new Set<string>();
      ids.forEach((id) => set.add(id));
      routeDirs.set(directory, set);
    }
  };
  registerRouteDirs();

  const attribute = (call: CallFact): { sources: string[]; attribution: Attribution; candidates: string[] } => {
    const owner = call.owner ? classes.canonical(call.owner, call.source.path) : undefined;
    if (owner && routesByWidget.has(owner)) {
      return { sources: routesByWidget.get(owner)!, attribution: "class", candidates: [] };
    }
    if (owner) {
      let frontier = new Set([owner]);
      const visited = new Set(frontier);
      for (let depth = 0; depth < MAX_COMPOSITION_DEPTH && frontier.size; depth++) {
        const next = new Set<string>();
        for (const widget of frontier) {
          usedBy.get(widget)?.forEach((user) => {
            if (!visited.has(user)) {
              visited.add(user);
              next.add(user);
            }
          });
        }
        const hits = [...next].filter((widget) => routesByWidget.has(widget));
        if (hits.length) {
          const routes = [...new Set(hits.flatMap((widget) => routesByWidget.get(widget)!))];
          return routes.length <= MAX_CANDIDATE_SOURCES
            ? { sources: routes, attribution: "composition", candidates: [] }
            : { sources: [], attribution: "shared", candidates: routes.slice(0, 8) };
        }
        frontier = next;
      }
    }
    const roots = [...new Set([call.source.path, partRoot.get(call.source.path) ?? call.source.path])];
    const localRoutes = [...new Set(roots.flatMap((root) => [...(classes.definedIn.get(root) ?? [])])
      .flatMap((widget) => routesByWidget.get(widget) ?? []))];
    if (localRoutes.length && localRoutes.length <= MAX_CANDIDATE_SOURCES) {
      return { sources: localRoutes, attribution: "file", candidates: [] };
    }
    for (let directory = dirname(roots[roots.length - 1]); directory && directory !== "." && directory !== "lib"; directory = dirname(directory)) {
      const nearby = routeDirs.get(directory);
      if (nearby && nearby.size <= 3) {
        return { sources: [...nearby], attribution: "folder", candidates: [] };
      }
    }
    return { sources: [], attribution: "unresolved", candidates: [] };
  };

  // --- Edges ----------------------------------------------------------------------------------------------
  const edges: TrailEdge[] = [];
  const unresolvedNavigation: UnresolvedNavigation[] = [];
  const seenEdges = new Set<string>();

  const pushEdge = (
    call: Pick<CallFact, "callee" | "owner" | "trigger" | "guards" | "source">,
    to: string,
    navigation: NavigationKind,
    extraGuard: string | undefined,
    attributed: ReturnType<typeof attribute>,
  ): void => {
    const guards = extraGuard ? [...call.guards, extraGuard] : call.guards;
    const sources: Array<string | null> = attributed.sources.length ? attributed.sources : [null];
    for (const from of sources) {
      if (from === to && attributed.attribution !== "class") {
        continue;
      }
      const key = `${from}|${to}|${call.source.path}:${call.source.line}:${call.source.column}|${extraGuard ?? ""}`;
      if (seenEdges.has(key)) {
        continue;
      }
      seenEdges.add(key);
      edges.push({
        id: "",
        from,
        fromCandidates: from === null ? attributed.candidates : [],
        to,
        navigation,
        callee: call.callee,
        trigger: call.trigger,
        guards,
        owner: call.owner,
        attribution: attributed.attribution,
        source: call.source,
      });
    }
  };

  const declarationIdOf = (file: FileFacts, index: number | undefined): string | undefined =>
    index === undefined ? undefined : declarationIds.get(file.declarations[index]);

  const ensureTarget = (id: string, navigation: NavigationKind, widget: string | undefined): void => {
    if (builds.has(id)) {
      const build = builds.get(id)!;
      if (widget && !build.route.widget) {
        build.route.widget = widget;
        build.route.widgetSource = widgetSource(widget);
      }
      return;
    }
    const member = resolver.enumMembers.get(id);
    ensureRoute(id, {
      kind: navigation === "overlay" ? "overlay" : "screen",
      framework: member ? "enum" : "widget",
      path: member?.path,
      widget,
      widgetSource: widget ? widgetSource(widget) : undefined,
      source: member?.source,
    });
  };

  // --- Destination helpers: `void toDashboard() => context.go('/dashboard')` -------------------------------------
  // The navigation is written once, in a small method; the screen it leaves from is wherever that method is called.
  interface Destination {
    id: string;
    navigation: NavigationKind;
    guards: string[];
  }
  // Navigation that already belongs to a screen (its own class, a `part` file, a widget it builds) is that screen's own
  // handler. Only code no screen claims, such as a navigation service or a `BuildContext` extension, is a reusable helper.
  const attributionCache = new Map<CallFact, ReturnType<typeof attribute>>();
  const attributionOf = (call: CallFact): ReturnType<typeof attribute> => {
    let result = attributionCache.get(call);
    if (!result) {
      result = attribute(call);
      attributionCache.set(call, result);
    }
    return result;
  };
  const claimedByScreen = (call: CallFact): boolean => !["unresolved", "shared"].includes(attributionOf(call).attribution);
  const destinationHelpers = new Map<string, Destination[]>();
  /** Library (file or `part of` root) a helper was defined in; private helpers only apply inside it. */
  const helperLibrary = new Map<string, string>();
  /** Files that define a navigating function of this name, whoever claims it: the name is ambiguous if there are several. */
  const definitionFiles = new Map<string, Set<string>>();
  for (const call of allCalls) {
    if (call.fn && kindOfCall(call, helpers, extraCallees)) {
      const files = definitionFiles.get(call.fn.name) ?? new Set<string>();
      files.add(call.source.path);
      definitionFiles.set(call.fn.name, files);
    }
  }
  for (const call of allCalls) {
    const navigation = call.fn ? kindOfCall(call, helpers, extraCallees) : undefined;
    if (!call.fn || !navigation || navigation === "overlay" || helpers.has(call.fn.name) || claimedByScreen(call)) {
      continue;
    }
    const references = [...call.positional, ...call.named.filter((item) => !DATA_ARGUMENTS.has(item.name)).map((item) => item.text)]
      .flatMap((text) => resolver.references(text, call.owner));
    if (references.length && (definitionFiles.get(call.fn.name)?.size ?? 0) === 1) {
      helperLibrary.set(call.fn.name, partRoot.get(call.source.path) ?? call.source.path);
      const list = destinationHelpers.get(call.fn.name) ?? [];
      references.forEach((reference) => list.push({
        id: reference.id,
        navigation,
        guards: reference.guard ? [...call.guards, reference.guard] : call.guards,
      }));
      destinationHelpers.set(call.fn.name, list);
    }
  }
  const isDestinationBody = (call: CallFact): boolean =>
    !!call.fn && destinationHelpers.has(call.fn.name) && !claimedByScreen(call);

  for (const file of facts) {
    for (const call of file.calls) {
      const navigation = kindOfCall(call, helpers, extraCallees);
      // The body of a destination helper is a definition; its edges are drawn from the helper's call sites below.
      if (!navigation || isDestinationBody(call)) {
        continue;
      }
      const argumentTexts = [
        ...call.positional,
        ...call.named.filter((item) => !DATA_ARGUMENTS.has(item.name)).map((item) => item.text),
      ];
      const references = argumentTexts.flatMap((text) => resolver.references(text, call.owner));
      const enclosingRoute = declarationIdOf(file, call.declaration);
      const attributed = attributionOf(call);
      const contentWidget = call.widgetArgs.find((name) => classes.isWidget(name) && !WRAPPER_WIDGET.test(name));

      if (references.length) {
        for (const reference of references) {
          if (enclosingRoute && reference.id === enclosingRoute) {
            continue;
          }
          ensureTarget(reference.id, navigation, navigation === "overlay" ? contentWidget : undefined);
          pushEdge(call, reference.id, navigation, reference.guard, attributed);
        }
        continue;
      }

      if (navigation !== "overlay") {
        // Typed / generated routes: `HomeRoute().go(context)`, `context.router.push(HomeRoute())`, `replaceAll([A(), B()])`, `beamTo(HomeLocation())`.
        const keyed = [...new Set([call.receiverConstructor, ...call.widgetArgs]
          .filter((name): name is string => !!name && routeKeys.has(name))
          .map((name) => routeKeys.get(name)!))];
        const reachable = keyed.filter((id) => id !== enclosingRoute);
        if (reachable.length) {
          reachable.forEach((id) => pushEdge(call, id, navigation, undefined, attributed));
          continue;
        }
        // A page handed over directly: `Navigator.push(ctx, MaterialPageRoute(builder: (_) => X()))`, `Get.to(() => X())`.
        const destination = call.widgetArgs.find((name) => classes.isWidget(name) && !WRAPPER_WIDGET.test(name));
        if (destination) {
          const known = routesByWidget.get(destination)?.[0];
          const id = known ?? `widget:${destination}`;
          if (!known) {
            ensureRoute(id, { kind: "screen", framework: "widget", widget: destination, widgetSource: widgetSource(destination) }).widgets.add(destination);
            indexWidgets();
            registerRouteDirs();
          }
          pushEdge(call, id, navigation, undefined, attributed);
          continue;
        }
      }
      if (navigation === "overlay") {
        if (contentWidget) {
          // A dialog/sheet shown from code that belongs to no known screen is a helper's own body or an
          // app-wide alert: keeping it would only add edges nobody can follow.
          if (attributed.attribution === "unresolved" || attributed.attribution === "shared") {
            continue;
          }
          const id = routesByWidget.get(contentWidget)?.[0] ?? `overlay:${contentWidget}`;
          ensureTarget(id, "overlay", contentWidget);
          pushEdge(call, id, "overlay", undefined, attributed);
        }
        continue;
      }
      if (forwardsParameter(call, classes.enumNames) || !(call.name in NAVIGATION_VERBS || helpers.has(call.name) || extraCallees.has(call.name))) {
        continue;
      }
      if ((call.name in NAVIGATION_VERBS) && !ROUTER_LIKE.test(call.callee)) {
        continue;
      }
      if (unresolvedNavigation.length < MAX_UNRESOLVED_REPORTED) {
        unresolvedNavigation.push({
          callee: call.callee,
          expression: argumentTexts[0] ?? "",
          source: call.source,
          owner: call.owner,
        });
      }
    }

    // `redirect:` closures return a location instead of calling the router.
    for (const redirect of file.redirects) {
      const owningRoute = declarationIdOf(file, redirect.declaration);
      for (const target of resolver.scan(redirect.text)) {
        if (target === owningRoute) {
          continue;
        }
        ensureTarget(target, "redirect", undefined);
        const sources = owningRoute ? [owningRoute] : [];
        pushEdge(
          { callee: "redirect", owner: undefined, trigger: { kind: "redirect", hint: "redirect" }, guards: [], source: redirect.source },
          target,
          "redirect",
          undefined,
          { sources, attribution: owningRoute ? "class" : "unresolved", candidates: [] },
        );
      }
    }
  }

  // --- Call sites of destination helpers ---------------------------------------------------------------------
  if (destinationHelpers.size && loadNamedCalls) {
    for (const call of loadNamedCalls(new Set(destinationHelpers.keys()))) {
      // `_parseState` exists in a hundred files; a private helper only applies inside the library that defines it.
      if (isDestinationBody(call) || (call.name.startsWith("_") && (partRoot.get(call.source.path) ?? call.source.path) !== helperLibrary.get(call.name))) {
        continue;
      }
      const attributed = attribute(call);
      for (const destination of destinationHelpers.get(call.name) ?? []) {
        ensureTarget(destination.id, destination.navigation, undefined);
        pushEdge({ ...call, guards: [...call.guards, ...destination.guards] }, destination.id, destination.navigation, undefined, attributed);
      }
    }
  }

  // --- Bottom navigation: every tab of a StatefulShellRoute can be reached from every other tab ---------------
  for (const file of facts) {
    const shells = new Map<number, Map<number, string[]>>();
    file.declarations.forEach((declaration) => {
      const id = declarationIds.get(declaration);
      if (!declaration.shell || !id) {
        return;
      }
      const branches = shells.get(declaration.shell.shell) ?? new Map<number, string[]>();
      branches.set(declaration.shell.branch, [...(branches.get(declaration.shell.branch) ?? []), id]);
      shells.set(declaration.shell.shell, branches);
    });
    for (const branches of shells.values()) {
      const tabs = [...branches.values()].map((ids) => ids[0]);
      for (const from of tabs) {
        for (const to of tabs) {
          if (from !== to) {
            const source = builds.get(to)?.route.source ?? { path: file.path, line: 1, column: 1 };
            pushEdge(
              { callee: "StatefulShellRoute", owner: undefined, trigger: { kind: "user", hint: "bottom navigation" }, guards: [], source },
              to,
              "tab",
              undefined,
              { sources: [from], attribution: "class", candidates: [] },
            );
          }
        }
      }
    }
  }

  // --- Entry points ---------------------------------------------------------------------------------------
  const entry: string[] = [];
  for (const file of facts) {
    for (const item of file.entries) {
      if (item.kind === "location") {
        const id = resolver.single(item.text, item.owner);
        if (id && builds.has(id) && !entry.includes(id)) {
          entry.push(id);
        }
      } else {
        const widget = /\b([A-Z][A-Za-z0-9_]*)\s*\(/.exec(item.text)?.[1];
        const id = widget ? routesByWidget.get(widget)?.[0] : undefined;
        if (id && !entry.includes(id)) {
          entry.push(id);
        }
      }
    }
  }
  for (const id of entryIds) {
    if (builds.has(id) && !entry.includes(id)) {
      entry.push(id);
    }
  }
  for (const id of entry) {
    builds.get(id)!.route.initial = true;
  }

  // --- Assemble -------------------------------------------------------------------------------------------
  const routes = routeOrder.map((id) => builds.get(id)!.route);
  edges.sort((a, b) => a.source.path.localeCompare(b.source.path) || a.source.line - b.source.line || a.source.column - b.source.column);
  edges.forEach((edge, index) => {
    edge.id = `e${index + 1}`;
  });
  const withSource = edges.filter((edge) => edge.from !== null).length;

  // Say so when the project's router is not (fully) understood, instead of quietly reporting a thin graph.
  const foundFrameworks = new Set(routes.map((route) => route.framework));
  for (const router of routers) {
    if (router.support === "none") {
      diagnostics.push({ path: "pubspec.yaml", severity: "warning", message: `${router.package} is used but its routes are not read. ${router.note}` });
    } else if (router.package !== "get" && !foundFrameworks.has(frameworkOf(router.package) as TrailFramework)) {
      diagnostics.push({
        path: "pubspec.yaml",
        severity: "warning",
        message: `${router.package} is in pubspec.yaml but no routes declared with it were found. They may be built dynamically or live in generated code; the agent should read the router setup directly.`,
      });
    }
  }
  if (!routes.length) {
    diagnostics.push({
      path: "lib",
      severity: "warning",
      message: "No routes were found. The app may use a router the scan does not read; list its navigation methods in flutter-config-manager.trail.navigationCallees, or have the agent read the router setup.",
    });
  }
  const screens = routes.filter((route) => route.kind === "screen").length;

  return {
    projectRoot,
    generatedAt: new Date().toISOString(),
    frameworks: [...frameworks].sort(),
    routers,
    routes,
    edges,
    entry,
    navigationHelpers: [
      ...[...helpers].map(([name, navigation]) => ({ name, navigation })),
      ...[...destinationHelpers].filter(([name]) => !helpers.has(name)).map(([name, list]) => ({ name, navigation: list[0].navigation })),
    ].sort((a, b) => a.name.localeCompare(b.name)),
    unresolvedNavigation,
    totals: {
      routes: routes.length,
      screens,
      overlays: routes.length - screens,
      edges: edges.length,
      edgesWithSource: withSource,
      edgesWithoutSource: edges.length - withSource,
      unresolvedNavigation: unresolvedNavigation.length,
      filesScanned: facts.length,
    },
    diagnostics,
  };
}

export function weakestAttribution(values: Attribution[]): Attribution {
  return values.reduce<Attribution>((worst, value) => ATTRIBUTION_RANK[value] > ATTRIBUTION_RANK[worst] ? value : worst, "class");
}

export async function scanRouteGraph(rootPath: string, options: TrailScannerOptions = {}): Promise<TrailGraph> {
  const root = path.resolve(rootPath);
  const language: Language = await loadDartLanguage();
  const { files } = collectDartFiles(root, options.excludedGlobs ?? []);
  const diagnostics: TrailGraph["diagnostics"] = [];
  const facts: FileFacts[] = [];
  for (const file of files) {
    try {
      const result = extractFileFacts(root, file, language);
      if (result.parseError) {
        diagnostics.push({
          path: normalizePath(path.relative(root, file)),
          severity: "warning",
          message: "The Dart parser reported syntax errors; routes and navigation calls from this file may be incomplete.",
        });
      }
      facts.push(result);
    } catch (error) {
      diagnostics.push({
        path: normalizePath(path.relative(root, file)),
        severity: "error",
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }
  const loadNamedCalls = (names: ReadonlySet<string>): CallFact[] =>
    files.flatMap((file) => {
      try {
        return extractNamedCalls(root, file, language, names);
      } catch {
        return [];
      }
    });
  return buildRouteGraph(root, facts, options, diagnostics, detectRouters(root), loadNamedCalls);
}
