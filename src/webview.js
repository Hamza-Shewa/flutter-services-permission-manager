(function () {
  const vscode = acquireVsCodeApi();
  const utils = window.PermissionManagerUtils;

  const androidTableBody = document.getElementById("androidPermissionTable");
  const iosTableBody = document.getElementById("iosPermissionTable");
  const searchInput = document.getElementById("permissionSearch");
  const categoryFilter = document.getElementById("categoryFilter");
  const addAndroidButton = document.getElementById(
    "addAndroidPermissionButton",
  );
  const addIosButton = document.getElementById("addIosPermissionButton");
  const iosSearchInput = document.getElementById("iosPermissionSearch");
  const iosCategoryFilter = document.getElementById("iosCategoryFilter");
  const saveButton = document.getElementById("savePermissionsButton");
  const saveAppNameButton = document.getElementById("saveAppNameButton");
  const saveServicesButton = document.getElementById("saveServicesButton");
  const saveAllButton = document.getElementById("saveAllButton");
  const statusMessage = document.getElementById("statusMessage");
  const toastContainer = document.getElementById("toastContainer");
  const refreshButton = document.getElementById("refreshButton");

  const modalBackdrop = document.getElementById("modalBackdrop");
  const modalSearch = document.getElementById("modalSearch");
  const modalResults = document.getElementById("modalResults");
  const modalError = document.getElementById("modalError");
  const modalValueContainer = document.getElementById("modalValueContainer");
  const modalValueInput = document.getElementById("modalValueInput");
  const modalValueSelect = document.getElementById("modalValueSelect");
  const modalValueHint = document.getElementById("modalValueHint");
  const androidCountChip = document.getElementById("androidCountChip");
  const iosCountChip = document.getElementById("iosCountChip");
  const macosCountChip = document.getElementById("macosCountChip");
  const macosTableBody = document.getElementById("macosPermissionTable");
  const macosSearchInput = document.getElementById("macosPermissionSearch");
  const macosCategoryFilter = document.getElementById("macosCategoryFilter");
  const addMacosButton = document.getElementById("addMacosPermissionButton");
  const androidSection = document.getElementById("androidSection");
  const iosSection = document.getElementById("iosSection");
  const macosSection = document.getElementById("macosSection");
  const modalCancel = document.getElementById("modalCancel");
  const modalAdd = document.getElementById("modalAdd");

  const crossPlatformModalBackdrop = document.getElementById(
    "crossPlatformModalBackdrop",
  );
  const crossPlatformModalTitle = document.getElementById(
    "crossPlatformModalTitle",
  );
  const crossPlatformModalMessage = document.getElementById(
    "crossPlatformModalMessage",
  );
  const crossPlatformSuggestions = document.getElementById(
    "crossPlatformSuggestions",
  );
  const crossPlatformModalError = document.getElementById(
    "crossPlatformModalError",
  );
  const crossPlatformModalSkip = document.getElementById(
    "crossPlatformModalSkip",
  );
  const crossPlatformModalAdd = document.getElementById(
    "crossPlatformModalAdd",
  );
  const syncPermissionsButton = document.getElementById(
    "syncPermissionsButton",
  );

  const equivalentModalBackdrop = document.getElementById(
    "equivalentModalBackdrop",
  );
  const equivalentModalTitle = document.getElementById("equivalentModalTitle");
  const equivalentModalMessage = document.getElementById(
    "equivalentModalMessage",
  );
  const equivalentSuggestions = document.getElementById(
    "equivalentSuggestions",
  );
  const equivalentModalError = document.getElementById("equivalentModalError");
  const equivalentModalCancel = document.getElementById(
    "equivalentModalCancel",
  );
  const equivalentModalAdd = document.getElementById("equivalentModalAdd");
  const syncModalBackdrop = document.getElementById("syncModalBackdrop");
  const syncModalList = document.getElementById("syncModalList");
  const syncModalError = document.getElementById("syncModalError");
  const syncModalCancel = document.getElementById("syncModalCancel");
  const syncModalConfirm = document.getElementById("syncModalConfirm");

  // Service modal elements
  const addServiceButton = document.getElementById("addServiceButton");
  const servicesContainer = document.getElementById("servicesContainer");
  const serviceSearch = document.getElementById("serviceSearch");
  const serviceModalBackdrop = document.getElementById("serviceModalBackdrop");
  const serviceModalTitle = document.getElementById("serviceModalTitle");
  const serviceModalContent = document.getElementById("serviceModalContent");
  const serviceModalError = document.getElementById("serviceModalError");
  const serviceModalCancel = document.getElementById("serviceModalCancel");
  const serviceModalSave = document.getElementById("serviceModalSave");
  const addServiceModalBackdrop = document.getElementById(
    "addServiceModalBackdrop",
  );
  const addServiceList = document.getElementById("addServiceList");
  const addServiceModalCancel = document.getElementById(
    "addServiceModalCancel",
  );

  // App Name elements
  const appNameDefault = document.getElementById("appNameDefault");
  const appNameLangDropdown = document.getElementById("appNameLangDropdown");
  const appNameLangDropdownTrigger = document.getElementById("appNameLangDropdownTrigger");
  const appNameLangDropdownMenu = document.getElementById("appNameLangDropdownMenu");
  const appNameLangSearch = document.getElementById("appNameLangSearch");
  const appNameLangOptions = document.getElementById("appNameLangOptions");
  const appNameLangList = document.getElementById("appNameLangList");

  // Languages data (loaded from extension)
  let languagesData = [];

  let pendingRefreshTimeout = null;

  const state = {
    androidPermissions: [],
    iosPermissions: [],
    allAndroidPermissions: [],
    allIosPermissions: [],
    search: "",
    category: "",
    iosSearch: "",
    iosCategory: "",
    sort: { column: "permission", direction: "asc" },
    modalQuery: "",
    modalSelection: null,
    modalMode: "android",
    modalCategory: "",
    hasAndroidManifest: false,
    hasIOSPlist: false,
    hasMacOSPlist: false,
    macosPermissions: [],
    macosSearch: "",
    macosCategory: "",
    pendingCrossPlatformPermissions: [],
    crossPlatformMode: null,
    pendingCrossPlatformModal: null,
    pendingEquivalentModal: null,
    equivalentPermissions: [],
    // Services state
    services: [],
    availableServices: [],
    currentEditingService: null,
    serviceSearch: "",
    pendingSyncModal: false,
    // App Name state
    appName: {
      defaultName: "",
      localizations: {}
    },
    // Languages list
    languages: [],
  };

  function scheduleRefresh() {
    if (pendingRefreshTimeout) {
      clearTimeout(pendingRefreshTimeout);
    }
    pendingRefreshTimeout = setTimeout(() => {
      vscode.postMessage({ type: "refresh" });
      pendingRefreshTimeout = null;
    }, 200);
  }

  /**
   * Shows an animated toast notification
   * @param {string} message - The message to display
   * @param {'success' | 'error' | 'info'} type - The type of toast
   * @param {number} duration - How long to show the toast (ms)
   */
  function showToast(message, type = "info", duration = 4000) {
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

  /**
   * Dismisses a toast with animation
   */
  function dismissToast(toast) {
    if (!toast || toast.classList.contains("hiding")) return;

    toast.classList.add("hiding");
    toast.addEventListener("animationend", () => {
      toast.remove();
    });
  }

  // Legacy setStatus function - now uses toast
  function setStatus(message, type) {
    if (!message) return;

    // Map old types to toast types
    const toastType =
      type === "success" ? "success" : type === "error" ? "error" : "info";
    showToast(message, toastType);

    // Also update hidden status element for compatibility
    statusMessage.textContent = message || "";
    statusMessage.className = `status ${type || ""}`.trim();
  }

  function renderAndroidTable() {
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

  function renderIOSTable() {
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

  function renderCategoryOptions() {
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

  function renderIOSCategoryOptions() {
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

  function renderMacOSCategoryOptions() {
    if (!macosCategoryFilter) return;
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

  function renderMacOSTable() {
    if (!macosTableBody) return;
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

  function renderModalCategoryTabs() {
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

  function applySortIndicator() {
    document.querySelectorAll("th[data-column]").forEach((th) => {
      th.classList.remove("sort-asc", "sort-desc");
      if (th.dataset.column === state.sort.column) {
        th.classList.add(
          state.sort.direction === "asc" ? "sort-asc" : "sort-desc",
        );
      }
    });
  }

  function updateView() {
    renderCategoryOptions();
    renderIOSCategoryOptions();
    renderMacOSCategoryOptions();
    renderAndroidTable();
    renderIOSTable();
    renderMacOSTable();
    applySortIndicator();
    updateCounts();
    updateSectionVisibility();
  }

  function updateSectionVisibility() {
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

  function findAndroidEquivalent(iosPermissionName) {
    return state.allAndroidPermissions.find(
      (p) =>
        (p.constantValue &&
          utils.normalizeText(p.constantValue) ===
            utils.normalizeText(iosPermissionName)) ||
        utils.normalizeText(p.permission) ===
          utils.normalizeText(iosPermissionName),
    );
  }

  function findIOSEquivalent(androidPermissionName) {
    return state.allIosPermissions.find(
      (p) =>
        utils.normalizeText(p.permission) ===
        utils.normalizeText(androidPermissionName),
    );
  }

  function buildSyncItems() {
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

  function renderSyncModal() {
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

  function closeSyncModal() {
    syncModalBackdrop.style.display = "none";
    syncModalList.innerHTML = "";
    syncModalError.textContent = "";
  }

  function confirmSync() {
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

  function syncEquivalents() {
    // Ensure all permissions are loaded, queue modal until both arrive
    if (state.allAndroidPermissions.length === 0) {
      state.pendingSyncModal = true;
      vscode.postMessage({ type: "requestAllAndroidPermissions" });
    }
    if (state.allIosPermissions.length === 0) {
      state.pendingSyncModal = true;
      vscode.postMessage({ type: "requestAllIOSPermissions" });
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

  function tryOpenPendingSyncModal() {
    if (
      state.pendingSyncModal &&
      state.allAndroidPermissions.length > 0 &&
      state.allIosPermissions.length > 0
    ) {
      state.pendingSyncModal = false;
      renderSyncModal();
    }
  }

  function updateCounts() {
    const androidCount = utils.dedupePermissions(
      state.androidPermissions,
    ).length;
    const iosCount = state.iosPermissions ? state.iosPermissions.length : 0;
    const macosCount = state.macosPermissions
      ? state.macosPermissions.length
      : 0;
    if (androidCountChip)
      androidCountChip.textContent = `Android: ${androidCount}`;
    if (iosCountChip) iosCountChip.textContent = `iOS: ${iosCount}`;
    if (macosCountChip) macosCountChip.textContent = `macOS: ${macosCount}`;
  }

  function openModal(mode) {
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

  function closeModal() {
    modalBackdrop.style.display = "none";
  }

  function renderModalResults() {
    modalResults.innerHTML = "";
    const isIos = state.modalMode === "ios";
    const isMacos = state.modalMode === "macos";
    const isApplePlatform = isIos || isMacos;

    let targetPermissions;
    if (isIos) targetPermissions = state.iosPermissions;
    else if (isMacos) targetPermissions = state.macosPermissions;
    else targetPermissions = state.androidPermissions;

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

  function addSelectedPermission() {
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
        vscode.postMessage({ type: "requestAllIOSPermissions" });
      } else if (isIos && state.allAndroidPermissions.length === 0) {
        vscode.postMessage({ type: "requestAllAndroidPermissions" });
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

  function addPermissionDirectly(selected, isIos) {
    // Check for duplicates
    let targetPermissions;
    const isMacos = state.modalMode === "macos";

    if (isIos) targetPermissions = state.iosPermissions;
    else if (isMacos) targetPermissions = state.macosPermissions;
    else targetPermissions = state.androidPermissions;

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

  function showCrossPlatformModal(selected, equivalents, isSourceIos) {
    // Ensure target platform permissions are loaded
    const needsTargetPermissions = isSourceIos
      ? state.allAndroidPermissions.length === 0
      : state.allIosPermissions.length === 0;

    if (needsTargetPermissions) {
      // Load target permissions first
      const messageType = isSourceIos
        ? "requestAllAndroidPermissions"
        : "requestAllIOSPermissions";
      vscode.postMessage({ type: messageType });

      // Store the modal data and show modal after permissions load
      state.pendingCrossPlatformModal = { selected, equivalents, isSourceIos };
      return;
    }

    showCrossPlatformModalInternal(selected, equivalents, isSourceIos);
  }

  function showCrossPlatformModalInternal(selected, equivalents, isSourceIos) {
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

  function addCrossPlatformPermissions() {
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
                    valueInput.style.borderColor = "var(--danger)";
                  errors.push(permissionName);
                  return; // Skip this permission
                }
                if (valueInput) valueInput.style.borderColor = "";
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

  function closeCrossPlatformModal() {
    crossPlatformModalBackdrop.style.display = "none";
    state.pendingCrossPlatformPermissions = [];
    state.crossPlatformMode = null;
  }

  function showEquivalentModal(permission, targetPlatform) {
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
      vscode.postMessage({ type: messageType });
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

  function renderEquivalentSuggestions(
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

  function closeEquivalentModal() {
    equivalentModalBackdrop.style.display = "none";
    state.equivalentPermissions = [];
  }

  function addEquivalentPermissions() {
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
                    valueInput.style.borderColor = "var(--danger)";
                  errors.push(permissionName);
                  return; // Skip this permission
                }
                if (valueInput) valueInput.style.borderColor = "";
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

  // ==================== App Name Functions ====================

  function renderAppName() {
    if (!appNameDefault) return;
    
    appNameDefault.value = state.appName.defaultName || "";
    renderAppNameLangList();
  }

  function renderLanguageDropdown() {
    if (!appNameLangOptions || !state.languages) return;
    
    const searchTerm = (appNameLangSearch?.value || "").toLowerCase();
    const existingCodes = Object.keys(state.appName.localizations || {});
    
    const filteredLangs = state.languages.filter(lang => {
      // Don't show already added languages
      if (existingCodes.includes(lang.code)) return false;
      
      // Filter by search term
      if (!searchTerm) return true;
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

  function openAppNameLangDropdown() {
    if (!appNameLangDropdownMenu) return;
    appNameLangDropdownMenu.classList.add('active');
    appNameLangDropdownTrigger.classList.add('active');
    renderLanguageDropdown();
    if (appNameLangSearch) appNameLangSearch.focus();
  }

  function closeAppNameLangDropdown() {
    if (!appNameLangDropdownMenu) return;
    appNameLangDropdownMenu.classList.remove('active');
    appNameLangDropdownTrigger.classList.remove('active');
  }

  function toggleAppNameLangDropdown() {
    if (appNameLangDropdownMenu?.classList.contains('active')) {
      closeAppNameLangDropdown();
    } else {
      openAppNameLangDropdown();
    }
  }

  function addAppNameLanguageDirect(code) {
    if (!code) return;
    
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
    if (appNameLangSearch) appNameLangSearch.value = "";
    
    renderAppNameLangList();
    showToast("Language added. Enter the app name for this language.", "info");
  }

  function removeAppNameLanguage(code) {
    if (state.appName.localizations && state.appName.localizations[code] !== undefined) {
      delete state.appName.localizations[code];
      renderAppNameLangList();
    }
  }

  function updateAppNameLanguage(code, value) {
    if (!state.appName.localizations) {
      state.appName.localizations = {};
    }
    state.appName.localizations[code] = value;
  }

  function renderAppNameLangList() {
    if (!appNameLangList) return;
    
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

  // ==================== Services Functions ====================

  function renderServices() {
    if (!servicesContainer) return;

    // Filter services based on search
    const searchTerm = state.serviceSearch.toLowerCase();
    const filteredServices = state.services.filter((service) => {
      const config = state.availableServices.find((s) => s.id === service.id);
      if (!config) return false;

      // Match by service name, description, or values
      const matchesName = config.name.toLowerCase().includes(searchTerm);
      const matchesDesc = config.description.toLowerCase().includes(searchTerm);
      const matchesValues = Object.values(service.values).some((v) =>
        String(v).toLowerCase().includes(searchTerm),
      );

      return matchesName || matchesDesc || matchesValues;
    });

    if (state.services.length === 0) {
      servicesContainer.innerHTML = `
                <div class="empty-services">
                    <div class="empty-services-icon">🔌</div>
                    <p>No services configured yet.</p>
                    <p style="font-size: 13px; margin-top: 8px;">Click "Add Service" to configure Facebook, Google, or other SDK integrations.</p>
                </div>
            `;
      return;
    }

    if (filteredServices.length === 0 && searchTerm) {
      servicesContainer.innerHTML = `
                <div class="empty-services">
                    <div class="empty-services-icon">🔍</div>
                    <p>No services match "${state.serviceSearch}"</p>
                </div>
            `;
      return;
    }

    servicesContainer.innerHTML = filteredServices
      .map((service) => {
        const config = state.availableServices.find((s) => s.id === service.id);
        if (!config) return "";

        return `
                <div class="service-card" data-service-id="${service.id}">
                    <div class="service-card-header">
                        <div class="service-card-icon">${config.icon}</div>
                        <div>
                            <div class="service-card-title">${config.name}</div>
                            <div class="service-card-status">✓ Configured</div>
                        </div>
                    </div>
                    <div class="service-card-fields">
                        ${config.fields
                          .map(
                            (field) => `
                            <div class="service-field">
                                <span class="service-field-label">${field.label}</span>
                                <span class="service-field-value" title="${service.values[field.id] || "-"}">${service.values[field.id] || "-"}</span>
                            </div>
                        `,
                          )
                          .join("")}
                    </div>
                    <div class="service-card-actions">
                        <button type="button" class="btn-secondary edit-service-btn" data-service-id="${service.id}">✏️ Edit</button>
                        <button type="button" class="delete-button remove-service-btn" data-service-id="${service.id}">🗑️ Remove</button>
                    </div>
                </div>
            `;
      })
      .join("");

    // Add event listeners
    servicesContainer.querySelectorAll(".edit-service-btn").forEach((btn) => {
      btn.addEventListener("click", () => {
        const serviceId = btn.dataset.serviceId;
        const service = state.services.find((s) => s.id === serviceId);
        if (service) {
          openServiceModal(serviceId, service.values);
        }
      });
    });

    servicesContainer.querySelectorAll(".remove-service-btn").forEach((btn) => {
      btn.onclick = (e) => {
        e.stopPropagation();
        e.preventDefault();
        const serviceId = btn.dataset.serviceId;
        if (!serviceId) return;

        const config = state.availableServices.find((s) => s.id === serviceId);
        const serviceName = config ? config.name : serviceId;

        if (state.services.find((s) => s.id === serviceId)) {
          state.services = state.services.filter((s) => s.id !== serviceId);
          renderServices();
          showToast(`${serviceName} removed. Save changes to apply.`, "info");
        }
      };
    });
  }

  function openAddServiceModal() {
    if (!addServiceModalBackdrop || !addServiceList) return;

    const configuredIds = state.services.map((s) => s.id);

    addServiceList.innerHTML = state.availableServices
      .map((service) => {
        const isConfigured = configuredIds.includes(service.id);
        return `
                <div class="service-list-item ${isConfigured ? "disabled" : ""}" data-service-id="${service.id}" ${isConfigured ? 'title="Already configured"' : ""}>
                    <span class="service-icon">${service.icon}</span>
                    <div class="service-info">
                        <div class="service-name">${service.name}${isConfigured ? " (Configured)" : ""}</div>
                        <div class="service-desc">${service.description}</div>
                    </div>
                </div>
            `;
      })
      .join("");

    addServiceList
      .querySelectorAll(".service-list-item:not(.disabled)")
      .forEach((item) => {
        item.addEventListener("click", () => {
          closeAddServiceModal();
          openServiceModal(item.dataset.serviceId, {});
        });
      });

    addServiceModalBackdrop.style.display = "flex";
  }

  function closeAddServiceModal() {
    if (addServiceModalBackdrop) {
      addServiceModalBackdrop.style.display = "none";
    }
  }

  function openServiceModal(serviceId, existingValues = {}) {
    const config = state.availableServices.find((s) => s.id === serviceId);
    if (!config || !serviceModalBackdrop) return;

    state.currentEditingService = serviceId;
    serviceModalTitle.textContent = `Configure ${config.name}`;

    // Escape HTML attribute values
    const escapeAttr = (str) =>
      String(str || "")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#39;");

    serviceModalContent.innerHTML = `
            <div class="service-form">
                ${config.fields
                  .map((field) => {
                    const fieldType = field.type || "text";
                    if (fieldType === "list") {
                      const rawValue = existingValues[field.id] || "";
                      const items = String(rawValue)
                        .split(/[,;\n]+/)
                        .map((value) => value.trim())
                        .filter(Boolean);
                      const listItems = items.length > 0 ? items : [""];

                      return `
                    <div class="form-group" data-field-type="list" data-field-id="${field.id}">
                        <label>${field.label}${field.required ? " *" : ""}</label>
                        <div class="service-list-inputs" data-list-id="${field.id}">
                            ${listItems
                              .map(
                                (value) => `
                                <div class="service-list-input-row">
                                    <input
                                        type="text"
                                        data-field-id="${field.id}"
                                        placeholder="${escapeAttr(field.placeholder)}"
                                        value="${escapeAttr(value)}"
                                    />
                                    <button type="button" class="btn-secondary btn-small remove-list-item" data-field-id="${field.id}">−</button>
                                </div>
                            `,
                              )
                              .join("")}
                        </div>
                        <button type="button" class="btn-secondary btn-small add-list-item" data-field-id="${field.id}">+ Add</button>
                    </div>
                  `;
                    }

                    if (fieldType === "toggle") {
                      const rawValue = String(existingValues[field.id] || "false").toLowerCase();
                      const isEnabled = rawValue === "true";
                      return `
                    <div class="form-group" data-field-type="toggle" data-field-id="${field.id}">
                        <label>${field.label}${field.required ? " *" : ""}</label>
                        <button type="button" class="btn-secondary toggle-button" data-field-id="${field.id}" data-value="${isEnabled}">${isEnabled ? "true" : "false"}</button>
                    </div>
                  `;
                    }

                    return `
                    <div class="form-group">
                        <label for="service-field-${field.id}">${field.label}${field.required ? " *" : ""}</label>
                        <input 
                            type="text" 
                            id="service-field-${field.id}" 
                            data-field-id="${field.id}"
                            placeholder="${escapeAttr(field.placeholder)}"
                            value="${escapeAttr(existingValues[field.id])}"
                            ${field.required ? "required" : ""}
                        />
                    </div>
                  `;
                  })
                  .join("")}
            </div>
        `;

    serviceModalBackdrop.style.display = "flex";

    serviceModalContent
      .querySelectorAll(".add-list-item")
      .forEach((button) => {
        button.addEventListener("click", () => {
          const fieldId = button.dataset.fieldId;
          const container = serviceModalContent.querySelector(
            `.service-list-inputs[data-list-id="${fieldId}"]`,
          );
          if (!container) return;
          const row = document.createElement("div");
          row.className = "service-list-input-row";
          row.innerHTML = `
                <input type="text" data-field-id="${fieldId}" placeholder="${escapeAttr(
                  config.fields.find((f) => f.id === fieldId)?.placeholder,
                )}" />
                <button type="button" class="btn-secondary btn-small remove-list-item" data-field-id="${fieldId}">−</button>
            `;
          container.appendChild(row);
          const input = row.querySelector("input");
          if (input) input.focus();
        });
      });

    serviceModalContent
      .querySelectorAll(".service-list-inputs")
      .forEach((container) => {
        container.addEventListener("click", (event) => {
          const target = event.target;
          if (!target || !target.classList.contains("remove-list-item")) return;
          const row = target.closest(".service-list-input-row");
          if (!row) return;
          const listInputs = container.querySelectorAll(
            ".service-list-input-row",
          );
          if (listInputs.length <= 1) {
            const input = row.querySelector("input");
            if (input) input.value = "";
            return;
          }
          row.remove();
        });
      });

    serviceModalContent
      .querySelectorAll(".toggle-button")
      .forEach((button) => {
        button.addEventListener("click", () => {
          const currentValue = button.dataset.value === "true";
          const nextValue = !currentValue;
          button.dataset.value = String(nextValue);
          button.textContent = nextValue ? "true" : "false";
        });
      });

    // Focus first input
    const firstInput = serviceModalContent.querySelector("input");
    if (firstInput) {
      setTimeout(() => firstInput.focus(), 100);
    }
  }

  function closeServiceModal() {
    if (serviceModalBackdrop) {
      serviceModalBackdrop.style.display = "none";
    }
    state.currentEditingService = null;
  }

  function saveService() {
    const config = state.availableServices.find(
      (s) => s.id === state.currentEditingService,
    );
    if (!config) return;

    const values = {};
    let hasError = false;

    config.fields.forEach((field) => {
      const fieldType = field.type || "text";

      if (fieldType === "list") {
        const inputs = serviceModalContent.querySelectorAll(
          `input[data-field-id="${field.id}"]`,
        );
        const items = Array.from(inputs)
          .map((input) => input.value.trim())
          .filter(Boolean);
        const value = items.join(", ");
        const container = serviceModalContent.querySelector(
          `.form-group[data-field-id="${field.id}"]`,
        );

        if (field.required && items.length === 0) {
          hasError = true;
          if (container) container.style.borderColor = "var(--danger)";
        } else {
          if (container) container.style.borderColor = "";
          values[field.id] = value;
        }
        return;
      }

      if (fieldType === "toggle") {
        const button = serviceModalContent.querySelector(
          `.toggle-button[data-field-id="${field.id}"]`,
        );
        const value = button?.dataset.value === "true" ? "true" : "false";
        values[field.id] = value;
        return;
      }

      const input = document.getElementById(`service-field-${field.id}`);
      const value = input ? input.value.trim() : "";

      if (field.required && !value) {
        hasError = true;
        input.style.borderColor = "var(--danger)";
      } else {
        input.style.borderColor = "";
        values[field.id] = value;
      }
    });

    if (hasError) {
      showToast("Please fill in all required fields.", "error");
      return;
    }

    // Update or add service
    const existingIndex = state.services.findIndex(
      (s) => s.id === state.currentEditingService,
    );
    if (existingIndex >= 0) {
      state.services[existingIndex].values = values;
    } else {
      state.services.push({ id: state.currentEditingService, values });
    }

    closeServiceModal();
    renderServices();
    showToast(
      `${config.name} configured successfully. Save changes to apply.`,
      "success",
    );
  }

  function handleSavePermissions() {
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
    
    vscode.postMessage({
      type: "savePermissions",
      androidPermissions: androidPermissions,
      iosPermissions: iosPermissions,
      macosPermissions: macosPermissions,
    });
  }
  
  function handleSaveAppName() {
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
    
    vscode.postMessage({
      type: "saveAppName",
      appName: {
        defaultName: state.appName.defaultName,
        localizations: state.appName.localizations || {}
      },
    });
  }
  
  function handleSaveServices() {
    console.log("[PermissionManager] handleSaveServices called");
    console.log(
      "[PermissionManager] Services to save:",
      JSON.stringify(state.services),
    );
    
    console.log("[PermissionManager] Posting saveServices message");
    showToast("Saving services...", "info");
    
    vscode.postMessage({
      type: "saveServices",
      services: state.services,
    });
  }

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
    vscode.postMessage({ type: "requestAllAndroidPermissions" });
  });

  addIosButton.addEventListener("click", () => {
    openModal("ios");
    vscode.postMessage({ type: "requestAllIOSPermissions" });
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
      vscode.postMessage({ type: "requestAllIOSPermissions" });
    });
  }

  // Service event listeners
  if (addServiceButton) {
    addServiceButton.addEventListener("click", () => {
      vscode.postMessage({ type: "requestServices" });
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
      } catch (e) {}
    } else {
      document.documentElement.setAttribute('data-theme', 'light');
      themeToggleButton.textContent = '☀️';
      try {
        localStorage.setItem('permissionManagerTheme', 'light');
      } catch (e) {}
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
  if (refreshButton) {
    refreshButton.addEventListener("click", () => {
      vscode.postMessage({ type: "refresh" });
    });
  }
  if (syncPermissionsButton) {
    syncPermissionsButton.addEventListener("click", syncEquivalents);
  }

  function handleSaveAll() {
    console.log("[PermissionManager] handleSaveAll called");
    // Fire the individual save handlers in sequence
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
  if (syncModalCancel) {
    syncModalCancel.addEventListener("click", closeSyncModal);
  }
  if (syncModalConfirm) {
    syncModalConfirm.addEventListener("click", confirmSync);
  }

  // Auto-refresh when the webview regains focus to pick up file changes
  window.addEventListener("focus", () => {
    scheduleRefresh();
  });

  window.addEventListener("message", (event) => {
    const message = event.data;
    if (!message) {
      return;
    }
    switch (message.type) {
      case "permissions":
        state.androidPermissions = message.androidPermissions || [];
        state.iosPermissions = message.iosPermissions || [];
        state.macosPermissions = message.macosPermissions || [];
        state.hasAndroidManifest = message.hasAndroidManifest || false;
        state.hasIOSPlist = message.hasIOSPlist || false;
        state.hasMacOSPlist = message.hasMacOSPlist || false;
        state.services = message.services || [];
        state.availableServices =
          message.availableServices || state.availableServices || [];
        // Handle languages
        if (message.languages) {
          state.languages = message.languages;
        }
        // Handle appName
        if (message.appName) {
          state.appName = {
            defaultName: message.appName.defaultName || "",
            localizations: message.appName.localizations || {}
          };
        }
        updateView();
        renderServices();
        renderAppName();
        break;
      case "allAndroidPermissions":
        state.allAndroidPermissions = message.permissions || [];
        renderModalCategoryTabs();
        renderModalResults();
        tryOpenPendingSyncModal();
        // Check if we have a pending cross-platform modal
        if (
          state.pendingCrossPlatformModal &&
          state.pendingCrossPlatformModal.isSourceIos
        ) {
          const { selected, equivalents, isSourceIos } =
            state.pendingCrossPlatformModal;
          state.pendingCrossPlatformModal = null;
          showCrossPlatformModalInternal(selected, equivalents, isSourceIos);
        }
        // Check if we have a pending equivalent modal
        if (
          state.pendingEquivalentModal &&
          state.pendingEquivalentModal.targetPlatform === "android"
        ) {
          const { permission, targetPlatform } = state.pendingEquivalentModal;
          state.pendingEquivalentModal = null;
          showEquivalentModal(permission, targetPlatform);
        }
        break;
      case "allIOSPermissions":
        state.allIosPermissions = message.permissions || [];
        renderModalCategoryTabs();
        renderModalResults();
        tryOpenPendingSyncModal();
        // Check if we have a pending cross-platform modal
        if (
          state.pendingCrossPlatformModal &&
          !state.pendingCrossPlatformModal.isSourceIos
        ) {
          const { selected, equivalents, isSourceIos } =
            state.pendingCrossPlatformModal;
          state.pendingCrossPlatformModal = null;
          showCrossPlatformModalInternal(selected, equivalents, isSourceIos);
        }
        // Check if we have a pending equivalent modal
        if (
          state.pendingEquivalentModal &&
          state.pendingEquivalentModal.targetPlatform === "ios"
        ) {
          const { permission, targetPlatform } = state.pendingEquivalentModal;
          state.pendingEquivalentModal = null;
          showEquivalentModal(permission, targetPlatform);
        }
        break;
      case "servicesConfig":
        state.availableServices = message.services || [];
        renderServices();
        break;
      case "saveResult":
        setStatus(message.message || "", message.success ? "success" : "error");
        break;
      default:
        break;
    }
  });

  vscode.postMessage({ type: "ready" });
})();
