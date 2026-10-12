import { state } from "../../core/state.js";
import { bus } from "../../core/bus.js";
import * as api from "../../core/api.js";
import {
  connectMcpButton,
  copyTrailMermaidButton,
  copyTrailPromptButton,
  findTrailPathsButton,
  scanTrailButton,
  trailConnectButton,
  trailContent,
  trailCount,
  trailEmpty,
  trailError,
  trailFromInput,
  trailGapList,
  trailGaps,
  trailGapsSummary,
  trailGoalInput,
  trailList,
  trailLoading,
  trailLock,
  trailLockText,
  trailLockTitle,
  trailPaths,
  trailRouteOptions,
  trailRouters,
  trailSummary,
  trailWarnings,
  trailToInput,
} from "../../core/elements.js";

const LOCK_TEXT = trailLockText ? trailLockText.textContent : "";
const OUTDATED_TEXT = "Your MCP connection is out of date, so it may not offer the Trail tools. Update it, then come back.";
const openTrails = new Set();

let agentChecked = false;
let agentReady = false;
let agentOutdated = false;
let graph = null;
let trails = [];
let routeIndex = new Map();

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) { node.className = className; }
  if (text !== undefined) { node.textContent = text; }
  return node;
}

function badge(text, stateClass) {
  return el("span", `semantics-badge ${stateClass}`, text);
}

function sourceButton(path, line) {
  const button = el("button", "semantics-source", line ? `${path}:${line}` : path);
  button.type = "button";
  button.title = "Open in the editor";
  button.addEventListener("click", () => api.revealSourceReference(path, line || 1, 1));
  return button;
}

function routeLabel(id) {
  const route = routeIndex.get(id);
  return route ? route.label : id;
}

function attributionClass(value) {
  if (value === "class" || value === "file") { return "ready"; }
  if (value === "composition" || value === "folder") { return "uncertain"; }
  return "issue";
}

function attributionHint(value) {
  return {
    class: "source screen read directly from the code",
    file: "source screen inferred from the same file",
    composition: "source screen inferred from the widget tree",
    folder: "source screen guessed from the folder",
    shared: "shared widget: source screen unknown",
    unresolved: "source screen unknown",
  }[value] || value;
}

// ---- lock ---------------------------------------------------------------------------------------

function isActive() {
  return state.activeTab === "trail";
}

function updateLock() {
  const locked = !agentReady;
  if (trailLock) { trailLock.style.display = locked ? "block" : "none"; }
  if (trailContent) { trailContent.style.display = locked ? "none" : "block"; }
  if (trailConnectButton) { trailConnectButton.style.display = agentChecked ? "" : "none"; }
  if (trailLockTitle) {
    trailLockTitle.textContent = !agentChecked
      ? "Checking for connected AI agents…"
      : agentOutdated ? "Update your AI agent connection" : "Connect an AI agent to use Trail";
  }
  if (trailLockText) { trailLockText.textContent = agentOutdated ? OUTDATED_TEXT : LOCK_TEXT; }
  [scanTrailButton, copyTrailMermaidButton].forEach((button) => {
    if (button) { button.disabled = locked || (button === copyTrailMermaidButton && !graph); }
  });
  if (!locked && isActive() && !graph) { api.scanTrail(); }
}

bus.on("mcpClientsStatus", (message) => {
  if (message.loading) { return; }
  const clients = message.clients || [];
  agentChecked = true;
  agentOutdated = clients.some((client) => client.state === "outdated") && !clients.some((client) => client.state === "installed");
  agentReady = clients.some((client) => client.state === "installed") || !!(message.builtInAgent && message.builtInAgent.available);
  updateLock();
});

trailConnectButton?.addEventListener("click", () => connectMcpButton?.click());

// ---- scan summary ----------------------------------------------------------------------------------

function renderSummary() {
  if (!trailSummary || !graph) { return; }
  trailSummary.replaceChildren();
  const totals = graph.totals;
  [
    [totals.screens, "Screens"],
    [totals.overlays, "Sheets & dialogs"],
    [totals.edges, "Navigation edges"],
    [totals.edgesWithSource, "Edges with a known source screen"],
    [totals.edgesWithoutSource, "Edges to check"],
    [totals.unresolvedNavigation, "Computed destinations"],
    [trails.length, "Trails saved"],
    [totals.filesScanned, "Files scanned"],
  ].forEach(([value, label]) => {
    const card = el("div", "semantics-stat");
    card.append(el("strong", "", String(value)), el("span", "", label));
    trailSummary.appendChild(card);
  });
  trailSummary.style.display = "grid";
}

const SUPPORT_LABEL = { full: "fully read", partial: "partly read", none: "not read" };

/** Which routing packages the project uses and how well the scan understands them, plus anything it could not read. */
function renderRouters() {
  if (!graph) { return; }
  if (trailRouters) {
    const routers = graph.routers || [];
    trailRouters.style.display = "block";
    trailRouters.textContent = routers.length
      ? `Routing packages: ${routers.map((router) => `${router.package} (${SUPPORT_LABEL[router.support]})`).join(", ")}${routers.some((router) => router.support !== "full") ? ". Your agent verifies the parts that are only partly read." : ""}`
      : "No routing package found in pubspec.yaml; the built-in Navigator is read.";
    trailRouters.title = routers.map((router) => `${router.package}: ${router.note}`).join("\n");
  }
  if (trailWarnings) {
    const warnings = (graph.diagnostics || []).filter((item) => item.severity === "warning" && !/syntax errors/.test(item.message));
    trailWarnings.replaceChildren(...warnings.map((item) => el("div", "", item.message)));
    trailWarnings.style.display = warnings.length ? "block" : "none";
  }
}

function renderRouteOptions() {
  if (!trailRouteOptions || !graph) { return; }
  routeIndex = new Map(graph.routes.map((route) => [route.id, route]));
  trailRouteOptions.replaceChildren(...graph.routes.map((route) => {
    const option = document.createElement("option");
    option.value = route.id;
    option.label = [route.label, route.path].filter(Boolean).join("  ");
    return option;
  }));
}

function gapRow(text, source) {
  const row = el("div", "trail-gap");
  row.append(el("span", "", `${text} `), sourceButton(source.path, source.line));
  return row;
}

function renderGaps() {
  if (!trailGaps || !trailGapList || !graph) { return; }
  const unattributed = graph.unattributed || [];
  const dynamic = graph.unresolvedNavigation || [];
  trailGapList.replaceChildren();
  unattributed.forEach((edge) => {
    const candidates = edge.fromCandidates && edge.fromCandidates.length
      ? ` (shared by ${edge.fromCandidates.slice(0, 3).map(routeLabel).join(", ")}…)`
      : "";
    trailGapList.appendChild(gapRow(`Goes to ${routeLabel(edge.to)} from an unknown screen${candidates}`, edge.source));
  });
  dynamic.forEach((item) => {
    trailGapList.appendChild(gapRow(`${item.callee}(${item.expression}) has a computed destination`, item.source));
  });
  const total = unattributed.length + dynamic.length;
  trailGaps.style.display = total ? "block" : "none";
  if (trailGapsSummary) {
    trailGapsSummary.textContent = `${total} place${total === 1 ? "" : "s"} the scan could not resolve`;
  }
}

bus.on("trailLoading", (message) => {
  if (trailLoading) { trailLoading.style.display = message.loading ? "block" : "none"; }
  if (scanTrailButton) { scanTrailButton.disabled = !!message.loading || !agentReady; }
  if (message.loading && trailError) { trailError.style.display = "none"; }
});

bus.on("trailGraph", (message) => {
  graph = message.graph;
  renderRouteOptions();
  renderSummary();
  renderRouters();
  renderGaps();
  renderTrails();
  if (copyTrailMermaidButton) { copyTrailMermaidButton.disabled = !agentReady; }
});

bus.on("trailError", (message) => {
  if (trailError) {
    trailError.textContent = message.message;
    trailError.style.display = "block";
  }
});

// ---- saved trails ------------------------------------------------------------------------------------

function renderStep(step, index, trail) {
  const item = el("li", `trail-step${step.optional ? " optional" : ""}`);
  item.appendChild(el("div", "trail-step-num", String(index + 1)));
  const body = el("div");
  const line = el("div", "trail-step-line");
  line.append(el("span", "trail-step-title", step.title), badge(step.kind, "trail-kind"));
  if (step.optional) { line.appendChild(badge("optional", "uncertain")); }
  if (step.route) { line.appendChild(el("span", "trail-route", routeLabel(step.route))); }
  if (step.source) { line.appendChild(sourceButton(step.source.path, step.source.line)); }
  body.appendChild(line);
  if (step.condition) { body.appendChild(el("div", "trail-when", `When: ${step.condition}`)); }
  if (step.note) { body.appendChild(el("div", "trail-step-note", step.note)); }
  if (step.branches && step.branches.length) {
    const list = el("ul", "trail-branches");
    step.branches.forEach((branch) => {
      const targetIndex = trail.steps.findIndex((candidate) => candidate.id === branch.to);
      const target = trail.steps[targetIndex];
      list.appendChild(el("li", "", `${branch.label} → ${target ? `step ${targetIndex + 1}: ${target.title}` : branch.to}`));
    });
    body.appendChild(list);
  }
  item.appendChild(body);
  return item;
}

function renderTrail(trail) {
  const card = el("details", "trail-card");
  card.open = openTrails.has(trail.id);
  card.addEventListener("toggle", () => {
    if (card.open) { openTrails.add(trail.id); } else { openTrails.delete(trail.id); }
  });
  const summary = el("summary");
  const title = el("span", "", trail.title);
  const meta = el("span", "trail-card-meta");
  const updated = new Date(trail.updatedAt);
  meta.textContent = `${trail.steps.length} steps${Number.isNaN(updated.getTime()) ? "" : ` · ${updated.toLocaleDateString()}`}`;
  summary.append(title, trail.issues.length ? badge(`${trail.issues.length} issue${trail.issues.length === 1 ? "" : "s"}`, "uncertain") : meta);
  card.appendChild(summary);

  const body = el("div", "trail-card-body");
  if (trail.goal) { body.appendChild(el("div", "trail-goal-text", trail.goal)); }
  if (trail.summary) { body.appendChild(el("div", "trail-goal-text", trail.summary)); }
  const steps = el("ol", "trail-steps");
  trail.steps.forEach((step, index) => steps.appendChild(renderStep(step, index, trail)));
  body.appendChild(steps);
  if (trail.issues.length) {
    const issues = el("div", "trail-issues");
    issues.append(el("strong", "", "Out of date with the code: "), document.createTextNode(trail.issues.join(" ")));
    body.appendChild(issues);
  }
  const actions = el("div", "trail-card-actions");
  const mermaid = el("button", "btn-secondary", "Copy Mermaid");
  mermaid.type = "button";
  mermaid.addEventListener("click", () => {
    const routes = [...new Set(trail.steps.map((step) => step.route).filter(Boolean))];
    api.copyTrailMermaid(routes);
  });
  const remove = el("button", "btn-secondary", "Delete");
  remove.type = "button";
  remove.addEventListener("click", () => api.deleteTrail(trail.id));
  actions.append(mermaid, remove);
  body.appendChild(actions);
  card.appendChild(body);
  return card;
}

function renderTrails() {
  if (!trailList) { return; }
  trailList.replaceChildren(...trails.map(renderTrail));
  if (trailEmpty) { trailEmpty.style.display = trails.length ? "none" : "block"; }
  if (trailCount) { trailCount.textContent = trails.length ? `${trails.length} saved` : ""; }
  renderSummary();
}

bus.on("trailsLoaded", (message) => {
  trails = message.trails || [];
  renderTrails();
});

// ---- path finder -------------------------------------------------------------------------------------

function triggerText(edge) {
  const hint = edge.trigger.hint ? ` (${edge.trigger.hint})` : "";
  switch (edge.trigger.kind) {
    case "user": return `user action${hint}`;
    case "state": return `state change${hint}`;
    case "redirect": return "router redirect";
    case "lifecycle": return `on load / timer${hint}`;
    default: return edge.navigation === "tab" ? "bottom navigation" : "";
  }
}

function renderHop(hop) {
  const wrapper = el("div", "trail-hop");
  hop.edges.slice(0, 2).forEach((edge) => {
    const line = el("div");
    const parts = [el("code", "", edge.navigation)];
    const trigger = triggerText(edge);
    if (trigger) { parts.push(document.createTextNode(` · ${trigger}`)); }
    if (edge.guards.length) { parts.push(document.createTextNode(` · if ${edge.guards.join(" and ")}`)); }
    line.append(...parts, document.createTextNode(" "), sourceButton(edge.source.path, edge.source.line));
    wrapper.appendChild(line);
  });
  if (hop.edges.length > 2) {
    wrapper.appendChild(el("div", "", `+${hop.edges.length - 2} more way${hop.edges.length === 3 ? "" : "s"}`));
  }
  return wrapper;
}

function renderPaths(result) {
  if (!trailPaths) { return; }
  trailPaths.replaceChildren();
  if (result.error) {
    trailPaths.appendChild(el("div", "trail-note", result.error));
    (result.candidates || []).forEach((route) => {
      const chip = el("button", "semantics-source", route.id);
      chip.type = "button";
      chip.addEventListener("click", () => {
        if (trailToInput) { trailToInput.value = route.id; }
        runFind();
      });
      trailPaths.append(chip, document.createTextNode(" "));
    });
    return;
  }
  if (!result.paths.length) {
    const note = el("div", "trail-note", `No chain of screens leads to ${result.to ? result.to.label : "that screen"} from the starting point.`);
    trailPaths.appendChild(note);
    if (result.unattributedIntoTarget.length) {
      trailPaths.appendChild(el("div", "trail-note", "These calls reach it, but the scan could not tell which screen they belong to:"));
      result.unattributedIntoTarget.forEach((edge) => trailPaths.appendChild(gapRow("Navigates here from an unknown screen", edge.source)));
    }
    return;
  }
  result.paths.forEach((path, index) => {
    const card = el("div", "trail-path");
    const head = el("div", "trail-path-head");
    const heading = el("span", "", `Path ${index + 1} · ${path.routes.length} screens`);
    const certainty = badge(path.weakestAttribution, attributionClass(path.weakestAttribution));
    certainty.title = attributionHint(path.weakestAttribution);
    head.append(heading, certainty);
    card.appendChild(head);
    path.routes.forEach((routeId, position) => {
      card.appendChild(el("div", "trail-screen", routeLabel(routeId)));
      if (position < path.hops.length) { card.appendChild(renderHop(path.hops[position])); }
    });
    trailPaths.appendChild(card);
  });
  const copy = el("button", "btn-secondary", "Copy Mermaid for these paths");
  copy.type = "button";
  copy.addEventListener("click", () => api.copyTrailMermaid([...new Set(result.paths.flatMap((path) => path.routes))]));
  trailPaths.appendChild(copy);
}

function runFind() {
  const to = (trailToInput && trailToInput.value || "").trim();
  if (!to) { return; }
  api.findTrailPaths((trailFromInput && trailFromInput.value || "").trim(), to);
}

bus.on("trailPaths", (message) => renderPaths(message.result));
findTrailPathsButton?.addEventListener("click", runFind);
trailToInput?.addEventListener("keydown", (event) => { if (event.key === "Enter") { runFind(); } });

// ---- actions -------------------------------------------------------------------------------------------

scanTrailButton?.addEventListener("click", () => api.scanTrail());
copyTrailMermaidButton?.addEventListener("click", () => api.copyTrailMermaid([]));
copyTrailPromptButton?.addEventListener("click", () => {
  copyTrailPromptButton.disabled = true;
  copyTrailPromptButton.textContent = "Scanning…";
  api.copyTrailPrompt((trailGoalInput && trailGoalInput.value || "").trim());
});

bus.on("trailCopied", (message) => {
  const button = message.what === "prompt" ? copyTrailPromptButton : copyTrailMermaidButton;
  const original = message.what === "prompt" ? "Copy AI prompt" : "Copy Mermaid";
  if (!button) { return; }
  button.disabled = false;
  button.textContent = "Copied";
  setTimeout(() => { button.textContent = original; }, 1600);
});

bus.on("trailError", () => {
  if (copyTrailPromptButton) {
    copyTrailPromptButton.disabled = false;
    copyTrailPromptButton.textContent = "Copy AI prompt";
  }
});

// An agent saves trails from outside the editor, so pick them up when the tab opens or the window regains focus.
window.addEventListener("trail-tab-activated", () => {
  if (!agentReady) { return; }
  if (graph) { api.loadTrails(); } else { api.scanTrail(); }
});
window.addEventListener("focus", () => {
  if (agentReady && isActive() && graph) { api.loadTrails(); }
});

updateLock();
