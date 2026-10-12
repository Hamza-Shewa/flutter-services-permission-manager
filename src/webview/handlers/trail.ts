import * as vscode from "vscode";
import {
  buildWorkspaceTrailPrompt,
  deleteWorkspaceTrail,
  loadWorkspaceTrails,
  scanWorkspaceRoutes,
} from "../../features/trail/trail.service.js";
import { expandRoutePaths, findRoutePaths, summarizeGraph, toMermaid } from "../../features/trail/index.js";
import type { TrailGraph } from "../../features/trail/index.js";
import { toErrorMessage } from "../../core/shared/index.js";
import type { WebviewRef } from "./index.js";

/** The last scan, so path searches and trail checks answer without re-reading every Dart file. */
let lastGraph: TrailGraph | undefined;

async function currentGraph(): Promise<TrailGraph> {
  lastGraph ??= await scanWorkspaceRoutes();
  return lastGraph;
}

export async function handleScanTrail(ref: WebviewRef): Promise<void> {
  try {
    ref.webview.postMessage({ type: "trailLoading", loading: true });
    lastGraph = await scanWorkspaceRoutes();
    ref.webview.postMessage({ type: "trailGraph", graph: summarizeGraph(lastGraph) });
    ref.webview.postMessage({ type: "trailsLoaded", trails: loadWorkspaceTrails(lastGraph) });
  } catch (error) {
    ref.webview.postMessage({ type: "trailError", message: toErrorMessage(error) });
  } finally {
    ref.webview.postMessage({ type: "trailLoading", loading: false });
  }
}

/** Re-reads only the saved trails (an agent may have written one since the last scan). */
export async function handleLoadTrails(ref: WebviewRef): Promise<void> {
  try {
    ref.webview.postMessage({ type: "trailsLoaded", trails: loadWorkspaceTrails(lastGraph) });
  } catch (error) {
    ref.webview.postMessage({ type: "trailError", message: toErrorMessage(error) });
  }
}

export async function handleFindTrailPaths(ref: WebviewRef, from: string | undefined, to: string): Promise<void> {
  try {
    const graph = await currentGraph();
    const result = findRoutePaths(graph, { from: from?.trim() || undefined, to });
    ref.webview.postMessage({ type: "trailPaths", result: expandRoutePaths(graph, result) });
  } catch (error) {
    ref.webview.postMessage({ type: "trailError", message: toErrorMessage(error) });
  }
}

export async function handleCopyTrailPrompt(ref: WebviewRef, goal: string | undefined): Promise<void> {
  try {
    const { prompt, graph } = await buildWorkspaceTrailPrompt(goal);
    lastGraph = graph;
    await vscode.env.clipboard.writeText(prompt);
    ref.webview.postMessage({ type: "trailGraph", graph: summarizeGraph(graph) });
    ref.webview.postMessage({ type: "trailCopied", what: "prompt" });
  } catch (error) {
    ref.webview.postMessage({ type: "trailError", message: toErrorMessage(error) });
  }
}

export async function handleCopyTrailMermaid(ref: WebviewRef, routes: string[] | undefined): Promise<void> {
  try {
    const graph = await currentGraph();
    await vscode.env.clipboard.writeText(toMermaid(graph, { routes: routes?.length ? routes : undefined }));
    ref.webview.postMessage({ type: "trailCopied", what: "mermaid" });
  } catch (error) {
    ref.webview.postMessage({ type: "trailError", message: toErrorMessage(error) });
  }
}

export async function handleDeleteTrail(ref: WebviewRef, id: string): Promise<void> {
  try {
    const choice = await vscode.window.showWarningMessage(
      `Delete the trail "${id}" from .flutter-config-manager/trails.json?`,
      { modal: true },
      "Delete",
    );
    if (choice !== "Delete") {
      return;
    }
    deleteWorkspaceTrail(id);
    ref.webview.postMessage({ type: "trailsLoaded", trails: loadWorkspaceTrails(lastGraph) });
  } catch (error) {
    ref.webview.postMessage({ type: "trailError", message: toErrorMessage(error) });
  }
}
