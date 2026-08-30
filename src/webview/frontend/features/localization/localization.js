import { state, getState, setState, on } from '../../core/state.js';
import * as api from '../../core/api.js';
import { androidTableBody, iosTableBody, searchInput, categoryFilter, addAndroidButton, addIosButton, saveAndroidBuildDetailsButton, saveIosBuildDetailsButton, iosSearchInput, iosCategoryFilter, saveButton, saveAppNameButton, saveServicesButton, savePackageNamesButton, saveAllButton, statusMessage, toastContainer, refreshButton, androidPackageNameInput, iosBundleIdentifierInput, analyzePackagesButton, updateAllPackagesButton, toggleTransitiveButton, packagesLoadingIndicator, packagesTableContainer, packagesTableBody, packageSearchInput, packageSearchSpinner, packageSearchDropdown, popularPackagesContainer, packagePreviewCard, previewPackageName, previewPackageVersion, previewPackageDescription, previewLoading, previewAddButton, validatorHeaderActions, validatorLoadingIndicator, validatorLoadingText, validatorTableContainer, validatorTableBody, validatorNotInstalledContainer, installValidatorButton, modalBackdrop, modalSearch, modalResults, modalError, modalValueContainer, modalValueInput, modalValueSelect, modalValueHint, androidCountChip, iosCountChip, macosCountChip, macosTableBody, macosSearchInput, macosCategoryFilter, addMacosButton, androidDetailsSection, iosDetailsSection, androidDetailsGrid, iosDetailsGrid, androidSection, iosSection, macosSection, modalCancel, modalAdd, crossPlatformModalBackdrop, crossPlatformModalTitle, crossPlatformModalMessage, crossPlatformSuggestions, crossPlatformModalError, crossPlatformModalSkip, crossPlatformModalAdd, syncPermissionsButton, equivalentModalBackdrop, equivalentModalTitle, equivalentModalMessage, equivalentSuggestions, equivalentModalError, equivalentModalCancel, equivalentModalAdd, syncModalBackdrop, syncModalList, syncModalError, syncModalCancel, syncModalConfirm, deleteSafetyModalBackdrop, deleteSafetyCancel, deleteSafetyConfirm, addServiceButton, servicesContainer, serviceSearch, serviceModalBackdrop, serviceModalTitle, serviceModalContent, serviceModalError, serviceModalCancel, serviceModalSave, addServiceModalBackdrop, addServiceList, addServiceModalCancel, appNameDefault, appNameLangDropdown, appNameLangDropdownTrigger, appNameLangDropdownMenu, appNameLangSearch, appNameLangOptions, appNameLangList } from '../../core/elements.js';

export function renderAppName() {
    if (!appNameDefault) {return;}

    appNameDefault.value = state.appName.defaultName || "";
    renderAppNameLangList();
  }

export function renderLanguageDropdown() {
    if (!appNameLangOptions || !state.languages) {return;}

    const searchTerm = (appNameLangSearch?.value || "").toLowerCase();
    const existingCodes = Object.keys(state.appName.localizations || {});

    const filteredLangs = state.languages.filter(lang => {
      // Don't show already added languages
      if (existingCodes.includes(lang.code)) {return false;}

      // Filter by search term
      if (!searchTerm) {return true;}
      return (
        lang.name.toLowerCase().includes(searchTerm) ||
        lang.nativeName.toLowerCase().includes(searchTerm) ||
        lang.code.toLowerCase().includes(searchTerm)
      );
    });

    if (filteredLangs.length === 0) {
      appNameLangOptions.innerHTML = '<div class="appname-lang-option"><span class="appname-lang-option-title">No languages found</span></div>';
      return;
    }

    appNameLangOptions.innerHTML = filteredLangs
      .map(lang => `
        <div class="appname-lang-option" data-code="${lang.code}">
          <span class="appname-lang-option-title">${lang.name} <span class="appname-lang-option-code">${lang.code}</span></span>
          <span class="appname-lang-option-subtitle">${lang.nativeName}</span>
        </div>
      `)
      .join("");

    // Add click handlers - add language directly when clicked
    appNameLangOptions.querySelectorAll('.appname-lang-option').forEach(option => {
      option.addEventListener('click', () => {
        const code = option.dataset.code;
        const lang = state.languages.find(l => l.code === code);
        if (lang) {
          // Add language directly
          addAppNameLanguageDirect(code);
          closeAppNameLangDropdown();
        }
      });
    });
  }

export function openAppNameLangDropdown() {
    if (!appNameLangDropdownMenu) {return;}
    appNameLangDropdownMenu.classList.add('active');
    appNameLangDropdownTrigger.classList.add('active');
    renderLanguageDropdown();
    if (appNameLangSearch) {appNameLangSearch.focus();}
  }

export function closeAppNameLangDropdown() {
    if (!appNameLangDropdownMenu) {return;}
    appNameLangDropdownMenu.classList.remove('active');
    appNameLangDropdownTrigger.classList.remove('active');
  }

export function toggleAppNameLangDropdown() {
    if (appNameLangDropdownMenu?.classList.contains('active')) {
      closeAppNameLangDropdown();
    } else {
      openAppNameLangDropdown();
    }
  }

export function addAppNameLanguageDirect(code) {
    if (!code) {return;}

    // Check if already added
    if (state.appName.localizations && state.appName.localizations[code] !== undefined) {
      showToast("Language already added", "info");
      return;
    }

    // Initialize localizations if not exists
    if (!state.appName.localizations) {
      state.appName.localizations = {};
    }

    // Add language with empty value
    state.appName.localizations[code] = "";

    // Reset dropdown trigger text
    appNameLangDropdownTrigger.innerHTML = `<span>Select a language...</span><span>▼</span>`;
    // Clear search
    if (appNameLangSearch) {appNameLangSearch.value = "";}

    renderAppNameLangList();
    showToast("Language added. Enter the app name for this language.", "info");
  }

export function removeAppNameLanguage(code) {
    if (state.appName.localizations && state.appName.localizations[code] !== undefined) {
      delete state.appName.localizations[code];
      renderAppNameLangList();
    }
  }

export function updateAppNameLanguage(code, value) {
    if (!state.appName.localizations) {
      state.appName.localizations = {};
    }
    state.appName.localizations[code] = value;
  }

export function renderAppNameLangList() {
    if (!appNameLangList) {return;}

    const locs = state.appName.localizations || {};
    const entries = Object.entries(locs);

    if (entries.length === 0) {
      appNameLangList.innerHTML = '<div class="appname-lang-empty">No localized languages added yet. Select a language from the dropdown above.</div>';
      return;
    }

    appNameLangList.innerHTML = entries
      .map(([code, value]) => {
        const lang = state.languages.find(l => l.code === code);
        const langName = lang ? lang.name : code;
        const nativeName = lang ? lang.nativeName : "";

        return `
          <div class="appname-lang-item" data-code="${code}">
            <div class="appname-lang-item-info">
              <span class="appname-lang-item-name">${langName}</span>
              <span class="appname-lang-item-code">${nativeName} (${code})</span>
            </div>
            <div class="appname-lang-item-input">
              <input type="text" value="${value}" placeholder="App name in ${langName}..." data-code="${code}" />
            </div>
            <button type="button" class="appname-lang-item-remove" data-code="${code}">Remove</button>
          </div>
        `;
      })
      .join("");

    // Add event listeners to inputs
    appNameLangList.querySelectorAll('.appname-lang-item-input input').forEach(input => {
      input.addEventListener('input', (e) => {
        const code = e.target.dataset.code;
        updateAppNameLanguage(code, e.target.value);
      });
    });

    // Add event listeners to remove buttons
    appNameLangList.querySelectorAll('.appname-lang-item-remove').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const code = e.target.dataset.code;
        removeAppNameLanguage(code);
      });
    });
  }

export function handleSaveAppName() {
    console.log("[PermissionManager] handleSaveAppName called");

    // Sync app name from input fields to state
    if (appNameDefault) {
      state.appName.defaultName = appNameDefault.value.trim();
    }

    if (!state.appName.defaultName) {
      showToast("Please enter a default app name", "error");
      return;
    }

    console.log("[PermissionManager] Posting saveAppName message");
    showToast("Saving app name localization...", "info");

    api.postMessage({
      type: "saveAppName",
      appName: {
        defaultName: state.appName.defaultName,
        localizations: state.appName.localizations || {}
      },
    });
  }

