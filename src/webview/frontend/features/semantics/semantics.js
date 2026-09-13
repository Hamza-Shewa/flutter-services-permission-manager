import { state } from "../../core/state.js";
import { bus } from "../../core/bus.js";
import * as api from "../../core/api.js";
import {
  previewSemanticsFixesButton,
  copySemanticsPromptButton,
  scanInteractivesButton,
  semanticsEmpty,
  semanticsError,
  semanticsKindFilter,
  semanticsLoading,
  semanticsPreviewApply,
  semanticsPreviewBackdrop,
  semanticsPreviewCancel,
  semanticsPreviewList,
  semanticsPromptProject,
  semanticsSearch,
  semanticsStatusFilter,
  semanticsSummary,
  semanticsTableBody,
  semanticsTableContainer,
} from "../../core/elements.js";

const selected = new Map();
const expanded = new Set();
let activePreviewId = null;
let scanTimer = null;

function badge(text, stateClass) {
  const span = document.createElement("span");
  span.className = `semantics-badge ${stateClass}`;
  span.textContent = text;
  return span;
}

function badgeClass(value) {
  if (value === "ready" || value === "present") { return "ready"; }
  if (value === "uncertain" || value === "dynamic") { return "uncertain"; }
  return "issue";
}

function literalIdentifier(expression) {
  const match = /^(?:r)?(['"])([\s\S]*)\1$/.exec(String(expression || "").trim());
  return match ? match[2] : "";
}

function updatePreviewButton() {
  if (previewSemanticsFixesButton) {
    previewSemanticsFixesButton.disabled = selected.size === 0;
    previewSemanticsFixesButton.textContent = selected.size
      ? `Preview ${selected.size} selected fix${selected.size === 1 ? "" : "es"}`
      : "Preview selected fixes";
  }
}

function openSource(reference) {
  api.revealSourceReference(reference.path, reference.line, reference.column);
}

function findingMatches(finding) {
  const query = String(semanticsSearch?.value || "").trim().toLowerCase();
  const status = semanticsStatusFilter?.value || "";
  const kind = semanticsKindFilter?.value || "";
  const haystack = [finding.source.path, finding.widgetType, finding.kind, finding.semantics.identifierExpression]
    .filter(Boolean).join(" ").toLowerCase();
  if (query && !haystack.includes(query)) { return false; }
  if (kind && finding.kind !== kind) { return false; }
  if (status === "issues" && finding.automation === "present" && finding.accessibility === "ready") { return false; }
  if (status === "automation" && finding.automation === "present") { return false; }
  if (status === "accessibility" && finding.accessibility === "ready") { return false; }
  if (status === "ready" && (finding.automation !== "present" || finding.accessibility !== "ready")) { return false; }
  return true;
}

function renderSummary(result) {
  if (!semanticsSummary) { return; }
  semanticsSummary.innerHTML = "";
  const stats = [
    [result.totals.findings, "Interactive candidates"],
    [result.totals.automationReady, "Automation ready"],
    [result.totals.automationMissing, "Missing identifiers"],
    [result.totals.automationDuplicate, "Duplicate identifiers"],
    [result.totals.automationDynamic, "Dynamic identifiers"],
    [result.totals.accessibilityReady, "Accessibility ready"],
    [result.totals.accessibilityMissing, "Missing a11y semantics"],
    [result.totals.accessibilityUncertain, "A11y uncertain"],
    [result.totals.opaque, "Opaque surfaces"],
    [result.totals.filesScanned, "Files scanned"],
  ];
  stats.forEach(([value, label]) => {
    const card = document.createElement("div");
    card.className = "semantics-stat";
    const strong = document.createElement("strong");
    strong.textContent = String(value);
    const span = document.createElement("span");
    span.textContent = label;
    card.append(strong, span);
    semanticsSummary.appendChild(card);
  });
  semanticsSummary.style.display = "grid";
  if (semanticsPromptProject) { semanticsPromptProject.textContent = result.projectRoot; }
}

function findingElement(finding) {
  const item = document.createElement("div");
  item.className = "semantics-finding";

  const checkbox = document.createElement("input");
  checkbox.type = "checkbox";
  checkbox.disabled = finding.kind === "opaque";
  checkbox.checked = selected.has(finding.occurrenceId);

  const identity = document.createElement("div");
  const title = document.createElement("strong");
  title.textContent = finding.widgetType;
  const meta = document.createElement("div");
  meta.className = "semantics-finding-meta";
  meta.textContent = `${finding.kind} · ${finding.confidence} confidence · line ${finding.source.line}${finding.enabled === "disabled" ? " · disabled" : ""}`;
  identity.append(title, meta);
  if (finding.opaqueReason) {
    const reason = document.createElement("div");
    reason.className = "semantics-finding-meta";
    reason.textContent = finding.opaqueReason;
    identity.appendChild(reason);
  }

  const idArea = document.createElement("div");
  const input = document.createElement("input");
  input.className = "semantics-id-input";
  input.value = literalIdentifier(finding.semantics.identifierExpression) || finding.suggestedIdentifier;
  input.placeholder = "screen.action";
  input.disabled = checkbox.disabled;
  input.setAttribute("aria-label", `Semantics identifier for ${finding.widgetType}`);
  const statuses = document.createElement("div");
  statuses.append(
    badge(`a11y: ${finding.accessibility}`, badgeClass(finding.accessibility)),
    badge(`ID: ${finding.automation}`, badgeClass(finding.automation)),
  );
  idArea.append(input, statuses);

  const sourceButton = document.createElement("button");
  sourceButton.type = "button";
  sourceButton.className = "semantics-source";
  sourceButton.textContent = `Open :${finding.source.line}`;
  sourceButton.addEventListener("click", () => openSource(finding.source));

  const syncSelection = () => {
    if (checkbox.checked) {
      selected.set(finding.occurrenceId, { occurrenceId: finding.occurrenceId, identifier: input.value.trim() });
    } else {
      selected.delete(finding.occurrenceId);
    }
    updatePreviewButton();
  };
  checkbox.addEventListener("change", syncSelection);
  input.addEventListener("input", () => {
    if (checkbox.checked) { syncSelection(); }
  });

  item.append(checkbox, identity, idArea, sourceButton);
  return item;
}

export function renderInteractives() {
  const result = state.interactivesResult;
  if (!semanticsTableBody || !semanticsTableContainer || !semanticsEmpty) { return; }
  semanticsTableBody.innerHTML = "";
  if (!result) {
    semanticsTableContainer.style.display = "none";
    semanticsEmpty.style.display = "block";
    return;
  }
  renderSummary(result);
  const groups = result.groups
    .map((group) => ({ ...group, visibleFindings: group.findings.filter(findingMatches) }))
    .filter((group) => group.visibleFindings.length > 0);
  semanticsEmpty.style.display = groups.length ? "none" : "block";
  semanticsEmpty.textContent = result.totals.findings === 0
    ? "No interactive candidates were found in production Dart sources."
    : "No findings match the current filters.";
  semanticsTableContainer.style.display = groups.length ? "block" : "none";

  groups.forEach((group) => {
    const row = document.createElement("tr");
    row.className = "semantics-file-row";
    const fileCell = document.createElement("td");
    fileCell.textContent = `${expanded.has(group.path) ? "▾" : "▸"} ${group.path}`;
    const countCell = document.createElement("td");
    countCell.textContent = String(group.visibleFindings.length);
    const a11yCell = document.createElement("td");
    const a11yReady = group.visibleFindings.filter((finding) => finding.accessibility === "ready").length;
    a11yCell.appendChild(badge(`${a11yReady}/${group.visibleFindings.length} ready`, a11yReady === group.visibleFindings.length ? "ready" : "uncertain"));
    const automationCell = document.createElement("td");
    const automationReady = group.visibleFindings.filter((finding) => finding.automation === "present").length;
    automationCell.appendChild(badge(`${automationReady}/${group.visibleFindings.length} ready`, automationReady === group.visibleFindings.length ? "ready" : "issue"));
    const openCell = document.createElement("td");
    const open = document.createElement("button");
    open.type = "button";
    open.className = "semantics-source";
    open.textContent = `Open :${group.primaryReference.line}`;
    open.addEventListener("click", (event) => { event.stopPropagation(); openSource(group.primaryReference); });
    openCell.appendChild(open);
    row.append(fileCell, countCell, a11yCell, automationCell, openCell);
    row.addEventListener("click", () => {
      if (expanded.has(group.path)) { expanded.delete(group.path); } else { expanded.add(group.path); }
      renderInteractives();
    });
    semanticsTableBody.appendChild(row);

    if (expanded.has(group.path)) {
      const detailsRow = document.createElement("tr");
      detailsRow.className = "semantics-details-row";
      const detailsCell = document.createElement("td");
      detailsCell.colSpan = 5;
      const list = document.createElement("div");
      list.className = "semantics-findings";
      group.visibleFindings.forEach((finding) => list.appendChild(findingElement(finding)));
      detailsCell.appendChild(list);
      detailsRow.appendChild(detailsCell);
      semanticsTableBody.appendChild(detailsRow);
    }
  });
}

export function scan() {
  selected.clear();
  updatePreviewButton();
  if (semanticsError) { semanticsError.style.display = "none"; }
  api.scanInteractives();
}

function scheduleScan() {
  clearTimeout(scanTimer);
  scanTimer = setTimeout(scan, 500);
}

function showPreview(preview) {
  activePreviewId = preview.previewId;
  if (!semanticsPreviewBackdrop || !semanticsPreviewList) { return; }
  semanticsPreviewList.innerHTML = "";
  preview.changes.forEach((change) => {
    const section = document.createElement("div");
    section.className = "semantics-preview-file";
    const heading = document.createElement("strong");
    heading.textContent = change.path;
    const before = document.createElement("pre");
    before.textContent = `Before\n${change.beforeSnippet}`;
    const after = document.createElement("pre");
    after.textContent = `After\n${change.afterSnippet}`;
    section.append(heading, before, after);
    semanticsPreviewList.appendChild(section);
  });
  semanticsPreviewBackdrop.style.display = "flex";
}

scanInteractivesButton?.addEventListener("click", scan);
copySemanticsPromptButton?.addEventListener("click", () => api.copySemanticsPrompt());
previewSemanticsFixesButton?.addEventListener("click", () => api.previewSemanticsFixes([...selected.values()]));
semanticsSearch?.addEventListener("input", renderInteractives);
semanticsStatusFilter?.addEventListener("change", renderInteractives);
semanticsKindFilter?.addEventListener("change", renderInteractives);
semanticsPreviewCancel?.addEventListener("click", () => {
  activePreviewId = null;
  if (semanticsPreviewBackdrop) { semanticsPreviewBackdrop.style.display = "none"; }
});
semanticsPreviewApply?.addEventListener("click", () => {
  if (activePreviewId) {
    semanticsPreviewApply.disabled = true;
    api.applySemanticsFixes(activePreviewId);
  }
});

window.addEventListener("semantics-tab-activated", () => {
  if (!state.interactivesResult || state.interactivesInvalidated) { scan(); }
});

bus.on("interactivesLoading", (message) => {
  if (semanticsLoading) { semanticsLoading.style.display = message.loading ? "block" : "none"; }
  if (scanInteractivesButton) { scanInteractivesButton.disabled = !!message.loading; }
});
bus.on("interactivesResult", (message) => {
  state.interactivesResult = message.result;
  state.interactivesInvalidated = false;
  selected.clear();
  if (semanticsKindFilter) {
    const current = semanticsKindFilter.value;
    const kinds = [...new Set(message.result.groups.flatMap((group) => group.findings.map((finding) => finding.kind)))].sort();
    semanticsKindFilter.replaceChildren(new Option("All interaction kinds", ""), ...kinds.map((kind) => new Option(kind, kind)));
    semanticsKindFilter.value = current;
  }
  updatePreviewButton();
  renderInteractives();
});
bus.on("interactivesError", (message) => {
  if (semanticsError) {
    semanticsError.textContent = message.message;
    semanticsError.style.display = "block";
  }
  if (semanticsPreviewApply) { semanticsPreviewApply.disabled = false; }
});
bus.on("interactivesInvalidated", () => {
  state.interactivesInvalidated = true;
  if (state.activeTab === "semantics") { scheduleScan(); }
});
bus.on("semanticsFixPreview", (message) => showPreview(message.preview));
bus.on("semanticsFixApplied", () => {
  activePreviewId = null;
  selected.clear();
  if (semanticsPreviewBackdrop) { semanticsPreviewBackdrop.style.display = "none"; }
  if (semanticsPreviewApply) { semanticsPreviewApply.disabled = false; }
});
bus.on("semanticsPromptCopying", (message) => {
  if (!copySemanticsPromptButton) { return; }
  copySemanticsPromptButton.disabled = !!message.copying;
  copySemanticsPromptButton.textContent = message.copying ? "Scanning…" : "Copy AI prompt";
});
bus.on("semanticsPromptCopied", () => {
  if (!copySemanticsPromptButton) { return; }
  copySemanticsPromptButton.textContent = "Copied";
  setTimeout(() => { copySemanticsPromptButton.textContent = "Copy AI prompt"; }, 1600);
});
