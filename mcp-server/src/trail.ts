import { z } from "zod";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";

import {
  TRAILS_FILE,
  annotateTrails,
  expandRoutePaths,
  findRoutePaths,
  readTrails,
  resolveRoutes,
  saveTrail,
  scanRouteGraph,
  summarizeGraph,
} from "../../out/features/trail/index.js";
import type { TrailGraph, TrailScannerOptions } from "../../out/features/trail/types.js";

const scannerShape = {
  excludedGlobs: z.array(z.string()).optional(),
  navigationCallees: z.array(z.string()).optional(),
};

export const scanRoutesSchema = z.object({
  detail: z.enum(["summary", "full"]).optional(),
  route: z.string().optional(),
  ...scannerShape,
});

export const findRoutePathsSchema = z.object({
  to: z.string().min(1),
  from: z.string().optional(),
  maxPaths: z.number().int().min(1).max(20).optional(),
  includeOverlays: z.boolean().optional(),
  ...scannerShape,
});

export const listTrailsSchema = z.object({
  ...scannerShape,
});

const stepShape = z.object({
  id: z.string().optional(),
  title: z.string(),
  kind: z.enum(["screen", "sheet", "dialog", "action", "decision", "outcome"]),
  route: z.string().optional(),
  source: z.object({ path: z.string(), line: z.number().int().positive().optional() }).optional(),
  condition: z.string().optional(),
  optional: z.boolean().optional(),
  note: z.string().optional(),
  branches: z.array(z.object({ label: z.string(), to: z.string() })).optional(),
});

export const saveTrailSchema = z.object({
  id: z.string().optional(),
  title: z.string(),
  goal: z.string().optional(),
  summary: z.string().optional(),
  steps: z.array(stepShape).min(1),
  ...scannerShape,
});

function textResult(value: unknown): CallToolResult {
  return { content: [{ type: "text", text: JSON.stringify(value, null, 2) }] };
}

function optionsFrom(args: Record<string, unknown>): TrailScannerOptions {
  let defaults: TrailScannerOptions = {};
  try {
    defaults = JSON.parse(process.env.FCM_TRAIL_OPTIONS ?? "{}") as TrailScannerOptions;
  } catch {
    defaults = {};
  }
  return {
    excludedGlobs: (args.excludedGlobs as string[] | undefined) ?? defaults.excludedGlobs,
    navigationCallees: (args.navigationCallees as string[] | undefined) ?? defaults.navigationCallees,
  };
}

export async function scanRoutesTool(root: string, args: Record<string, unknown>): Promise<CallToolResult> {
  const graph = await scanRouteGraph(root, optionsFrom(args));
  const focus = typeof args.route === "string" ? args.route : undefined;
  if (focus) {
    const matches = resolveRoutes(graph, focus);
    const ids = new Set(matches.map((route) => route.id));
    return textResult({
      matches,
      outgoing: graph.edges.filter((edge) => edge.from !== null && ids.has(edge.from)),
      incoming: graph.edges.filter((edge) => ids.has(edge.to)),
    });
  }
  if (args.detail === "full") {
    return textResult(graph);
  }
  return textResult(summarizeGraph(graph));
}

export async function findRoutePathsTool(root: string, args: Record<string, unknown>): Promise<CallToolResult> {
  const graph: TrailGraph = await scanRouteGraph(root, optionsFrom(args));
  const result = findRoutePaths(graph, {
    to: String(args.to),
    from: args.from as string | undefined,
    maxPaths: args.maxPaths as number | undefined,
    includeOverlays: args.includeOverlays as boolean | undefined,
  });
  return textResult(expandRoutePaths(graph, result));
}

export async function listTrailsTool(root: string, args: Record<string, unknown>): Promise<CallToolResult> {
  const graph = await scanRouteGraph(root, optionsFrom(args));
  return textResult({ file: TRAILS_FILE, trails: annotateTrails(root, readTrails(root), graph) });
}

export async function saveTrailTool(root: string, args: Record<string, unknown>): Promise<CallToolResult> {
  const { excludedGlobs, navigationCallees, ...trail } = args;
  const graph = await scanRouteGraph(root, optionsFrom({ excludedGlobs, navigationCallees }));
  try {
    return textResult(saveTrail(root, trail, graph));
  } catch (error) {
    return {
      isError: true,
      content: [{ type: "text", text: error instanceof Error ? error.message : String(error) }],
    };
  }
}
