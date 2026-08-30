import { state, getState, setState, on } from '../../core/state.js';
import * as api from '../../core/api.js';
import { androidTableBody, iosTableBody, searchInput, categoryFilter, addAndroidButton, addIosButton, saveAndroidBuildDetailsButton, saveIosBuildDetailsButton, iosSearchInput, iosCategoryFilter, saveButton, saveAppNameButton, saveServicesButton, savePackageNamesButton, saveAllButton, statusMessage, toastContainer, refreshButton, androidPackageNameInput, iosBundleIdentifierInput, analyzePackagesButton, updateAllPackagesButton, toggleTransitiveButton, packagesLoadingIndicator, packagesTableContainer, packagesTableBody, packageSearchInput, packageSearchSpinner, packageSearchDropdown, popularPackagesContainer, packagePreviewCard, previewPackageName, previewPackageVersion, previewPackageDescription, previewLoading, previewAddButton, validatorHeaderActions, validatorLoadingIndicator, validatorLoadingText, validatorTableContainer, validatorTableBody, validatorNotInstalledContainer, installValidatorButton, modalBackdrop, modalSearch, modalResults, modalError, modalValueContainer, modalValueInput, modalValueSelect, modalValueHint, androidCountChip, iosCountChip, macosCountChip, macosTableBody, macosSearchInput, macosCategoryFilter, addMacosButton, androidDetailsSection, iosDetailsSection, androidDetailsGrid, iosDetailsGrid, androidSection, iosSection, macosSection, modalCancel, modalAdd, crossPlatformModalBackdrop, crossPlatformModalTitle, crossPlatformModalMessage, crossPlatformSuggestions, crossPlatformModalError, crossPlatformModalSkip, crossPlatformModalAdd, syncPermissionsButton, equivalentModalBackdrop, equivalentModalTitle, equivalentModalMessage, equivalentSuggestions, equivalentModalError, equivalentModalCancel, equivalentModalAdd, syncModalBackdrop, syncModalList, syncModalError, syncModalCancel, syncModalConfirm, deleteSafetyModalBackdrop, deleteSafetyCancel, deleteSafetyConfirm, addServiceButton, servicesContainer, serviceSearch, serviceModalBackdrop, serviceModalTitle, serviceModalContent, serviceModalError, serviceModalCancel, serviceModalSave, addServiceModalBackdrop, addServiceList, addServiceModalCancel, appNameDefault, appNameLangDropdown, appNameLangDropdownTrigger, appNameLangDropdownMenu, appNameLangSearch, appNameLangOptions, appNameLangList } from '../../core/elements.js';

export function normalizeBuildDetailValue(key, value) {
    const raw = String(value ?? "").replace(/\r\n|\r|\n/g, " ").trim();
    if (key === "compileSdk" || key === "minSdk" || key === "targetSdk" || key === "versionCode") {
      return raw.replace(/^API\s+/i, "");
    }
    return raw;
  }

export function updatePlatformDetailValue(sectionName, key, value) {
    const section = state.platformDetails?.[sectionName] || [];
    const detail = section.find((item) => item.key === key);
    if (detail) {
      detail.value = value;
    }
  }

export function renderPlatformDetails() {
    renderDetailCards(
      androidDetailsGrid,
      state.platformDetails?.android || [],
      "No Android build metadata detected.",
      "android",
    );
    renderDetailCards(
      iosDetailsGrid,
      state.platformDetails?.ios || [],
      "No iOS build metadata detected.",
      "ios",
    );

    // Populate package configuration inputs
    const androidAppId = state.platformDetails?.android?.find((d) => d.key === "applicationId")?.value;
    const iosBundleId = state.platformDetails?.ios?.find((d) => d.key === "bundleIdentifier")?.value;

    if (androidPackageNameInput && androidAppId) {
      androidPackageNameInput.value = androidAppId;
    }
    if (iosBundleIdentifierInput && iosBundleId) {
      iosBundleIdentifierInput.value = iosBundleId;
    }
  }

export function handleSaveAndroidBuildDetails() {
    console.log("[PermissionManager] handleSaveAndroidBuildDetails called");
    showToast("Saving Android build details...", "info");
    const androidDetails = (state.platformDetails?.android || []).map((detail) => ({
      ...detail,
      value: normalizeBuildDetailValue(detail.key, detail.value),
    }));
    api.postMessage({
      type: "saveAndroidBuildDetails",
      androidDetails,
    });
  }

export function handleSaveIosBuildDetails() {
    console.log("[PermissionManager] handleSaveIosBuildDetails called");
    showToast("Saving iOS build details...", "info");
    const iosDetails = (state.platformDetails?.ios || []).map((detail) => ({
      ...detail,
      value: normalizeBuildDetailValue(detail.key, detail.value),
    }));
    api.postMessage({
      type: "saveIosBuildDetails",
      iosDetails,
    });
  }

export function handleSavePlatformDetails() {
    console.log("[PermissionManager] handleSavePlatformDetails called");

    showToast("Saving build details...", "info");

    const platformDetails = {
      android: (state.platformDetails?.android || []).map((detail) => ({
        ...detail,
        value: normalizeBuildDetailValue(detail.key, detail.value),
      })),
      ios: (state.platformDetails?.ios || []).map((detail) => ({
        ...detail,
        value: normalizeBuildDetailValue(detail.key, detail.value),
      })),
    };

    api.postMessage({
      type: "savePlatformDetails",
      platformDetails,
    });
  }

