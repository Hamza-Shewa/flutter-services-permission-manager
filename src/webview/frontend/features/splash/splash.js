import { state } from "../../core/state.js";
import { bus } from "../../core/bus.js";
import * as api from "../../core/api.js";
import {
  loadImage,
  sourceRect,
  drawContained,
  frameScheduler,
  marginFraction,
  bindRange,
} from "../../core/image-preview.js";
import {
  byId,
  bindBackground,
  selectedPlatform,
  applyPlatformAvailability,
  setBusy,
  renderResult,
  hideResult,
  wheelToRange,
} from "../../core/imgtool-ui.js";

const els = {
  browse: byId("splashBrowseButton"),
  thumb: byId("splashSourceThumb"),
  label: byId("splashSourceLabel"),
  meta: byId("splashSourceMeta"),
  adjust: byId("splashAdjustRow"),
  logoSlider: byId("splashLogoSlider"),
  logoNumber: byId("splashLogoNumber"),
  scaleSlider: byId("splashScaleSlider"),
  scaleNumber: byId("splashScaleNumber"),
  trim: byId("splashTrim"),
  trimHint: byId("splashTrimHint"),
  previewEmpty: byId("splashPreviewEmpty"),
  previewRow: byId("splashPreviewRow"),
  showBounds: byId("splashShowBounds"),
  phones: [byId("splashPhoneAndroid"), byId("splashPhoneIOS")],
  platformAndroid: byId("splashPlatformAndroid"),
  platformIOS: byId("splashPlatformIOS"),
  platformBoth: byId("splashPlatformBoth"),
  generate: byId("splashGenerateButton"),
  spinner: byId("splashLoading"),
  currentRow: byId("splashCurrentRow"),
  currentAndroidCard: byId("splashCurrentAndroidCard"),
  currentAndroid: byId("splashCurrentAndroid"),
  currentAndroidLabel: byId("splashCurrentAndroidLabel"),
  currentIOSCard: byId("splashCurrentIOSCard"),
  currentIOS: byId("splashCurrentIOS"),
  currentIOSLabel: byId("splashCurrentIOSLabel"),
  currentEmpty: byId("splashCurrentEmpty"),
};
const resultEls = {
  resultEl: byId("splashResult"),
  filesEl: byId("splashFileList"),
  summaryEl: byId("splashFileSummary"),
  bodyEl: byId("splashFileListBody"),
};

/** What `generateSplash` writes when no color is chosen. */
const PLATFORM_DEFAULT_BACKGROUND = "#ffffff";

let source = null;
let image = null;
let hasLoadedCurrentPreview = false;

function isDark(hex) {
  const n = Number.parseInt(hex.slice(1), 16);
  const luminance = 0.299 * ((n >> 16) & 255) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255);
  return luminance < 140;
}

function drawPhone(canvas) {
  const deviceW = Number(canvas.dataset.deviceW);
  const deviceH = Number(canvas.dataset.deviceH);
  const dpr = window.devicePixelRatio || 1;
  const cssW = canvas.clientWidth || 160;
  const cssH = canvas.clientHeight || Math.round(cssW * (deviceH / deviceW));
  const w = Math.round(cssW * dpr);
  const h = Math.round(cssH * dpr);
  if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
  const ctx = canvas.getContext("2d");
  const unit = w / deviceW;
  const bg = background.get() || PLATFORM_DEFAULT_BACKGROUND;

  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, w, h);

  ctx.fillStyle = isDark(bg) ? "rgba(255,255,255,0.8)" : "rgba(0,0,0,0.65)";
  ctx.font = `${Math.round(12 * unit)}px -apple-system, "Segoe UI", Roboto, sans-serif`;
  ctx.textBaseline = "middle";
  ctx.fillText("9:41", 18 * unit, 16 * unit);

  const box = logo.get() * unit;
  const ox = (w - box) / 2;
  const oy = (h - box) / 2;
  drawContained(ctx, image, sourceRect(image, source.preview, !!els.trim?.checked), box, scale.get(), ox, oy);

  if (els.showBounds?.checked) {
    ctx.setLineDash([4 * dpr, 3 * dpr]);
    ctx.lineWidth = dpr;
    ctx.strokeStyle = isDark(bg) ? "rgba(255,255,255,0.7)" : "rgba(0,0,0,0.5)";
    ctx.strokeRect(ox + 0.5, oy + 0.5, box - 1, box - 1);
    ctx.setLineDash([]);
  }
}

const draw = () => {
  if (!image || !source) { return; }
  els.phones.forEach((canvas) => { if (canvas) { drawPhone(canvas); } });
};
const scheduleDraw = frameScheduler(draw);

function markSizePreset() {
  document.querySelectorAll("[data-splash-size]").forEach((chip) => {
    chip.classList.toggle("active", Number(chip.dataset.splashSize) === logo.get());
  });
}

const logo = bindRange({
  slider: els.logoSlider,
  number: els.logoNumber,
  resetValue: 200,
  onChange: () => {
    markSizePreset();
    scheduleDraw();
  },
});

const scale = bindRange({
  slider: els.scaleSlider,
  number: els.scaleNumber,
  resetValue: 100,
  onChange: scheduleDraw,
});

const background = bindBackground({
  color: byId("splashBackgroundColor"),
  hex: byId("splashBackgroundHex"),
  none: byId("splashBackgroundTransparent"),
  row: byId("splashBackgroundRow"),
  suggest: byId("splashBackgroundSuggest"),
  onChange: scheduleDraw,
});

function updateGenerateButton() {
  if (!els.generate || els.generate.dataset.busy) { return; }
  els.generate.disabled = !source;
}

function renderCurrentPreviews(previews) {
  const android = previews?.android;
  const ios = previews?.ios;
  if (els.currentAndroidCard) { els.currentAndroidCard.style.display = android ? "flex" : "none"; }
  if (android) {
    els.currentAndroid.src = android.dataUrl;
    els.currentAndroidLabel.textContent = `Android · ${android.width}px`;
  }
  if (els.currentIOSCard) { els.currentIOSCard.style.display = ios ? "flex" : "none"; }
  if (ios) {
    els.currentIOS.src = ios.dataUrl;
    els.currentIOSLabel.textContent = `iOS · ${ios.width}px`;
  }
  if (els.currentRow) { els.currentRow.style.display = "flex"; }
  if (els.currentEmpty) { els.currentEmpty.style.display = android || ios ? "none" : "block"; }
}

/** Enables/disables the platform radios based on which platforms this project actually has. */
export function refreshSplashAvailability() {
  applyPlatformAvailability(els.platformAndroid, els.platformIOS, els.platformBoth, !!state.hasAndroidManifest, !!state.hasIOSPlist);
}

els.browse?.addEventListener("click", () => api.browseSplashSource());
els.generate?.addEventListener("click", () => {
  if (!source) { return; }
  api.generateSplash({
    sourcePath: source.path,
    platforms: selectedPlatform(els.platformAndroid, els.platformIOS),
    scalePercent: scale.get(),
    backgroundColor: background.get(),
    trimMargins: !!els.trim?.checked,
    logoSize: logo.get(),
  });
});

document.querySelectorAll("[data-splash-size]").forEach((chip) => {
  chip.addEventListener("click", () => logo.set(Number(chip.dataset.splashSize)));
});
els.trim?.addEventListener("change", scheduleDraw);
els.showBounds?.addEventListener("change", scheduleDraw);
wheelToRange(els.phones, logo, 4);
markSizePreset();

window.addEventListener("splash-tab-activated", () => {
  scheduleDraw();
  if (!hasLoadedCurrentPreview) {
    hasLoadedCurrentPreview = true;
    api.requestCurrentSplashPreview();
  }
});

bus.on("splashSourceSelected", async (message) => {
  const preview = message.preview;
  try {
    image = await loadImage(preview.dataUrl);
  } catch {
    image = null;
    return;
  }
  source = { path: message.path, fileName: message.fileName, kind: message.kind, preview };

  els.label.textContent = message.fileName;
  els.meta.textContent = `${message.kind.toUpperCase()} · ${preview.sourceWidth}×${preview.sourceHeight}${preview.hasTransparency ? " · transparent" : ""} · click to change`;
  els.thumb.src = preview.dataUrl;
  els.thumb.style.display = "";

  const margin = marginFraction(preview);
  els.trimHint.textContent = margin > 0.02 ? `(${Math.round(margin * 100)}% empty)` : "";
  els.trim.checked = margin > 0.04;
  background.suggest(preview.suggestedBackground);
  if (preview.suggestedBackground) { background.set(preview.suggestedBackground); }

  hideResult(resultEls);
  els.adjust.style.display = "flex";
  els.previewEmpty.style.display = "none";
  els.previewRow.style.display = "flex";
  updateGenerateButton();
  scheduleDraw();
});

bus.on("currentSplashPreview", (message) => renderCurrentPreviews(message.previews));

bus.on("splashGenerating", (message) => {
  setBusy(els.generate, els.spinner, !!message.generating);
  if (!message.generating) { updateGenerateButton(); }
});

bus.on("splashGenerated", (message) => {
  setBusy(els.generate, els.spinner, false);
  updateGenerateButton();
  renderResult(resultEls, message.result || {});
});
