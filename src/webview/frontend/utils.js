import { state, getState, setState, on } from './state.js';
import * as api from './api.js';
import { androidTableBody, iosTableBody, searchInput, categoryFilter, addAndroidButton, addIosButton, saveAndroidBuildDetailsButton, saveIosBuildDetailsButton, iosSearchInput, iosCategoryFilter, saveButton, saveAppNameButton, saveServicesButton, savePackageNamesButton, saveAllButton, statusMessage, toastContainer, refreshButton, androidPackageNameInput, iosBundleIdentifierInput, analyzePackagesButton, updateAllPackagesButton, toggleTransitiveButton, packagesLoadingIndicator, packagesTableContainer, packagesTableBody, packageSearchInput, packageSearchSpinner, packageSearchDropdown, popularPackagesContainer, packagePreviewCard, previewPackageName, previewPackageVersion, previewPackageDescription, previewLoading, previewAddButton, validatorHeaderActions, validatorLoadingIndicator, validatorLoadingText, validatorTableContainer, validatorTableBody, validatorNotInstalledContainer, installValidatorButton, modalBackdrop, modalSearch, modalResults, modalError, modalValueContainer, modalValueInput, modalValueSelect, modalValueHint, androidCountChip, iosCountChip, macosCountChip, macosTableBody, macosSearchInput, macosCategoryFilter, addMacosButton, androidDetailsSection, iosDetailsSection, androidDetailsGrid, iosDetailsGrid, androidSection, iosSection, macosSection, modalCancel, modalAdd, crossPlatformModalBackdrop, crossPlatformModalTitle, crossPlatformModalMessage, crossPlatformSuggestions, crossPlatformModalError, crossPlatformModalSkip, crossPlatformModalAdd, syncPermissionsButton, equivalentModalBackdrop, equivalentModalTitle, equivalentModalMessage, equivalentSuggestions, equivalentModalError, equivalentModalCancel, equivalentModalAdd, syncModalBackdrop, syncModalList, syncModalError, syncModalCancel, syncModalConfirm, deleteSafetyModalBackdrop, deleteSafetyCancel, deleteSafetyConfirm, addServiceButton, servicesContainer, serviceSearch, serviceModalBackdrop, serviceModalTitle, serviceModalContent, serviceModalError, serviceModalCancel, serviceModalSave, addServiceModalBackdrop, addServiceList, addServiceModalCancel, appNameDefault, appNameLangDropdown, appNameLangDropdownTrigger, appNameLangDropdownMenu, appNameLangSearch, appNameLangOptions, appNameLangList } from './elements.js';

export function escapeHtml(value) {
    return String(value || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

export function scheduleRefresh() {
    if (pendingRefreshTimeout) {
      clearTimeout(pendingRefreshTimeout);
    }
    pendingRefreshTimeout = setTimeout(() => {
      vscode.postMessage({ type: "refresh" });
      pendingRefreshTimeout = null;
    }, 200);
  }

export function showToast(message, type = "info", duration = 4000) {
    const toast = document.createElement("div");
    toast.className = `toast ${type}`;

    const icons = {
      success: "✓",
      error: "✕",
      info: "ℹ",
    };

    toast.innerHTML = `
            <div class="toast-icon">${icons[type] || icons.info}</div>
            <div class="toast-content">${message}</div>
            <button class="toast-close" aria-label="Close">×</button>
            <div class="toast-progress" style="animation-duration: ${duration}ms;"></div>
        `;

    const closeBtn = toast.querySelector(".toast-close");
    closeBtn.addEventListener("click", () => dismissToast(toast));

    toastContainer.appendChild(toast);

    // Auto dismiss after duration
    setTimeout(() => dismissToast(toast), duration);

    return toast;
  }

export function dismissToast(toast) {
    if (!toast || toast.classList.contains("hiding")) {return;}

    toast.classList.add("hiding");
    toast.addEventListener("animationend", () => {
      toast.remove();
    });
  }

export function setStatus(message, type) {
    if (!message) {return;}

    // Map old types to toast types
    const toastType =
      type === "success" ? "success" : type === "error" ? "error" : "info";
    showToast(message, toastType);

    // Also update hidden status element for compatibility
    statusMessage.textContent = message || "";
    statusMessage.className = `status ${type || ""}`.trim();
  }

