/**
 * Webview message handlers
 * Handles incoming messages from the webview
 */

import * as vscode from "vscode";
import type {
  IOSPermissionEntry,
  ServiceEntry,
  PermissionsPayload,
} from "../../types/index.js";
import {
  getUsedAndroidPermissions,
  getUsedIOSPermissions,
  getAndroidPermissions,
  getIOSPermissions,
} from "../../utils/extractors.js";
import { savePermissions, extractServices } from "../../services/index.js";
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
  const existingServices = await extractServices(
    files.androidManifestUri,
    files.iosPlistUri,
    files.iosAppDelegateUri,
    servicesConfig ?? [],
  );

  setPreviousServicesCache(existingServices);

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
 * Handle save permissions request
 */
export async function handleSave(
  ref: WebviewRef,
  androidPermissions: string[],
  iosPermissions: IOSPermissionEntry[],
  macosPermissions: IOSPermissionEntry[],
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
    getCategorizedIosPermissionsCache() ?? undefined,
    services,
    getServicesConfigCache() ?? [],
    getPreviousServicesCache(),
    macosPermissions,
    files.macosPlistUri,
  );

  if (result.success) {
    setPreviousServicesCache(services);
  }

  ref.webview.postMessage({ type: "saveResult", ...result });
}
