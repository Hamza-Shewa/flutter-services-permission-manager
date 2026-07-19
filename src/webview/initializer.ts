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
import { MessageBus } from "../shared/message-bus.js";
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
  const webview =
    target.type === "panel" ? target.panel.webview : target.view.webview;

  // Set webview HTML content
  webview.html = await getWebviewContent(webview, extensionUri);

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

  bus.on("ready", () => ref.webview.postMessage(initialPayload));
  bus.on("refresh", async () => await handleRefresh(ref, files));
  bus.on("requestAllAndroidPermissions", async () => await handleRequestAllAndroid(ref));
  bus.on("requestAllIOSPermissions", async () => await handleRequestAllIOS(ref));
  bus.on("requestServices", () => handleRequestServices(ref));
  
  bus.on("savePermissions", async (message: any) => 
    await handleSavePermissions(ref, message.androidPermissions ?? [], message.iosPermissions ?? [], message.macosPermissions ?? [], files)
  );
  bus.on("saveAppName", async (message: any) => await handleSaveAppName(ref, message.appName, files));
  bus.on("savePlatformDetails", async (message: any) => await handleSavePlatformDetails(ref, message.platformDetails, files));
  bus.on("saveServices", async (message: any) => await handleSaveServices(ref, message.services ?? [], files));
  
  bus.on("savePackageNames", async (message: any) => 
    await handleSavePackageNames(ref, { applicationId: message.applicationId || "", bundleIdentifier: message.bundleIdentifier || "" }, files)
  );
  
  bus.on("saveAndroidBuildDetails", async (message: any) => await handleSaveAndroidBuildDetails(ref, message.androidDetails ?? [], files));
  bus.on("saveIosBuildDetails", async (message: any) => await handleSaveIosBuildDetails(ref, message.iosDetails ?? [], files));
  
  bus.on("migrateAndroid", async () => await handleMigrateAndroid(ref));
  bus.on("upgradePackages", async () => await handleUpgradePackages(ref));
  bus.on("requestPackagesAnalysis", async () => await handleRequestPackagesAnalysis(ref));
  bus.on("upgradeSinglePackage", async (message: any) => { if (message.packageName) {await handleUpgradeSinglePackage(ref, message.packageName);} });
  bus.on("searchPackages", async (message: any) => { if (message.query !== undefined) {await handleSearchPackages(ref, message.query);} });
  bus.on("requestPackageDetails", async (message: any) => { if (message.packageName) {await handleRequestPackageDetails(ref, message.packageName);} });
  bus.on("addPackage", async (message: any) => { if (message.packageName) {await handleAddPackage(ref, message.packageName);} });
  
  bus.on("checkDependencyValidator", async () => await handleCheckDependencyValidator(ref));
  bus.on("installDependencyValidator", async () => await handleInstallDependencyValidator(ref));
  bus.on("runDependencyValidator", async () => await handleRunDependencyValidator(ref));
  
  bus.on("removePackage", async (message: any) => { if (message.packageName) {await handleRemovePackage(ref, message.packageName);} });
  bus.on("downgradePackage", async (message: any) => { if (message.packageName) {await handleDowngradePackage(ref, message.packageName);} });
  bus.on("removeAllFlaggedPackages", async (message: any) => { if (message.packages) {await handleRemoveAllFlaggedPackages(ref, message.packages);} });
}
