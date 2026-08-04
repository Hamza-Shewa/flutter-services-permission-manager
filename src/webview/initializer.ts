/**
 * Webview initialization
 * Shared initialization logic for both Panel and View
 */

import * as vscode from "vscode";
import type {
  AndroidPermission,
  IOSPermission,
  PermissionsPayload,
  WebviewMessage,
  ServicesConfigFile,
  AppNameLocalization,
  LanguageInfo,
} from "../types/index.js";
import { getCategorizedIOSPermissions } from "../utils/extractors.js";
import { extractServices } from "../services/index.js";
import { extractAndroidAppNameLocalizations } from "../services/android/localization.service.js";
import { extractIOSAppNameLocalizations } from "../services/ios/localization.service.js";
import { getWebviewContent } from "./content.js";
import { readJsonFile } from "../utils/file.js";
import { discoverProjectPlatformDetails } from "../services/workspace.js";
import type { ProjectFiles } from "../services/workspace.js";

import {
  setCategorizedIosPermissionsCache,
  setServicesConfigCache,
  setPreviousServicesCache,
  getServicesConfigCache,
} from "./state.js";
import { debounce } from "../utils/debounce.js";
import { MessageBus } from "./message-bus.js";
import {
  handleRefresh,
  handleRequestAllAndroid,
  handleRequestAllIOS,
  handleRequestServices,
  handleSavePermissions,
  handleSaveServices,
  handleSaveAppName,
  handleSavePlatformDetails,
  handleSavePackageNames,
  handleSaveAndroidBuildDetails,
  handleSaveIosBuildDetails,
  handleMigrateAndroid,
  handleMigrateAndroid16kb,
  handleUpgradePackages,
  handleRequestPackagesAnalysis,
  handleUpgradeSinglePackage,
  handleSearchPackages,
  handleRequestPackageDetails,
  handleAddPackage,
  handleCheckDependencyValidator,
  handleInstallDependencyValidator,
  handleRunDependencyValidator,
  handleRemovePackage,
  handleDowngradePackage,
  handleRemoveAllFlaggedPackages,
  handleAnalyzeUnusedAssets,
  handleDeleteUnusedAssets,
  handleRevealAssetReference,
  handleUpdateIgnoredAssetPaths,
  type WebviewRef,
} from "./handlers/index.js";

interface LanguagesConfigFile {
  languages: LanguageInfo[];
}

/** Target type for webview initialization */
export type WebviewTarget =
  | { type: "panel"; panel: vscode.WebviewPanel }
  | { type: "view"; view: vscode.WebviewView };

/**
 * Initialize a webview (Panel or View) with Flutter config manager content
 */
export async function initializePermissionWebview(
  target: WebviewTarget,
  extensionUri: vscode.Uri,
  androidPermissions: AndroidPermission[],
  iosPermissions: IOSPermission[],
  macosPermissions: IOSPermission[],
  files: ProjectFiles,
): Promise<void> {
  // Load and cache data
  const [categorizedPermissions, servicesConfigFile, languagesConfig] = await Promise.all([
    getCategorizedIOSPermissions(),
    readJsonFile<ServicesConfigFile>("services-config.json"),
    readJsonFile<LanguagesConfigFile>("languages.json"),
  ]);

  setCategorizedIosPermissionsCache(categorizedPermissions);
  setServicesConfigCache(servicesConfigFile?.services ?? null);

  // Extract existing services
  const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
  const platformDetails = await discoverProjectPlatformDetails(files);
  const existingServices = await extractServices(
    workspaceFolder?.uri,
    files.androidManifestUri,
    files.androidMainActivityUri,
    files.iosPlistUri,
    files.iosAppDelegateUri,
    files.iosEntitlementsUri,
    files.iosPbxprojUri,
    servicesConfigFile?.services ?? [],
  );

  setPreviousServicesCache(existingServices);

  // Extract app name localizations
  let appNameData: AppNameLocalization | undefined;
  if (workspaceFolder) {
    const androidAppName = await extractAndroidAppNameLocalizations(workspaceFolder.uri);
    const iosAppName = await extractIOSAppNameLocalizations(workspaceFolder.uri);

    // Prefer Android values, fallback to iOS
    const defaultName = androidAppName?.defaultName || iosAppName?.defaultName || "";
    const localizations = { ...(iosAppName?.localizations || {}), ...(androidAppName?.localizations || {}) };

    if (defaultName) {
      appNameData = {
        defaultName,
        localizations
      };
    }
  }

  // Build initial payload
  const payload: PermissionsPayload = {
    type: "permissions",
    androidPermissions,
    iosPermissions,
    macosPermissions,
    hasAndroidManifest: !!files.androidManifestUri,
    hasIOSPlist: !!files.iosPlistUri,
    hasMacOSPlist: !!files.macosPlistUri,
    hasPodfile: !!files.iosPodfileUri,
    services: existingServices,
    availableServices: servicesConfigFile?.services ?? [],
    platformDetails,
    appName: appNameData ?? { defaultName: '', localizations: {} },
    languages: languagesConfig?.languages ?? [],
  };

  const webview = target.type === "panel" ? target.panel.webview : target.view.webview;

  // Set up message handler
  const ref: WebviewRef = target.type === "panel"
    ? { kind: 'panel', panel: target.panel, webview }
    : { kind: 'view', view: target.view, webview };
  setupMessageHandler(ref, payload, files);

  // Set up visibility change handler
  if (target.type === "panel") {
    target.panel.onDidChangeViewState(async (e) => {
      if (e.webviewPanel.visible) {
        await handleRefresh(ref, files);
      }
    });
  } else {
    target.view.onDidChangeVisibility(async () => {
      if (target.view.visible) {
        await handleRefresh(ref, files);
      }
    });
  }

  // Set up file watcher
  if (workspaceFolder) {
    const watcher = vscode.workspace.createFileSystemWatcher(
      new vscode.RelativePattern(
        workspaceFolder,
        '{**/AndroidManifest.xml,**/Info.plist,**/Podfile,**/pubspec.yaml}'
      )
    );
    const debouncedRefresh = debounce(() => handleRefresh(ref, files), 1500);
    watcher.onDidChange(debouncedRefresh);
    watcher.onDidCreate(debouncedRefresh);

    if (target.type === "panel") {
      target.panel.onDidDispose(() => watcher.dispose());
    } else {
      target.view.onDidDispose(() => watcher.dispose());
    }
  }

  // Set webview HTML content
  webview.html = await getWebviewContent(webview, extensionUri);

  // Send initial payload
  webview.postMessage(payload);
}

/**
 * Sets up the message handler for webview communication
 */
function setupMessageHandler(
  ref: WebviewRef,
  initialPayload: PermissionsPayload,
  files: ProjectFiles,
): void {
  const bus = new MessageBus(ref.webview);

  bus
    .register("ready", () => {
      console.log("[Extension Backend] Received 'ready' from webview. Sending initial payload...");
      ref.webview.postMessage(initialPayload);
    })
    .register("refresh", async () => {
      console.log("[Extension Backend] Received 'refresh' from webview. Reloading data...");
      await handleRefresh(ref, files);
    })
    .register("requestAllAndroidPermissions", async () => await handleRequestAllAndroid(ref))
    .register("requestAllIOSPermissions", async () => await handleRequestAllIOS(ref))
    .register("requestServices", () => handleRequestServices(ref))
    .register("savePermissions", async (msg) =>
      await handleSavePermissions(ref, msg.androidPermissions ?? [], msg.iosPermissions ?? [], msg.macosPermissions ?? [], files)
    )
    .register("saveAppName", async (msg) => await handleSaveAppName(ref, msg.appName, files))
    .register("savePlatformDetails", async (msg) => await handleSavePlatformDetails(ref, msg.platformDetails, files))
    .register("saveServices", async (msg) => await handleSaveServices(ref, msg.services ?? [], files))
    .register("savePackageNames", async (msg) =>
      await handleSavePackageNames(ref, { applicationId: msg.applicationId || "", bundleIdentifier: msg.bundleIdentifier || "" }, files)
    )
    .register("saveAndroidBuildDetails", async (msg) => await handleSaveAndroidBuildDetails(ref, msg.androidDetails ?? [], files))
    .register("saveIosBuildDetails", async (msg) => await handleSaveIosBuildDetails(ref, msg.iosDetails ?? [], files))
    .register("migrateAndroid", async () => await handleMigrateAndroid(ref))
    .register("migrateAndroid16kb", async () => await handleMigrateAndroid16kb(ref))
    .register("upgradePackages", async () => await handleUpgradePackages(ref))
    .register("requestPackagesAnalysis", async () => await handleRequestPackagesAnalysis(ref))
    .register("upgradeSinglePackage", async (msg) => { if (msg.packageName) { await handleUpgradeSinglePackage(ref, msg.packageName); } })
    .register("searchPackages", async (msg) => { if (msg.query !== undefined) { await handleSearchPackages(ref, msg.query); } })
    .register("requestPackageDetails", async (msg) => { if (msg.packageName) { await handleRequestPackageDetails(ref, msg.packageName); } })
    .register("addPackage", async (msg) => { if (msg.packageName) { await handleAddPackage(ref, msg.packageName); } })
    .register("checkDependencyValidator", async () => await handleCheckDependencyValidator(ref))
    .register("installDependencyValidator", async () => await handleInstallDependencyValidator(ref))
    .register("runDependencyValidator", async () => await handleRunDependencyValidator(ref))
    .register("removePackage", async (msg) => { if (msg.packageName) { await handleRemovePackage(ref, msg.packageName); } })
    .register("downgradePackage", async (msg) => { if (msg.packageName) { await handleDowngradePackage(ref, msg.packageName); } })
    .register("removeAllFlaggedPackages", async (msg) => { if (msg.packages) { await handleRemoveAllFlaggedPackages(ref, msg.packages); } })
    .register("analyzeUnusedAssets", async () => await handleAnalyzeUnusedAssets(ref))
    .register("deleteUnusedAsset", async (msg) => { if (msg.assetPath) { await handleDeleteUnusedAssets(ref, [msg.assetPath]); } })
    .register("deleteAllUnusedAssets", async (msg) => { if (msg.assetPaths) { await handleDeleteUnusedAssets(ref, msg.assetPaths); } })
    .register("revealAssetReference", async (msg) => { if (msg.file) { await handleRevealAssetReference(ref, { file: msg.file, line: msg.line, column: msg.column }); } })
    .register("updateIgnoredAssetPaths", async (msg) => { if (msg.value) { await handleUpdateIgnoredAssetPaths(ref, { action: msg.action, mode: msg.mode === "dynamic" ? "dynamic" : "full", kind: msg.kind, value: msg.value }); } })
    .register("webview_error", (msg) => { console.error("[WEBVIEW ERROR]:", JSON.stringify(msg, null, 2)); })
    .register("webview_log", (msg) => { console.log("[WEBVIEW LOG]:", msg.message); });
}
