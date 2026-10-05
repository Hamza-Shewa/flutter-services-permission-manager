import * as api from "../../core/api.js";

const qualityInput = document.getElementById("webpQuality");
const losslessInput = document.getElementById("webpLossless");
const previewButton = document.getElementById("webpPreviewButton");
const applyButton = document.getElementById("webpApplyButton");
const statusEl = document.getElementById("webpStatus");
const tableContainer = document.getElementById("webpTableContainer");
const tableBody = document.getElementById("webpTableBody");

function formatBytes(bytes) {
    if (bytes < 1024) { return `${bytes} B`; }
    if (bytes < 1024 * 1024) { return `${(bytes / 1024).toFixed(1)} KB`; }
    return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

function options() {
    const quality = Math.min(100, Math.max(1, Math.round(Number(qualityInput?.value) || 85)));
    return { quality, lossless: !!losslessInput?.checked };
}

function setBusy(busy, text) {
    if (previewButton) { previewButton.disabled = busy; }
    if (applyButton) { applyButton.disabled = busy; }
    if (statusEl && text !== undefined) { statusEl.textContent = text; }
}

function cell(text, title) {
    const td = document.createElement("td");
    td.textContent = text;
    if (title) { td.title = title; }
    return td;
}

export function handleWebpConversionResult(message) {
    setBusy(false, "");
    if (message.error || !message.result) {
        if (applyButton) { applyButton.style.display = "none"; }
        if (statusEl) { statusEl.textContent = `Conversion failed: ${message.error || "no result"}`; }
        return;
    }
    const result = message.result;
    if (tableBody) {
        tableBody.textContent = "";
        for (const image of result.images) {
            const row = document.createElement("tr");
            row.appendChild(cell(image.path));
            if (image.status === "converted" || image.status === "would-convert") {
                const saved = image.before > 0 ? Math.round((1 - image.after / image.before) * 100) : 0;
                row.appendChild(cell(`${formatBytes(image.before)} → ${formatBytes(image.after)}`));
                row.appendChild(cell(`-${saved}%`));
            } else {
                const skipped = cell(`${image.status}: ${image.reason || ""}`, image.reason || "");
                skipped.colSpan = 2;
                skipped.style.color = "var(--text-secondary)";
                row.appendChild(skipped);
            }
            tableBody.appendChild(row);
        }
    }
    if (tableContainer) { tableContainer.style.display = result.images.length > 0 ? "block" : "none"; }

    const saved = formatBytes(result.bytesSaved);
    if (message.applied) {
        if (applyButton) { applyButton.style.display = "none"; }
        const updated = result.rewrittenFiles.length > 0 ? ` References updated in ${result.rewrittenFiles.length} file(s).` : "";
        statusEl.textContent = `Converted ${result.converted} of ${result.totalImages} image(s), saved ${saved}.${updated} Review the diff and run the app: paths built from variables cannot be detected.`;
    } else if (result.converted > 0) {
        statusEl.textContent = `${result.converted} of ${result.totalImages} image(s) can be converted, saving ${saved} (${result.skipped} skipped, ${result.failed} failed).`;
        if (applyButton) {
            applyButton.textContent = `Convert ${result.converted} image(s) and update references`;
            applyButton.style.display = "inline-block";
        }
    } else {
        if (applyButton) { applyButton.style.display = "none"; }
        statusEl.textContent = result.totalImages === 0
            ? "No PNG/JPG/JPEG files are declared as assets."
            : "Nothing to convert - see the reasons below.";
    }
}

if (previewButton) {
    previewButton.addEventListener("click", () => {
        const { quality, lossless } = options();
        if (applyButton) { applyButton.style.display = "none"; }
        setBusy(true, "Encoding images to estimate the savings...");
        api.convertImagesToWebp(false, quality, lossless);
    });
}
if (applyButton) {
    applyButton.addEventListener("click", () => {
        const { quality, lossless } = options();
        setBusy(true, "Converting images and updating references...");
        api.convertImagesToWebp(true, quality, lossless);
    });
}
// A new quality / mode invalidates the previewed numbers.
for (const input of [qualityInput, losslessInput]) {
    if (input) {
        input.addEventListener("change", () => { if (applyButton) { applyButton.style.display = "none"; } });
    }
}
