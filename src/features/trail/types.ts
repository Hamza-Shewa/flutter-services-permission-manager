/** Types shared by the route-graph extractor, the trail store and the Trail tab / MCP tools. Pure: no vscode. */

export interface TrailSourceRef {
  /** Project-relative, forward-slash path. */
  path: string;
  line: number;
  column: number;
}

/**
 * - `screen`: a page reached through a route (go_router `GoRoute`, Navigator named route or `MaterialPageRoute`).
 * - `overlay`: a bottom sheet / dialog, either named through a route constant or identified by its widget class.
 */
export type TrailRouteKind = "screen" | "overlay";

/**
 * Where a route was declared. `navigator` is the built-in Navigator (named route maps, `onGenerateRoute`, `MaterialPageRoute`);
 * `enum` and `widget` mark routes known only from how they are used, not from a router declaration.
 */
export type TrailFramework =
  | "go_router"
  | "auto_route"
  | "fluro"
  | "get"
  | "flutter_modular"
  | "beamer"
  | "routemaster"
  | "vrouter"
  | "qlevar_router"
  | "sailor"
  | "navigator"
  | "enum"
  | "widget";

/** How much of a routing package the scan understands. */
export type RouterSupport = "full" | "partial" | "none";

export interface DetectedRouter {
  package: string;
  support: RouterSupport;
  /** What is and is not read for this package. */
  note: string;
}

export interface TrailRoute {
  /** Canonical, stable identifier: `AppRoute.login`, `/settings`, `name:profile`, `widget:ReceiptPage` or `overlay:OtpSheet`. */
  id: string;
  kind: TrailRouteKind;
  /** Short human label (the enum member, last path segment or widget class). */
  label: string;
  framework: TrailFramework;
  path?: string;
  name?: string;
  /** The widget class the route builds, when it could be identified. */
  widget?: string;
  widgetSource?: TrailSourceRef;
  /** Where the route is declared (the `GoRoute(...)` call or the enum member). */
  source?: TrailSourceRef;
  /** `id` of the enclosing `GoRoute` for nested routes. */
  parent?: string;
  /** True when the router's initial location / `initialRoute` / `home` points at it. */
  initial?: boolean;
}

export type NavigationKind = "push" | "go" | "replace" | "overlay" | "redirect" | "tab";

export type TriggerKind = "user" | "state" | "redirect" | "lifecycle" | "unknown";

/** How the source screen of an edge was worked out, from most to least certain. */
export type Attribution =
  /** The call sits in the route's own widget class (or its `State`). */
  | "class"
  /** The call sits in a `part` file / helper in the same library as the route's widget. */
  | "file"
  /** The call sits in a widget that a route's widget builds (transitively). */
  | "composition"
  /** Only the folder suggests the screen. Verify before relying on it. */
  | "folder"
  /** A widget used by many screens: `fromCandidates` lists some, none is authoritative. */
  | "shared"
  | "unresolved";

export interface TrailEdge {
  id: string;
  /** Source route `id`; null when the owning screen could not be determined. */
  from: string | null;
  /** Possible source routes when `from` is null or uncertain. */
  fromCandidates: string[];
  to: string;
  navigation: NavigationKind;
  /** The call as written, for example `context.pushNavigation`. */
  callee: string;
  trigger: { kind: TriggerKind; hint?: string };
  /** Conditions that must hold for this call to run (enclosing `if` / `switch` / ternary), outermost first. */
  guards: string[];
  /** Enclosing class or extension. */
  owner?: string;
  attribution: Attribution;
  source: TrailSourceRef;
}

/** A navigation call whose target could not be resolved to a known route. */
export interface UnresolvedNavigation {
  callee: string;
  expression: string;
  source: TrailSourceRef;
  owner?: string;
}

export interface TrailGraphTotals {
  routes: number;
  screens: number;
  overlays: number;
  edges: number;
  edgesWithSource: number;
  edgesWithoutSource: number;
  unresolvedNavigation: number;
  filesScanned: number;
}

export interface TrailGraph {
  projectRoot: string;
  generatedAt: string;
  frameworks: TrailFramework[];
  /** Routing packages found in pubspec.yaml, with how well the scan understands each. */
  routers: DetectedRouter[];
  routes: TrailRoute[];
  edges: TrailEdge[];
  /** Route ids the app starts on. */
  entry: string[];
  /** Project methods detected as navigation helpers (they forward a parameter to a router call). */
  navigationHelpers: Array<{ name: string; navigation: NavigationKind }>;
  unresolvedNavigation: UnresolvedNavigation[];
  totals: TrailGraphTotals;
  diagnostics: Array<{ path: string; severity: "warning" | "error"; message: string }>;
}

export interface TrailScannerOptions {
  excludedGlobs?: string[];
  /** Extra method names to treat as navigation calls (they take a route and move to it). */
  navigationCallees?: string[];
}

export interface RoutePathHop {
  from: string;
  to: string;
  /** Every edge between the two routes; the first is the most direct (user triggered, source known). */
  edgeIds: string[];
}

export interface RoutePath {
  routes: string[];
  hops: RoutePathHop[];
  /** Lowest attribution certainty among the hops. */
  weakestAttribution: Attribution;
}

/** A hop with its edges spelled out, for UIs and agents that need the call site and conditions. */
export interface ExpandedRoutePathHop {
  from: string;
  to: string;
  edges: TrailEdge[];
}

export interface ExpandedRoutePath {
  routes: string[];
  weakestAttribution: Attribution;
  hops: ExpandedRoutePathHop[];
}

export interface ExpandedRoutePathsResult {
  from: TrailRoute[];
  to: TrailRoute | null;
  paths: ExpandedRoutePath[];
  unattributedIntoTarget: TrailEdge[];
  error?: string;
  candidates?: TrailRoute[];
}

/** The graph without its edge list, small enough to send to the webview. */
export interface TrailGraphSummary {
  projectRoot: string;
  generatedAt: string;
  frameworks: TrailFramework[];
  routers: DetectedRouter[];
  entry: string[];
  totals: TrailGraphTotals;
  routes: TrailRoute[];
  /** Edges whose source screen is unknown. */
  unattributed: Array<{ id: string; to: string; source: TrailSourceRef; fromCandidates: string[] }>;
  unresolvedNavigation: UnresolvedNavigation[];
  navigationHelpers: TrailGraph["navigationHelpers"];
  diagnostics: TrailGraph["diagnostics"];
}

export interface RoutePathsResult {
  from: TrailRoute[];
  to: TrailRoute | null;
  paths: RoutePath[];
  /** Edges into the target whose source screen is unknown: the likely reason when no path exists. */
  unattributedIntoTarget: TrailEdge[];
  /** Set when `from` or `to` could not be matched to a route. */
  error?: string;
  candidates?: TrailRoute[];
}

export type TrailStepKind = "screen" | "sheet" | "dialog" | "action" | "decision" | "outcome";

export interface TrailBranch {
  /** For example `OTP rejected` or `payment failed`. */
  label: string;
  /** Id of another step in the same trail. */
  to: string;
}

export interface TrailStep {
  id: string;
  title: string;
  kind: TrailStepKind;
  /** A `TrailRoute.id`; omitted for actions and for sheets/dialogs without a route. */
  route?: string;
  source?: { path: string; line?: number };
  /** When this step happens at all, for example `only the first time the app is launched`. */
  condition?: string;
  optional?: boolean;
  note?: string;
  /** Alternative continuations. A step without branches continues to the next one in the list. */
  branches?: TrailBranch[];
}

export interface Trail {
  id: string;
  title: string;
  goal?: string;
  summary?: string;
  steps: TrailStep[];
  updatedAt: string;
}

export interface TrailFile {
  version: 1;
  trails: Trail[];
}

export interface TrailWithIssues extends Trail {
  /** Problems found against the current route graph (a route that no longer exists, a missing file). */
  issues: string[];
}

export const TRAIL_STEP_KINDS: readonly TrailStepKind[] = ["screen", "sheet", "dialog", "action", "decision", "outcome"];
