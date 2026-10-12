import type { TrailGraph, TrailSourceRef } from "./types.js";

const MAX_UNATTRIBUTED = 25;
const MAX_DYNAMIC = 15;

function where(source: TrailSourceRef): string {
  return `${source.path}:${source.line}`;
}

/**
 * The prompt for an AI agent that has this extension's MCP tools. The static scan supplies the routes and the
 * edges it can prove; the agent supplies what code reading cannot: conditions, outcomes and the journey itself.
 */
export function buildTrailPrompt(graph: TrailGraph, goal?: string): string {
  const objective = goal?.trim()
    ? `Journey to map: ${goal.trim()}`
    : "Journey to map: pick the app's most important user journeys (sign-in, the main money or content flow, settings) and map each as its own trail.";
  const unattributed = graph.edges.filter((edge) => edge.from === null);
  const lines: string[] = [
    "You are mapping a user journey (a \"trail\") through the Flutter app in this workspace, from the first launch to the end of the flow.",
    "",
    objective,
    "",
    `Project: ${graph.projectRoot}`,
    "",
    "## What the static scan already proved",
    `- ${graph.totals.screens} screens and ${graph.totals.overlays} sheets/dialogs; ${graph.totals.edges} navigation edges (${graph.totals.edgesWithSource} with a known source screen, ${graph.totals.edgesWithoutSource} without).`,
    `- Router: ${graph.frameworks.length ? graph.frameworks.join(", ") : "none detected"}. Entry: ${graph.entry.length ? graph.entry.join(", ") : "not detected - find where the app decides its first screen"}.`,
    graph.routers.length
      ? `- Routing packages in pubspec.yaml: ${graph.routers.map((router) => `${router.package} (${router.support === "full" ? "fully read" : router.support === "partial" ? "partly read" : "NOT read"})`).join(", ")}. ${graph.routers.some((router) => router.support !== "full") ? "Where a package is only partly read, verify its routes and guards in the router setup yourself." : ""}`.trim()
      : "- No known routing package was found in pubspec.yaml (the built-in Navigator may be in use).",
    graph.navigationHelpers.length
      ? `- Navigation helpers the code defines: ${graph.navigationHelpers.map((helper) => helper.name).join(", ")}.`
      : "- No project navigation helpers were detected.",
    "- Every edge carries its call site (file:line), what triggers it (a tap, a state listener, a redirect), the conditions around the call (if/switch/ternary) and how sure the scan is about the screen it starts from.",
    "",
    "## What the scan cannot see - this is your job",
    "- First-launch / onboarding / already-signed-in branches: read the splash or launch logic and the router redirects, and say when each branch applies.",
    "- Outcomes decided by a Bloc/Cubit state (success vs failure, OTP accepted vs rejected): open the listener, read the states it switches on, and record each outcome as a branch.",
    "- Sheets and dialogs (OTP, confirmation) that appear between two screens, including when they appear.",
    "- Edges whose source screen is unknown or whose target is computed. If a step of the journey does not exist in the code (for example a receipt screen), say so in that step's note. Never invent a route.",
    "",
    "## How to work",
    "1. Call `find_route_paths` with `to` set to the final screen to get the candidate chains from the entry screen. Call `scan_routes` if you need the full list of route ids.",
    "2. Open the source of every edge on the chain you choose (the `source` field) and read the surrounding code to confirm the order, the trigger and the conditions. Fix wrong or missing hops using what you read, not what the scan guessed.",
    "3. Write the trail as ordered steps. Use only route ids that exist in the graph for `route`. Use `kind`: screen, sheet (bottom sheet), dialog, action (something the user does that is not a screen), decision (a branch point), outcome (success/failure result).",
    "4. Put anything that only sometimes happens in the step's `condition` and set `optional: true` (for example \"only the first time the app is launched\"). Express alternative continuations as `branches` (`label` plus the `to` step id); a step without branches continues to the next step in the list.",
    "5. Give each step the file (and line) where it happens in `source`.",
    "6. Call `save_trail`. If it reports errors, fix them and call it again. When it succeeds, tell the user the trail id; the Trail tab in the extension shows it.",
  ];
  if (unattributed.length) {
    lines.push("", "## Edges whose source screen the scan could not determine (check these first if your path needs them)");
    for (const edge of unattributed.slice(0, MAX_UNATTRIBUTED)) {
      const guess = edge.fromCandidates.length ? ` (could be shared by: ${edge.fromCandidates.slice(0, 4).join(", ")})` : "";
      lines.push(`- ${where(edge.source)}  ->  ${edge.to}${guess}`);
    }
    if (unattributed.length > MAX_UNATTRIBUTED) {
      lines.push(`- ... and ${unattributed.length - MAX_UNATTRIBUTED} more (scan_routes lists them all).`);
    }
  }
  const warnings = graph.diagnostics.filter((item) => item.severity === "warning" && !item.message.includes("syntax errors"));
  if (warnings.length) {
    lines.push("", "## Warnings from the scan");
    warnings.slice(0, 6).forEach((item) => lines.push(`- ${item.message}`));
  }
  if (graph.unresolvedNavigation.length) {
    lines.push("", "## Navigation calls whose destination is computed at runtime");
    for (const item of graph.unresolvedNavigation.slice(0, MAX_DYNAMIC)) {
      lines.push(`- ${where(item.source)}  ${item.callee}(${item.expression})`);
    }
    if (graph.unresolvedNavigation.length > MAX_DYNAMIC) {
      lines.push(`- ... and ${graph.unresolvedNavigation.length - MAX_DYNAMIC} more.`);
    }
  }
  lines.push(
    "",
    "## Rules",
    "- Report what the code does. Where you are unsure, say so in `note` instead of guessing.",
    "- Do not edit any project file; this task only reads code and saves the trail.",
  );
  return lines.join("\n");
}
