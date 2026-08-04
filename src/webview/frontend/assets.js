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
} from "./elements.js";

let pendingDeleteAssets = []; // Array of project-relative asset paths

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

function showAssetsDeleteModal(paths) {
    pendingDeleteAssets = paths || [];
    if (assetsDeleteMessage) {
        assetsDeleteMessage.textContent =
            pendingDeleteAssets.length === 1
                ? `Are you sure you want to delete this unused asset file?`
                : `Are you sure you want to delete these ${pendingDeleteAssets.length} unused asset files?`;
    }
    if (assetsDeleteModalBackdrop) {
        assetsDeleteModalBackdrop.style.display = "flex";
    }
}

function hideAssetsDeleteModal() {
    pendingDeleteAssets = [];
    if (assetsDeleteModalBackdrop) {
        assetsDeleteModalBackdrop.style.display = "none";
    }
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

if (scanAssetsButton) {
    scanAssetsButton.addEventListener("click", scanUnusedAssets);
}

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
    if (assets.length > 0) {
        const delAllBtn = document.createElement("button");
        delAllBtn.type = "button";
        delAllBtn.className = "btn-primary";
        delAllBtn.style.background = "#d32f2f";
        delAllBtn.style.borderColor = "#d32f2f";
        delAllBtn.style.color = "white";
        delAllBtn.textContent = "🗑 Delete All Unused";
        delAllBtn.addEventListener("click", () => {
            showAssetsDeleteModal(assets.map((a) => a.path));
        });
        assetsHeaderActions.appendChild(delAllBtn);
    }
}

export function renderAssetsTable() {
    if (!assetsTableBody || !assetsTableContainer) { return; }
    assetsTableBody.innerHTML = "";

    const assets = state.assetsState?.assets || [];

    if (assets.length === 0) {
        assetsTableContainer.style.display = "none";
        if (assetsEmptyContainer) { assetsEmptyContainer.style.display = "block"; }
        renderAssetsHeaderActions();
        return;
    }

    assetsTableContainer.style.display = "block";
    if (assetsEmptyContainer) { assetsEmptyContainer.style.display = "none"; }

    assets.forEach((asset) => {
        const tr = document.createElement("tr");

        const tdPath = document.createElement("td");
        tdPath.textContent = asset.path;
        tdPath.title = asset.path;
        tr.appendChild(tdPath);

        const tdSize = document.createElement("td");
        tdSize.textContent = formatBytes(asset.size);
        tr.appendChild(tdSize);

        const tdAction = document.createElement("td");
        const delBtn = document.createElement("button");
        delBtn.className = "btn-upgrade-single";
        delBtn.textContent = "Delete";
        delBtn.style.borderColor = "#d32f2f";
        delBtn.style.color = "#d32f2f";
        delBtn.addEventListener("click", () => {
            showAssetsDeleteModal([asset.path]);
        });
        tdAction.appendChild(delBtn);
        tr.appendChild(tdAction);

        assetsTableBody.appendChild(tr);
    });

    renderAssetsHeaderActions();
}

export function handleUnusedAssetsResult(message) {
    if (assetsLoadingIndicator) { assetsLoadingIndicator.style.display = "none"; }

    if (message.error) {
        state.assetsState = { assets: [], totalAssets: 0, usedAssets: 0 };
        // Surface the friendly message (e.g. VPN guidance) via the toast/status.
        setStatus(message.error, "error");
        renderAssetsTable();
        return;
    }

    state.assetsState = {
        assets: message.assets || [],
        totalAssets: message.totalAssets || 0,
        usedAssets: message.usedAssets || 0,
    };
    renderAssetsTable();
}
