import { state } from "../../core/state.js";
import { bus } from "../../core/bus.js";
import * as api from "../../core/api.js";
import {
  loadImage,
  renderComposed,
  renderSilhouette,
  blit,
  frameScheduler,
  circleSafeScale,
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
  browse: byId("iconsBrowseButton"),
  thumb: byId("iconsSourceThumb"),
  label: byId("iconsSourceLabel"),
  meta: byId("iconsSourceMeta"),
  adjust: byId("iconsAdjustRow"),
  slider: byId("iconsScaleSlider"),
  number: byId("iconsScaleNumber"),
  trim: byId("iconsTrim"),
  trimHint: byId("iconsTrimHint"),
  previewEmpty: byId("iconsPreviewEmpty"),
  previewRow: byId("iconsPreviewRow"),
  tilesCard: byId("iconsTilesCard"),
  showSafe: byId("iconsShowSafeZone"),
  silhouetteWarning: byId("iconsSilhouetteWarning"),
  platformAndroid: byId("iconsPlatformAndroid"),
  platformIOS: byId("iconsPlatformIOS"),
  platformBoth: byId("iconsPlatformBoth"),
  familyRow: byId("iconsAndroidFamilyRow"),
  familyLauncher: byId("iconsFamilyLauncher"),
  familyPlayStore: byId("iconsFamilyPlayStore"),
  familyNotifications: byId("iconsFamilyNotifications"),
  generate: byId("iconsGenerateButton"),
  spinner: byId("iconsLoading"),
  currentRow: byId("iconsCurrentRow"),
  currentAndroidCard: byId("iconsCurrentAndroidCard"),
  currentAndroid: byId("iconsCurrentAndroid"),
  currentAndroidLabel: byId("iconsCurrentAndroidLabel"),
  currentIOSCard: byId("iconsCurrentIOSCard"),
  currentIOS: byId("iconsCurrentIOS"),
  currentIOSLabel: byId("iconsCurrentIOSLabel"),
  currentEmpty: byId("iconsCurrentEmpty"),
};
const resultEls = {
  resultEl: byId("iconsResult"),
  filesEl: byId("iconsFileList"),
  summaryEl: byId("iconsFileSummary"),
  bodyEl: byId("iconsFileListBody"),
};

const COLORED_SIZE = 512;
const SILHOUETTE_SIZE = 128;
const colored = document.createElement("canvas");
const silhouette = document.createElement("canvas");

let source = null;
let image = null;
let hasLoadedCurrentPreview = false;
let activePreset = null;

const draw = () => {
  if (!image || !source) { return; }
  const trim = !!els.trim?.checked;
  const scalePercent = scale.get();
  renderComposed(colored, image, source.preview, { scalePercent, background: background.get(), trim }, COLORED_SIZE);
  renderSilhouette(silhouette, image, source.preview, { scalePercent, trim }, SILHOUETTE_SIZE);
  document.querySelectorAll('[data-icons-preview="colored"]').forEach((c) => blit(c, colored));
  document.querySelectorAll('[data-icons-preview="silhouette"]').forEach((c) => blit(c, silhouette));
};
const scheduleDraw = frameScheduler(draw);

function markPreset(name) {
  activePreset = name;
  document.querySelectorAll("[data-icons-preset]").forEach((chip) => {
    chip.classList.toggle("active", chip.dataset.iconsPreset === name);
  });
}

const scale = bindRange({
  slider: els.slider,
  number: els.number,
  resetValue: 100,
  onChange: () => {
    markPreset(null);
    scheduleDraw();
  },
});

const background = bindBackground({
  color: byId("iconsBackgroundColor"),
  hex: byId("iconsBackgroundHex"),
  none: byId("iconsBackgroundTransparent"),
  row: byId("iconsBackgroundRow"),
  suggest: byId("iconsBackgroundSuggest"),
  onChange: scheduleDraw,
});

function applyPreset(name) {
  const preview = source?.preview;
  if (!preview) { return; }
  const hasMargins = marginFraction(preview) > 0.02;
  if (name === "auto") {
    if (preview.hasTransparency) {
      els.trim.checked = hasMargins;
      scale.set(circleSafeScale(preview, els.trim.checked));
    } else if (preview.suggestedBackground && marginFraction(preview) > 0.05) {
      els.trim.checked = true;
      background.set(preview.suggestedBackground);
      scale.set(circleSafeScale(preview, true));
    } else {
      els.trim.checked = false;
      scale.set(100);
    }
  } else if (name === "safe") {
    scale.set(circleSafeScale(preview, !!els.trim.checked));
  } else if (name === "fill") {
    els.trim.checked = hasMargins;
    scale.set(100);
  } else if (name === "padded") {
    scale.set(80);
  }
  markPreset(name);
  scheduleDraw();
}

function currentAndroidFamilies() {
  return {
    launcher: !!els.familyLauncher?.checked,
    playStore: !!els.familyPlayStore?.checked,
    notifications: !!els.familyNotifications?.checked,
  };
}

function updateGenerateButton() {
  if (!els.generate || els.generate.dataset.busy) { return; }
  if (!source) {
    els.generate.disabled = true;
    return;
  }
  const families = currentAndroidFamilies();
  const anyFamily = families.launcher || families.playStore || families.notifications;
  els.generate.disabled = selectedPlatform(els.platformAndroid, els.platformIOS) === "android" && !anyFamily;
}

function updateFamilyRowVisibility() {
  if (!els.familyRow) { return; }
  els.familyRow.style.display = selectedPlatform(els.platformAndroid, els.platformIOS) === "ios" ? "none" : "flex";
}

function fillAppName() {
  const name = state.appName?.defaultName || "Your app";
  document.querySelectorAll("[data-icons-appname]").forEach((el) => { el.textContent = name; });
}

function renderCurrentPreviews(previews) {
  const android = previews?.android;
  const ios = previews?.ios;
  if (els.currentAndroidCard) { els.currentAndroidCard.style.display = android ? "flex" : "none"; }
  if (android) {
    els.currentAndroid.src = android.dataUrl;
    els.currentAndroidLabel.textContent = `Android · ${android.size}px`;
  }
  if (els.currentIOSCard) { els.currentIOSCard.style.display = ios ? "flex" : "none"; }
  if (ios) {
    els.currentIOS.src = ios.dataUrl;
    els.currentIOSLabel.textContent = `iOS · ${ios.size}px`;
  }
  if (els.currentRow) { els.currentRow.style.display = "flex"; }
  if (els.currentEmpty) { els.currentEmpty.style.display = android || ios ? "none" : "block"; }
}

/** Enables/disables the platform radios based on which platforms this project actually has. */
export function refreshIconsAvailability() {
  applyPlatformAvailability(els.platformAndroid, els.platformIOS, els.platformBoth, !!state.hasAndroidManifest, !!state.hasIOSPlist);
  updateFamilyRowVisibility();
  updateGenerateButton();
}

els.browse?.addEventListener("click", () => api.browseIconSource());
els.generate?.addEventListener("click", () => {
  if (!source) { return; }
  api.generateIcons({
    sourcePath: source.path,
    platforms: selectedPlatform(els.platformAndroid, els.platformIOS),
    scalePercent: scale.get(),
    backgroundColor: background.get(),
    trimMargins: !!els.trim?.checked,
    androidFamilies: currentAndroidFamilies(),
  });
});

document.querySelectorAll("[data-icons-preset]").forEach((chip) => {
  chip.addEventListener("click", () => applyPreset(chip.dataset.iconsPreset));
});
els.trim?.addEventListener("change", () => {
  // Keep a size preset meaningful when the reference box changes.
  if (activePreset === "safe" || activePreset === "auto") {
    scale.set(circleSafeScale(source?.preview, !!els.trim.checked));
    markPreset(activePreset);
  }
  scheduleDraw();
});
els.showSafe?.addEventListener("change", () => {
  els.tilesCard?.classList.toggle("imgtool-show-safe", els.showSafe.checked);
});
wheelToRange([els.previewRow], scale);

[els.platformAndroid, els.platformIOS, els.platformBoth].forEach((radio) => {
  radio?.addEventListener("change", () => {
    updateFamilyRowVisibility();
    updateGenerateButton();
  });
});
[els.familyLauncher, els.familyPlayStore, els.familyNotifications].forEach((checkbox) => {
  checkbox?.addEventListener("change", updateGenerateButton);
});

window.addEventListener("icons-tab-activated", () => {
  fillAppName();
  scheduleDraw();
  if (!hasLoadedCurrentPreview) {
    hasLoadedCurrentPreview = true;
    api.requestCurrentIconPreview();
  }
});

bus.on("iconSourceSelected", async (message) => {
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
  background.suggest(preview.suggestedBackground);
  if (els.silhouetteWarning) { els.silhouetteWarning.style.display = preview.hasTransparency ? "none" : "block"; }

  hideResult(resultEls);
  els.adjust.style.display = "flex";
  els.previewEmpty.style.display = "none";
  els.previewRow.style.display = "flex";
  fillAppName();
  applyPreset("auto");
  updateGenerateButton();
});

bus.on("currentIconPreview", (message) => renderCurrentPreviews(message.previews));

bus.on("iconsGenerating", (message) => {
  setBusy(els.generate, els.spinner, !!message.generating);
  if (!message.generating) { updateGenerateButton(); }
});

bus.on("iconsGenerated", (message) => {
  setBusy(els.generate, els.spinner, false);
  updateGenerateButton();
  renderResult(resultEls, message.result || {});
});
