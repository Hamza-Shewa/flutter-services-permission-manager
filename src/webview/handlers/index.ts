/**
 * Webview message handlers
 * Handles incoming messages from the webview
 */

import * as vscode from "vscode";
import type {
  IOSPermissionEntry,
  ServiceEntry,
  PermissionsPayload,
  AppNameLocalization,
  LanguageInfo,
} from "../../types/index.js";
import { readJsonFile } from "../../utils/file.js";
import {
  getUsedAndroidPermissions,
  getUsedIOSPermissions,
  getAndroidPermissions,
  getIOSPermissions,
} from "../../utils/extractors.js";
import {
  savePermissions,
  savePermissionsOnly,
  saveServicesOnly,
  saveAppNameOnly,
  extractServices,
} from "../../services/index.js";
import { extractAndroidAppNameLocalizations } from "../../services/android/localization.service.js";
import { extractIOSAppNameLocalizations } from "../../services/ios/localization.service.js";
import type { ProjectFiles } from "../../services/workspace.js";
import {
  getCategorizedIosPermissionsCache,
  getServicesConfigCache,
  getPreviousServicesCache,
  setPreviousServicesCache,
} from "../state.js";

/** Webview reference that works for both Panel and View */
export interface WebviewRef {
  webview: vscode.Webview;
}

/**
 * Handle refresh request - reload permissions and services from files
 */
export async function handleRefresh(
  ref: WebviewRef,
  files: ProjectFiles,
): Promise<void> {
  const [androidDoc, iosDoc, macosDoc] = await Promise.all([
    files.androidManifestUri
      ? vscode.workspace.openTextDocument(files.androidManifestUri)
      : Promise.resolve(null),
    files.iosPlistUri
      ? vscode.workspace.openTextDocument(files.iosPlistUri)
      : Promise.resolve(null),
    files.macosPlistUri
      ? vscode.workspace.openTextDocument(files.macosPlistUri)
      : Promise.resolve(null),
  ]);

  const [usedAndroidPermissions, usedIOSPermissions, usedMacOSPermissions] =
    await Promise.all([
      getUsedAndroidPermissions(androidDoc?.getText() ?? ""),
      getUsedIOSPermissions(iosDoc?.getText() ?? ""),
      getUsedIOSPermissions(macosDoc?.getText() ?? ""),
    ]);

  const servicesConfig = getServicesConfigCache();
  const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
  const existingServices = await extractServices(
    workspaceFolder?.uri,
    files.androidManifestUri,
    files.androidMainActivityUri,
    files.iosPlistUri,
    files.iosAppDelegateUri,
    files.iosEntitlementsUri,
    files.iosPbxprojUri,
    servicesConfig ?? [],
  );

  setPreviousServicesCache(existingServices);

  // Extract app name localizations
  let appNameData: AppNameLocalization | undefined;
  if (workspaceFolder) {
    const androidAppName = await extractAndroidAppNameLocalizations(workspaceFolder.uri);
    const iosAppName = await extractIOSAppNameLocalizations(workspaceFolder.uri);
    
    const defaultName = androidAppName?.defaultName || iosAppName?.defaultName || "";
    const localizations = { ...(iosAppName?.localizations || {}), ...(androidAppName?.localizations || {}) };
    
    if (defaultName) {
      appNameData = { defaultName, localizations };
    }
  }

  // Load languages
  const languagesConfig = await readJsonFile<{ languages: LanguageInfo[] }>("languages.json");

  const payload: PermissionsPayload = {
    type: "permissions",
    androidPermissions: usedAndroidPermissions,
    iosPermissions: usedIOSPermissions,
    macosPermissions: usedMacOSPermissions,
    hasAndroidManifest: !!files.androidManifestUri,
    hasIOSPlist: !!files.iosPlistUri,
    hasMacOSPlist: !!files.macosPlistUri,
    hasPodfile: !!files.iosPodfileUri,
    services: existingServices,
    availableServices: servicesConfig ?? [],
    appName: appNameData,
    languages: languagesConfig?.languages ?? [],
  };

  ref.webview.postMessage(payload);
}

/**
 * Handle request for all Android permissions
 */
export async function handleRequestAllAndroid(ref: WebviewRef): Promise<void> {
  const permissions = await getAndroidPermissions();
  ref.webview.postMessage({
    type: "allAndroidPermissions",
    permissions,
  });
}

/**
 * Handle request for all iOS permissions
 */
export async function handleRequestAllIOS(ref: WebviewRef): Promise<void> {
  const permissions = await getIOSPermissions();
  ref.webview.postMessage({
    type: "allIOSPermissions",
    permissions,
  });
}

/**
 * Handle request for services configuration
 */
export function handleRequestServices(ref: WebviewRef): void {
  ref.webview.postMessage({
    type: "servicesConfig",
    services: getServicesConfigCache() ?? [],
  });
}

/**
 * Handle save permissions request (legacy - saves everything)
 */
export async function handleSave(
  ref: WebviewRef,
  androidPermissions: string[],
  iosPermissions: IOSPermissionEntry[],
  macosPermissions: IOSPermissionEntry[],
  appName: AppNameLocalization | undefined,
  services: ServiceEntry[],
  files: ProjectFiles,
): Promise<void> {
  const result = await savePermissions(
    androidPermissions,
    iosPermissions,
    files.androidManifestUri,
    files.iosPlistUri,
    files.iosPodfileUri,
    files.iosAppDelegateUri,
    files.iosEntitlementsUri,
    getCategorizedIosPermissionsCache() ?? undefined,
    services,
    getServicesConfigCache() ?? [],
    getPreviousServicesCache(),
    macosPermissions,
    files.macosPlistUri,
    appName,
  );

  if (result.success) {
    setPreviousServicesCache(services);
  }

  ref.webview.postMessage({ type: "saveResult", ...result });
}

/**
 * Handle save permissions only (without services or app name)
 */
export async function handleSavePermissions(
  ref: WebviewRef,
  androidPermissions: string[],
  iosPermissions: IOSPermissionEntry[],
  macosPermissions: IOSPermissionEntry[],
  files: ProjectFiles,
): Promise<void> {
  const result = await savePermissionsOnly(
    androidPermissions,
    iosPermissions,
    files.androidManifestUri,
    files.iosPlistUri,
    files.iosPodfileUri,
    getCategorizedIosPermissionsCache() ?? undefined,
    macosPermissions,
    files.macosPlistUri,
  );

  ref.webview.postMessage({ type: "saveResult", ...result });
}

/**
 * Handle save services only (without permissions or app name)
 */
export async function handleSaveServices(
  ref: WebviewRef,
  services: ServiceEntry[],
  files: ProjectFiles,
): Promise<void> {
  const result = await saveServicesOnly(
    services,
    getServicesConfigCache() ?? [],
    getPreviousServicesCache(),
    files.androidManifestUri,
    files.iosPlistUri,
    files.iosAppDelegateUri,
    files.iosEntitlementsUri,
  );

  if (result.success) {
    setPreviousServicesCache(services);
  }

  ref.webview.postMessage({ type: "saveResult", ...result });
}

/**
 * Handle save app name only (without permissions or services)
 */
export async function handleSaveAppName(
  ref: WebviewRef,
  appName: AppNameLocalization,
  files: ProjectFiles,
): Promise<void> {
  const result = await saveAppNameOnly(
    appName,
    files.androidManifestUri,
    files.iosPlistUri,
  );

  ref.webview.postMessage({ type: "saveResult", ...result });
}
