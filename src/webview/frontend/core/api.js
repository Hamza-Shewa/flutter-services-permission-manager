const vscode = window.vscode || acquireVsCodeApi();

/** Forward a script error to the extension host (logged there; asserted on by the webview runtime test). */
export function reportWebviewError(entry) {
  try {
    vscode.postMessage({ type: "webviewError", ...entry });
  } catch {
    // Nothing else to do: the error is already in the developer console.
  }
}
// Errors recorded by webview-utils.js before this module loaded, then live reporting from here on.
(window.__fcmErrors || []).splice(0).forEach(reportWebviewError);
window.__fcmReportError = reportWebviewError;

export function sendRefresh() { vscode.postMessage({ type: "refresh" }); }
export function requestAllAndroidPermissions() { vscode.postMessage({ type: "requestAllAndroidPermissions" }); }
export function requestAllIOSPermissions() { vscode.postMessage({ type: "requestAllIOSPermissions" }); }
export function requestServices() { vscode.postMessage({ type: "requestServices" }); }
export function requestPackagesAnalysis() { vscode.postMessage({ type: "requestPackagesAnalysis" }); }
export function searchPackages(query) { vscode.postMessage({ type: "searchPackages", query }); }
export function requestPackageDetails(packageName) { vscode.postMessage({ type: "requestPackageDetails", packageName }); }
export function addPackage(packageName) { vscode.postMessage({ type: "addPackage", packageName }); }
export function upgradeSinglePackage(packageName, major = false) { vscode.postMessage({ type: "upgradeSinglePackage", packageName, major }); }
export function removeAllFlaggedPackages(packages) { vscode.postMessage({ type: "removeAllFlaggedPackages", packages }); }
export function downgradePackage(packageName) { vscode.postMessage({ type: "downgradePackage", packageName }); }
export function installDependencyValidator() { vscode.postMessage({ type: "installDependencyValidator" }); }
export function checkDependencyValidator() { vscode.postMessage({ type: "checkDependencyValidator" }); }
export function runDependencyValidator() { vscode.postMessage({ type: "runDependencyValidator" }); }
export function analyzeUnusedAssets() { vscode.postMessage({ type: "analyzeUnusedAssets" }); }
export function convertImagesToWebp(apply, quality, lossless) { vscode.postMessage({ type: "convertImagesToWebp", apply, quality, lossless }); }
export function deleteUnusedAsset(assetPath) { vscode.postMessage({ type: "deleteUnusedAsset", assetPath }); }
export function deleteAllUnusedAssets(assetPaths) { vscode.postMessage({ type: "deleteAllUnusedAssets", assetPaths }); }
export function revealAssetReference(file, line, column) { vscode.postMessage({ type: "revealAssetReference", file, line, column }); }
export function updateIgnoredAssetPaths(action, mode, kind, value) { vscode.postMessage({ type: "updateIgnoredAssetPaths", action, mode, kind, value }); }
export function migrateAndroid() { vscode.postMessage({ type: "migrateAndroid" }); }
export function migrateAndroid16kb() { vscode.postMessage({ type: "migrateAndroid16kb" }); }
export function requestTranslations(dir) { vscode.postMessage({ type: "requestTranslations", dir }); }
export function addTranslationLocale(locale, referenceLocale, dir) { vscode.postMessage({ type: "addTranslationLocale", locale, referenceLocale, dir }); }
export function removeTranslationLocale(locale, dir) { vscode.postMessage({ type: "removeTranslationLocale", locale, dir }); }
export function autoAddMissingKeys(referenceLocale, dir) { vscode.postMessage({ type: "autoAddMissingKeys", referenceLocale, dir }); }
export function translateAll(referenceLocale, dir) { vscode.postMessage({ type: "translateAll", referenceLocale, dir }); }
export function translateMissing(referenceLocale, dir) { vscode.postMessage({ type: "translateMissing", referenceLocale, dir }); }
export function translateLocale(locale, referenceLocale, dir) { vscode.postMessage({ type: "translateLocale", locale, referenceLocale, dir }); }
export function translateLocaleMissing(locale, referenceLocale, dir) { vscode.postMessage({ type: "translateLocaleMissing", locale, referenceLocale, dir }); }
export function saveTranslations(translations, dir) { vscode.postMessage({ type: "saveTranslations", translations, dir }); }
export function browseTranslationsDir() { vscode.postMessage({ type: "browseTranslationsDir" }); }
export function scanInteractives() { vscode.postMessage({ type: "scanInteractives" }); }
export function copySemanticsPrompt() { vscode.postMessage({ type: "copySemanticsPrompt" }); }
export function dumpAndroidUi(mode) { vscode.postMessage({ type: "dumpAndroidUi", mode }); }
export function scanTrail() { vscode.postMessage({ type: "scanTrail" }); }
export function loadTrails() { vscode.postMessage({ type: "loadTrails" }); }
export function findTrailPaths(from, to) { vscode.postMessage({ type: "findTrailPaths", from, to }); }
export function copyTrailPrompt(goal) { vscode.postMessage({ type: "copyTrailPrompt", goal }); }
export function copyTrailMermaid(routes) { vscode.postMessage({ type: "copyTrailMermaid", routes }); }
export function deleteTrail(id) { vscode.postMessage({ type: "deleteTrail", id }); }
export function checkMcpClients() { vscode.postMessage({ type: "checkMcpClients" }); }
export function installMcpClient(client) { vscode.postMessage({ type: "installMcpClient", client }); }
export function copyMcpConfig() { vscode.postMessage({ type: "copyMcpConfig" }); }
export function previewSemanticsFixes(requests) { vscode.postMessage({ type: "previewSemanticsFixes", requests }); }
export function applySemanticsFixes(previewId) { vscode.postMessage({ type: "applySemanticsFixes", previewId }); }
export function revealSourceReference(path, line, column) { vscode.postMessage({ type: "revealSourceReference", path, line, column }); }
export function browseIconSource() { vscode.postMessage({ type: "browseIconSource" }); }
export function requestCurrentIconPreview() { vscode.postMessage({ type: "requestCurrentIconPreview" }); }
/** options: { sourcePath, platforms, scalePercent, backgroundColor, trimMargins, androidFamilies } */
export function generateIcons(options) { vscode.postMessage({ type: "generateIcons", ...options }); }
export function browseSplashSource() { vscode.postMessage({ type: "browseSplashSource" }); }
export function requestCurrentSplashPreview() { vscode.postMessage({ type: "requestCurrentSplashPreview" }); }
/** options: { sourcePath, platforms, scalePercent, backgroundColor, trimMargins, logoSize } */
export function generateSplash(options) { vscode.postMessage({ type: "generateSplash", ...options }); }
export function postMessage(msg) { vscode.postMessage(msg); }
export function sendReady() { vscode.postMessage({ type: "ready" }); }
