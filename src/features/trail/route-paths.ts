import { weakestAttribution } from "./route-graph.js";
import type {
  Attribution,
  ExpandedRoutePathsResult,
  RoutePath,
  RoutePathHop,
  RoutePathsResult,
  TrailEdge,
  TrailGraph,
  TrailGraphSummary,
  TrailRoute,
} from "./types.js";

export interface FindPathsOptions {
  /** Where to start; defaults to the app's entry route(s). */
  from?: string;
  to: string;
  maxPaths?: number;
  maxDepth?: number;
  /** Follow edges into sheets and dialogs. Defaults to true. */
  includeOverlays?: boolean;
  /** Follow edges whose source screen is only a folder-level guess. Defaults to true. */
  includeWeakAttribution?: boolean;
}

const DEFAULT_MAX_PATHS = 5;
const DEFAULT_MAX_DEPTH = 14;
const MAX_CANDIDATES = 8;

function normalize(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "");
}

/** Finds routes by id, path, name, widget class or a loose text match on the label. */
export function resolveRoutes(graph: TrailGraph, query: string): TrailRoute[] {
  const text = query.trim();
  if (!text) {
    return [];
  }
  const exact = graph.routes.filter((route) => route.id === text);
  if (exact.length) {
    return exact;
  }
  const lower = text.toLowerCase();
  const strong = graph.routes.filter((route) =>
    route.path?.toLowerCase() === lower ||
    route.name?.toLowerCase() === lower ||
    route.widget?.toLowerCase() === lower ||
    route.label.toLowerCase() === lower);
  if (strong.length) {
    return strong;
  }
  const needle = normalize(text);
  if (!needle) {
    return [];
  }
  return graph.routes
    .filter((route) => [route.id, route.label, route.path, route.name, route.widget]
      .some((candidate) => candidate && normalize(candidate).includes(needle)))
    .slice(0, MAX_CANDIDATES);
}

function edgeScore(edge: TrailEdge): number {
  // Prefer a user-driven hop with a known source over a state listener over a guess.
  const trigger = edge.trigger.kind === "user" ? 0 : edge.trigger.kind === "state" ? 1 : 2;
  const attribution = ["class", "file", "composition", "folder", "shared", "unresolved"].indexOf(edge.attribution);
  return trigger * 10 + attribution + edge.guards.length * 0.1;
}

/** The routes that can be reached from `from`, ignoring edges without a known source screen. */
function adjacencyOf(graph: TrailGraph, options: FindPathsOptions): Map<string, Map<string, TrailEdge[]>> {
  const adjacency = new Map<string, Map<string, TrailEdge[]>>();
  const overlayIds = new Set(graph.routes.filter((route) => route.kind === "overlay").map((route) => route.id));
  for (const edge of graph.edges) {
    if (edge.from === null || edge.from === edge.to) {
      continue;
    }
    if (options.includeOverlays === false && (overlayIds.has(edge.to) || overlayIds.has(edge.from))) {
      continue;
    }
    if (options.includeWeakAttribution === false && edge.attribution === "folder") {
      continue;
    }
    const targets = adjacency.get(edge.from) ?? new Map<string, TrailEdge[]>();
    const list = targets.get(edge.to) ?? [];
    list.push(edge);
    targets.set(edge.to, list);
    adjacency.set(edge.from, targets);
  }
  for (const targets of adjacency.values()) {
    for (const list of targets.values()) {
      list.sort((a, b) => edgeScore(a) - edgeScore(b));
    }
  }
  return adjacency;
}

/** Shortest distance from every route to `target`, following edges backwards. */
function distancesTo(target: string, adjacency: Map<string, Map<string, TrailEdge[]>>): Map<string, number> {
  const reverse = new Map<string, string[]>();
  for (const [from, targets] of adjacency) {
    for (const to of targets.keys()) {
      reverse.set(to, [...(reverse.get(to) ?? []), from]);
    }
  }
  const distance = new Map<string, number>([[target, 0]]);
  const queue = [target];
  for (let head = 0; head < queue.length; head++) {
    const node = queue[head];
    for (const previous of reverse.get(node) ?? []) {
      if (!distance.has(previous)) {
        distance.set(previous, distance.get(node)! + 1);
        queue.push(previous);
      }
    }
  }
  return distance;
}

export function findRoutePaths(graph: TrailGraph, options: FindPathsOptions): RoutePathsResult {
  const maxPaths = Math.max(1, options.maxPaths ?? DEFAULT_MAX_PATHS);
  const maxDepth = Math.max(1, options.maxDepth ?? DEFAULT_MAX_DEPTH);
  const targets = resolveRoutes(graph, options.to);
  const target = targets.length === 1 || (targets.length > 1 && targets[0].id === options.to) ? targets[0] : null;
  if (!target) {
    return {
      from: [],
      to: null,
      paths: [],
      unattributedIntoTarget: [],
      error: targets.length ? `"${options.to}" matches several routes; pick one by id.` : `No route matches "${options.to}".`,
      candidates: targets,
    };
  }
  let starts: TrailRoute[];
  if (options.from) {
    const matches = resolveRoutes(graph, options.from);
    if (matches.length !== 1 && !(matches.length > 1 && matches[0].id === options.from)) {
      return {
        from: [],
        to: target,
        paths: [],
        unattributedIntoTarget: [],
        error: matches.length ? `"${options.from}" matches several routes; pick one by id.` : `No route matches "${options.from}".`,
        candidates: matches,
      };
    }
    starts = [matches[0]];
  } else {
    starts = graph.entry.map((id) => graph.routes.find((route) => route.id === id)).filter((route): route is TrailRoute => !!route);
  }

  const adjacency = adjacencyOf(graph, options);
  const distance = distancesTo(target.id, adjacency);
  const found: RoutePath[] = [];

  const extend = (route: string, trail: string[], limit: number): void => {
    if (found.length >= maxPaths * 4) {
      return;
    }
    if (route === target.id && trail.length > 1) {
      const hops: RoutePathHop[] = [];
      for (let index = 1; index < trail.length; index++) {
        const edges = adjacency.get(trail[index - 1])?.get(trail[index]) ?? [];
        hops.push({ from: trail[index - 1], to: trail[index], edgeIds: edges.map((edge) => edge.id) });
      }
      const attributions: Attribution[] = hops.map((hop) => {
        const edge = graph.edges.find((candidate) => candidate.id === hop.edgeIds[0]);
        return edge?.attribution ?? "unresolved";
      });
      found.push({ routes: [...trail], hops, weakestAttribution: weakestAttribution(attributions) });
      return;
    }
    if (trail.length - 1 >= limit) {
      return;
    }
    for (const next of adjacency.get(route)?.keys() ?? []) {
      const remaining = distance.get(next);
      if (trail.includes(next) || remaining === undefined || trail.length + remaining > limit) {
        continue;
      }
      trail.push(next);
      extend(next, trail, limit);
      trail.pop();
    }
  };

  // Shortest first: allow one extra hop at a time so a long path never crowds out a short one.
  for (const start of starts) {
    const base = start.id === target.id ? 0 : distance.get(start.id);
    if (base === undefined) {
      continue;
    }
    for (let limit = Math.max(1, base); limit <= maxDepth && found.length < maxPaths * 2; limit++) {
      extend(start.id, [start.id], limit);
    }
  }

  const unique = new Map<string, RoutePath>();
  for (const path of found) {
    unique.set(path.routes.join(">"), path);
  }
  const paths = [...unique.values()]
    .sort((a, b) => a.routes.length - b.routes.length || a.hops.length - b.hops.length)
    .slice(0, maxPaths);

  return {
    from: starts,
    to: target,
    paths,
    unattributedIntoTarget: graph.edges.filter((edge) => edge.to === target.id && edge.from === null),
  };
}

function mermaidId(id: string): string {
  return `n_${id.replace(/[^A-Za-z0-9]/g, "_")}`;
}

function mermaidText(text: string): string {
  return text.replace(/"/g, "'").replace(/[<>]/g, " ").replace(/\s+/g, " ").trim();
}

export interface MermaidOptions {
  /** Draw only these routes (and the edges between them). */
  routes?: string[];
  includeOverlays?: boolean;
  maxEdges?: number;
}

/** A top-down flowchart: solid arrows for user taps, dashed for state-driven or redirect hops. */
export function toMermaid(graph: TrailGraph, options: MermaidOptions = {}): string {
  const include = options.routes ? new Set(options.routes) : undefined;
  const maxEdges = options.maxEdges ?? 300;
  const lines = ["flowchart TD"];
  const used = new Set<string>();
  const edgeLines: string[] = [];
  const drawn = new Set<string>();
  for (const edge of graph.edges) {
    if (edge.from === null || edge.from === edge.to) {
      continue;
    }
    if (include && (!include.has(edge.from) || !include.has(edge.to))) {
      continue;
    }
    if (options.includeOverlays === false && graph.routes.some((route) => route.kind === "overlay" && (route.id === edge.to || route.id === edge.from))) {
      continue;
    }
    const key = `${edge.from}>${edge.to}>${edge.navigation}`;
    if (drawn.has(key) || edgeLines.length >= maxEdges) {
      continue;
    }
    drawn.add(key);
    used.add(edge.from);
    used.add(edge.to);
    const label = mermaidText(edge.guards.length ? edge.guards[edge.guards.length - 1].slice(0, 48) : edge.trigger.hint ?? "");
    const arrow = edge.trigger.kind === "user" ? "-->" : "-.->";
    edgeLines.push(`  ${mermaidId(edge.from)} ${arrow}${label ? `|"${label}"|` : ""} ${mermaidId(edge.to)}`);
  }
  for (const route of graph.routes) {
    if (!used.has(route.id)) {
      continue;
    }
    const label = mermaidText(route.label);
    lines.push(route.kind === "overlay" ? `  ${mermaidId(route.id)}(["${label}"])` : `  ${mermaidId(route.id)}["${label}"]`);
  }
  lines.push(...edgeLines);
  return lines.join("\n");
}

const MAX_EDGES_PER_HOP = 3;

/** Replaces edge ids with the edges themselves (the few best per hop). */
export function expandRoutePaths(graph: TrailGraph, result: RoutePathsResult): ExpandedRoutePathsResult {
  const byId = new Map(graph.edges.map((edge) => [edge.id, edge]));
  return {
    from: result.from,
    to: result.to,
    error: result.error,
    candidates: result.candidates,
    unattributedIntoTarget: result.unattributedIntoTarget,
    paths: result.paths.map((path) => ({
      routes: path.routes,
      weakestAttribution: path.weakestAttribution,
      hops: path.hops.map((hop) => ({
        from: hop.from,
        to: hop.to,
        edges: hop.edgeIds.slice(0, MAX_EDGES_PER_HOP).map((id) => byId.get(id)).filter((edge): edge is TrailEdge => !!edge),
      })),
    })),
  };
}

export function summarizeGraph(graph: TrailGraph): TrailGraphSummary {
  return {
    projectRoot: graph.projectRoot,
    generatedAt: graph.generatedAt,
    frameworks: graph.frameworks,
    routers: graph.routers,
    entry: graph.entry,
    totals: graph.totals,
    routes: graph.routes,
    unattributed: graph.edges
      .filter((edge) => edge.from === null)
      .map((edge) => ({ id: edge.id, to: edge.to, source: edge.source, fromCandidates: edge.fromCandidates })),
    unresolvedNavigation: graph.unresolvedNavigation,
    navigationHelpers: graph.navigationHelpers,
    diagnostics: graph.diagnostics,
  };
}
