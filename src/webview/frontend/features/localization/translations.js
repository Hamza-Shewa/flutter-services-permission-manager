import { state, getState, setState, on } from '../../core/state.js';
import * as api from '../../core/api.js';
import {
  transSaveAllButton,
  transRefDropdown,
  transRefDropdownTrigger,
  transRefDropdownMenu,
  transRefSearch,
  transRefOptions,
  transAddDropdown,
  transAddDropdownTrigger,
  transAddDropdownMenu,
  transAddSearch,
  transAddOptions,
  transAutoAddButton,
  transTranslateAllButton,
  transTranslateMissingButton,
  transEmpty,
  transLocaleList,
  transTableContainer,
  transTable,
  transTableHead,
  transTableBody,
  transStatus,
  transDirInput,
  transDirLoadButton,
  transDirBrowseButton,
} from '../../core/elements.js';
import { showToast } from '../../core/utils.js';

const DIR_STORAGE_KEY = 'permissionManagerTranslationsDir';

// ---------------------------------------------------------------------------
// Directory helpers
// ---------------------------------------------------------------------------

/** Workspace-relative directory where the user's translation files live. */
export function getTranslationsDir() {
  return state.translationsDir || "";
}

/** Persist the directory choice and keep the input in sync. */
export function setTranslationsDir(dir) {
  state.translationsDir = (dir || "").trim();
  try {
    localStorage.setItem(DIR_STORAGE_KEY, state.translationsDir);
  } catch { /* ignore */ }
  if (transDirInput) {
    transDirInput.value = state.translationsDir;
  }
}

/** Restore the saved directory choice on startup. */
function loadSavedDir() {
  try {
    const saved = localStorage.getItem(DIR_STORAGE_KEY);
    if (saved) {
      state.translationsDir = saved;
      if (transDirInput) { transDirInput.value = saved; }
    }
  } catch { /* ignore */ }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function showTransStatus(message, type = "info") {
  if (!transStatus) { return; }
  transStatus.textContent = message;
  transStatus.className = `status ${type}`;
  transStatus.style.display = message ? "" : "none";
}

function esc(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function getReferenceLocale() {
  return state.referenceLocale || state.translations?.[0]?.locale || null;
}

function getReferenceFile() {
  const locale = getReferenceLocale();
  return (state.translations || []).find((t) => t.locale === locale) || null;
}

function allKeys() {
  const reference = getReferenceFile();
  const seen = new Set();
  const ordered = [];
  if (reference) {
    for (const key of Object.keys(reference.keys)) {
      seen.add(key);
      ordered.push(key);
    }
  }
  const extras = [];
  for (const file of state.translations || []) {
    for (const key of Object.keys(file.keys)) {
      if (!seen.has(key)) {
        seen.add(key);
        extras.push(key);
      }
    }
  }
  extras.sort();
  return ordered.concat(extras);
}

function missingCountFor(locale) {
  const reference = getReferenceFile();
  if (!reference || locale === reference.locale) {
    return 0;
  }
  const file = (state.translations || []).find((t) => t.locale === locale);
  if (!file) { return 0; }
  let count = 0;
  for (const key of Object.keys(reference.keys)) {
    const value = file.keys[key];
    if (value === undefined || value === "") { count++; }
  }
  return count;
}

function isBusy() {
  return !!state.transBusy;
}

function setBusy(busy) {
  state.transBusy = busy;
  if (transAutoAddButton) { transAutoAddButton.disabled = busy; }
  if (transTranslateAllButton) { transTranslateAllButton.disabled = busy; }
  if (transTranslateMissingButton) { transTranslateMissingButton.disabled = busy; }
  if (transSaveAllButton) { transSaveAllButton.disabled = busy; }
}

// ---------------------------------------------------------------------------
// Renderers
// ---------------------------------------------------------------------------

export function renderTranslations() {
  const translations = state.translations || [];

  // Keep the directory input in sync with the current selection.
  if (transDirInput && state.translationsDir !== undefined) {
    transDirInput.value = state.translationsDir || "";
  }

  if (translations.length === 0) {
    if (transEmpty) { transEmpty.style.display = ""; }
    if (transLocaleList) { transLocaleList.innerHTML = ""; }
    if (transTableContainer) { transTableContainer.style.display = "none"; }
    if (transRefDropdownTrigger) {
      transRefDropdownTrigger.innerHTML = "<span>Select reference...</span><span>▼</span>";
    }
    if (transAddDropdownTrigger) {
      transAddDropdownTrigger.innerHTML = "<span>Select a language...</span><span>▼</span>";
    }
    return;
  }

  if (transEmpty) { transEmpty.style.display = "none"; }
  renderReferenceDropdown();
  renderAddDropdown();
  renderLocaleChips();
  renderKeysTable();
}

function renderReferenceDropdown() {
  if (!transRefOptions) { return; }
  const reference = getReferenceLocale();
  const translations = state.translations || [];

  if (!reference && transRefDropdownTrigger) {
    transRefDropdownTrigger.innerHTML = "<span>Select reference...</span><span>▼</span>";
  } else if (transRefDropdownTrigger) {
    const refFile = getReferenceFile();
    const label = refFile ? `${refFile.locale}` : reference;
    transRefDropdownTrigger.innerHTML = `<span>Reference: ${esc(label)}</span><span>▼</span>`;
  }

  const searchTerm = (transRefSearch?.value || "").toLowerCase();
  const filtered = translations.filter((t) =>
    !searchTerm || t.locale.toLowerCase().includes(searchTerm)
  );

  if (filtered.length === 0) {
    transRefOptions.innerHTML =
      '<div class="trans-option-empty">No languages loaded.</div>';
    return;
  }

  transRefOptions.innerHTML = filtered
    .map((t) => {
      const missing = missingCountFor(t.locale);
      const selected = t.locale === reference ? " selected" : "";
      return `
        <div class="trans-option${selected}" data-locale="${esc(t.locale)}">
          <span class="trans-option-title">${esc(t.locale)}<span class="trans-option-code">${esc(t.fileName)}</span></span>
          <span class="trans-option-subtitle">${missing > 0 ? missing + " missing" : "Complete"}</span>
        </div>
      `;
    })
    .join("");

  transRefOptions.querySelectorAll(".trans-option").forEach((option) => {
    option.addEventListener("click", () => {
      setReferenceLocale(option.dataset.locale);
      closeRefDropdown();
    });
  });
}

function renderAddDropdown() {
  if (!transAddOptions) { return; }
  const loadedCodes = (state.translations || []).map((t) => t.locale);
  const langs = state.languages || [];
  const searchTerm = (transAddSearch?.value || "").toLowerCase();

  const filtered = langs.filter((lang) => {
    if (loadedCodes.includes(lang.code)) { return false; }
    if (!searchTerm) { return true; }
    return (
      lang.name.toLowerCase().includes(searchTerm) ||
      lang.nativeName.toLowerCase().includes(searchTerm) ||
      lang.code.toLowerCase().includes(searchTerm)
    );
  });

  if (filtered.length === 0) {
    transAddOptions.innerHTML =
      '<div class="trans-option-empty">No languages found.</div>';
    return;
  }

  transAddOptions.innerHTML = filtered
    .map((lang) => `
      <div class="trans-option" data-code="${esc(lang.code)}">
        <span class="trans-option-title">${esc(lang.name)}<span class="trans-option-code">${esc(lang.code)}</span></span>
        <span class="trans-option-subtitle">${esc(lang.nativeName)}</span>
      </div>
    `)
    .join("");

  transAddOptions.querySelectorAll(".trans-option").forEach((option) => {
    option.addEventListener("click", () => {
      addLocaleFromDropdown(option.dataset.code);
    });
  });
}

function renderLocaleChips() {
  if (!transLocaleList) { return; }
  const reference = getReferenceLocale();
  const translations = state.translations || [];

  transLocaleList.innerHTML = translations
    .map((t) => {
      const missing = missingCountFor(t.locale);
      const isRef = t.locale === reference;
      return `
        <div class="trans-locale-chip${isRef ? " reference" : ""}" data-locale="${esc(t.locale)}">
          <span>${esc(t.locale)}</span>
          <span class="trans-locale-chip-missing">${missing > 0 ? missing + " missing" : "✓"}</span>
          <div class="trans-chip-menu">
            <button type="button" class="trans-chip-menu-btn" data-menu-locale="${esc(t.locale)}" title="Translate actions">⋮</button>
            <div class="trans-chip-menu-pop" data-menu-pop="${esc(t.locale)}">
              <button type="button" class="trans-chip-menu-item" data-action="translate" data-locale="${esc(t.locale)}">🌐 Translate this locale</button>
              <button type="button" class="trans-chip-menu-item" data-action="translate-missing" data-locale="${esc(t.locale)}">🔁 Translate only missing values</button>
              ${isRef ? "" : `<button type="button" class="trans-chip-menu-item danger" data-action="remove" data-locale="${esc(t.locale)}">🗑 Remove locale</button>`}
            </div>
          </div>
        </div>
      `;
    })
    .join("");

  transLocaleList.querySelectorAll(".trans-chip-menu-btn").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      const locale = btn.dataset.menuLocale;
      const pop = transLocaleList.querySelector(`.trans-chip-menu-pop[data-menu-pop="${CSS.escape(locale)}"]`);
      // Close any other open popup first.
      transLocaleList.querySelectorAll(".trans-chip-menu-pop.active").forEach((p) => p.classList.remove("active"));
      if (pop) { pop.classList.toggle("active"); }
    });
  });

  transLocaleList.querySelectorAll(".trans-chip-menu-item").forEach((item) => {
    item.addEventListener("click", (e) => {
      e.stopPropagation();
      const { action, locale } = item.dataset;
      const pop = item.closest(".trans-chip-menu-pop");
      if (pop) { pop.classList.remove("active"); }
      if (action === "translate") { handleTranslateLocale(locale); }
      else if (action === "translate-missing") { handleTranslateLocaleMissing(locale); }
      else if (action === "remove") { handleRemoveLocale(locale); }
    });
  });
}

function renderKeysTable() {
  const translations = state.translations || [];
  if (!transTableContainer || !transTableHead || !transTableBody) { return; }

  if (translations.length < 2) {
    transTableContainer.style.display = "none";
    if (transTableBody) { transTableBody.innerHTML = ""; }
    return;
  }

  const reference = getReferenceLocale();
  const keys = allKeys();
  transTableContainer.style.display = "";

  // Keep the 30% key / 35% per-language ratio: with 2 languages the table is
  // exactly 100% wide; with 3+ it overflows and the wrapper scrolls horizontally.
  if (transTable) {
    transTable.style.width = `${30 + 35 * translations.length}%`;
  }

  // Header
  let headHtml = "<tr><th class=\"trans-key-cell\">Key</th>";
  for (const t of translations) {
    headHtml += `<th class="trans-value-cell">${esc(t.locale)}${t.locale === reference ? " ★" : ""}</th>`;
  }
  headHtml += "</tr>";
  transTableHead.innerHTML = headHtml;

  // Body
  const rows = keys.map((key) => {
    let row = `<tr><td class="trans-key-cell">${esc(key)}</td>`;
    for (const t of translations) {
      const value = t.keys[key] ?? "";
      const missing = value === "" ? " missing-cell" : "";
      row += `<td class="trans-value-cell${missing}"><textarea data-locale="${esc(t.locale)}" data-key="${esc(key)}" placeholder="…" rows="1">${esc(value)}</textarea></td>`;
    }
    row += "</tr>";
    return row;
  });
  transTableBody.innerHTML = rows.join("");

  // Wire inputs
  transTableBody.querySelectorAll("textarea").forEach((ta) => {
    ta.addEventListener("input", (e) => {
      const { locale, key } = ta.dataset;
      updateTranslationValue(locale, key, ta.value);
      const cell = ta.closest("td");
      if (cell) {
        cell.classList.toggle("missing-cell", ta.value.trim() === "");
      }
    });
  });

  // Auto-grow rows
  transTableBody.querySelectorAll("textarea").forEach((ta) => {
    ta.style.height = "auto";
    ta.style.height = `${Math.max(34, ta.scrollHeight)}px`;
  });
}

// ---------------------------------------------------------------------------
// Dropdowns
// ---------------------------------------------------------------------------

export function openRefDropdown() {
  if (!transRefDropdownMenu) { return; }
  closeAddDropdown();
  transRefDropdownMenu.classList.add("active");
  transRefDropdownTrigger?.classList.add("active");
  renderReferenceDropdown();
  transRefSearch?.focus();
}

export function closeRefDropdown() {
  if (!transRefDropdownMenu) { return; }
  transRefDropdownMenu.classList.remove("active");
  transRefDropdownTrigger?.classList.remove("active");
}

export function toggleRefDropdown() {
  if (transRefDropdownMenu?.classList.contains("active")) {
    closeRefDropdown();
  } else {
    openRefDropdown();
  }
}

export function openAddDropdown() {
  if (!transAddDropdownMenu) { return; }
  closeRefDropdown();
  transAddDropdownMenu.classList.add("active");
  transAddDropdownTrigger?.classList.add("active");
  renderAddDropdown();
  transAddSearch?.focus();
}

export function closeAddDropdown() {
  if (!transAddDropdownMenu) { return; }
  transAddDropdownMenu.classList.remove("active");
  transAddDropdownTrigger?.classList.remove("active");
}

export function toggleAddDropdown() {
  if (transAddDropdownMenu?.classList.contains("active")) {
    closeAddDropdown();
  } else {
    openAddDropdown();
  }
}

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------

export function setReferenceLocale(locale) {
  if (!locale) { return; }
  state.referenceLocale = locale;
  if (transAddSearch) { transAddSearch.value = ""; }
  renderTranslations();
}

export function addLocaleFromDropdown(code) {
  if (!code) { return; }
  const loadedCodes = (state.translations || []).map((t) => t.locale);
  if (loadedCodes.includes(code)) {
    showToast("Language already loaded", "info");
    return;
  }
  closeAddDropdown();
  if (transAddSearch) { transAddSearch.value = ""; }
  if (isBusy()) { return; }
  setBusy(true);
  showTransStatus(`Adding language "${code}"...`, "info");
  api.addTranslationLocale(code, getReferenceLocale(), getTranslationsDir());
}

export function updateTranslationValue(locale, key, value) {
  const file = (state.translations || []).find((t) => t.locale === locale);
  if (!file) { return; }
  file.keys = { ...file.keys, [key]: value };
}

export function handleAutoAddMissing() {
  if (isBusy()) { return; }
  setBusy(true);
  showTransStatus("Adding missing keys...", "info");
  api.autoAddMissingKeys(getReferenceLocale(), getTranslationsDir());
}

export function handleTranslateAll() {
  if (isBusy()) { return; }
  if (!getReferenceLocale()) {
    showToast("Select a reference language first", "error");
    return;
  }
  setBusy(true);
  showTransStatus("Translating all values...", "info");
  api.translateAll(getReferenceLocale(), getTranslationsDir());
}

export function handleTranslateMissing() {
  if (isBusy()) { return; }
  if (!getReferenceLocale()) {
    showToast("Select a reference language first", "error");
    return;
  }
  setBusy(true);
  showTransStatus("Filling missing values...", "info");
  api.translateMissing(getReferenceLocale(), getTranslationsDir());
}

export function handleTranslateLocale(locale) {
  if (isBusy()) { return; }
  if (!getReferenceLocale()) {
    showToast("Select a reference language first", "error");
    return;
  }
  setBusy(true);
  showTransStatus(`Translating "${locale}"...`, "info");
  api.translateLocale(locale, getReferenceLocale(), getTranslationsDir());
}

export function handleTranslateLocaleMissing(locale) {
  if (isBusy()) { return; }
  if (!getReferenceLocale()) {
    showToast("Select a reference language first", "error");
    return;
  }
  setBusy(true);
  showTransStatus(`Filling missing values for "${locale}"...`, "info");
  api.translateLocaleMissing(locale, getReferenceLocale(), getTranslationsDir());
}

export function handleRemoveLocale(locale) {
  if (isBusy()) { return; }
  const file = (state.translations || []).find((t) => t.locale === locale);
  if (!file) { return; }
  if (!window.confirm(`Remove language "${locale}"?\n\nThis deletes ${file.fileName} from disk.`)) {
    return;
  }
  setBusy(true);
  showTransStatus(`Removing "${locale}"...`, "info");
  api.removeTranslationLocale(locale, getTranslationsDir());
}

export function handleSaveAllTranslations() {
  if (isBusy()) { return; }
  if (!state.translations || state.translations.length === 0) {
    showToast("No translation files to save", "info");
    return;
  }
  setBusy(true);
  showTransStatus("Saving all translation files...", "info");
  api.saveTranslations(state.translations, getTranslationsDir());
}

/** Load translation files from the directory typed into the input. */
export function handleLoadTranslationsDir() {
  if (!transDirInput) { return; }
  const dir = transDirInput.value.trim();
  setTranslationsDir(dir);
  setBusy(true);
  showTransStatus(dir ? `Loading translation files from "${dir}"...` : "Loading translation files...", "info");
  api.requestTranslations(getTranslationsDir());
}

/** Clear the directory filter and reload with auto-discovery. */
export function handleClearTranslationsDir() {
  setTranslationsDir("");
  setBusy(true);
  showTransStatus("Loading translation files (auto-discovery)...", "info");
  api.requestTranslations("");
}

// ---------------------------------------------------------------------------
// Message application
// ---------------------------------------------------------------------------

/** Apply a fresh list of translation files coming from the backend. */
export function applyTranslations(translations) {
  state.translations = translations || [];

  // Keep the reference selection stable; fall back to the first locale.
  const currentRef = state.referenceLocale;
  const stillExists = (state.translations || []).some((t) => t.locale === currentRef);
  if (!currentRef || !stillExists) {
    state.referenceLocale = state.translations?.[0]?.locale || null;
  }

  setBusy(false);
  renderTranslations();
}

/** Apply the result of a translate/add/save action. */
export function applyTranslationsResult(message) {
  setBusy(false);
  if (message && message.translations) {
    state.translations = message.translations;
    const currentRef = state.referenceLocale;
    const stillExists = state.translations.some((t) => t.locale === currentRef);
    if (!currentRef || !stillExists) {
      state.referenceLocale = state.translations?.[0]?.locale || null;
    }
  }
  if (message && message.message) {
    showTransStatus(message.message, message.success ? "success" : "error");
    if (!message.success) {
      showToast(message.message, "error");
    }
  }
  renderTranslations();
}

// Restore the user's saved translation directory on startup.
loadSavedDir();
