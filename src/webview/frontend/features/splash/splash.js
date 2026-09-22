import { state } from "../../core/state.js";
import { bus } from "../../core/bus.js";
import * as api from "../../core/api.js";
import {
  splashBrowseButton,
  splashSourceLabel,
  splashPlatformAndroid,
  splashPlatformIOS,
  splashPlatformBoth,
  splashGenerateButton,
  splashLoading,
  splashResult,
  splashFileList,
  splashPreviewRow,
  splashPreviewImage,
  splashAdjustRow,
  splashScaleSlider,
  splashScaleValue,
  splashBackgroundColor,
  splashBackgroundTransparent,
  splashBackgroundRow,
  splashCurrentRow,
  splashCurrentAndroidCard,
  splashCurrentAndroid,
  splashCurrentAndroidLabel,
  splashCurrentIOSCard,
  splashCurrentIOS,
  splashCurrentIOSLabel,
  splashCurrentEmpty,
} from "../../core/elements.js";

let selectedSource = null;
let previewRequestTimer = null;
let hasLoadedCurrentPreview = false;

function selectedPlatform() {
  if (splashPlatformAndroid?.checked) { return "android"; }
  if (splashPlatformIOS?.checked) { return "ios"; }
  return "both";
}

function currentScalePercent() {
  const value = Number(splashScaleSlider?.value);
  return Number.isFinite(value) ? value : 100;
}

/** `undefined` means "use the platform's own default background" - the wire format `generateSplashPreview`/`generateSplash` expect. */
function currentBackgroundColor() {
  if (splashBackgroundTransparent?.checked) { return undefined; }
  return splashBackgroundColor?.value || undefined;
}

function updateGenerateButton() {
  if (splashGenerateButton) { splashGenerateButton.disabled = !selectedSource; }
}

function requestLivePreview() {
  if (!selectedSource) { return; }
  clearTimeout(previewRequestTimer);
  previewRequestTimer = setTimeout(() => {
    api.requestSplashPreview(selectedSource.path, currentScalePercent(), currentBackgroundColor());
  }, 150);
}

function renderCurrentPreviews(previews) {
  const android = previews?.android;
  const ios = previews?.ios;
  if (splashCurrentAndroidCard) { splashCurrentAndroidCard.style.display = android ? "flex" : "none"; }
  if (android) {
    if (splashCurrentAndroid) { splashCurrentAndroid.src = android.dataUrl; }
    if (splashCurrentAndroidLabel) { splashCurrentAndroidLabel.textContent = `Android (${android.width}×${android.height})`; }
  }
  if (splashCurrentIOSCard) { splashCurrentIOSCard.style.display = ios ? "flex" : "none"; }
  if (ios) {
    if (splashCurrentIOS) { splashCurrentIOS.src = ios.dataUrl; }
    if (splashCurrentIOSLabel) { splashCurrentIOSLabel.textContent = `iOS (${ios.width}×${ios.height})`; }
  }
  if (splashCurrentRow) { splashCurrentRow.style.display = "flex"; }
  if (splashCurrentEmpty) { splashCurrentEmpty.style.display = android || ios ? "none" : "block"; }
}

/** Enables/disables the platform radios based on which platforms this project actually has. */
export function refreshSplashAvailability() {
  const hasAndroid = !!state.hasAndroidManifest;
  const hasIOS = !!state.hasIOSPlist;
  if (splashPlatformAndroid) { splashPlatformAndroid.disabled = !hasAndroid; }
  if (splashPlatformIOS) { splashPlatformIOS.disabled = !hasIOS; }
  if (splashPlatformBoth) { splashPlatformBoth.disabled = !(hasAndroid && hasIOS); }
  if (splashPlatformBoth?.checked && splashPlatformBoth.disabled) {
    if (hasAndroid && splashPlatformAndroid) { splashPlatformAndroid.checked = true; }
    else if (hasIOS && splashPlatformIOS) { splashPlatformIOS.checked = true; }
  }
}

splashBrowseButton?.addEventListener("click", () => api.browseSplashSource(currentScalePercent(), currentBackgroundColor()));
splashGenerateButton?.addEventListener("click", () => {
  if (!selectedSource) { return; }
  api.generateSplash(selectedSource.path, selectedPlatform(), currentScalePercent(), currentBackgroundColor());
});

splashScaleSlider?.addEventListener("input", () => {
  if (splashScaleValue) { splashScaleValue.textContent = `${splashScaleSlider.value}%`; }
  requestLivePreview();
});
splashBackgroundColor?.addEventListener("input", requestLivePreview);
splashBackgroundTransparent?.addEventListener("change", () => {
  if (splashBackgroundRow) { splashBackgroundRow.style.opacity = splashBackgroundTransparent.checked ? "0.5" : "1"; }
  if (splashBackgroundColor) { splashBackgroundColor.disabled = splashBackgroundTransparent.checked; }
  requestLivePreview();
});

window.addEventListener("splash-tab-activated", () => {
  if (!hasLoadedCurrentPreview) {
    hasLoadedCurrentPreview = true;
    api.requestCurrentSplashPreview();
  }
});

bus.on("splashSourceSelected", (message) => {
  selectedSource = { path: message.path, fileName: message.fileName, kind: message.kind };
  if (splashSourceLabel) {
    splashSourceLabel.textContent = `${message.fileName} (${message.kind.toUpperCase()})`;
  }
  if (splashResult) { splashResult.style.display = "none"; }
  if (splashFileList) { splashFileList.style.display = "none"; splashFileList.innerHTML = ""; }
  if (message.previewDataUrl) {
    if (splashPreviewImage) { splashPreviewImage.src = message.previewDataUrl; }
    if (splashPreviewRow) { splashPreviewRow.style.display = "flex"; }
    if (splashAdjustRow) { splashAdjustRow.style.display = "flex"; }
  } else {
    if (splashPreviewRow) { splashPreviewRow.style.display = "none"; }
    if (splashAdjustRow) { splashAdjustRow.style.display = "none"; }
  }
  updateGenerateButton();
});

bus.on("splashPreviewUpdated", (message) => {
  if (message.previewDataUrl && splashPreviewImage) { splashPreviewImage.src = message.previewDataUrl; }
});

bus.on("currentSplashPreview", (message) => {
  renderCurrentPreviews(message.previews);
});

bus.on("splashGenerating", (message) => {
  if (splashLoading) { splashLoading.style.display = message.generating ? "block" : "none"; }
  if (message.generating) {
    if (splashGenerateButton) { splashGenerateButton.disabled = true; }
  } else {
    updateGenerateButton();
  }
});

bus.on("splashGenerated", (message) => {
  const result = message.result || {};
  updateGenerateButton();
  if (splashResult) {
    splashResult.style.display = "block";
    splashResult.style.color = result.success ? "#81c784" : "#ef9a9a";
    splashResult.textContent = result.message || "";
  }
  const files = [...(result.androidFiles || []), ...(result.iosFiles || [])];
  if (splashFileList) {
    splashFileList.innerHTML = "";
    if (files.length) {
      splashFileList.style.display = "block";
      const groups = new Map();
      files.forEach((file) => {
        const label = file.label || "File";
        if (!groups.has(label)) { groups.set(label, []); }
        groups.get(label).push(file);
      });
      groups.forEach((groupFiles, label) => {
        const heading = document.createElement("div");
        heading.style.fontWeight = "600";
        heading.style.marginTop = "6px";
        heading.textContent = `${label} (${groupFiles.length})`;
        splashFileList.appendChild(heading);
        groupFiles.forEach((file) => {
          const row = document.createElement("div");
          row.style.paddingLeft = "10px";
          row.textContent = `${file.path} (${file.width}×${file.height})`;
          splashFileList.appendChild(row);
        });
      });
    } else {
      splashFileList.style.display = "none";
    }
  }
});
