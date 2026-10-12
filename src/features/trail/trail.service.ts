import * as vscode from "vscode";
import { buildTrailPrompt } from "./prompt.js";
import { scanRouteGraph } from "./route-graph.js";
import { annotateTrails, deleteTrail, readTrails } from "./trail-store.js";
import type { TrailGraph, TrailScannerOptions, TrailWithIssues } from "./types.js";

export function getTrailScannerOptions(): TrailScannerOptions {
  const config = vscode.workspace.getConfiguration("flutter-config-manager.trail");
  const clean = (key: string): string[] => (config.get<string[]>(key, []) ?? [])
    .map((value) => value.trim())
    .filter(Boolean);
  return {
    excludedGlobs: clean("excludedGlobs"),
    navigationCallees: clean("navigationCallees"),
  };
}

function workspaceRoot(): string {
  const root = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  if (!root) {
    throw new Error("No workspace folder is open.");
  }
  return root;
}

export async function scanWorkspaceRoutes(): Promise<TrailGraph> {
  return scanRouteGraph(workspaceRoot(), getTrailScannerOptions());
}

export async function buildWorkspaceTrailPrompt(goal?: string): Promise<{ prompt: string; graph: TrailGraph }> {
  const graph = await scanWorkspaceRoutes();
  return { prompt: buildTrailPrompt(graph, goal), graph };
}

export function loadWorkspaceTrails(graph?: TrailGraph): TrailWithIssues[] {
  const root = workspaceRoot();
  return annotateTrails(root, readTrails(root), graph);
}

export function deleteWorkspaceTrail(id: string): boolean {
  return deleteTrail(workspaceRoot(), id);
}
