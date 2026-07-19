import { state, getState, setState, on } from './state.js';
import * as api from './api.js';
import { androidTableBody, iosTableBody, searchInput, categoryFilter, addAndroidButton, addIosButton, saveAndroidBuildDetailsButton, saveIosBuildDetailsButton, iosSearchInput, iosCategoryFilter, saveButton, saveAppNameButton, saveServicesButton, savePackageNamesButton, saveAllButton, statusMessage, toastContainer, refreshButton, androidPackageNameInput, iosBundleIdentifierInput, analyzePackagesButton, updateAllPackagesButton, toggleTransitiveButton, packagesLoadingIndicator, packagesTableContainer, packagesTableBody, packageSearchInput, packageSearchSpinner, packageSearchDropdown, popularPackagesContainer, packagePreviewCard, previewPackageName, previewPackageVersion, previewPackageDescription, previewLoading, previewAddButton, validatorHeaderActions, validatorLoadingIndicator, validatorLoadingText, validatorTableContainer, validatorTableBody, validatorNotInstalledContainer, installValidatorButton, validatorInstalledContainer, runValidatorButton, modalBackdrop, modalSearch, modalResults, modalError, modalValueContainer, modalValueInput, modalValueSelect, modalValueHint, androidCountChip, iosCountChip, macosCountChip, macosTableBody, macosSearchInput, macosCategoryFilter, addMacosButton, androidDetailsSection, iosDetailsSection, androidDetailsGrid, iosDetailsGrid, androidSection, iosSection, macosSection, modalCancel, modalAdd, crossPlatformModalBackdrop, crossPlatformModalTitle, crossPlatformModalMessage, crossPlatformSuggestions, crossPlatformModalError, crossPlatformModalSkip, crossPlatformModalAdd, syncPermissionsButton, equivalentModalBackdrop, equivalentModalTitle, equivalentModalMessage, equivalentSuggestions, equivalentModalError, equivalentModalCancel, equivalentModalAdd, syncModalBackdrop, syncModalList, syncModalError, syncModalCancel, syncModalConfirm, deleteSafetyModalBackdrop, deleteSafetyCancel, deleteSafetyConfirm, addServiceButton, servicesContainer, serviceSearch, serviceModalBackdrop, serviceModalTitle, serviceModalContent, serviceModalError, serviceModalCancel, serviceModalSave, addServiceModalBackdrop, addServiceList, addServiceModalCancel, appNameDefault, appNameLangDropdown, appNameLangDropdownTrigger, appNameLangDropdownMenu, appNameLangSearch, appNameLangOptions, appNameLangList } from './elements.js';

import * as permissions from './permissions.js';
import * as services from './services.js';
import * as packages from './packages.js';
import * as localization from './localization.js';
import * as buildDetails from './build-details.js';
import * as utils from './utils.js';
import * as router from './router.js';

// Map module functions to globalThis so the top level code can access them.
Object.assign(window, permissions);
Object.assign(window, services);
Object.assign(window, packages);
Object.assign(window, localization);
Object.assign(window, buildDetails);
Object.assign(window, utils);
Object.assign(window, router);

// Also map the module namespaces themselves so qualified calls (like utils.foo()) work
window.permissions = permissions;
window.services = services;
window.packages = packages;
window.localization = localization;
window.buildDetails = buildDetails;
window.utils = utils;
window.router = router;
window.api = api;

  searchInput.addEventListener("input", (event) => {
    state.search = event.target.value;
    updateView();
  });

  iosSearchInput.addEventListener("input", (event) => {
    state.iosSearch = event.target.value;
    updateView();
  });

  categoryFilter.addEventListener("change", (event) => {
    state.category = event.target.value;
    updateView();
  });

  iosCategoryFilter.addEventListener("change", (event) => {
    state.iosCategory = event.target.value;
    updateView();
  });

  document.querySelectorAll("th[data-column]").forEach((th) => {
    th.addEventListener("click", () => {
      const column = th.dataset.column;
      if (state.sort.column === column) {
        state.sort.direction = state.sort.direction === "asc" ? "desc" : "asc";
      } else {
        state.sort.column = column;
        state.sort.direction = "asc";
      }
      updateView();
    });
  });

  addAndroidButton.addEventListener("click", () => {
    openModal("android");
    api.postMessage({ type: "requestAllAndroidPermissions" });
  });

  addIosButton.addEventListener("click", () => {
    openModal("ios");
    api.postMessage({ type: "requestAllIOSPermissions" });
  });

  // macOS event listeners
  if (macosSearchInput) {
    macosSearchInput.addEventListener("input", (event) => {
      state.macosSearch = event.target.value;
      updateView();
    });
  }
  if (macosCategoryFilter) {
    macosCategoryFilter.addEventListener("change", (event) => {
      state.macosCategory = event.target.value;
      updateView();
    });
  }
  if (addMacosButton) {
    addMacosButton.addEventListener("click", () => {
      openModal("macos");
      api.postMessage({ type: "requestAllIOSPermissions" });
    });
  }

  // Service event listeners
  if (addServiceButton) {
    addServiceButton.addEventListener("click", () => {
      api.postMessage({ type: "requestServices" });
      openAddServiceModal();
    });
  }
  if (serviceSearch) {
    serviceSearch.addEventListener("input", (event) => {
      state.serviceSearch = event.target.value;
      renderServices();
    });
  }
  if (serviceModalCancel) {
    serviceModalCancel.addEventListener("click", closeServiceModal);
  }
  if (serviceModalSave) {
    serviceModalSave.addEventListener("click", saveService);
  }
  if (addServiceModalCancel) {
    addServiceModalCancel.addEventListener("click", closeAddServiceModal);
  }

  if (saveAndroidBuildDetailsButton) {
    saveAndroidBuildDetailsButton.addEventListener("click", () => {
      handleSaveAndroidBuildDetails();
    });
  }

  if (saveIosBuildDetailsButton) {
    saveIosBuildDetailsButton.addEventListener("click", () => {
      handleSaveIosBuildDetails();
    });
  }

  // App Name event listeners
  if (appNameDefault) {
    appNameDefault.addEventListener("input", () => {
      state.appName.defaultName = appNameDefault.value.trim();
    });
  }
  if (appNameLangDropdownTrigger) {
    appNameLangDropdownTrigger.addEventListener("click", (e) => {
      e.stopPropagation();
      toggleAppNameLangDropdown();
    });
  }
  if (appNameLangSearch) {
    appNameLangSearch.addEventListener("input", () => {
      renderLanguageDropdown();
    });
  }
  // Close dropdown when clicking outside
  document.addEventListener("click", (e) => {
    if (appNameLangDropdown && !appNameLangDropdown.contains(e.target)) {
      closeAppNameLangDropdown();
    }
  });

  console.log("[PermissionManager] Initializing...");
  console.log("[PermissionManager] saveButton element:", saveButton);

  // Theme toggle button
  const themeToggleButton = document.createElement("button");
  themeToggleButton.id = "themeToggleButton";
  themeToggleButton.type = "button";
  themeToggleButton.className = "btn-toggle btn-secondary";
  themeToggleButton.textContent = "🌙"; // default shows moon for dark theme

  // Insert theme toggle into header-right if available
  const headerRight = document.querySelector('.header-right');
  if (headerRight) {
    headerRight.appendChild(themeToggleButton);
  }

  // Default to dark theme (no data-theme attr). If user has saved preference, apply it.
  (function loadTheme() {
    try {
      const saved = localStorage.getItem('permissionManagerTheme');
      if (saved === 'light') {
        document.documentElement.setAttribute('data-theme', 'light');
        themeToggleButton.textContent = '☀️';
      } else {
        document.documentElement.removeAttribute('data-theme');
        themeToggleButton.textContent = '🌙';
      }
    } catch (e) {
      // ignore
    }
  })();

  function toggleTheme() {
    const isLight = document.documentElement.getAttribute('data-theme') === 'light';
    if (isLight) {
      document.documentElement.removeAttribute('data-theme');
      themeToggleButton.textContent = '🌙';
      try {
        localStorage.setItem('permissionManagerTheme', 'dark');
      } catch (e) { }
    } else {
      document.documentElement.setAttribute('data-theme', 'light');
      themeToggleButton.textContent = '☀️';
      try {
        localStorage.setItem('permissionManagerTheme', 'light');
      } catch (e) { }
    }
  }

  themeToggleButton.addEventListener('click', toggleTheme);

  if (saveButton) {
    console.log("[PermissionManager] Adding click listener to save permissions button");
    saveButton.addEventListener("click", () => {
      console.log("[PermissionManager] Save permissions button clicked!");
      handleSavePermissions();
    });
  } else {
    console.error("[PermissionManager] saveButton not found!");
  }
  if (saveAllButton) {
    console.log("[PermissionManager] Adding click listener to save all button");
    saveAllButton.addEventListener("click", () => {
      console.log("[PermissionManager] Save all button clicked!");
      handleSaveAll();
    });
  }

  if (saveAppNameButton) {
    saveAppNameButton.addEventListener("click", () => {
      console.log("[PermissionManager] Save app name button clicked!");
      handleSaveAppName();
    });
  }

  if (saveServicesButton) {
    saveServicesButton.addEventListener("click", () => {
      console.log("[PermissionManager] Save services button clicked!");
      handleSaveServices();
    });
  }

  if (savePackageNamesButton) {
    savePackageNamesButton.addEventListener("click", () => {
      console.log("[PermissionManager] Save package names button clicked!");
      handleSavePackageNames();
    });
  }

  const migrateAndroidButton = document.getElementById("migrateAndroidButton");
  if (migrateAndroidButton) {
    migrateAndroidButton.addEventListener("click", () => {
      api.postMessage({ type: "migrateAndroid" });
    });
  }

  const upgradePackagesButton = document.getElementById("upgradePackagesButton");
  if (upgradePackagesButton) {
    upgradePackagesButton.addEventListener("click", () => {
      api.postMessage({ type: "upgradePackages" });
    });
  }

  if (refreshButton) {
    refreshButton.addEventListener("click", () => {
      api.postMessage({ type: "refresh" });
    });
  }
  if (syncPermissionsButton) {
    syncPermissionsButton.addEventListener("click", syncEquivalents);
  }

  function handleSaveAll() {
    console.log("[PermissionManager] handleSaveAll called");
    // Fire the individual save handlers in sequence
    try {
      handleSavePlatformDetails();
    } catch (e) {
      console.error('Error saving build details', e);
    }
    try {
      handleSavePermissions();
    } catch (e) {
      console.error('Error saving permissions', e);
    }
    try {
      handleSaveServices();
    } catch (e) {
      console.error('Error saving services', e);
    }
    try {
      handleSaveAppName();
    } catch (e) {
      console.error('Error saving app name', e);
    }
  }

  modalCancel.addEventListener("click", closeModal);
  modalAdd.addEventListener("click", addSelectedPermission);
  modalSearch.addEventListener("input", (event) => {
    state.modalQuery = event.target.value;
    renderModalResults();
  });

  crossPlatformModalSkip.addEventListener("click", () => {
    // Validate the permission first before closing anything
    const isIos = state.modalMode === "ios";

    if (isIos) {
      const selected = state.modalSelection;
      const type = (selected?.type || "").toLowerCase();
      if (type !== "boolean") {
        const value = modalValueInput.value.trim();
        if (!value || value === "TODO: Provide usage description.") {
          // Just close the cross-platform modal and show error, keep main modal open
          closeCrossPlatformModal();
          showToast(
            "Please provide a valid usage description for this iOS permission.",
            "error",
          );
          modalValueInput.focus();
          return;
        }
      }
    }

    closeCrossPlatformModal();
    try {
      addPermissionDirectly(state.modalSelection, isIos);
      closeModal();
      updateView();
    } catch (error) {
      // If there's an error, show it but keep the main modal open
      showToast(error.message, "error");
    }
  });

  crossPlatformModalAdd.addEventListener("click", addCrossPlatformPermissions);

  equivalentModalCancel.addEventListener("click", closeEquivalentModal);
  equivalentModalAdd.addEventListener("click", addEquivalentPermissions);
  
  function confirmSync() {
    api.postMessage({
      type: "savePermissions",
      androidPermissions: state.androidPermissions,
      iosPermissions: state.iosPermissions,
      macosPermissions: state.macosPermissions,
    });
    closeSyncModal();
  }

  if (syncModalCancel) {
    syncModalCancel.addEventListener("click", closeSyncModal);
  }
  if (syncModalConfirm) {
    syncModalConfirm.addEventListener("click", confirmSync);
  }

  let hasAnalyzedPackages = false;

  // Packages Render and Listeners
  function renderPackagesTable() {
    if (!packagesTableBody) {return;}
    packagesTableBody.innerHTML = "";

    if (!state.packages || state.packages.length === 0) {
      const row = document.createElement("tr");
      const cell = document.createElement("td");
      cell.colSpan = 6;
      cell.className = "empty-state";
      cell.textContent = "No packages analyzed or no outdated packages found.";
      row.appendChild(cell);
      packagesTableBody.appendChild(row);
      return;
    }

    // Sort by kind: direct, dev, transitive
    const kindOrder = { "direct": 0, "dev": 1, "transitive": 2 };
    const sortedPackages = [...state.packages].sort((a, b) => {
      const kindA = a.kind || "transitive";
      const kindB = b.kind || "transitive";
      if (kindOrder[kindA] !== kindOrder[kindB]) {
        return kindOrder[kindA] - kindOrder[kindB];
      }
      return a.package.localeCompare(b.package);
    });

    sortedPackages.forEach((pkg) => {
      // Filter out transitive if not toggled
      if (!state.showTransitive && pkg.kind === "transitive") {
        return;
      }

      // Only show outdated packages (upgradable > current or resolvable > current)
      const isOutdated = (pkg.upgradable?.version && pkg.current?.version && pkg.upgradable.version !== pkg.current.version) ||
                         (pkg.resolvable?.version && pkg.current?.version && pkg.resolvable.version !== pkg.current.version);
      
      if (!isOutdated) {
        return;
      }

      const row = document.createElement("tr");
      if (pkg.kind === "transitive") {
        row.className = "row-transitive";
      }

      // Package Name
      const nameCell = document.createElement("td");
      nameCell.textContent = pkg.package;
      row.appendChild(nameCell);

      // Type Badge
      const typeCell = document.createElement("td");
      const typeBadge = document.createElement("span");
      typeBadge.className = `package-type-badge type-${pkg.kind || "transitive"}`;
      typeBadge.textContent = pkg.kind || "transitive";
      typeCell.appendChild(typeBadge);
      row.appendChild(typeCell);

      // Current Version
      const currentCell = document.createElement("td");
      if (pkg.current?.version) {
        const badge = document.createElement("span");
        badge.className = "version-badge";
        badge.textContent = pkg.current.version;
        currentCell.appendChild(badge);
      } else {
        currentCell.textContent = "-";
      }
      row.appendChild(currentCell);

      // Upgradable Version
      const upgradableCell = document.createElement("td");
      if (pkg.upgradable?.version) {
        const badge = document.createElement("span");
        badge.className = "version-badge version-upgrade";
        badge.textContent = pkg.upgradable.version;
        upgradableCell.appendChild(badge);
      } else {
        upgradableCell.textContent = "-";
      }
      row.appendChild(upgradableCell);

      // Latest Version
      const latestCell = document.createElement("td");
      if (pkg.latest?.version) {
        const badge = document.createElement("span");
        badge.className = "version-badge";
        badge.textContent = pkg.latest.version;
        latestCell.appendChild(badge);
      } else {
        latestCell.textContent = "-";
      }
      row.appendChild(latestCell);

      // Action Button
      const actionCell = document.createElement("td");
      if (pkg.kind === "direct" || pkg.kind === "dev") {
        const upgradeBtn = document.createElement("button");
        upgradeBtn.className = "btn-upgrade-single";
        upgradeBtn.textContent = "Update";
        upgradeBtn.addEventListener("click", () => {
          if (packagesLoadingIndicator) {
            packagesLoadingIndicator.style.display = "block";
            packagesLoadingIndicator.querySelector("div").textContent = `Upgrading ${pkg.package}...`;
          }
          if (packagesTableContainer) {
            packagesTableContainer.style.display = "none";
          }
          api.postMessage({ type: "upgradeSinglePackage", packageName: pkg.package });
        });
        actionCell.appendChild(upgradeBtn);
      }
      row.appendChild(actionCell);

      packagesTableBody.appendChild(row);
    });

    // Check if body is empty after filtering
    if (packagesTableBody.children.length === 0) {
      const row = document.createElement("tr");
      const cell = document.createElement("td");
      cell.colSpan = 6;
      cell.className = "empty-state";
      cell.textContent = "All packages are up to date!";
      row.appendChild(cell);
      packagesTableBody.appendChild(row);
    }
  }

  if (analyzePackagesButton) {
    analyzePackagesButton.addEventListener("click", () => {
      if (packagesLoadingIndicator) {
        packagesLoadingIndicator.style.display = "block";
        packagesLoadingIndicator.querySelector("div").textContent = "Analyzing flutter packages (this may take a few moments)...";
      }
      if (packagesTableContainer) {
        packagesTableContainer.style.display = "none";
      }
      api.postMessage({ type: "requestPackagesAnalysis" });
    });
  }

  if (updateAllPackagesButton) {
    updateAllPackagesButton.addEventListener("click", () => {
      if (packagesLoadingIndicator) {
        packagesLoadingIndicator.style.display = "block";
        packagesLoadingIndicator.querySelector("div").textContent = "Upgrading all packages... Please wait.";
      }
      if (packagesTableContainer) {
        packagesTableContainer.style.display = "none";
      }
      api.postMessage({ type: "upgradePackages" });
    });
  }

  if (toggleTransitiveButton) {
    toggleTransitiveButton.addEventListener("click", () => {
      state.showTransitive = !state.showTransitive;
      toggleTransitiveButton.textContent = state.showTransitive ? "🙈 Hide Transitive" : "👁 Show Transitive";
      renderPackagesTable();
    });
  }

  // --- Search & Add Packages Logic ---
  
  const POPULAR_PACKAGES = [
    "bloc", "flutter_bloc", "dio", "get_it", 
    "shared_preferences", "cached_network_image", 
    "easy_localization", "provider", "freezed", "sqflite"
  ];

  let searchTimeout = null;
  let currentPreviewPackage = null;

  function renderPopularPackages() {
    if (!popularPackagesContainer) {return;}
    popularPackagesContainer.innerHTML = "";
    POPULAR_PACKAGES.forEach(pkg => {
      const chip = document.createElement("div");
      chip.className = "popular-chip";
      chip.textContent = pkg;
      chip.addEventListener("click", () => {
        packageSearchInput.value = pkg;
        packageSearchDropdown.style.display = "none";
        loadPackagePreview(pkg);
      });
      popularPackagesContainer.appendChild(chip);
    });
  }

  function loadPackagePreview(packageName) {
    currentPreviewPackage = packageName;
    packagePreviewCard.style.display = "block";
    previewPackageName.textContent = packageName;
    previewPackageVersion.textContent = "";
    previewPackageDescription.textContent = "";
    previewAddButton.style.display = "none";
    previewLoading.style.display = "block";

    api.postMessage({ type: "requestPackageDetails", packageName });
  }

  if (packageSearchInput) {
    packageSearchInput.addEventListener("input", (e) => {
      const query = e.target.value.trim();
      
      clearTimeout(searchTimeout);
      
      if (query.length < 2) {
        packageSearchDropdown.style.display = "none";
        packageSearchSpinner.style.display = "none";
        return;
      }

      packageSearchSpinner.style.display = "block";
      searchTimeout = setTimeout(() => {
        api.postMessage({ type: "searchPackages", query });
      }, 400); // 400ms debounce
    });

    // Close dropdown when clicking outside
    document.addEventListener("click", (e) => {
      if (!packageSearchInput.contains(e.target) && !packageSearchDropdown.contains(e.target)) {
        packageSearchDropdown.style.display = "none";
      }
    });
  }

  if (previewAddButton) {
    previewAddButton.addEventListener("click", () => {
      if (currentPreviewPackage) {
        if (packagesLoadingIndicator) {
          packagesLoadingIndicator.style.display = "block";
          packagesLoadingIndicator.querySelector("div").textContent = `Adding ${currentPreviewPackage}...`;
        }
        api.postMessage({ type: "addPackage", packageName: currentPreviewPackage });
        packagePreviewCard.style.display = "none";
        packageSearchInput.value = "";
      }
    });
  }

  renderPopularPackages();
  // -----------------------------------

  // --- Dependency Validator Logic ---
  let pendingDeletePackages = []; // Array of package names to delete

  function showDeleteSafetyModal(packages) {
    pendingDeletePackages = packages;
    if (deleteSafetyModalBackdrop) {
      deleteSafetyModalBackdrop.style.display = "flex";
    }
  }

  function hideDeleteSafetyModal() {
    pendingDeletePackages = [];
    if (deleteSafetyModalBackdrop) {
      deleteSafetyModalBackdrop.style.display = "none";
    }
  }

  if (deleteSafetyCancel) {deleteSafetyCancel.addEventListener("click", hideDeleteSafetyModal);}
  if (deleteSafetyConfirm) {
    deleteSafetyConfirm.addEventListener("click", () => {
      if (pendingDeletePackages.length > 0) {
        if (validatorLoadingIndicator) {
          validatorLoadingIndicator.style.display = "block";
          validatorLoadingText.textContent = `Removing ${pendingDeletePackages.length} package(s)...`;
        }
        if (validatorTableContainer) {validatorTableContainer.style.display = "none";}
        
        api.postMessage({ type: "removeAllFlaggedPackages", packages: pendingDeletePackages });
        hideDeleteSafetyModal();
      }
    });
  }

  if (installValidatorButton) {
    installValidatorButton.addEventListener("click", () => {
      if (validatorNotInstalledContainer) {validatorNotInstalledContainer.style.display = "none";}
      if (validatorLoadingIndicator) {
        validatorLoadingIndicator.style.display = "block";
        validatorLoadingText.textContent = "Installing dependency_validator... Please wait.";
      }
      api.postMessage({ type: "installDependencyValidator" });
    });
  }

  if (runValidatorButton) {
    runValidatorButton.addEventListener("click", () => {
      if (validatorInstalledContainer) {validatorInstalledContainer.style.display = "none";}
      if (validatorLoadingIndicator) {
        validatorLoadingIndicator.style.display = "block";
        validatorLoadingText.textContent = "Running dependency_validator...";
      }
      if (validatorTableContainer) {validatorTableContainer.style.display = "none";}
      api.postMessage({ type: "runDependencyValidator" });
    });
  }

  function renderValidatorHeaderActions() {
    if (!validatorHeaderActions) {return;}
    validatorHeaderActions.innerHTML = "";
    if (state.validatorState.isInstalled) {
      const runBtn = document.createElement("button");
      runBtn.type = "button";
      runBtn.className = "btn-secondary";
      runBtn.textContent = "🔍 Analyze Unused";
      runBtn.addEventListener("click", () => {
        if (validatorLoadingIndicator) {
          validatorLoadingIndicator.style.display = "block";
          validatorLoadingText.textContent = "Running dependency_validator...";
        }
        if (validatorTableContainer) {validatorTableContainer.style.display = "none";}
        api.postMessage({ type: "runDependencyValidator" });
      });
      validatorHeaderActions.appendChild(runBtn);

      if (state.validatorState.issues && state.validatorState.issues.length > 0) {
        const delAllBtn = document.createElement("button");
        delAllBtn.type = "button";
        delAllBtn.className = "btn-primary";
        delAllBtn.style.background = "#d32f2f";
        delAllBtn.style.borderColor = "#d32f2f";
        delAllBtn.style.color = "white";
        delAllBtn.textContent = "🗑 Delete All Flagged";
        delAllBtn.addEventListener("click", () => {
          const pkgs = state.validatorState.issues.map(i => i.package);
          showDeleteSafetyModal(pkgs);
        });
        validatorHeaderActions.appendChild(delAllBtn);
      }
    }
  }

  function renderValidatorTable() {
    if (!validatorTableBody || !validatorTableContainer) {return;}
    validatorTableBody.innerHTML = "";

    if (!state.validatorState.issues) {
      validatorTableContainer.style.display = "none";
      if (state.validatorState.isInstalled && validatorInstalledContainer) {
        validatorInstalledContainer.style.display = "block";
      } else if (validatorInstalledContainer) {
        validatorInstalledContainer.style.display = "none";
      }
      return;
    }

    if (validatorInstalledContainer) {
      validatorInstalledContainer.style.display = "none";
    }

    if (state.validatorState.issues.length === 0) {
      validatorTableContainer.style.display = "block";
      const tr = document.createElement("tr");
      const td = document.createElement("td");
      td.colSpan = 3;
      td.className = "empty-state";
      td.textContent = "No unused dependencies found! 🎉";
      tr.appendChild(td);
      validatorTableBody.appendChild(tr);
      return;
    }

    validatorTableContainer.style.display = "block";

    state.validatorState.issues.forEach(issue => {
      const tr = document.createElement("tr");

      // Package Name
      const tdName = document.createElement("td");
      tdName.textContent = issue.package;
      tr.appendChild(tdName);

      // Issue Type
      const tdType = document.createElement("td");
      const badge = document.createElement("span");
      badge.className = "issue-badge";
      if (issue.issueType === 'unused') {
        badge.textContent = "Unused";
        badge.classList.add("issue-unused");
      } else if (issue.issueType === 'downgrade') {
        badge.textContent = "Downgrade to Dev";
        badge.classList.add("issue-downgrade");
      } else {
        badge.textContent = "May be unused";
        badge.classList.add("issue-maybe");
      }
      tdType.appendChild(badge);
      tr.appendChild(tdType);

      // Action
      const tdAction = document.createElement("td");
      const btn = document.createElement("button");
      btn.className = "btn-upgrade-single";
      
      if (issue.issueType === 'downgrade') {
        btn.textContent = "Downgrade";
        btn.addEventListener("click", () => {
          if (validatorLoadingIndicator) {
            validatorLoadingIndicator.style.display = "block";
            validatorLoadingText.textContent = `Downgrading ${issue.package}...`;
          }
          if (validatorTableContainer) {validatorTableContainer.style.display = "none";}
          api.postMessage({ type: "downgradePackage", packageName: issue.package });
        });
      } else {
        btn.textContent = "Remove";
        btn.style.borderColor = "#d32f2f";
        btn.style.color = "#d32f2f";
        btn.addEventListener("click", () => {
          showDeleteSafetyModal([issue.package]);
        });
      }
      tdAction.appendChild(btn);
      tr.appendChild(tdAction);

      validatorTableBody.appendChild(tr);
    });
  }
  // -----------------------------------

  // Auto-refresh when the webview regains focus to pick up file changes
  window.addEventListener("focus", () => {
    scheduleRefresh();
  });

  
import { bus } from './bus.js';

bus.on("permissions", (message) => {
  state.hasAndroidManifest = message.hasAndroidManifest;
  state.hasIOSPlist = message.hasIOSPlist;
  state.hasMacOSPlist = message.hasMacOSPlist;
  
  if (message.hasAndroidManifest && !message.hasIOSPlist && !message.hasMacOSPlist) {
    state.modalMode = "android";
    if (androidDetailsSection) {androidDetailsSection.style.display = "block";}
    if (iosDetailsSection) {iosDetailsSection.style.display = "none";}
  } else if (!message.hasAndroidManifest && (message.hasIOSPlist || message.hasMacOSPlist)) {
    state.modalMode = message.hasIOSPlist ? "ios" : "macos";
    if (androidDetailsSection) {androidDetailsSection.style.display = "none";}
    if (iosDetailsSection) {iosDetailsSection.style.display = "block";}
  } else if (androidDetailsSection && iosDetailsSection) {
    androidDetailsSection.style.display = "block";
    iosDetailsSection.style.display = "block";
  }

  state.androidPermissions = message.androidPermissions || [];
  state.iosPermissions = message.iosPermissions || [];
  state.macosPermissions = message.macosPermissions || [];
  
  if (message.services) {
    state.services = message.services;
    renderServices();
  }
  
  if (message.availableServices) {
    state.availableServices = message.availableServices;
  }
  
  if (message.appName) {
    state.appName = message.appName;
    renderAppName();
  }

  if (message.platformDetails) {
    state.platformDetails = message.platformDetails;
    renderPlatformDetails();
  }

  if (message.languages) {
    state.languages = message.languages;
    renderLanguageDropdown();
  }

  updateView();
  
  if (androidSection) {androidSection.style.display = state.hasAndroidManifest ? "block" : "none";}
  if (iosSection) {iosSection.style.display = state.hasIOSPlist ? "block" : "none";}
  if (macosSection) {macosSection.style.display = state.hasMacOSPlist ? "block" : "none";}

  // Auto-run packages analysis on first load
  if (!hasAnalyzedPackages && analyzePackagesButton) {
    hasAnalyzedPackages = true;
    analyzePackagesButton.click();
    api.checkDependencyValidator();
  }
});

bus.on("allAndroidPermissions", (message) => {
  state.allAndroidPermissions = message.permissions || [];
  renderModalResults();
});

bus.on("allIOSPermissions", (message) => {
  state.allIosPermissions = message.permissions || [];
  renderModalResults();
  
  if (state.pendingCrossPlatformModal) {
    const { permission, platform } = state.pendingCrossPlatformModal;
    state.pendingCrossPlatformModal = null;
    showCrossPlatformModal(permission, platform);
  }
  
  if (state.pendingEquivalentModal && state.pendingEquivalentModal.targetPlatform === "ios") {
    const { permission, targetPlatform } = state.pendingEquivalentModal;
    state.pendingEquivalentModal = null;
    showEquivalentModal(permission, targetPlatform);
  }
});

bus.on("servicesConfig", (message) => {
  state.availableServices = message.services || [];
  renderServices();
});

bus.on("saveResult", (message) => {
  setStatus(message.message || "", message.success ? "success" : "error");
  if (packagesLoadingIndicator) {
    packagesLoadingIndicator.style.display = "none";
  }
  if (message.success && message.message && message.message.includes("migrated to declarative plugins")) {
    handleSaveAll();
  }
});

bus.on("packagesAnalysisResult", (message) => {
  if (packagesLoadingIndicator) {packagesLoadingIndicator.style.display = "none";}
  if (packagesTableContainer) {packagesTableContainer.style.display = "block";}
  if (message.error) {
    if (message.error.includes("the current project is not a flutter project")) {
      setStatus(message.error, "error");
    } else {
      setStatus(`Package analysis failed: ${message.error}`, "error");
    }
    state.packages = [];
  } else {
    state.packages = message.packages || [];
  }
  renderPackagesTable();
});

bus.on("searchPackagesResult", (message) => {
  if (packageSearchSpinner) {packageSearchSpinner.style.display = "none";}
  if (packageSearchDropdown) {
    packageSearchDropdown.innerHTML = "";
    if (message.error || !message.packages || message.packages.length === 0) {
      packageSearchDropdown.style.display = "none";
    } else {
      message.packages.forEach(pkg => {
        const li = document.createElement("li");
        li.className = "typeahead-item";
        li.textContent = pkg;
        li.addEventListener("click", () => {
          packageSearchInput.value = pkg;
          packageSearchDropdown.style.display = "none";
          loadPackagePreview(pkg);
        });
        packageSearchDropdown.appendChild(li);
      });
      packageSearchDropdown.style.display = "block";
    }
  }
});

bus.on("packageDetailsResult", (message) => {
  if (currentPreviewPackage === message.packageName) {
    if (previewLoading) {previewLoading.style.display = "none";}
    if (message.error) {
      if (previewPackageDescription) {previewPackageDescription.textContent = `Error: ${message.error}`;}
    } else {
      if (previewPackageVersion) {previewPackageVersion.textContent = message.latestVersion || "Unknown";}
      if (previewPackageDescription) {previewPackageDescription.textContent = message.description || "No description provided.";}
      if (previewAddButton) {previewAddButton.style.display = "inline-block";}
    }
  }
});

bus.on("dependencyValidatorState", (message) => {
  if (validatorLoadingIndicator) {validatorLoadingIndicator.style.display = "none";}
  state.validatorState.isInstalled = message.isInstalled;
  if (message.isInstalled) {
    if (validatorNotInstalledContainer) {validatorNotInstalledContainer.style.display = "none";}
    if (!state.validatorState.issues && validatorInstalledContainer) {
      validatorInstalledContainer.style.display = "block";
    }
  } else {
    if (validatorNotInstalledContainer) {validatorNotInstalledContainer.style.display = "block";}
    if (validatorTableContainer) {validatorTableContainer.style.display = "none";}
    if (validatorInstalledContainer) {validatorInstalledContainer.style.display = "none";}
  }
  renderValidatorHeaderActions();
});

bus.on("dependencyValidationResult", (message) => {
  if (validatorLoadingIndicator) {validatorLoadingIndicator.style.display = "none";}
  if (validatorInstalledContainer) {validatorInstalledContainer.style.display = "none";}
  if (message.error) {
    setStatus(`Dependency validator error: ${message.error}`, "error");
  } else {
    state.validatorState.issues = message.issues || [];
    renderValidatorTable();
  }
  renderValidatorHeaderActions();
});

api.sendReady();
