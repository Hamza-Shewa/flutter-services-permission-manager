import { state, getState, setState, on } from './state.js';
import * as api from './api.js';
import { androidTableBody, iosTableBody, searchInput, categoryFilter, addAndroidButton, addIosButton, saveAndroidBuildDetailsButton, saveIosBuildDetailsButton, iosSearchInput, iosCategoryFilter, saveButton, saveAppNameButton, saveServicesButton, savePackageNamesButton, saveAllButton, statusMessage, toastContainer, refreshButton, androidPackageNameInput, iosBundleIdentifierInput, analyzePackagesButton, updateAllPackagesButton, toggleTransitiveButton, packagesLoadingIndicator, packagesTableContainer, packagesTableBody, packageSearchInput, packageSearchSpinner, packageSearchDropdown, popularPackagesContainer, packagePreviewCard, previewPackageName, previewPackageVersion, previewPackageDescription, previewLoading, previewAddButton, validatorHeaderActions, validatorLoadingIndicator, validatorLoadingText, validatorTableContainer, validatorTableBody, validatorNotInstalledContainer, installValidatorButton, modalBackdrop, modalSearch, modalResults, modalError, modalValueContainer, modalValueInput, modalValueSelect, modalValueHint, androidCountChip, iosCountChip, macosCountChip, macosTableBody, macosSearchInput, macosCategoryFilter, addMacosButton, androidDetailsSection, iosDetailsSection, androidDetailsGrid, iosDetailsGrid, androidSection, iosSection, macosSection, modalCancel, modalAdd, crossPlatformModalBackdrop, crossPlatformModalTitle, crossPlatformModalMessage, crossPlatformSuggestions, crossPlatformModalError, crossPlatformModalSkip, crossPlatformModalAdd, syncPermissionsButton, equivalentModalBackdrop, equivalentModalTitle, equivalentModalMessage, equivalentSuggestions, equivalentModalError, equivalentModalCancel, equivalentModalAdd, syncModalBackdrop, syncModalList, syncModalError, syncModalCancel, syncModalConfirm, deleteSafetyModalBackdrop, deleteSafetyCancel, deleteSafetyConfirm, addServiceButton, servicesContainer, serviceSearch, serviceModalBackdrop, serviceModalTitle, serviceModalContent, serviceModalError, serviceModalCancel, serviceModalSave, addServiceModalBackdrop, addServiceList, addServiceModalCancel, appNameDefault, appNameLangDropdown, appNameLangDropdownTrigger, appNameLangDropdownMenu, appNameLangSearch, appNameLangOptions, appNameLangList } from './elements.js';

export function renderAndroidTable() {
    const uniquePermissions = utils.dedupePermissions(state.androidPermissions);
    const filtered = utils.filterPermissions(
      uniquePermissions,
      state.search,
      state.category,
    );
    const sorted = utils.sortPermissions(
      filtered,
      state.sort.column,
      state.sort.direction,
    );

    androidTableBody.innerHTML = "";
    if (sorted.length === 0) {
      const row = document.createElement("tr");
      const cell = document.createElement("td");
      cell.colSpan = 6;
      cell.className = "empty-state";
      cell.textContent = "No permissions found.";
      row.appendChild(cell);
      androidTableBody.appendChild(row);
      return;
    }

    sorted.forEach((permission, index) => {
      const row = document.createElement("tr");

      // Permission cell with equivalent button
      const permissionCell = document.createElement("td");
      const permissionText = document.createElement("span");
      permissionText.textContent = permission.permission || "";
      permissionCell.appendChild(permissionText);

      if (
        permission.equivalentIosPermissions &&
        permission.equivalentIosPermissions.length > 0
      ) {
        const equivalentButton = document.createElement("button");
        equivalentButton.className = "equivalent-button";
        equivalentButton.textContent = "Add equivalent";
        equivalentButton.addEventListener("click", () => {
          showEquivalentModal(permission, "ios");
        });
        permissionCell.appendChild(equivalentButton);
      }
      row.appendChild(permissionCell);

      // Other cells
      const otherCells = [
        permission.description || "",
        permission.constantValue || "",
        permission.category || "",
        permission.apiLevel || "",
      ];
      otherCells.forEach((value) => {
        const cell = document.createElement("td");
        cell.textContent = value;
        row.appendChild(cell);
      });

      // Add delete button
      const actionsCell = document.createElement("td");
      const deleteButton = document.createElement("button");
      deleteButton.className = "delete-button";
      deleteButton.textContent = "Delete";
      deleteButton.addEventListener("click", () => {
        state.androidPermissions.splice(
          state.androidPermissions.indexOf(permission),
          1,
        );
        updateView();
      });
      actionsCell.appendChild(deleteButton);
      row.appendChild(actionsCell);

      androidTableBody.appendChild(row);
    });
  }

export function renderIOSTable() {
    iosTableBody.innerHTML = "";
    const filtered = utils.filterPermissions(
      state.iosPermissions || [],
      state.iosSearch,
      state.iosCategory,
    );
    if (!filtered || filtered.length === 0) {
      const row = document.createElement("tr");
      const cell = document.createElement("td");
      cell.colSpan = 5;
      cell.className = "empty-state";
      cell.textContent = "No permissions found.";
      row.appendChild(cell);
      iosTableBody.appendChild(row);
      return;
    }
    filtered.forEach((permission) => {
      const index = state.iosPermissions.indexOf(permission);
      const row = document.createElement("tr");

      // Permission cell with equivalent button
      const permissionCell = document.createElement("td");
      const permissionText = document.createElement("span");
      permissionText.textContent = permission.permission || "";
      permissionCell.appendChild(permissionText);

      if (
        permission.equivalentAndroidPermissions &&
        permission.equivalentAndroidPermissions.length > 0
      ) {
        const equivalentButton = document.createElement("button");
        equivalentButton.className = "equivalent-button";
        equivalentButton.textContent = "Add equivalent";
        equivalentButton.addEventListener("click", () => {
          showEquivalentModal(permission, "android");
        });
        permissionCell.appendChild(equivalentButton);
      }
      row.appendChild(permissionCell);

      const valueCell = document.createElement("td");
      const type = (permission.type || "").toLowerCase();
      if (type === "boolean") {
        const select = document.createElement("select");
        select.innerHTML =
          '<option value="true">true</option><option value="false">false</option>';
        select.value = String(Boolean(permission.value));
        select.addEventListener("change", (event) => {
          const target = event.target;
          state.iosPermissions[index].value = target.value === "true";
        });
        valueCell.appendChild(select);
      } else {
        const textarea = document.createElement("textarea");
        textarea.placeholder = "Usage description";
        textarea.value =
          typeof permission.value === "string" ? permission.value : "";
        textarea.addEventListener("input", (event) => {
          const target = event.target;
          state.iosPermissions[index].value = target.value;
        });
        valueCell.appendChild(textarea);
      }
      row.appendChild(valueCell);

      const descriptionCell = document.createElement("td");
      descriptionCell.textContent = permission.description || "";
      row.appendChild(descriptionCell);

      const categoryCell = document.createElement("td");
      categoryCell.textContent = permission.category || "";
      row.appendChild(categoryCell);

      // Add delete button
      const actionsCell = document.createElement("td");
      const deleteButton = document.createElement("button");
      deleteButton.className = "delete-button";
      deleteButton.textContent = "Delete";
      deleteButton.addEventListener("click", () => {
        state.iosPermissions.splice(index, 1);
        updateView();
      });
      actionsCell.appendChild(deleteButton);
      row.appendChild(actionsCell);

      iosTableBody.appendChild(row);
    });
  }

export function renderCategoryOptions() {
    const categoryFilter = document.getElementById("categoryFilter");
    const categories = Array.from(
      new Set(
        state.androidPermissions
          .map((permission) => permission.category)
          .filter(Boolean),
      ),
    ).sort();
    const current = categoryFilter.value;
    categoryFilter.innerHTML = '<option value="">All categories</option>';
    categories.forEach((category) => {
      const option = document.createElement("option");
      option.value = category;
      option.textContent = category;
      categoryFilter.appendChild(option);
    });
    categoryFilter.value = current;
  }

export function renderIOSCategoryOptions() {
    const iosCategoryFilter = document.getElementById("iosCategoryFilter");
    const categories = Array.from(
      new Set(
        (state.iosPermissions || [])
          .map((permission) => permission.category)
          .filter(Boolean),
      ),
    ).sort();
    const current = iosCategoryFilter.value;
    iosCategoryFilter.innerHTML = '<option value="">All categories</option>';
    categories.forEach((category) => {
      const option = document.createElement("option");
      option.value = category;
      option.textContent = category;
      iosCategoryFilter.appendChild(option);
    });
    iosCategoryFilter.value = current;
  }

export function renderMacOSCategoryOptions() {
    if (!macosCategoryFilter) {return;}
    const categories = Array.from(
      new Set(
        (state.macosPermissions || [])
          .map((permission) => permission.category)
          .filter(Boolean),
      ),
    ).sort();
    const current = macosCategoryFilter.value;
    macosCategoryFilter.innerHTML = '<option value="">All categories</option>';
    categories.forEach((category) => {
      const option = document.createElement("option");
      option.value = category;
      option.textContent = category;
      macosCategoryFilter.appendChild(option);
    });
    macosCategoryFilter.value = current;
  }

export function renderMacOSTable() {
    if (!macosTableBody) {return;}
    macosTableBody.innerHTML = "";
    const filtered = utils.filterPermissions(
      state.macosPermissions || [],
      state.macosSearch,
      state.macosCategory,
    );
    if (!filtered || filtered.length === 0) {
      const row = document.createElement("tr");
      const cell = document.createElement("td");
      cell.colSpan = 5;
      cell.className = "empty-state";
      cell.textContent = "No permissions found.";
      row.appendChild(cell);
      macosTableBody.appendChild(row);
      return;
    }
    filtered.forEach((permission) => {
      const index = state.macosPermissions.indexOf(permission);
      const row = document.createElement("tr");

      // Permission cell
      const permissionCell = document.createElement("td");
      const permissionText = document.createElement("span");
      permissionText.textContent = permission.permission || "";
      permissionCell.appendChild(permissionText);
      row.appendChild(permissionCell);

      // Value cell
      const valueCell = document.createElement("td");
      const type = (permission.type || "").toLowerCase();
      if (type === "boolean") {
        const select = document.createElement("select");
        select.innerHTML =
          '<option value="true">true</option><option value="false">false</option>';
        select.value = String(Boolean(permission.value));
        select.addEventListener("change", (event) => {
          const target = event.target;
          state.macosPermissions[index].value = target.value === "true";
        });
        valueCell.appendChild(select);
      } else {
        const textarea = document.createElement("textarea");
        textarea.placeholder = "Usage description";
        textarea.value =
          typeof permission.value === "string" ? permission.value : "";
        textarea.addEventListener("input", (event) => {
          const target = event.target;
          state.macosPermissions[index].value = target.value;
        });
        valueCell.appendChild(textarea);
      }
      row.appendChild(valueCell);

      // Description cell
      const descriptionCell = document.createElement("td");
      descriptionCell.textContent = permission.description || "";
      row.appendChild(descriptionCell);

      // Category cell
      const categoryCell = document.createElement("td");
      categoryCell.textContent = permission.category || "";
      row.appendChild(categoryCell);

      // Actions cell with delete button
      const actionsCell = document.createElement("td");
      const deleteButton = document.createElement("button");
      deleteButton.className = "delete-button";
      deleteButton.textContent = "Delete";
      deleteButton.addEventListener("click", () => {
        state.macosPermissions.splice(index, 1);
        updateView();
      });
      actionsCell.appendChild(deleteButton);
      row.appendChild(actionsCell);

      macosTableBody.appendChild(row);
    });
  }

export function renderDetailCards(container, details, emptyMessage, sectionName) {
    if (!container) {return;}

    if (!details || details.length === 0) {
      container.innerHTML = `
        <div class="detail-empty">${escapeHtml(emptyMessage)}</div>
      `;
      return;
    }

    container.innerHTML = details
      .map((detail) => `
        <article class="detail-card" data-detail-key="${escapeHtml(detail.key)}">
          <div class="detail-card-label">${escapeHtml(detail.label)}</div>
          ${detail.editable !== false
          ? `<input class="detail-card-input" data-section="${escapeHtml(sectionName)}" data-key="${escapeHtml(detail.key)}" type="text" value="${escapeHtml(normalizeBuildDetailValue(detail.key, detail.value))}" />`
          : `<div class="detail-card-readonly">${escapeHtml(detail.value)}</div>`}
          ${detail.source ? `<div class="detail-card-source">${escapeHtml(detail.source)}</div>` : ""}
        </article>
      `)
      .join("");

    container.querySelectorAll(".detail-card-input").forEach((input) => {
      input.addEventListener("input", (event) => {
        const target = event.target;
        updatePlatformDetailValue(
          target.dataset.section,
          target.dataset.key,
          target.value,
        );
      });
    });
  }

export function renderModalCategoryTabs() {
    const modalCategoryTabs = document.getElementById("modalCategoryTabs");
    const isIos = state.modalMode === "ios";
    const sourceList = isIos
      ? state.allIosPermissions
      : state.allAndroidPermissions;
    const categories = Array.from(
      new Set(
        sourceList.map((permission) => permission.category).filter(Boolean),
      ),
    ).sort();

    modalCategoryTabs.innerHTML = "";

    // Create "All" tab
    const allTab = document.createElement("button");
    allTab.className = "category-tab active";
    allTab.dataset.category = "";
    allTab.textContent = "All";
    allTab.addEventListener("click", () => {
      modalCategoryTabs
        .querySelectorAll(".category-tab")
        .forEach((t) => t.classList.remove("active"));
      allTab.classList.add("active");
      state.modalCategory = "";
      renderModalResults();
    });
    modalCategoryTabs.appendChild(allTab);

    categories.forEach((category) => {
      const tab = document.createElement("button");
      tab.className = "category-tab";
      tab.dataset.category = category;
      tab.textContent = category;
      tab.addEventListener("click", () => {
        // Update active tab
        modalCategoryTabs
          .querySelectorAll(".category-tab")
          .forEach((t) => t.classList.remove("active"));
        tab.classList.add("active");
        // Update modal filter
        state.modalCategory = category;
        renderModalResults();
      });
      modalCategoryTabs.appendChild(tab);
    });
  }

export function applySortIndicator() {
    document.querySelectorAll("th[data-column]").forEach((th) => {
      th.classList.remove("sort-asc", "sort-desc");
      if (th.dataset.column === state.sort.column) {
        th.classList.add(
          state.sort.direction === "asc" ? "sort-asc" : "sort-desc",
        );
      }
    });
  }

export function updateView() {
    renderCategoryOptions();
    renderIOSCategoryOptions();
    renderMacOSCategoryOptions();
    renderAndroidTable();
    renderIOSTable();
    renderMacOSTable();
    renderPlatformDetails();
    applySortIndicator();
    updateCounts();
    updateSectionVisibility();
  }

export function updateSectionVisibility() {
    const hasAndroidDetails = (state.platformDetails?.android || []).length > 0;
    const hasIOSDetails = (state.platformDetails?.ios || []).length > 0;

    if (androidDetailsSection) {
      androidDetailsSection.style.display = state.hasAndroidManifest || hasAndroidDetails ? "" : "none";
    }
    if (iosDetailsSection) {
      iosDetailsSection.style.display = state.hasIOSPlist || hasIOSDetails ? "" : "none";
    }
    if (androidSection) {
      androidSection.style.display = state.hasAndroidManifest ? "" : "none";
    }
    if (iosSection) {
      iosSection.style.display = state.hasIOSPlist ? "" : "none";
    }
    if (macosSection) {
      macosSection.style.display = state.hasMacOSPlist ? "" : "none";
    }
    if (androidCountChip) {
      androidCountChip.style.display = state.hasAndroidManifest ? "" : "none";
    }
    if (iosCountChip) {
      iosCountChip.style.display = state.hasIOSPlist ? "" : "none";
    }
    if (macosCountChip) {
      macosCountChip.style.display = state.hasMacOSPlist ? "" : "none";
    }
  }

export function findAndroidEquivalent(iosPermissionName) {
    return state.allAndroidPermissions.find(
      (p) =>
        (p.constantValue &&
          utils.normalizeText(p.constantValue) ===
          utils.normalizeText(iosPermissionName)) ||
        utils.normalizeText(p.permission) ===
        utils.normalizeText(iosPermissionName),
    );
  }

export function findIOSEquivalent(androidPermissionName) {
    return state.allIosPermissions.find(
      (p) =>
        utils.normalizeText(p.permission) ===
        utils.normalizeText(androidPermissionName),
    );
  }

export function buildSyncItems() {
    const items = [];
    const missing = [];

    state.iosPermissions.forEach((iosPerm) => {
      const equivalents = iosPerm.equivalentAndroidPermissions || [];
      equivalents.forEach((eq) => {
        const androidPerm = findAndroidEquivalent(eq);
        if (!androidPerm) {
          missing.push(
            `Missing Android equivalent for ${iosPerm.permission}: ${eq}`,
          );
          return;
        }
        const exists = state.androidPermissions.some(
          (p) =>
            utils.normalizeText(p.constantValue || p.permission) ===
            utils.normalizeText(
              androidPerm.constantValue || androidPerm.permission,
            ),
        );
        if (!exists) {
          items.push({
            sourcePlatform: "ios",
            targetPlatform: "android",
            sourceName: iosPerm.permission,
            target: androidPerm,
          });
        }
      });
    });

    state.androidPermissions.forEach((androidPerm) => {
      const equivalents = androidPerm.equivalentIosPermissions || [];
      equivalents.forEach((eq) => {
        const iosPerm = findIOSEquivalent(eq);
        if (!iosPerm) {
          missing.push(
            `Missing iOS equivalent for ${androidPerm.permission}: ${eq}`,
          );
          return;
        }
        const exists = state.iosPermissions.some(
          (p) =>
            utils.normalizeText(p.permission) ===
            utils.normalizeText(iosPerm.permission),
        );
        if (!exists) {
          items.push({
            sourcePlatform: "android",
            targetPlatform: "ios",
            sourceName: androidPerm.permission,
            target: iosPerm,
          });
        }
      });
    });

    return { items, missing };
  }

export function renderSyncModal() {
    syncModalList.innerHTML = "";
    syncModalError.textContent = "";

    const { items, missing } = buildSyncItems();
    // Cache items so confirmSync uses the exact same list
    state.syncItems = items;

    if (missing.length > 0) {
      syncModalError.textContent = missing.join(" | ");
      syncModalError.className = "status error";
    } else {
      syncModalError.textContent = "";
      syncModalError.className = "status";
    }

    if (items.length === 0) {
      const empty = document.createElement("div");
      empty.className = "empty-state";
      empty.textContent = "No new equivalents to sync.";
      syncModalList.appendChild(empty);
      return;
    }

    items.forEach((item, index) => {
      const wrapper = document.createElement("div");
      wrapper.className = "cross-platform-suggestion";

      const checkbox = document.createElement("input");
      checkbox.type = "checkbox";
      checkbox.id = `sync-item-${index}`;
      checkbox.checked = true;
      checkbox.dataset.index = String(index);

      const label = document.createElement("label");
      label.htmlFor = `sync-item-${index}`;
      label.textContent = `${item.sourcePlatform === "ios" ? "iOS" : "Android"} "${item.sourceName}" → ${item.targetPlatform === "ios" ? "iOS" : "Android"} "${item.target.permission || item.target.constantValue}"`;

      const row = document.createElement("div");
      row.className = "suggestion-row";
      row.appendChild(checkbox);
      row.appendChild(label);
      wrapper.appendChild(row);

      if (item.targetPlatform === "ios") {
        const type = (item.target.type || "").toLowerCase();
        if (type !== "boolean") {
          const valueInput = document.createElement("input");
          valueInput.type = "text";
          valueInput.placeholder = "Usage description (required)";
          valueInput.className = "equivalent-value-input";
          valueInput.id = `sync-input-${index}`;
          valueInput.required = true;
          valueInput.dataset.index = String(index);
          valueInput.addEventListener("focus", () => {
            checkbox.checked = true;
          });
          valueInput.addEventListener("input", () => {
            checkbox.checked = true;
          });
          wrapper.appendChild(valueInput);
        }
      }

      syncModalList.appendChild(wrapper);
    });

    syncModalBackdrop.style.display = "flex";
  }

export function closeSyncModal() {
    syncModalBackdrop.style.display = "none";
    syncModalList.innerHTML = "";
    syncModalError.textContent = "";
  }

export function confirmSync() {
    try {
      const items = state.syncItems || [];
      console.log("confirmSync: items processable", items.length);
      if (items.length === 0) {
        closeSyncModal();
        showToast("No equivalents to sync.", "info");
        return;
      }

      const suggestions = syncModalList.querySelectorAll(
        ".cross-platform-suggestion",
      );
      let addedCount = 0;
      const errors = [];
      const skippedExisting = [];

      suggestions.forEach((suggestion, idx) => {
        const checkbox = suggestion.querySelector('input[type="checkbox"]');
        if (!checkbox || !checkbox.checked) {
          return;
        }
        const itemIndex = Number(checkbox.dataset.index ?? idx);
        const item = items[itemIndex];
        if (!item) {
          console.error("Sync item not found for index:", itemIndex);
          return;
        }

        if (item.targetPlatform === "android") {
          const exists = state.androidPermissions.some(
            (p) =>
              utils.normalizeText(p.constantValue || p.permission) ===
              utils.normalizeText(
                item.target.constantValue || item.target.permission,
              ),
          );
          if (!exists) {
            state.androidPermissions = [
              ...state.androidPermissions,
              item.target,
            ];
            addedCount++;
          } else {
            skippedExisting.push(
              item.target.permission ||
              item.target.constantValue ||
              "Android permission",
            );
          }
        } else {
          const exists = state.iosPermissions.some(
            (p) =>
              utils.normalizeText(p.permission) ===
              utils.normalizeText(item.target.permission),
          );
          if (!exists) {
            // Find input by ID to ensures we get the exact input associated with this item index
            const input = document.getElementById(`sync-input-${itemIndex}`);
            const type = (item.target.type || "").toLowerCase();

            let value = type === "boolean" ? true : "";
            if (type !== "boolean") {
              value = input ? input.value.trim() : "";

              if (!value || value === "TODO: Provide usage description.") {
                if (input) {
                  input.style.borderColor = "var(--danger)";
                  input.addEventListener(
                    "input",
                    () => {
                      input.style.borderColor = "";
                    },
                    { once: true },
                  );
                }
                errors.push(item.target.permission);
                return;
              }
            }
            state.iosPermissions = [
              ...state.iosPermissions,
              { ...item.target, value },
            ];
            addedCount++;
          } else {
            skippedExisting.push(item.target.permission || "iOS permission");
          }
        }
      });

      if (errors.length > 0) {
        showToast(
          `Please provide usage descriptions for: ${errors.join(", ")}`,
          "error",
          5000,
        );
        return;
      }

      closeSyncModal();
      updateView();

      if (addedCount > 0) {
        showToast(
          `Synced ${addedCount} equivalent permission${addedCount > 1 ? "s" : ""}.`,
          "success",
        );
      } else {
        showToast("No permissions were added.", "info");
      }

      if (skippedExisting.length > 0) {
        showToast(
          `Skipped existing: ${skippedExisting.join(", ")}`,
          "info",
          5000,
        );
      }
    } catch (error) {
      console.error("Error in confirmSync:", error);
      showToast("Error syncing permissions: " + error.message, "error");
    }
  }

export function syncEquivalents() {
    // Ensure all permissions are loaded, queue modal until both arrive
    if (state.allAndroidPermissions.length === 0) {
      state.pendingSyncModal = true;
      api.postMessage({ type: "requestAllAndroidPermissions" });
    }
    if (state.allIosPermissions.length === 0) {
      state.pendingSyncModal = true;
      api.postMessage({ type: "requestAllIOSPermissions" });
    }

    if (
      state.allAndroidPermissions.length > 0 &&
      state.allIosPermissions.length > 0
    ) {
      state.pendingSyncModal = false;
      renderSyncModal();
    } else {
      showToast("Loading permissions, please try again in a moment.", "info");
    }
  }

export function tryOpenPendingSyncModal() {
    if (
      state.pendingSyncModal &&
      state.allAndroidPermissions.length > 0 &&
      state.allIosPermissions.length > 0
    ) {
      state.pendingSyncModal = false;
      renderSyncModal();
    }
  }

export function updateCounts() {
    const androidCount = utils.dedupePermissions(
      state.androidPermissions,
    ).length;
    const iosCount = state.iosPermissions ? state.iosPermissions.length : 0;
    const macosCount = state.macosPermissions
      ? state.macosPermissions.length
      : 0;
    if (androidCountChip)
      {androidCountChip.textContent = `Android: ${androidCount}`;}
    if (iosCountChip) {iosCountChip.textContent = `iOS: ${iosCount}`;}
    if (macosCountChip) {macosCountChip.textContent = `macOS: ${macosCount}`;}
  }

export function openModal(mode) {
    state.modalMode = mode;
    const modalTitle = document.getElementById("modalTitle");
    const isApplePlatform = mode === "ios" || mode === "macos";
    if (mode === "ios") {
      modalTitle.textContent = "Add iOS Permission";
    } else if (mode === "macos") {
      modalTitle.textContent = "Add macOS Permission";
    } else {
      modalTitle.textContent = "Add Android Permission";
    }
    modalBackdrop.style.display = "flex";
    modalSearch.value = "";
    modalError.textContent = "";
    state.modalQuery = "";
    state.modalSelection = null;
    state.modalCategory = "";
    modalValueInput.value = "";
    modalValueSelect.value = "true";
    modalValueContainer.style.display = isApplePlatform ? "block" : "none";
    modalValueInput.style.display = "block";
    modalValueSelect.style.display = "none";
    modalValueHint.textContent =
      "Provide a usage description required by Apple.";
    renderModalCategoryTabs();
    renderModalResults();
    modalSearch.focus();
  }

export function closeModal() {
    modalBackdrop.style.display = "none";
  }

export function renderModalResults() {
    modalResults.innerHTML = "";
    const isIos = state.modalMode === "ios";
    const isMacos = state.modalMode === "macos";
    const isApplePlatform = isIos || isMacos;

    let targetPermissions;
    if (isIos) {targetPermissions = state.iosPermissions;}
    else if (isMacos) {targetPermissions = state.macosPermissions;}
    else {targetPermissions = state.androidPermissions;}

    const usedKeys = new Set(
      targetPermissions.map((permission) =>
        utils.normalizeText(permission.permission || permission.constantValue),
      ),
    );
    const sourceList = isApplePlatform
      ? state.allIosPermissions
      : state.allAndroidPermissions;
    const filtered = utils.filterPermissions(
      sourceList,
      state.modalQuery,
      state.modalCategory,
    );
    const available = filtered.filter(
      (permission) =>
        !usedKeys.has(
          utils.normalizeText(
            permission.permission || permission.constantValue,
          ),
        ),
    );

    if (available.length === 0) {
      const empty = document.createElement("div");
      empty.className = "empty-state";
      empty.textContent = "No matching permissions.";
      modalResults.appendChild(empty);
      return;
    }

    available.forEach((permission) => {
      const item = document.createElement("div");
      item.className = "modal-item";
      const label = permission.permission || "";
      const suffix = permission.constantValue
        ? ` (${permission.constantValue})`
        : "";
      item.textContent = `${label}${suffix}`;
      item.addEventListener("click", () => {
        modalResults
          .querySelectorAll(".modal-item")
          .forEach((el) => el.classList.remove("selected"));
        item.classList.add("selected");
        state.modalSelection = permission;
        modalError.textContent = "";
        if (isIos) {
          const type = (permission.type || "").toLowerCase();
          if (type === "boolean") {
            modalValueInput.style.display = "none";
            modalValueSelect.style.display = "block";
            modalValueHint.textContent = "Select true or false for this key.";
          } else {
            modalValueInput.style.display = "block";
            modalValueSelect.style.display = "none";
            modalValueHint.textContent =
              "Provide a usage description required by Apple.";
          }
        }
      });
      modalResults.appendChild(item);
    });
  }

export function addSelectedPermission() {
    const validation = utils.validateSelection(state.modalSelection);
    if (!validation.valid) {
      modalError.textContent = validation.message;
      modalError.className = "status error";
      return;
    }

    const selected = state.modalSelection;
    const isIos = state.modalMode === "ios";
    const existing = (
      isIos ? state.iosPermissions : state.androidPermissions
    ).some(
      (permission) =>
        utils.normalizeText(
          permission.constantValue || permission.permission,
        ) ===
        utils.normalizeText(selected.constantValue || selected.permission),
    );

    if (existing) {
      modalError.textContent = "Permission already added.";
      modalError.className = "status error";
      return;
    }

    // Check for cross-platform equivalents
    const equivalents = isIos
      ? selected.equivalentAndroidPermissions
      : selected.equivalentIosPermissions;
    const hasCrossPlatformFile = isIos
      ? state.hasAndroidManifest
      : state.hasIOSPlist;

    if (equivalents && equivalents.length > 0 && hasCrossPlatformFile) {
      // Ensure we have the target platform permissions loaded
      if (!isIos && state.allIosPermissions.length === 0) {
        api.postMessage({ type: "requestAllIOSPermissions" });
      } else if (isIos && state.allAndroidPermissions.length === 0) {
        api.postMessage({ type: "requestAllAndroidPermissions" });
      }
      // Show cross-platform suggestion modal
      showCrossPlatformModal(selected, equivalents, isIos);
      return;
    }

    // No equivalents or no cross-platform file, add directly
    try {
      addPermissionDirectly(selected, isIos);
      closeModal();
      updateView();
    } catch (error) {
      modalError.textContent = error.message;
      modalError.className = "status error";
      showToast(error.message, "error");
    }
  }

export function addPermissionDirectly(selected, isIos) {
    // Check for duplicates
    let targetPermissions;
    const isMacos = state.modalMode === "macos";

    if (isIos) {targetPermissions = state.iosPermissions;}
    else if (isMacos) {targetPermissions = state.macosPermissions;}
    else {targetPermissions = state.androidPermissions;}

    const existing = targetPermissions.some(
      (permission) =>
        utils.normalizeText(
          permission.constantValue || permission.permission,
        ) ===
        utils.normalizeText(selected.constantValue || selected.permission),
    );

    if (existing) {
      throw new Error("Permission already added.");
    }

    if (isIos || isMacos) {
      const type = (selected.type || "").toLowerCase();
      let value;
      if (type === "boolean") {
        value = modalValueSelect.value === "true";
      } else {
        value = modalValueInput.value.trim();
        if (!value || value === "TODO: Provide usage description.") {
          throw new Error(
            `Please provide a valid usage description for this ${isIos ? "iOS" : "macOS"} permission.`,
          );
        }
      }
      if (isIos) {
        state.iosPermissions = [
          ...state.iosPermissions,
          { ...selected, value },
        ];
        showToast(
          `iOS permission "${selected.permission}" added successfully`,
          "success",
        );
      } else {
        state.macosPermissions = [
          ...state.macosPermissions,
          { ...selected, value },
        ];
        showToast(
          `macOS permission "${selected.permission}" added successfully`,
          "success",
        );
      }
    } else {
      state.androidPermissions = [...state.androidPermissions, selected];
      showToast(
        `Android permission "${selected.permission}" added successfully`,
        "success",
      );
    }
  }

export function showCrossPlatformModal(selected, equivalents, isSourceIos) {
    // Ensure target platform permissions are loaded
    const needsTargetPermissions = isSourceIos
      ? state.allAndroidPermissions.length === 0
      : state.allIosPermissions.length === 0;

    if (needsTargetPermissions) {
      // Load target permissions first
      const messageType = isSourceIos
        ? "requestAllAndroidPermissions"
        : "requestAllIOSPermissions";
      api.postMessage({ type: messageType });

      // Store the modal data and show modal after permissions load
      state.pendingCrossPlatformModal = { selected, equivalents, isSourceIos };
      return;
    }

    showCrossPlatformModalInternal(selected, equivalents, isSourceIos);
  }

export function showCrossPlatformModalInternal(selected, equivalents, isSourceIos) {
    state.pendingCrossPlatformPermissions = [];
    state.crossPlatformMode = isSourceIos ? "ios-to-android" : "android-to-ios";

    crossPlatformModalTitle.textContent = `Add ${isSourceIos ? "Android" : "iOS"} Equivalents`;
    crossPlatformModalMessage.textContent = `The ${isSourceIos ? "iOS" : "Android"} permission "${selected.permission || selected.constantValue}" has equivalent permissions on the other platform. Would you like to add them?`;

    crossPlatformSuggestions.innerHTML = "";

    equivalents.forEach((equivalent, index) => {
      const suggestionDiv = document.createElement("div");
      suggestionDiv.className = "cross-platform-suggestion";
      suggestionDiv.dataset.permissionName = equivalent; // Store permission name

      const checkbox = document.createElement("input");
      checkbox.type = "checkbox";
      checkbox.id = `equivalent-${index}`;
      checkbox.checked = true; // Default to checked

      const label = document.createElement("label");
      label.htmlFor = `equivalent-${index}`;
      label.textContent = equivalent;

      // For iOS permissions, add value input if needed
      let valueInput = null;
      if (isSourceIos) {
        // Adding Android equivalents, so no value input needed
        // Android permissions don't need values
      } else {
        // Adding iOS equivalents, may need values
        const iosPermission = state.allIosPermissions.find(
          (p) => p.permission === equivalent,
        );
        if (
          iosPermission &&
          (iosPermission.type || "").toLowerCase() !== "boolean"
        ) {
          valueInput = document.createElement("input");
          valueInput.type = "text";
          valueInput.placeholder = "Usage description (required)";
          valueInput.className = "equivalent-value-input";
          valueInput.required = true;
          valueInput.addEventListener("input", function () {
            this.style.borderColor = "";
          });
        }
      }

      suggestionDiv.appendChild(checkbox);
      suggestionDiv.appendChild(label);
      if (valueInput) {
        suggestionDiv.appendChild(valueInput);
      }

      crossPlatformSuggestions.appendChild(suggestionDiv);
    });

    crossPlatformModalBackdrop.style.display = "flex";
  }

export function addCrossPlatformPermissions() {
    const suggestions = crossPlatformSuggestions.querySelectorAll(
      ".cross-platform-suggestion",
    );
    const isSourceIos = state.crossPlatformMode === "ios-to-android";
    let addedCount = 0;
    const errors = [];

    suggestions.forEach((suggestion) => {
      const checkbox = suggestion.querySelector('input[type="checkbox"]');
      if (checkbox && checkbox.checked) {
        const permissionName = suggestion.dataset.permissionName;

        if (isSourceIos) {
          // Adding Android permission - check if it already exists
          const existing = state.androidPermissions.some(
            (permission) =>
              utils.normalizeText(
                permission.constantValue || permission.permission,
              ) === utils.normalizeText(permissionName),
          );
          if (!existing) {
            const androidPermission = state.allAndroidPermissions.find(
              (p) =>
                p.constantValue === permissionName ||
                p.permission === permissionName,
            );
            if (androidPermission) {
              state.androidPermissions = [
                ...state.androidPermissions,
                androidPermission,
              ];
              addedCount++;
            }
          }
        } else {
          // Adding iOS permission - check if it already exists
          const existing = state.iosPermissions.some(
            (permission) =>
              utils.normalizeText(permission.permission) ===
              utils.normalizeText(permissionName),
          );
          if (!existing) {
            const iosPermission = state.allIosPermissions.find(
              (p) => p.permission === permissionName,
            );
            if (iosPermission) {
              const valueInput = suggestion.querySelector(
                ".equivalent-value-input",
              );
              let value;
              const type = (iosPermission.type || "").toLowerCase();
              if (type === "boolean") {
                value = true; // Default to true for cross-platform adds
              } else {
                value = valueInput ? valueInput.value.trim() : "";
                if (!value || value === "TODO: Provide usage description.") {
                  if (valueInput)
                    {valueInput.style.borderColor = "var(--danger)";}
                  errors.push(permissionName);
                  return; // Skip this permission
                }
                if (valueInput) {valueInput.style.borderColor = "";}
              }
              state.iosPermissions = [
                ...state.iosPermissions,
                { ...iosPermission, value },
              ];
              addedCount++;
            }
          }
        }
      }
    });

    if (errors.length > 0) {
      showToast(
        `Please provide usage descriptions for: ${errors.join(", ")}`,
        "error",
        5000,
      );
      return; // Don't close modal
    }

    if (addedCount > 0) {
      const platform = isSourceIos ? "Android" : "iOS";
      showToast(
        `${addedCount} ${platform} equivalent permission${addedCount > 1 ? "s" : ""} added`,
        "success",
      );
    }

    closeCrossPlatformModal();
    try {
      addPermissionDirectly(state.modalSelection, state.modalMode === "ios");
      closeModal();
      updateView();
    } catch (error) {
      showToast(error.message, "error");
      return; // Don't close modal if there's an error
    }
    closeModal();
    updateView();
  }

export function closeCrossPlatformModal() {
    crossPlatformModalBackdrop.style.display = "none";
    state.pendingCrossPlatformPermissions = [];
    state.crossPlatformMode = null;
  }

export function showEquivalentModal(permission, targetPlatform) {
    const sourceList =
      targetPlatform === "ios"
        ? state.allIosPermissions
        : state.allAndroidPermissions;
    if (sourceList.length === 0) {
      // Request the permissions if not loaded
      const messageType =
        targetPlatform === "ios"
          ? "requestAllIOSPermissions"
          : "requestAllAndroidPermissions";
      api.postMessage({ type: messageType });
      state.pendingEquivalentModal = { permission, targetPlatform };
      return;
    }

    const equivalents =
      targetPlatform === "ios"
        ? permission.equivalentIosPermissions
        : permission.equivalentAndroidPermissions;
    if (!equivalents || equivalents.length === 0) {
      showToast("No equivalent permissions found for this permission.", "info");
      return;
    }
    const equivalentPermissions = equivalents
      .map((name) =>
        sourceList.find(
          (p) => p.permission === name || p.constantValue === name,
        ),
      )
      .filter(Boolean);

    // Compute available permissions (not already added)
    const availablePermissions = equivalentPermissions.filter((perm) => {
      const isAlreadyAdded =
        targetPlatform === "ios"
          ? state.iosPermissions.some((p) => p.permission === perm.permission)
          : state.androidPermissions.some(
            (p) => p.permission === perm.permission,
          );
      return !isAlreadyAdded;
    });

    // Check if all equivalents are already added
    if (availablePermissions.length === 0) {
      showToast("All equivalent permissions are already added.", "info");
      return;
    }

    const categories = Array.from(
      new Set(availablePermissions.map((p) => p.category).filter(Boolean)),
    ).sort();

    // Update modal title to indicate target platform
    equivalentModalTitle.textContent =
      targetPlatform === "ios"
        ? "Add Equivalent iOS Permissions"
        : "Add Equivalent Android Permissions";

    // Render category tabs
    const equivalentCategoryTabs = document.getElementById(
      "equivalentCategoryTabs",
    );
    equivalentCategoryTabs.innerHTML =
      '<button class="category-tab active" data-category="">All</button>';
    const allTab = equivalentCategoryTabs.querySelector(".category-tab");
    allTab.addEventListener("click", () => {
      equivalentCategoryTabs
        .querySelectorAll(".category-tab")
        .forEach((t) => t.classList.remove("active"));
      allTab.classList.add("active");
      renderEquivalentSuggestions(equivalentPermissions, targetPlatform, "");
    });
    categories.forEach((category) => {
      const tab = document.createElement("button");
      tab.className = "category-tab";
      tab.dataset.category = category;
      tab.textContent = category;
      tab.addEventListener("click", () => {
        equivalentCategoryTabs
          .querySelectorAll(".category-tab")
          .forEach((t) => t.classList.remove("active"));
        tab.classList.add("active");
        renderEquivalentSuggestions(
          equivalentPermissions,
          targetPlatform,
          category,
        );
      });
      equivalentCategoryTabs.appendChild(tab);
    });

    state.equivalentCategory = "";
    renderEquivalentSuggestions(equivalentPermissions, targetPlatform, "");

    equivalentModalError.textContent = "";
    equivalentModalBackdrop.style.display = "flex";
  }

export function renderEquivalentSuggestions(
    equivalentPermissions,
    targetPlatform,
    category,
  ) {
    equivalentSuggestions.innerHTML = "";
    state.equivalentPermissions = [];

    const filteredByCategory = category
      ? equivalentPermissions.filter((p) => p.category === category)
      : equivalentPermissions;
    const availablePermissions = filteredByCategory.filter((perm) => {
      const isAlreadyAdded =
        targetPlatform === "ios"
          ? state.iosPermissions.some((p) => p.permission === perm.permission)
          : state.androidPermissions.some(
            (p) => p.permission === perm.permission,
          );
      return !isAlreadyAdded;
    });

    if (availablePermissions.length === 0) {
      const messageDiv = document.createElement("div");
      messageDiv.textContent =
        "All equivalent permissions are already added to your project.";
      messageDiv.style.textAlign = "center";
      messageDiv.style.padding = "20px";
      messageDiv.style.color = "#666";
      messageDiv.style.fontStyle = "italic";
      equivalentSuggestions.appendChild(messageDiv);
      return;
    }

    availablePermissions.forEach((perm) => {
      const suggestionDiv = document.createElement("div");
      suggestionDiv.className = "cross-platform-suggestion";

      const contentDiv = document.createElement("div");
      contentDiv.className = "suggestion-content";

      const checkbox = document.createElement("input");
      checkbox.type = "checkbox";
      checkbox.dataset.permissionName = perm.permission;
      const checkboxId = `checkbox-${perm.permission.replace(/[^a-zA-Z0-9]/g, "-")}`;
      checkbox.id = checkboxId;

      const label = document.createElement("label");
      label.textContent = perm.permission;
      label.htmlFor = checkboxId;

      contentDiv.appendChild(checkbox);
      contentDiv.appendChild(label);
      suggestionDiv.appendChild(contentDiv);

      // Add value input for iOS permissions
      if (targetPlatform === "ios") {
        if ((perm.type || "").toLowerCase() !== "boolean") {
          const valueInput = document.createElement("input");
          valueInput.type = "text";
          valueInput.className = "equivalent-value-input";
          valueInput.placeholder = "Usage description (required)";
          valueInput.required = true;
          // Ensure interacting with the value marks the permission as selected
          valueInput.addEventListener("focus", () => {
            checkbox.checked = true;
          });
          valueInput.addEventListener("input", function () {
            checkbox.checked = true;
            this.style.borderColor = "";
          });
          suggestionDiv.appendChild(valueInput);
        }
      }

      equivalentSuggestions.appendChild(suggestionDiv);
    });
  }

export function closeEquivalentModal() {
    equivalentModalBackdrop.style.display = "none";
    state.equivalentPermissions = [];
  }

export function addEquivalentPermissions() {
    const suggestions = equivalentSuggestions.querySelectorAll(
      ".cross-platform-suggestion",
    );
    const targetPlatform = equivalentModalTitle.textContent.includes("iOS")
      ? "ios"
      : "android";
    let addedCount = 0;
    const errors = [];

    suggestions.forEach((suggestion) => {
      const checkbox = suggestion.querySelector('input[type="checkbox"]');
      if (checkbox && checkbox.checked) {
        const permissionName = checkbox.dataset.permissionName;

        if (targetPlatform === "ios") {
          // Adding iOS permission - check if it already exists
          const existing = state.iosPermissions.some(
            (permission) =>
              utils.normalizeText(permission.permission) ===
              utils.normalizeText(permissionName),
          );
          if (!existing) {
            const iosPermission = state.allIosPermissions.find(
              (p) => p.permission === permissionName,
            );
            if (iosPermission) {
              const valueInput = suggestion.querySelector(
                ".equivalent-value-input",
              );
              let value;
              const type = (iosPermission.type || "").toLowerCase();
              if (type === "boolean") {
                value = true; // Default to true for equivalent adds
              } else {
                value = valueInput ? valueInput.value.trim() : "";
                if (!value || value === "TODO: Provide usage description.") {
                  if (valueInput)
                    {valueInput.style.borderColor = "var(--danger)";}
                  errors.push(permissionName);
                  return; // Skip this permission
                }
                if (valueInput) {valueInput.style.borderColor = "";}
              }
              state.iosPermissions = [
                ...state.iosPermissions,
                { ...iosPermission, value },
              ];
              addedCount++;
            }
          }
        } else {
          // Adding Android permission - check if it already exists
          const existing = state.androidPermissions.some(
            (permission) =>
              utils.normalizeText(
                permission.constantValue || permission.permission,
              ) === utils.normalizeText(permissionName),
          );
          if (!existing) {
            const androidPermission = state.allAndroidPermissions.find(
              (p) =>
                p.constantValue === permissionName ||
                p.permission === permissionName,
            );
            if (androidPermission) {
              state.androidPermissions = [
                ...state.androidPermissions,
                androidPermission,
              ];
              addedCount++;
            }
          }
        }
      }
    });

    if (errors.length > 0) {
      showToast(
        `Please provide usage descriptions for: ${errors.join(", ")}`,
        "error",
        5000,
      );
      return; // Don't close modal
    }

    if (addedCount > 0) {
      showToast(
        `${addedCount} ${targetPlatform === "ios" ? "iOS" : "Android"} permission${addedCount > 1 ? "s" : ""} added successfully`,
        "success",
      );
    } else {
      showToast("No permissions were selected to add.", "error");
    }

    closeEquivalentModal();
    updateView();
  }

export function handleSavePermissions() {
    console.log("[PermissionManager] handleSavePermissions called");

    const androidPermissions = utils
      .dedupePermissions(state.androidPermissions)
      .map((permission) => permission.constantValue || permission.permission)
      .filter(Boolean);
    const iosPermissions = (state.iosPermissions || [])
      .map((permission) => ({
        permission: permission.permission,
        value: permission.value,
        type: permission.type,
      }))
      .filter((entry) => entry.permission);
    const macosPermissions = (state.macosPermissions || [])
      .map((permission) => ({
        permission: permission.permission,
        value: permission.value,
        type: permission.type,
      }))
      .filter((entry) => entry.permission);

    console.log("[PermissionManager] Posting savePermissions message");
    showToast("Saving permissions...", "info");

    api.postMessage({
      type: "savePermissions",
      androidPermissions: androidPermissions,
      iosPermissions: iosPermissions,
      macosPermissions: macosPermissions,
    });
  }

export function toggleTheme() {
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

export function handleSaveAll() {
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

export function showDeleteSafetyModal(packages) {
    pendingDeletePackages = packages;
    if (deleteSafetyModalBackdrop) {
      deleteSafetyModalBackdrop.style.display = "flex";
    }
  }

export function hideDeleteSafetyModal() {
    pendingDeletePackages = [];
    if (deleteSafetyModalBackdrop) {
      deleteSafetyModalBackdrop.style.display = "none";
    }
  }

