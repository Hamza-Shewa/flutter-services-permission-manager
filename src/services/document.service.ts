/**
 * VS Code document manipulation service
 */

import * as vscode from "vscode";
import * as path from "path";
import type {
  IOSPermissionEntry,
  SaveResult,
  ServiceEntry,
  ServiceConfig,
  AppNameLocalization,
} from "../types/index.js";
import {
  updateAndroidManifest,
  updateAndroidManifestWithServices,
  removeServicesFromAndroidManifest,
  getOrCreateStringsFile,
  updateAndroidStringsWithServices,
  removeServicesFromAndroidStrings,
  updateManifestToUseLocalizedAppName,
  updateAndroidAppNameLocalizations,
} from "./android/index.js";
import {
  updateIOSPlist,
  updateIOSPlistWithServices,
  removeServicesFromIOSPlist,
  updateIOSPodfile,
  updateAppDelegateWithServices,
  removeServicesFromAppDelegate,
  updateIOSEntitlementsWithServices,
  removeServicesFromIOSEntitlements,
  updateInfoPlistToUseLocalizedAppName,
  updateIOSAppNameLocalizations,
} from "./ios/index.js";

const APPLINKS_SERVICE_ID = "applinks";

function normalizeFingerprints(raw?: string): string[] {
  if (!raw) return [];
  return raw
    .split(/[,;\n]+/)
    .map((value) => value.trim())
    .filter(Boolean);
}

function findPlatformRoot(filePath: string, platformDirName: string): string | undefined {
  const segments = filePath.split(path.sep);
  const index = segments.lastIndexOf(platformDirName);
  if (index === -1) return undefined;
  return segments.slice(0, index + 1).join(path.sep);
}

async function updateAssociatedDomainFiles(
  service: ServiceEntry,
  androidManifestUri?: vscode.Uri,
  iosPlistUri?: vscode.Uri,
): Promise<void> {
  const fingerprints = normalizeFingerprints(service.values?.sha256CertFingerprints);
  const packageName = service.values?.packageName?.trim();
  const domains = service.values?.domains
    ?.split(/[,;\n]+/)
    .map((d) => d.trim())
    .filter(Boolean);

  if (!domains || domains.length === 0) {
    return;
  }

  const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
  if (!workspaceFolder) return;

  // Android: Write assetlinks.json if we have required data
  if (androidManifestUri && packageName && fingerprints.length > 0) {
    try {
      const androidRoot = findPlatformRoot(
        androidManifestUri.fsPath,
        "android",
      );
      if (androidRoot) {
        const wellKnownDir = vscode.Uri.file(
          path.join(androidRoot, "app", "src", "main", "assets", ".well-known"),
        );
        await vscode.workspace.fs.createDirectory(wellKnownDir);
        const assetLinksUri = vscode.Uri.file(
          path.join(wellKnownDir.fsPath, "assetlinks.json"),
        );

        const assetLinksContent = JSON.stringify(
          [
            {
              relation: ["delegate_permission/common.handle_all_urls"],
              target: {
                namespace: "android_app",
                package_name: packageName,
                sha256_cert_fingerprints: fingerprints,
              },
            },
          ],
          null,
          2,
        );

        await vscode.workspace.fs.writeFile(
          assetLinksUri,
          Buffer.from(assetLinksContent, "utf-8"),
        );
      }
    } catch (e) {
      console.error("Failed to write assetlinks.json:", e);
    }
  }

  // iOS: Write apple-app-site-association if we have a team ID
  const teamId = service.values?.teamId?.trim();
  const bundleId = service.values?.bundleId?.trim();
  if (iosPlistUri && teamId && bundleId) {
    try {
      const iosRoot = findPlatformRoot(iosPlistUri.fsPath, "ios");
      if (iosRoot) {
        const wellKnownDir = vscode.Uri.file(
          path.join(iosRoot, "Runner", "Assets.xcassets", ".well-known"),
        );
        await vscode.workspace.fs.createDirectory(wellKnownDir);
        const aasaUri = vscode.Uri.file(
          path.join(wellKnownDir.fsPath, "apple-app-site-association"),
        );

        const aasaContent = JSON.stringify(
          {
            applinks: {
              apps: [],
              details: domains.map((domain: string) => ({
                appID: `${teamId}.${bundleId}`,
                paths: ["*"],
              })),
            },
          },
          null,
          2,
        );

        await vscode.workspace.fs.writeFile(
          aasaUri,
          Buffer.from(aasaContent, "utf-8"),
        );
      }
    } catch (e) {
      console.error("Failed to write apple-app-site-association:", e);
    }
  }
}

async function updateAppNameLocalizations(
  appName: AppNameLocalization,
  workspaceRoot: vscode.Uri,
  androidManifestUri?: vscode.Uri,
  iosPlistUri?: vscode.Uri,
): Promise<void> {
  // Update Android
  if (androidManifestUri) {
    await updateAndroidAppNameLocalizations(
      workspaceRoot,
      appName.localizations,
      appName.defaultName,
    );

    // Update AndroidManifest.xml to reference @string/app_name
    const manifestDoc = await vscode.workspace.openTextDocument(
      androidManifestUri,
    );
    const updatedManifest = updateManifestToUseLocalizedAppName(
      manifestDoc.getText(),
    );
    await replaceDocumentContent(androidManifestUri, updatedManifest);
  }

  // Update iOS
  if (iosPlistUri) {
    await updateIOSAppNameLocalizations(
      workspaceRoot,
      appName.localizations,
      appName.defaultName,
    );

    // Update Info.plist to use localized app name
    const plistDoc = await vscode.workspace.openTextDocument(iosPlistUri);
    const updatedPlist = updateInfoPlistToUseLocalizedAppName(plistDoc.getText());
    await replaceDocumentContent(iosPlistUri, updatedPlist);
  }
}

export async function replaceDocumentContent(
  uri: vscode.Uri,
  content: string,
): Promise<void> {
  const doc = await vscode.workspace.openTextDocument(uri);
  const edit = new vscode.WorkspaceEdit();
  const fullRange = new vscode.Range(
    doc.positionAt(0),
    doc.positionAt(doc.getText().length),
  );
  edit.replace(uri, fullRange, content);
  await vscode.workspace.applyEdit(edit);
  await doc.save();
}

/**
 * Saves permissions to both Android and iOS platform files (legacy, saves everything)
 */
export async function savePermissions(
  androidPermissions: string[],
  iosPermissions: IOSPermissionEntry[],
  androidManifestUri?: vscode.Uri,
  iosPlistUri?: vscode.Uri,
  iosPodfileUri?: vscode.Uri,
  iosAppDelegateUri?: vscode.Uri,
  iosEntitlementsUri?: vscode.Uri,
  categorizedIosPermissions?: Record<
    string,
    { permission: string; podfileMacro?: string }[]
  >,
  services?: ServiceEntry[],
  servicesConfig?: ServiceConfig[],
  previousServices?: ServiceEntry[],
  macosPermissions?: IOSPermissionEntry[],
  macosPlistUri?: vscode.Uri,
  appName?: AppNameLocalization,
): Promise<SaveResult> {
  try {
    if (!androidManifestUri && !iosPlistUri) {
      return {
        success: false,
        message: "No AndroidManifest.xml or Info.plist was found to update.",
      };
    }

    // Determine which services were removed
    const currentServiceIds = new Set((services || []).map((s) => s.id));
    const removedServiceIds = (previousServices || [])
      .filter((s) => !currentServiceIds.has(s.id))
      .map((s) => s.id);

    // Get workspace folder for various file operations
    const workspaceFolder = vscode.workspace.workspaceFolders?.[0];

    if (androidManifestUri) {
      const doc = await vscode.workspace.openTextDocument(androidManifestUri);
      let updated = updateAndroidManifest(doc.getText(), androidPermissions);

      // Remove services that were deleted
      if (removedServiceIds.length > 0 && servicesConfig) {
        updated = removeServicesFromAndroidManifest(
          updated,
          removedServiceIds,
          servicesConfig,
        );
      }

      // Apply services if any
      if (services && services.length > 0 && servicesConfig) {
        updated = updateAndroidManifestWithServices(
          updated,
          services,
          servicesConfig,
        );
      }

      // Handle strings.xml
      if (workspaceFolder && servicesConfig) {
        const stringsUri = await getOrCreateStringsFile(workspaceFolder.uri);
        if (stringsUri) {
          try {
            const stringsDoc =
              await vscode.workspace.openTextDocument(stringsUri);
            let updatedStrings = stringsDoc.getText();

            // Remove strings from deleted services
            if (removedServiceIds.length > 0) {
              updatedStrings = removeServicesFromAndroidStrings(
                updatedStrings,
                removedServiceIds,
                servicesConfig,
              );
            }

            // Add/update strings from current services
            if (services && services.length > 0) {
              updatedStrings = updateAndroidStringsWithServices(
                updatedStrings,
                services,
                servicesConfig,
              );
            }

            if (updatedStrings !== stringsDoc.getText()) {
              await replaceDocumentContent(stringsUri, updatedStrings);
            }
          } catch (stringsError) {
            console.error("strings.xml update error:", stringsError);
          }
        }
      }

      await replaceDocumentContent(androidManifestUri, updated);
    }

    if (iosPlistUri) {
      const doc = await vscode.workspace.openTextDocument(iosPlistUri);

      // Build set of all known iOS permission keys for proper deletion
      let allKnownKeys: Set<string> | undefined;
      if (categorizedIosPermissions) {
        allKnownKeys = new Set<string>();
        for (const permissions of Object.values(categorizedIosPermissions)) {
          for (const p of permissions) {
            if (p.permission) {
              allKnownKeys.add(p.permission);
            }
          }
        }
      }

      let updated = updateIOSPlist(doc.getText(), iosPermissions, allKnownKeys);

      // Remove services that were deleted
      if (removedServiceIds.length > 0 && servicesConfig) {
        updated = removeServicesFromIOSPlist(
          updated,
          removedServiceIds,
          servicesConfig,
        );
      }

      // Apply services if any
      if (services && services.length > 0 && servicesConfig) {
        updated = updateIOSPlistWithServices(updated, services, servicesConfig);
      }

      await replaceDocumentContent(iosPlistUri, updated);
    }

    if (iosEntitlementsUri) {
      try {
        const entitlementsDoc =
          await vscode.workspace.openTextDocument(iosEntitlementsUri);
        let updatedEntitlements = entitlementsDoc.getText();

        if (removedServiceIds.length > 0 && servicesConfig) {
          updatedEntitlements = removeServicesFromIOSEntitlements(
            updatedEntitlements,
            removedServiceIds,
            servicesConfig,
          );
        }

        if (services && services.length > 0 && servicesConfig) {
          updatedEntitlements = updateIOSEntitlementsWithServices(
            updatedEntitlements,
            services,
            servicesConfig,
          );
        }

        if (updatedEntitlements !== entitlementsDoc.getText()) {
          await replaceDocumentContent(iosEntitlementsUri, updatedEntitlements);
        }
      } catch (entitlementsError) {
        console.error("Entitlements update error:", entitlementsError);
      }
    }

    if (macosPlistUri && macosPermissions) {
      const doc = await vscode.workspace.openTextDocument(macosPlistUri);

      // We reuse updateIOSPlist since the format is identical (Info.plist with NS*UsageDescription)
      // We pass undefined for allKnownKeys so it will simply replace all found permission keys
      // with the ones provided in macosPermissions.
      let updated = updateIOSPlist(doc.getText(), macosPermissions);

      // We do NOT apply services to macOS plist for now as services are currently Android/iOS specific

      await replaceDocumentContent(macosPlistUri, updated);
    }

    // Update AppDelegate.swift for services that require it (e.g., Google Maps)
    if (iosAppDelegateUri && servicesConfig) {
      try {
        const appDelegateDoc =
          await vscode.workspace.openTextDocument(iosAppDelegateUri);
        let updated = appDelegateDoc.getText();

        // Remove services that were deleted
        if (removedServiceIds.length > 0) {
          updated = removeServicesFromAppDelegate(
            updated,
            removedServiceIds,
            servicesConfig,
          );
        }

        // Apply services if any
        if (services && services.length > 0) {
          updated = updateAppDelegateWithServices(
            updated,
            services,
            servicesConfig,
          );
        }

        if (updated !== appDelegateDoc.getText()) {
          await replaceDocumentContent(iosAppDelegateUri, updated);
        }
      } catch (appDelegateError) {
        console.error("AppDelegate update error:", appDelegateError);
      }
    }

    // Update Podfile if we have iOS permissions with macros
    if (
      iosPodfileUri &&
      categorizedIosPermissions &&
      iosPermissions.length > 0
    ) {
      try {
        const podDoc = await vscode.workspace.openTextDocument(iosPodfileUri);
        const podEdit = await updateIOSPodfile(
          podDoc,
          iosPermissions,
          categorizedIosPermissions,
        );
        if (podEdit) {
          await vscode.workspace.applyEdit(podEdit);
          await podDoc.save();
        }
      } catch (podError) {
        // Don't fail the entire save if Podfile update fails
        console.error("Podfile update error:", podError);
      }
    }

    const applinksService = (services || []).find(
      (service) => service.id === APPLINKS_SERVICE_ID,
    );
    if (applinksService) {
      await updateAssociatedDomainFiles(
        applinksService,
        androidManifestUri,
        iosPlistUri,
      );
    }

    // Handle app name localization
    if (appName && workspaceFolder) {
      await updateAppNameLocalizations(
        appName,
        workspaceFolder.uri,
        androidManifestUri,
        iosPlistUri,
      );
    }

    return { success: true, message: "Permissions saved successfully." };
  } catch (error) {
    return { success: false, message: `Failed to save permissions: ${error}` };
  }
}

/**
 * Saves only permissions (Android, iOS, macOS) without affecting services or app name
 */
export async function savePermissionsOnly(
  androidPermissions: string[],
  iosPermissions: IOSPermissionEntry[],
  androidManifestUri?: vscode.Uri,
  iosPlistUri?: vscode.Uri,
  iosPodfileUri?: vscode.Uri,
  categorizedIosPermissions?: Record<
    string,
    { permission: string; podfileMacro?: string }[]
  >,
  macosPermissions?: IOSPermissionEntry[],
  macosPlistUri?: vscode.Uri,
): Promise<SaveResult> {
  try {
    if (!androidManifestUri && !iosPlistUri && !macosPlistUri) {
      return {
        success: false,
        message: "No AndroidManifest.xml, Info.plist, or macOS Info.plist was found to update.",
      };
    }

    if (androidManifestUri) {
      const doc = await vscode.workspace.openTextDocument(androidManifestUri);
      const updated = updateAndroidManifest(doc.getText(), androidPermissions);
      await replaceDocumentContent(androidManifestUri, updated);
    }

    if (iosPlistUri) {
      const doc = await vscode.workspace.openTextDocument(iosPlistUri);

      // Build set of all known iOS permission keys for proper deletion
      let allKnownKeys: Set<string> | undefined;
      if (categorizedIosPermissions) {
        allKnownKeys = new Set<string>();
        for (const permissions of Object.values(categorizedIosPermissions)) {
          for (const p of permissions) {
            if (p.permission) {
              allKnownKeys.add(p.permission);
            }
          }
        }
      }

      const updated = updateIOSPlist(doc.getText(), iosPermissions, allKnownKeys);
      await replaceDocumentContent(iosPlistUri, updated);
    }

    if (macosPlistUri && macosPermissions) {
      const doc = await vscode.workspace.openTextDocument(macosPlistUri);
      const updated = updateIOSPlist(doc.getText(), macosPermissions);
      await replaceDocumentContent(macosPlistUri, updated);
    }

    // Update Podfile if we have iOS permissions with macros
    if (
      iosPodfileUri &&
      categorizedIosPermissions &&
      iosPermissions.length > 0
    ) {
      try {
        const podDoc = await vscode.workspace.openTextDocument(iosPodfileUri);
        const podEdit = await updateIOSPodfile(
          podDoc,
          iosPermissions,
          categorizedIosPermissions,
        );
        if (podEdit) {
          await vscode.workspace.applyEdit(podEdit);
          await podDoc.save();
        }
      } catch (podError) {
        console.error("Podfile update error:", podError);
      }
    }

    return { success: true, message: "Permissions saved successfully." };
  } catch (error) {
    return { success: false, message: `Failed to save permissions: ${error}` };
  }
}

/**
 * Saves only services configuration without affecting permissions or app name
 */
export async function saveServicesOnly(
  services: ServiceEntry[],
  servicesConfig: ServiceConfig[],
  previousServices: ServiceEntry[],
  androidManifestUri?: vscode.Uri,
  iosPlistUri?: vscode.Uri,
  iosAppDelegateUri?: vscode.Uri,
  iosEntitlementsUri?: vscode.Uri,
): Promise<SaveResult> {
  try {
    if (!androidManifestUri && !iosPlistUri) {
      return {
        success: false,
        message: "No AndroidManifest.xml or Info.plist was found to update.",
      };
    }

    // Determine which services were removed
    const currentServiceIds = new Set((services || []).map((s) => s.id));
    const removedServiceIds = (previousServices || [])
      .filter((s) => !currentServiceIds.has(s.id))
      .map((s) => s.id);

    // Get workspace folder for various file operations
    const workspaceFolder = vscode.workspace.workspaceFolders?.[0];

    if (androidManifestUri) {
      const doc = await vscode.workspace.openTextDocument(androidManifestUri);
      let updated = doc.getText();

      // Remove services that were deleted
      if (removedServiceIds.length > 0) {
        updated = removeServicesFromAndroidManifest(
          updated,
          removedServiceIds,
          servicesConfig,
        );
      }

      // Apply services if any
      if (services && services.length > 0) {
        updated = updateAndroidManifestWithServices(
          updated,
          services,
          servicesConfig,
        );
      }

      // Handle strings.xml
      if (workspaceFolder) {
        const stringsUri = await getOrCreateStringsFile(workspaceFolder.uri);
        if (stringsUri) {
          try {
            const stringsDoc =
              await vscode.workspace.openTextDocument(stringsUri);
            let updatedStrings = stringsDoc.getText();

            // Remove strings from deleted services
            if (removedServiceIds.length > 0) {
              updatedStrings = removeServicesFromAndroidStrings(
                updatedStrings,
                removedServiceIds,
                servicesConfig,
              );
            }

            // Add/update strings from current services
            if (services && services.length > 0) {
              updatedStrings = updateAndroidStringsWithServices(
                updatedStrings,
                services,
                servicesConfig,
              );
            }

            if (updatedStrings !== stringsDoc.getText()) {
              await replaceDocumentContent(stringsUri, updatedStrings);
            }
          } catch (stringsError) {
            console.error("strings.xml update error:", stringsError);
          }
        }
      }

      if (updated !== doc.getText()) {
        await replaceDocumentContent(androidManifestUri, updated);
      }
    }

    if (iosPlistUri) {
      const doc = await vscode.workspace.openTextDocument(iosPlistUri);
      let updated = doc.getText();

      // Remove services that were deleted
      if (removedServiceIds.length > 0) {
        updated = removeServicesFromIOSPlist(
          updated,
          removedServiceIds,
          servicesConfig,
        );
      }

      // Apply services if any
      if (services && services.length > 0) {
        updated = updateIOSPlistWithServices(updated, services, servicesConfig);
      }

      if (updated !== doc.getText()) {
        await replaceDocumentContent(iosPlistUri, updated);
      }
    }

    if (iosEntitlementsUri) {
      try {
        const entitlementsDoc =
          await vscode.workspace.openTextDocument(iosEntitlementsUri);
        let updatedEntitlements = entitlementsDoc.getText();

        if (removedServiceIds.length > 0) {
          updatedEntitlements = removeServicesFromIOSEntitlements(
            updatedEntitlements,
            removedServiceIds,
            servicesConfig,
          );
        }

        if (services && services.length > 0) {
          updatedEntitlements = updateIOSEntitlementsWithServices(
            updatedEntitlements,
            services,
            servicesConfig,
          );
        }

        if (updatedEntitlements !== entitlementsDoc.getText()) {
          await replaceDocumentContent(iosEntitlementsUri, updatedEntitlements);
        }
      } catch (entitlementsError) {
        console.error("Entitlements update error:", entitlementsError);
      }
    }

    // Update AppDelegate.swift for services that require it (e.g., Google Maps)
    if (iosAppDelegateUri) {
      try {
        const appDelegateDoc =
          await vscode.workspace.openTextDocument(iosAppDelegateUri);
        let updated = appDelegateDoc.getText();

        // Remove services that were deleted
        if (removedServiceIds.length > 0) {
          updated = removeServicesFromAppDelegate(
            updated,
            removedServiceIds,
            servicesConfig,
          );
        }

        // Apply services if any
        if (services && services.length > 0) {
          updated = updateAppDelegateWithServices(
            updated,
            services,
            servicesConfig,
          );
        }

        if (updated !== appDelegateDoc.getText()) {
          await replaceDocumentContent(iosAppDelegateUri, updated);
        }
      } catch (appDelegateError) {
        console.error("AppDelegate update error:", appDelegateError);
      }
    }

    const applinksService = (services || []).find(
      (service) => service.id === APPLINKS_SERVICE_ID,
    );
    if (applinksService) {
      await updateAssociatedDomainFiles(
        applinksService,
        androidManifestUri,
        iosPlistUri,
      );
    }

    return { success: true, message: "Services saved successfully." };
  } catch (error) {
    return { success: false, message: `Failed to save services: ${error}` };
  }
}

/**
 * Saves only app name localizations without affecting permissions or services
 */
export async function saveAppNameOnly(
  appName: AppNameLocalization,
  androidManifestUri?: vscode.Uri,
  iosPlistUri?: vscode.Uri,
): Promise<SaveResult> {
  try {
    const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
    if (!workspaceFolder) {
      return {
        success: false,
        message: "No workspace folder found.",
      };
    }

    if (!androidManifestUri && !iosPlistUri) {
      return {
        success: false,
        message: "No AndroidManifest.xml or Info.plist was found to update.",
      };
    }

    await updateAppNameLocalizations(
      appName,
      workspaceFolder.uri,
      androidManifestUri,
      iosPlistUri,
    );

    return { success: true, message: "App name localizations saved successfully." };
  } catch (error) {
    return { success: false, message: `Failed to save app name localizations: ${error}` };
  }
}
