import { state, getState, setState, on } from './state.js';
import * as api from './api.js';
import { androidTableBody, iosTableBody, searchInput, categoryFilter, addAndroidButton, addIosButton, saveAndroidBuildDetailsButton, saveIosBuildDetailsButton, iosSearchInput, iosCategoryFilter, saveButton, saveAppNameButton, saveServicesButton, savePackageNamesButton, saveAllButton, statusMessage, toastContainer, refreshButton, androidPackageNameInput, iosBundleIdentifierInput, analyzePackagesButton, updateAllPackagesButton, toggleTransitiveButton, packagesLoadingIndicator, packagesTableContainer, packagesTableBody, packageSearchInput, packageSearchSpinner, packageSearchDropdown, popularPackagesContainer, packagePreviewCard, previewPackageName, previewPackageVersion, previewPackageDescription, previewLoading, previewAddButton, validatorHeaderActions, validatorLoadingIndicator, validatorLoadingText, validatorTableContainer, validatorTableBody, validatorNotInstalledContainer, installValidatorButton, modalBackdrop, modalSearch, modalResults, modalError, modalValueContainer, modalValueInput, modalValueSelect, modalValueHint, androidCountChip, iosCountChip, macosCountChip, macosTableBody, macosSearchInput, macosCategoryFilter, addMacosButton, androidDetailsSection, iosDetailsSection, androidDetailsGrid, iosDetailsGrid, androidSection, iosSection, macosSection, modalCancel, modalAdd, crossPlatformModalBackdrop, crossPlatformModalTitle, crossPlatformModalMessage, crossPlatformSuggestions, crossPlatformModalError, crossPlatformModalSkip, crossPlatformModalAdd, syncPermissionsButton, equivalentModalBackdrop, equivalentModalTitle, equivalentModalMessage, equivalentSuggestions, equivalentModalError, equivalentModalCancel, equivalentModalAdd, syncModalBackdrop, syncModalList, syncModalError, syncModalCancel, syncModalConfirm, deleteSafetyModalBackdrop, deleteSafetyCancel, deleteSafetyConfirm, addServiceButton, servicesContainer, serviceSearch, serviceModalBackdrop, serviceModalTitle, serviceModalContent, serviceModalError, serviceModalCancel, serviceModalSave, addServiceModalBackdrop, addServiceList, addServiceModalCancel, appNameDefault, appNameLangDropdown, appNameLangDropdownTrigger, appNameLangDropdownMenu, appNameLangSearch, appNameLangOptions, appNameLangList } from './elements.js';

export function renderServices() {
    if (!servicesContainer) {return;}

    // Filter services based on search
    const searchTerm = state.serviceSearch.toLowerCase();
    const filteredServices = state.services.filter((service) => {
      const config = state.availableServices.find((s) => s.id === service.id);
      if (!config) {return false;}

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
        if (!config) {return "";}

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
        if (!serviceId) {return;}

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

export function openAddServiceModal() {
    if (!addServiceModalBackdrop || !addServiceList) {return;}

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

export function closeAddServiceModal() {
    if (addServiceModalBackdrop) {
      addServiceModalBackdrop.style.display = "none";
    }
  }

export function openServiceModal(serviceId, existingValues = {}) {
    const config = state.availableServices.find((s) => s.id === serviceId);
    if (!config || !serviceModalBackdrop) {return;}

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
          if (!container) {return;}
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
          if (input) {input.focus();}
        });
      });

    serviceModalContent
      .querySelectorAll(".service-list-inputs")
      .forEach((container) => {
        container.addEventListener("click", (event) => {
          const target = event.target;
          if (!target || !target.classList.contains("remove-list-item")) {return;}
          const row = target.closest(".service-list-input-row");
          if (!row) {return;}
          const listInputs = container.querySelectorAll(
            ".service-list-input-row",
          );
          if (listInputs.length <= 1) {
            const input = row.querySelector("input");
            if (input) {input.value = "";}
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

export function closeServiceModal() {
    if (serviceModalBackdrop) {
      serviceModalBackdrop.style.display = "none";
    }
    state.currentEditingService = null;
  }

export function saveService() {
    const config = state.availableServices.find(
      (s) => s.id === state.currentEditingService,
    );
    if (!config) {return;}

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
          if (container) {container.style.borderColor = "var(--danger)";}
        } else {
          if (container) {container.style.borderColor = "";}
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

export function handleSaveServices() {
    console.log("[PermissionManager] handleSaveServices called");
    console.log(
      "[PermissionManager] Services to save:",
      JSON.stringify(state.services),
    );

    console.log("[PermissionManager] Posting saveServices message");
    showToast("Saving services...", "info");

    api.postMessage({
      type: "saveServices",
      services: state.services,
    });
  }

