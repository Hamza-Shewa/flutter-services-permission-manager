import { state } from "./state.js";
import * as api from "./api.js";
import { setStatus } from "./utils.js";
import {
    assetsHeaderActions,
    assetsLoadingIndicator,
    assetsLoadingText,
    assetsEmptyContainer,
    scanAssetsButton,
    assetsTableContainer,
    assetsTableBody,
    assetsDeleteModalBackdrop,
    assetsDeleteMessage,
    assetsDeleteCancel,
    assetsDeleteConfirm,
    assetsMaybeDeleteModalBackdrop,
    assetsMaybeDeleteMessage,
    assetsMaybeDeleteExpected,
    assetsMaybeDeleteInput,
    assetsMaybeDeleteCancel,
    assetsMaybeDeleteConfirm,
    assetsIgnoreDirInput,
    assetsIgnoreDirAdd,
    assetsIgnoreFileInput,
    assetsIgnoreFileAdd,
    assetsIgnoreChips,
    assetsIgnoreDynDirInput,
    assetsIgnoreDynDirAdd,
    assetsIgnoreDynFileInput,
    assetsIgnoreDynFileAdd,
    assetsIgnoreDynChips,
    assetsIgnoreAssetDirInput,
    assetsIgnoreAssetDirAdd,
    assetsIgnoreAssetChips,
    assetsIgnoreLoaderInput,
    assetsIgnoreLoaderAdd,
    assetsIgnoreLoaderChips,
} from "./elements.js";

let pendingDeleteAssets = []; // Array of project-relative asset paths
let pendingDeleteRefs = [];   // Dynamic references for the current delete modal
let pendingMaybeDelete = [];  // Paths queued for the two-step maybe-used modal
let maybeDeleteExpected = 0;  // Count the user must type to enable the confirm

function formatBytes(bytes) {
    if (bytes == null) { return "-"; }
    if (bytes < 1024) { return `${bytes} B`; }
    if (bytes < 1024 * 1024) { return `${(bytes / 1024).toFixed(1)} KB`; }
    return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

export function scanUnusedAssets() {
    if (assetsLoadingIndicator) {
        assetsLoadingIndicator.style.display = "block";
        if (assetsLoadingText) {
            assetsLoadingText.textContent = "Scanning for unused assets...";
        }
    }
    if (assetsTableContainer) { assetsTableContainer.style.display = "none"; }
    if (assetsEmptyContainer) { assetsEmptyContainer.style.display = "none"; }
    api.analyzeUnusedAssets();
}

export function hideAssetsLoading() {
    if (assetsLoadingIndicator) {
        assetsLoadingIndicator.style.display = "none";
    }
}

function showAssetsDeleteModal(paths, refs) {
    pendingDeleteAssets = paths || [];
    pendingDeleteRefs = refs || [];
    if (assetsDeleteMessage) {
        if (pendingDeleteAssets.length === 1 && pendingDeleteRefs.length > 0) {
            const files = pendingDeleteRefs.map((r) => r.file).filter(Boolean).join(", ");
            assetsDeleteMessage.textContent =
                `${pendingDeleteAssets[0]} is dynamically referenced by ${files}. Delete anyway?`;
        } else if (pendingDeleteAssets.length === 1) {
            assetsDeleteMessage.textContent =
                "Are you sure you want to delete this unused asset file?";
        } else {
            assetsDeleteMessage.textContent =
                `Are you sure you want to delete these ${pendingDeleteAssets.length} unused asset files?`;
        }
    }
    if (assetsDeleteModalBackdrop) {
        assetsDeleteModalBackdrop.style.display = "flex";
    }
}

function hideAssetsDeleteModal() {
    pendingDeleteAssets = [];
    pendingDeleteRefs = [];
    if (assetsDeleteModalBackdrop) {
        assetsDeleteModalBackdrop.style.display = "none";
    }
}

function showMaybeUsedDeleteModal() {
    const maybe = state.assetsState?.maybeUsedAssets || [];
    if (maybe.length === 0) { return; }
    pendingMaybeDelete = maybe.map((a) => a.path);
    maybeDeleteExpected = maybe.length;

    const files = new Set();
    maybe.forEach((a) => (a.refs || []).forEach((r) => { if (r.file) { files.add(r.file); } }));
    const fileList = Array.from(files).slice(0, 10).join(", ");
    const more = files.size > 10 ? `, +${files.size - 10} more` : "";

    if (assetsMaybeDeleteMessage) {
        assetsMaybeDeleteMessage.textContent =
            `${maybe.length} assets are referenced dynamically by: ${fileList}${more}.`;
    }
    if (assetsMaybeDeleteExpected) {
        assetsMaybeDeleteExpected.textContent = String(maybeDeleteExpected);
    }
    if (assetsMaybeDeleteInput) {
        assetsMaybeDeleteInput.value = "";
    }
    if (assetsMaybeDeleteConfirm) {
        assetsMaybeDeleteConfirm.disabled = true;
    }
    if (assetsMaybeDeleteModalBackdrop) {
        assetsMaybeDeleteModalBackdrop.style.display = "flex";
    }
}

function hideMaybeUsedDeleteModal() {
    pendingMaybeDelete = [];
    if (assetsMaybeDeleteModalBackdrop) {
        assetsMaybeDeleteModalBackdrop.style.display = "none";
    }
}

function updateMaybeUsedDeleteConfirm() {
    if (!assetsMaybeDeleteInput || !assetsMaybeDeleteConfirm) { return; }
    const value = Number(assetsMaybeDeleteInput.value);
    assetsMaybeDeleteConfirm.disabled = !(Number.isInteger(value) && value === maybeDeleteExpected);
}

if (assetsDeleteCancel) {
    assetsDeleteCancel.addEventListener("click", hideAssetsDeleteModal);
}
if (assetsDeleteConfirm) {
    assetsDeleteConfirm.addEventListener("click", () => {
        if (pendingDeleteAssets.length > 0) {
            if (assetsLoadingIndicator) {
                assetsLoadingIndicator.style.display = "block";
                if (assetsLoadingText) {
                    assetsLoadingText.textContent = `Deleting ${pendingDeleteAssets.length} unused asset(s)...`;
                }
            }
            if (assetsTableContainer) { assetsTableContainer.style.display = "none"; }
            if (assetsEmptyContainer) { assetsEmptyContainer.style.display = "none"; }

            if (pendingDeleteAssets.length === 1) {
                api.deleteUnusedAsset(pendingDeleteAssets[0]);
            } else {
                api.deleteAllUnusedAssets(pendingDeleteAssets);
            }
            hideAssetsDeleteModal();
        }
    });
}

if (assetsMaybeDeleteCancel) {
    assetsMaybeDeleteCancel.addEventListener("click", hideMaybeUsedDeleteModal);
}
if (assetsMaybeDeleteInput) {
    assetsMaybeDeleteInput.addEventListener("input", updateMaybeUsedDeleteConfirm);
}
if (assetsMaybeDeleteConfirm) {
    assetsMaybeDeleteConfirm.addEventListener("click", () => {
        if (pendingMaybeDelete.length === 0) { return; }
        if (assetsLoadingIndicator) {
            assetsLoadingIndicator.style.display = "block";
            if (assetsLoadingText) {
                assetsLoadingText.textContent = `Deleting ${pendingMaybeDelete.length} maybe-used asset(s)...`;
            }
        }
        if (assetsTableContainer) { assetsTableContainer.style.display = "none"; }
        if (assetsEmptyContainer) { assetsEmptyContainer.style.display = "none"; }
        api.deleteAllUnusedAssets(pendingMaybeDelete);
        hideMaybeUsedDeleteModal();
    });
}

if (scanAssetsButton) {
    scanAssetsButton.addEventListener("click", scanUnusedAssets);
}

function getIgnoreList(mode, kind) {
    const s = state.assetsState || {};
    if (mode === "loader") {
        return s.ignoredLoaders || [];
    }
    if (mode === "asset") {
        return s.ignoredAssetDirectories || [];
    }
    if (mode === "dynamic") {
        return kind === "file"
            ? (s.ignoredDynamicFiles || [])
            : (s.ignoredDynamicDirectories || []);
    }
    return kind === "file"
        ? (s.ignoredFiles || [])
        : (s.ignoredDirectories || []);
}

function addIgnoredPath(mode, kind, input) {
    const value = input ? input.value.trim() : "";
    if (!value) { return; }
    if (getIgnoreList(mode, kind).includes(value)) { return; }
    api.updateIgnoredAssetPaths("add", mode, kind, value);
}

function removeIgnoredPath(mode, kind, value) {
    api.updateIgnoredAssetPaths("remove", mode, kind, value);
}

function makeIgnoreChip(mode, kind, value) {
    const dynamic = mode === "dynamic";
    const asset = mode === "asset";
    const loader = mode === "loader";
    const chip = document.createElement("span");
    chip.style.cssText =
        "display:inline-flex; align-items:center; gap:6px; padding:3px 8px; font-size:12px; " +
        "background: var(--bg-primary,#1e1e1e); border:1px solid " +
        (loader ? "#b39ddb" : asset ? "#f0ad4e" : dynamic ? "#4fc3f7" : "var(--vscode-editorGroup-border,#555)") +
        "; border-radius:12px; color: var(--text-primary,#fff);" +
        (dynamic ? " border-style: dashed;" : "");
    const icon = document.createElement("span");
    icon.textContent = loader ? "🛑" : kind === "file" ? "📄" : "📁";
    chip.appendChild(icon);
    const label = document.createElement("span");
    label.textContent = value;
    chip.appendChild(label);
    const close = document.createElement("button");
    close.type = "button";
    close.textContent = "✕";
    close.title = `Remove ${value}`;
    close.style.cssText =
        "border:none; background:transparent; color:var(--text-secondary,#aaa); cursor:pointer; " +
        "font-size:12px; padding:0 2px;";
    close.addEventListener("click", () => removeIgnoredPath(mode, kind, value));
    chip.appendChild(close);
    return chip;
}

function renderIgnoreChips(container, mode) {
    if (!container) { return; }
    container.innerHTML = "";
    const dirs = getIgnoreList(mode, "directory");
    const files = getIgnoreList(mode, "file");
    if (dirs.length === 0 && files.length === 0) {
        const empty = document.createElement("span");
        empty.textContent = "None";
        empty.style.cssText = "color: var(--text-secondary,#aaa); font-size: 12px;";
        container.appendChild(empty);
        return;
    }
    dirs.forEach((d) => container.appendChild(makeIgnoreChip(mode, "directory", d)));
    files.forEach((f) => container.appendChild(makeIgnoreChip(mode, "file", f)));
}

function renderIgnoreAssetDirChips() {
    if (!assetsIgnoreAssetChips) { return; }
    assetsIgnoreAssetChips.innerHTML = "";
    const dirs = getIgnoreList("asset", "directory");
    if (dirs.length === 0) {
        const empty = document.createElement("span");
        empty.textContent = "None";
        empty.style.cssText = "color: var(--text-secondary,#aaa); font-size: 12px;";
        assetsIgnoreAssetChips.appendChild(empty);
        return;
    }
    dirs.forEach((d) => assetsIgnoreAssetChips.appendChild(makeIgnoreChip("asset", "directory", d)));
}

function renderIgnoreLoaderChips() {
    if (!assetsIgnoreLoaderChips) { return; }
    assetsIgnoreLoaderChips.innerHTML = "";
    const loaders = getIgnoreList("loader", "loader");
    if (loaders.length === 0) {
        const empty = document.createElement("span");
        empty.textContent = "None";
        empty.style.cssText = "color: var(--text-secondary,#aaa); font-size: 12px;";
        assetsIgnoreLoaderChips.appendChild(empty);
        return;
    }
    loaders.forEach((l) => assetsIgnoreLoaderChips.appendChild(makeIgnoreChip("loader", "loader", l)));
}

export function renderAssetIgnoreEditor() {
    renderIgnoreChips(assetsIgnoreChips, "full");
    renderIgnoreChips(assetsIgnoreDynChips, "dynamic");
    renderIgnoreAssetDirChips();
    renderIgnoreLoaderChips();
}

if (assetsIgnoreDirAdd) {
    assetsIgnoreDirAdd.addEventListener("click", () => addIgnoredPath("full", "directory", assetsIgnoreDirInput));
}
if (assetsIgnoreFileAdd) {
    assetsIgnoreFileAdd.addEventListener("click", () => addIgnoredPath("full", "file", assetsIgnoreFileInput));
}
if (assetsIgnoreDynDirAdd) {
    assetsIgnoreDynDirAdd.addEventListener("click", () => addIgnoredPath("dynamic", "directory", assetsIgnoreDynDirInput));
}
if (assetsIgnoreDynFileAdd) {
    assetsIgnoreDynFileAdd.addEventListener("click", () => addIgnoredPath("dynamic", "file", assetsIgnoreDynFileInput));
}
if (assetsIgnoreAssetDirAdd) {
    assetsIgnoreAssetDirAdd.addEventListener("click", () => addIgnoredPath("asset", "assetDirectory", assetsIgnoreAssetDirInput));
}
if (assetsIgnoreLoaderAdd) {
    assetsIgnoreLoaderAdd.addEventListener("click", () => addIgnoredPath("loader", "loader", assetsIgnoreLoaderInput));
}
if (assetsIgnoreDirInput) {
    assetsIgnoreDirInput.addEventListener("keydown", (e) => {
        if (e.key === "Enter") { addIgnoredPath("full", "directory", assetsIgnoreDirInput); }
    });
}
if (assetsIgnoreFileInput) {
    assetsIgnoreFileInput.addEventListener("keydown", (e) => {
        if (e.key === "Enter") { addIgnoredPath("full", "file", assetsIgnoreFileInput); }
    });
}
if (assetsIgnoreDynDirInput) {
    assetsIgnoreDynDirInput.addEventListener("keydown", (e) => {
        if (e.key === "Enter") { addIgnoredPath("dynamic", "directory", assetsIgnoreDynDirInput); }
    });
}
if (assetsIgnoreDynFileInput) {
    assetsIgnoreDynFileInput.addEventListener("keydown", (e) => {
        if (e.key === "Enter") { addIgnoredPath("dynamic", "file", assetsIgnoreDynFileInput); }
    });
}
if (assetsIgnoreAssetDirInput) {
    assetsIgnoreAssetDirInput.addEventListener("keydown", (e) => {
        if (e.key === "Enter") { addIgnoredPath("asset", "assetDirectory", assetsIgnoreAssetDirInput); }
    });
}
if (assetsIgnoreLoaderInput) {
    assetsIgnoreLoaderInput.addEventListener("keydown", (e) => {
        if (e.key === "Enter") { addIgnoredPath("loader", "loader", assetsIgnoreLoaderInput); }
    });
}

renderAssetIgnoreEditor();

export function renderAssetsHeaderActions() {
    if (!assetsHeaderActions) { return; }
    assetsHeaderActions.innerHTML = "";

    const scanBtn = document.createElement("button");
    scanBtn.type = "button";
    scanBtn.className = "btn-secondary";
    scanBtn.textContent = "🔍 Scan Assets";
    scanBtn.addEventListener("click", scanUnusedAssets);
    assetsHeaderActions.appendChild(scanBtn);

    const assets = state.assetsState?.assets || [];
    const maybe = state.assetsState?.maybeUsedAssets || [];

    if (assets.length > 0) {
        const delAllBtn = document.createElement("button");
        delAllBtn.type = "button";
        delAllBtn.className = "btn-primary";
        delAllBtn.style.background = "#d32f2f";
        delAllBtn.style.borderColor = "#d32f2f";
        delAllBtn.style.color = "white";
        delAllBtn.textContent = `🗑 Delete All Unused (${assets.length})`;
        delAllBtn.addEventListener("click", () => {
            showAssetsDeleteModal(assets.map((a) => a.path));
        });
        assetsHeaderActions.appendChild(delAllBtn);
    }

    if (maybe.length > 0) {
        const delMaybeBtn = document.createElement("button");
        delMaybeBtn.type = "button";
        delMaybeBtn.className = "btn-secondary";
        delMaybeBtn.style.borderColor = "#f0ad4e";
        delMaybeBtn.style.color = "#f0ad4e";
        delMaybeBtn.textContent = `⚠️ Delete Maybe Used (${maybe.length})`;
        delMaybeBtn.title = "Delete assets referenced via dynamic paths. Requires typing the count to confirm.";
        delMaybeBtn.addEventListener("click", showMaybeUsedDeleteModal);
        assetsHeaderActions.appendChild(delMaybeBtn);
    }
}

/**
 * Builds a label function for referencing-file buttons. Uses the basename,
 * falling back to the project-relative path when basenames collide across
 * different folders.
 */
function buildRefLabelFunction(allAssets) {
    const counts = new Map();
    allAssets.forEach((a) => (a.refs || []).forEach((r) => {
        const base = String(r.file).split("/").pop();
        counts.set(base, (counts.get(base) || 0) + 1);
    }));
    const cache = new Map();
    return (ref) => {
        if (cache.has(ref.file)) { return cache.get(ref.file); }
        const base = String(ref.file).split("/").pop();
        const label = (counts.get(base) || 0) > 1 ? ref.file : base;
        cache.set(ref.file, label);
        return label;
    };
}

function separatorRow(text) {
    const tr = document.createElement("tr");
    tr.className = "assets-bucket-separator";
    const td = document.createElement("td");
    td.colSpan = 4;
    td.textContent = text;
    tr.appendChild(td);
    return tr;
}

function renderAssetRow(asset, labelFor, refs) {
    const tr = document.createElement("tr");

    const tdPath = document.createElement("td");
    tdPath.textContent = asset.path;
    tdPath.title = asset.path;
    tr.appendChild(tdPath);

    const tdSize = document.createElement("td");
    tdSize.textContent = formatBytes(asset.size);
    tr.appendChild(tdSize);

    const tdRefs = document.createElement("td");
    if (refs.length > 0) {
        refs.forEach((ref) => {
            const btn = document.createElement("button");
            btn.type = "button";
            btn.className = ref.dynamic ? "asset-ref-btn weak" : "asset-ref-btn strong";
            btn.textContent = labelFor(ref);
            const where = `${ref.file}:${ref.line}`;
            btn.title = ref.dynamic
                ? `${where} — dynamic path (may reference any asset)`
                : `${where} — ${ref.pattern || "dynamic pattern"}`;
            btn.addEventListener("click", () => {
                api.revealAssetReference(ref.file, ref.line, ref.column);
            });
            tdRefs.appendChild(btn);
        });
    }
    tr.appendChild(tdRefs);

    const tdAction = document.createElement("td");
    const delBtn = document.createElement("button");
    delBtn.className = "btn-upgrade-single";
    delBtn.textContent = "Delete";
    delBtn.style.borderColor = "#d32f2f";
    delBtn.style.color = "#d32f2f";
    delBtn.addEventListener("click", () => {
        showAssetsDeleteModal([asset.path], refs);
    });
    tdAction.appendChild(delBtn);
    tr.appendChild(tdAction);

    return tr;
}

export function renderAssetsTable() {
    if (!assetsTableBody || !assetsTableContainer) { return; }
    assetsTableBody.innerHTML = "";

    const assets = state.assetsState?.assets || [];
    const maybe = state.assetsState?.maybeUsedAssets || [];

    if (assets.length === 0 && maybe.length === 0) {
        assetsTableContainer.style.display = "none";
        if (assetsEmptyContainer) { assetsEmptyContainer.style.display = "block"; }
        renderAssetsHeaderActions();
        return;
    }

    assetsTableContainer.style.display = "block";
    if (assetsEmptyContainer) { assetsEmptyContainer.style.display = "none"; }

    const labelFor = buildRefLabelFunction([...assets, ...maybe]);

    if (assets.length > 0) {
        assetsTableBody.appendChild(separatorRow(`Unused (${assets.length})`));
        assets.forEach((asset) => {
            assetsTableBody.appendChild(renderAssetRow(asset, labelFor, asset.refs || []));
        });
    }
    if (maybe.length > 0) {
        assetsTableBody.appendChild(
            separatorRow(`Maybe used (${maybe.length}) — referenced via dynamic paths`)
        );
        maybe.forEach((asset) => {
            assetsTableBody.appendChild(renderAssetRow(asset, labelFor, asset.refs || []));
        });
    }

    renderAssetsHeaderActions();
}

export function handleUnusedAssetsResult(message) {
    if (assetsLoadingIndicator) { assetsLoadingIndicator.style.display = "none"; }

    if (message.error) {
        state.assetsState = {
            assets: [],
            maybeUsedAssets: [],
            totalAssets: 0,
            usedAssets: 0,
            ignoredDirectories: message.ignoredDirectories || [],
            ignoredFiles: message.ignoredFiles || [],
            ignoredDynamicDirectories: message.ignoredDynamicDirectories || [],
            ignoredDynamicFiles: message.ignoredDynamicFiles || [],
            ignoredAssetDirectories: message.ignoredAssetDirectories || [],
            ignoredLoaders: message.ignoredLoaders || [],
        };
        // Surface the friendly message (e.g. VPN guidance) via the toast/status.
        setStatus(message.error, "error");
        renderAssetIgnoreEditor();
        renderAssetsTable();
        return;
    }

    state.assetsState = {
        assets: message.assets || [],
        maybeUsedAssets: message.maybeUsedAssets || [],
        totalAssets: message.totalAssets || 0,
        usedAssets: message.usedAssets || 0,
        ignoredDirectories: message.ignoredDirectories || state.assetsState.ignoredDirectories || [],
        ignoredFiles: message.ignoredFiles || state.assetsState.ignoredFiles || [],
        ignoredDynamicDirectories: message.ignoredDynamicDirectories || state.assetsState.ignoredDynamicDirectories || [],
        ignoredDynamicFiles: message.ignoredDynamicFiles || state.assetsState.ignoredDynamicFiles || [],
        ignoredAssetDirectories: message.ignoredAssetDirectories || state.assetsState.ignoredAssetDirectories || [],
        ignoredLoaders: message.ignoredLoaders || state.assetsState.ignoredLoaders || [],
    };
    renderAssetIgnoreEditor();
    renderAssetsTable();
}
