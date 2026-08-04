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
export function updateIgnoredAssetPaths(action, kind, value) { vscode.postMessage({ type: "updateIgnoredAssetPaths", action, kind, value }); }
export function migrateAndroid() { vscode.postMessage({ type: "migrateAndroid" }); }
export function migrateAndroid16kb() { vscode.postMessage({ type: "migrateAndroid16kb" }); }
export function postMessage(msg) { vscode.postMessage(msg); }
export function sendReady() { vscode.postMessage({ type: "ready" }); }
