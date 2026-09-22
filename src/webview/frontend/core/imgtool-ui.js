// Controls shared by the App Icons and Splash Screen tabs.

export const byId = (id) => document.getElementById(id);

const HEX = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i;

function normalizeHex(value) {
  const match = HEX.exec(value.trim());
  if (!match) { return null; }
  let hex = match[1];
  if (hex.length === 3) { hex = hex.split("").map((c) => c + c).join(""); }
  return `#${hex.toLowerCase()}`;
}

/**
 * Color picker + hex box + "transparent/default" checkbox + detected-color chip, as one control.
 * `get()` returns the hex string, or `undefined` when the checkbox is on.
 */
export function bindBackground({ color, hex, none, row, suggest, onChange }) {
  const sync = () => {
    const off = !!none?.checked;
    if (color) { color.disabled = off; }
    if (hex) { hex.disabled = off; }
    if (row) { row.classList.toggle("imgtool-muted", off); }
  };
  color?.addEventListener("input", () => {
    if (hex) { hex.value = color.value; }
    onChange();
  });
  hex?.addEventListener("input", () => {
    const value = normalizeHex(hex.value);
    if (value && color) {
      color.value = value;
      onChange();
    }
  });
  hex?.addEventListener("blur", () => { if (color) { hex.value = color.value; } });
  none?.addEventListener("change", () => { sync(); onChange(); });
  let suggested = null;
  suggest?.addEventListener("click", () => {
    if (!suggested) { return; }
    api.set(suggested);
    onChange();
  });
  sync();
  const api = {
    get: () => (none?.checked ? undefined : color?.value || undefined),
    set: (value) => {
      const v = normalizeHex(value);
      if (!v) { return; }
      if (color) { color.value = v; }
      if (hex) { hex.value = v; }
      if (none) { none.checked = false; }
      sync();
    },
    setTransparent: (on) => { if (none) { none.checked = on; } sync(); },
    suggest: (value) => {
      suggested = value ? normalizeHex(value) : null;
      if (!suggest) { return; }
      suggest.style.display = suggested ? "" : "none";
      if (suggested) {
        suggest.innerHTML = `<span class="imgtool-swatch" style="background:${suggested}"></span>Use detected ${suggested}`;
      }
    },
  };
  return api;
}

export function selectedPlatform(android, ios) {
  if (android?.checked) { return "android"; }
  if (ios?.checked) { return "ios"; }
  return "both";
}

/** Disables platform radios the project doesn't have, moving the selection off a disabled one. */
export function applyPlatformAvailability(android, ios, both, hasAndroid, hasIOS) {
  if (android) { android.disabled = !hasAndroid; }
  if (ios) { ios.disabled = !hasIOS; }
  if (both) { both.disabled = !(hasAndroid && hasIOS); }
  const checked = [android, ios, both].find((r) => r?.checked);
  if (!checked || checked.disabled) {
    const fallback = [both, android, ios].find((r) => r && !r.disabled);
    if (fallback) { fallback.checked = true; }
  }
}

export function setBusy(button, spinner, busy) {
  if (spinner) { spinner.style.display = busy ? "inline-block" : "none"; }
  if (button) {
    button.dataset.busy = busy ? "1" : "";
    if (busy) { button.disabled = true; }
  }
}

/** Shows a generation result and its grouped file list. */
export function renderResult({ resultEl, filesEl, summaryEl, bodyEl }, result) {
  if (resultEl) {
    resultEl.style.display = "block";
    resultEl.className = `imgtool-result ${result.success ? "ok" : "err"}`;
    resultEl.textContent = result.message || "";
  }
  const files = [...(result.androidFiles || []), ...(result.iosFiles || [])];
  if (!filesEl || !bodyEl) { return; }
  bodyEl.innerHTML = "";
  if (!files.length) {
    filesEl.style.display = "none";
    return;
  }
  filesEl.style.display = "block";
  if (summaryEl) { summaryEl.textContent = `${files.length} file${files.length === 1 ? "" : "s"} written`; }
  const groups = new Map();
  for (const file of files) {
    const label = file.label || "Files";
    if (!groups.has(label)) { groups.set(label, []); }
    groups.get(label).push(file);
  }
  for (const [label, groupFiles] of groups) {
    const heading = document.createElement("div");
    heading.style.fontWeight = "600";
    heading.style.marginTop = "6px";
    heading.textContent = `${label} (${groupFiles.length})`;
    bodyEl.appendChild(heading);
    for (const file of groupFiles) {
      const row = document.createElement("div");
      row.style.paddingLeft = "10px";
      row.textContent = `${file.path} · ${file.width}×${file.height}`;
      bodyEl.appendChild(row);
    }
  }
}

export function hideResult({ resultEl, filesEl }) {
  if (resultEl) { resultEl.style.display = "none"; }
  if (filesEl) { filesEl.style.display = "none"; }
}

/** Mouse-wheel over `targets` nudges a bound range by ±`step` without scrolling the page. */
export function wheelToRange(targets, range, step = 2) {
  for (const target of targets) {
    target?.addEventListener("wheel", (event) => {
      event.preventDefault();
      range.nudge(event.deltaY < 0 ? step : -step);
    }, { passive: false });
  }
}
