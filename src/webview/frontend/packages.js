import { state, getState, setState, on } from './state.js';
import * as api from './api.js';
import { androidTableBody, iosTableBody, searchInput, categoryFilter, addAndroidButton, addIosButton, saveAndroidBuildDetailsButton, saveIosBuildDetailsButton, iosSearchInput, iosCategoryFilter, saveButton, saveAppNameButton, saveServicesButton, savePackageNamesButton, saveAllButton, statusMessage, toastContainer, refreshButton, androidPackageNameInput, iosBundleIdentifierInput, analyzePackagesButton, updateAllPackagesButton, toggleTransitiveButton, packagesLoadingIndicator, packagesTableContainer, packagesTableBody, packageSearchInput, packageSearchSpinner, packageSearchDropdown, popularPackagesContainer, packagePreviewCard, previewPackageName, previewPackageVersion, previewPackageDescription, previewLoading, previewAddButton, validatorHeaderActions, validatorLoadingIndicator, validatorLoadingText, validatorTableContainer, validatorTableBody, validatorNotInstalledContainer, installValidatorButton, modalBackdrop, modalSearch, modalResults, modalError, modalValueContainer, modalValueInput, modalValueSelect, modalValueHint, androidCountChip, iosCountChip, macosCountChip, macosTableBody, macosSearchInput, macosCategoryFilter, addMacosButton, androidDetailsSection, iosDetailsSection, androidDetailsGrid, iosDetailsGrid, androidSection, iosSection, macosSection, modalCancel, modalAdd, crossPlatformModalBackdrop, crossPlatformModalTitle, crossPlatformModalMessage, crossPlatformSuggestions, crossPlatformModalError, crossPlatformModalSkip, crossPlatformModalAdd, syncPermissionsButton, equivalentModalBackdrop, equivalentModalTitle, equivalentModalMessage, equivalentSuggestions, equivalentModalError, equivalentModalCancel, equivalentModalAdd, syncModalBackdrop, syncModalList, syncModalError, syncModalCancel, syncModalConfirm, deleteSafetyModalBackdrop, deleteSafetyCancel, deleteSafetyConfirm, addServiceButton, servicesContainer, serviceSearch, serviceModalBackdrop, serviceModalTitle, serviceModalContent, serviceModalError, serviceModalCancel, serviceModalSave, addServiceModalBackdrop, addServiceList, addServiceModalCancel, appNameDefault, appNameLangDropdown, appNameLangDropdownTrigger, appNameLangDropdownMenu, appNameLangSearch, appNameLangOptions, appNameLangList } from './elements.js';

export function handleSavePackageNames() {
    const applicationId = androidPackageNameInput.value.trim();
    const bundleIdentifier = iosBundleIdentifierInput.value.trim();

    if (!applicationId && !bundleIdentifier) {
      showToast("Please enter at least one package name", "error");
      return;
    }

    showToast("Saving package names...", "info");

    api.postMessage({
      type: "savePackageNames",
      applicationId,
      bundleIdentifier,
    });
  }

export function renderPackagesTable() {
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

export function renderPopularPackages() {
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

export function loadPackagePreview(packageName) {
    currentPreviewPackage = packageName;
    packagePreviewCard.style.display = "block";
    previewPackageName.textContent = packageName;
    previewPackageVersion.textContent = "";
    previewPackageDescription.textContent = "";
    previewAddButton.style.display = "none";
    previewLoading.style.display = "block";

    api.postMessage({ type: "requestPackageDetails", packageName });
  }

export function renderValidatorHeaderActions() {
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

export function renderValidatorTable() {
    if (!validatorTableBody || !validatorTableContainer) {return;}
    validatorTableBody.innerHTML = "";

    if (!state.validatorState.issues) {
      validatorTableContainer.style.display = "none";
      return;
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

