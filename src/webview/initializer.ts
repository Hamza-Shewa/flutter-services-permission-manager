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
import type { ProjectFiles } from "../services/workspace.js";
import {
  setCategorizedIosPermissionsCache,
  setServicesConfigCache,
  setPreviousServicesCache,
  getServicesConfigCache,
} from "./state.js";
import {
  handleRefresh,
  handleRequestAllAndroid,
  handleRequestAllIOS,
  handleRequestServices,
  handleSavePermissions,
  handleSaveServices,
  handleSaveAppName,
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
    appName: appNameData,
    languages: languagesConfig?.languages ?? [],
  };

  // Set up message handler
  const ref: WebviewRef = { webview };
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
  ref.webview.onDidReceiveMessage(async (message: WebviewMessage) => {
    switch (message.type) {
      case "ready":
        ref.webview.postMessage(initialPayload);
        break;

      case "refresh":
        await handleRefresh(ref, files);
        break;

      case "requestAllAndroidPermissions":
        await handleRequestAllAndroid(ref);
        break;

      case "requestAllIOSPermissions":
        await handleRequestAllIOS(ref);
        break;

      case "requestServices":
        handleRequestServices(ref);
        break;

      case "savePermissions":
        await handleSavePermissions(
          ref,
          message.androidPermissions ?? [],
          message.iosPermissions ?? [],
          message.macosPermissions ?? [],
          files,
        );
        break;

      case "saveAppName":
        await handleSaveAppName(ref, message.appName, files);
        break;

      case "saveServices":
        await handleSaveServices(ref, message.services ?? [], files);
        break;
    }
  });
}
