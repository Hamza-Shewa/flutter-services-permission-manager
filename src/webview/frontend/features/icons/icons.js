import { state } from "../../core/state.js";
import { bus } from "../../core/bus.js";
import * as api from "../../core/api.js";
import {
  iconsBrowseButton,
  iconsSourceLabel,
  iconsPlatformAndroid,
  iconsPlatformIOS,
  iconsPlatformBoth,
  iconsGenerateButton,
  iconsLoading,
  iconsResult,
  iconsFileList,
  iconsPreviewRow,
  iconsPreviewIOS,
  iconsPreviewAndroidSquare,
  iconsPreviewAndroidCircle,
  iconsPreviewAndroidSquircle,
  iconsAdjustRow,
  iconsScaleSlider,
  iconsScaleValue,
  iconsBackgroundColor,
  iconsBackgroundTransparent,
  iconsBackgroundRow,
  iconsCurrentRow,
  iconsCurrentAndroidCard,
  iconsCurrentAndroid,
  iconsCurrentAndroidLabel,
  iconsCurrentIOSCard,
  iconsCurrentIOS,
  iconsCurrentIOSLabel,
  iconsCurrentEmpty,
  iconsAndroidFamilyRow,
  iconsFamilyLauncher,
  iconsFamilyPlayStore,
  iconsFamilyNotifications,
} from "../../core/elements.js";

let selectedSource = null;
let previewRequestTimer = null;
let hasLoadedCurrentPreview = false;

function selectedPlatform() {
  if (iconsPlatformAndroid?.checked) { return "android"; }
  if (iconsPlatformIOS?.checked) { return "ios"; }
  return "both";
}

function currentScalePercent() {
  const value = Number(iconsScaleSlider?.value);
  return Number.isFinite(value) ? value : 100;
}

/** `undefined` means "transparent" - the wire format `generateIconPreview`/`generateIcons` expect. */
function currentBackgroundColor() {
  if (iconsBackgroundTransparent?.checked) { return undefined; }
  return iconsBackgroundColor?.value || undefined;
}

function currentAndroidFamilies() {
  return {
    launcher: !!iconsFamilyLauncher?.checked,
    playStore: !!iconsFamilyPlayStore?.checked,
    notifications: !!iconsFamilyNotifications?.checked,
  };
}

function updateGenerateButton() {
  if (!iconsGenerateButton) { return; }
  if (!selectedSource) {
    iconsGenerateButton.disabled = true;
    return;
  }
  const platform = selectedPlatform();
  if (platform === "android") {
    const families = currentAndroidFamilies();
    iconsGenerateButton.disabled = !(families.launcher || families.playStore || families.notifications);
    return;
  }
  iconsGenerateButton.disabled = false;
}

function updateAndroidFamilyRowVisibility() {
  if (!iconsAndroidFamilyRow) { return; }
  const platform = selectedPlatform();
  iconsAndroidFamilyRow.style.display = platform === "android" || platform === "both" ? "flex" : "none";
}

function setPreviewImages(dataUrl) {
  [iconsPreviewIOS, iconsPreviewAndroidSquare, iconsPreviewAndroidCircle, iconsPreviewAndroidSquircle]
    .forEach((img) => { if (img) { img.src = dataUrl; } });
}

function requestLivePreview() {
  if (!selectedSource) { return; }
  clearTimeout(previewRequestTimer);
  previewRequestTimer = setTimeout(() => {
    api.requestIconPreview(selectedSource.path, currentScalePercent(), currentBackgroundColor());
  }, 150);
}

function renderCurrentPreviews(previews) {
  const android = previews?.android;
  const ios = previews?.ios;
  if (iconsCurrentAndroidCard) { iconsCurrentAndroidCard.style.display = android ? "flex" : "none"; }
  if (android) {
    if (iconsCurrentAndroid) { iconsCurrentAndroid.src = android.dataUrl; }
    if (iconsCurrentAndroidLabel) { iconsCurrentAndroidLabel.textContent = `Android (${android.size}×${android.size})`; }
  }
  if (iconsCurrentIOSCard) { iconsCurrentIOSCard.style.display = ios ? "flex" : "none"; }
  if (ios) {
    if (iconsCurrentIOS) { iconsCurrentIOS.src = ios.dataUrl; }
    if (iconsCurrentIOSLabel) { iconsCurrentIOSLabel.textContent = `iOS (${ios.size}×${ios.size})`; }
  }
  if (iconsCurrentRow) { iconsCurrentRow.style.display = "flex"; }
  if (iconsCurrentEmpty) { iconsCurrentEmpty.style.display = android || ios ? "none" : "block"; }
}

/** Enables/disables the platform radios based on which platforms this project actually has. */
export function refreshIconsAvailability() {
  const hasAndroid = !!state.hasAndroidManifest;
  const hasIOS = !!state.hasIOSPlist;
  if (iconsPlatformAndroid) { iconsPlatformAndroid.disabled = !hasAndroid; }
  if (iconsPlatformIOS) { iconsPlatformIOS.disabled = !hasIOS; }
  if (iconsPlatformBoth) { iconsPlatformBoth.disabled = !(hasAndroid && hasIOS); }
  if (iconsPlatformBoth?.checked && iconsPlatformBoth.disabled) {
    if (hasAndroid && iconsPlatformAndroid) { iconsPlatformAndroid.checked = true; }
    else if (hasIOS && iconsPlatformIOS) { iconsPlatformIOS.checked = true; }
  }
  updateAndroidFamilyRowVisibility();
  updateGenerateButton();
}

iconsBrowseButton?.addEventListener("click", () => api.browseIconSource(currentScalePercent(), currentBackgroundColor()));
iconsGenerateButton?.addEventListener("click", () => {
  if (!selectedSource) { return; }
  api.generateIcons(selectedSource.path, selectedPlatform(), currentScalePercent(), currentBackgroundColor(), currentAndroidFamilies());
});

[iconsPlatformAndroid, iconsPlatformIOS, iconsPlatformBoth].forEach((radio) => {
  radio?.addEventListener("change", () => {
    updateAndroidFamilyRowVisibility();
    updateGenerateButton();
  });
});
[iconsFamilyLauncher, iconsFamilyPlayStore, iconsFamilyNotifications].forEach((checkbox) => {
  checkbox?.addEventListener("change", updateGenerateButton);
});

iconsScaleSlider?.addEventListener("input", () => {
  if (iconsScaleValue) { iconsScaleValue.textContent = `${iconsScaleSlider.value}%`; }
  requestLivePreview();
});
iconsBackgroundColor?.addEventListener("input", requestLivePreview);
iconsBackgroundTransparent?.addEventListener("change", () => {
  if (iconsBackgroundRow) { iconsBackgroundRow.style.opacity = iconsBackgroundTransparent.checked ? "0.5" : "1"; }
  if (iconsBackgroundColor) { iconsBackgroundColor.disabled = iconsBackgroundTransparent.checked; }
  requestLivePreview();
});

window.addEventListener("icons-tab-activated", () => {
  if (!hasLoadedCurrentPreview) {
    hasLoadedCurrentPreview = true;
    api.requestCurrentIconPreview();
  }
});

bus.on("iconSourceSelected", (message) => {
  selectedSource = { path: message.path, fileName: message.fileName, kind: message.kind };
  if (iconsSourceLabel) {
    iconsSourceLabel.textContent = `${message.fileName} (${message.kind.toUpperCase()})`;
  }
  if (iconsResult) { iconsResult.style.display = "none"; }
  if (iconsFileList) { iconsFileList.style.display = "none"; iconsFileList.innerHTML = ""; }
  if (message.previewDataUrl) {
    setPreviewImages(message.previewDataUrl);
    if (iconsPreviewRow) { iconsPreviewRow.style.display = "flex"; }
    if (iconsAdjustRow) { iconsAdjustRow.style.display = "flex"; }
  } else {
    if (iconsPreviewRow) { iconsPreviewRow.style.display = "none"; }
    if (iconsAdjustRow) { iconsAdjustRow.style.display = "none"; }
  }
  updateGenerateButton();
});

bus.on("iconPreviewUpdated", (message) => {
  if (message.previewDataUrl) { setPreviewImages(message.previewDataUrl); }
});

bus.on("currentIconPreview", (message) => {
  renderCurrentPreviews(message.previews);
});

bus.on("iconsGenerating", (message) => {
  if (iconsLoading) { iconsLoading.style.display = message.generating ? "block" : "none"; }
  if (message.generating) {
    if (iconsGenerateButton) { iconsGenerateButton.disabled = true; }
  } else {
    updateGenerateButton();
  }
});

bus.on("iconsGenerated", (message) => {
  const result = message.result || {};
  updateGenerateButton();
  if (iconsResult) {
    iconsResult.style.display = "block";
    iconsResult.style.color = result.success ? "#81c784" : "#ef9a9a";
    iconsResult.textContent = result.message || "";
  }
  const files = [...(result.androidFiles || []), ...(result.iosFiles || [])];
  if (iconsFileList) {
    iconsFileList.innerHTML = "";
    if (files.length) {
      iconsFileList.style.display = "block";
      const groups = new Map();
      files.forEach((file) => {
        const label = file.label || "Icon";
        if (!groups.has(label)) { groups.set(label, []); }
        groups.get(label).push(file);
      });
      groups.forEach((groupFiles, label) => {
        const heading = document.createElement("div");
        heading.style.fontWeight = "600";
        heading.style.marginTop = "6px";
        heading.textContent = `${label} (${groupFiles.length})`;
        iconsFileList.appendChild(heading);
        groupFiles.forEach((file) => {
          const row = document.createElement("div");
          row.style.paddingLeft = "10px";
          row.textContent = `${file.path} (${file.width}×${file.height})`;
          iconsFileList.appendChild(row);
        });
      });
    } else {
      iconsFileList.style.display = "none";
    }
  }
});
