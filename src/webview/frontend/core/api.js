const vscode = window.vscode || acquireVsCodeApi();

export function sendRefresh() { vscode.postMessage({ type: "refresh" }); }
export function requestAllAndroidPermissions() { vscode.postMessage({ type: "requestAllAndroidPermissions" }); }
export function requestAllIOSPermissions() { vscode.postMessage({ type: "requestAllIOSPermissions" }); }
export function requestServices() { vscode.postMessage({ type: "requestServices" }); }
export function requestPackagesAnalysis() { vscode.postMessage({ type: "requestPackagesAnalysis" }); }
export function searchPackages(query) { vscode.postMessage({ type: "searchPackages", query }); }
export function requestPackageDetails(packageName) { vscode.postMessage({ type: "requestPackageDetails", packageName }); }
export function addPackage(packageName) { vscode.postMessage({ type: "addPackage", packageName }); }
export function upgradeSinglePackage(packageName) { vscode.postMessage({ type: "upgradeSinglePackage", packageName }); }
export function removeAllFlaggedPackages(packages) { vscode.postMessage({ type: "removeAllFlaggedPackages", packages }); }
export function downgradePackage(packageName) { vscode.postMessage({ type: "downgradePackage", packageName }); }
export function installDependencyValidator() { vscode.postMessage({ type: "installDependencyValidator" }); }
export function checkDependencyValidator() { vscode.postMessage({ type: "checkDependencyValidator" }); }
export function runDependencyValidator() { vscode.postMessage({ type: "runDependencyValidator" }); }
export function analyzeUnusedAssets() { vscode.postMessage({ type: "analyzeUnusedAssets" }); }
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
export function postMessage(msg) { vscode.postMessage(msg); }
export function sendReady() { vscode.postMessage({ type: "ready" }); }
