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
} from "../types/index.js";
import {
  updateAndroidManifest,
  updateAndroidManifestWithServices,
  removeServicesFromAndroidManifest,
  getOrCreateStringsFile,
  updateAndroidStringsWithServices,
  removeServicesFromAndroidStrings,
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
  const teamId = service.values?.teamId?.trim();
  const bundleId = service.values?.bundleId?.trim();

  if (androidManifestUri && packageName && fingerprints.length > 0) {
    const androidRoot = findPlatformRoot(androidManifestUri.fsPath, "android");
    if (androidRoot) {
      const assetlinksPath = path.join(androidRoot, "assetlinks.json");
      const assetlinksUri = vscode.Uri.file(assetlinksPath);
      const assetlinksPayload = [
        {
          relation: [
            "delegate_permission/common.handle_all_urls",
            "delegate_permission/common.get_login_creds",
          ],
          target: {
            namespace: "android_app",
            package_name: packageName,
            sha256_cert_fingerprints: fingerprints,
          },
        },
      ];

      await vscode.workspace.fs.writeFile(
        assetlinksUri,
        Buffer.from(JSON.stringify(assetlinksPayload, null, 2), "utf-8"),
      );
    }
  }

  if (iosPlistUri && teamId && bundleId) {
    const iosRoot = findPlatformRoot(iosPlistUri.fsPath, "ios");
    if (iosRoot) {
      const associationPath = path.join(iosRoot, "apple-app-site-association");
      const associationUri = vscode.Uri.file(associationPath);
      const associationPayload = {
        applinks: {
          apps: [],
          details: [
            {
              appID: `${teamId}.${bundleId}`,
              paths: ["*"],
            },
          ],
        },
      };

      await vscode.workspace.fs.writeFile(
        associationUri,
        Buffer.from(JSON.stringify(associationPayload, null, 2), "utf-8"),
      );
    }
  }

}

/**
 * Replaces entire document content with new content
 */
export async function replaceDocumentContent(
  uri: vscode.Uri,
  content: string,
): Promise<void> {
  const document = await vscode.workspace.openTextDocument(uri);
  const lastLine = document.lineAt(document.lineCount - 1);
  const fullRange = new vscode.Range(
    0,
    0,
    document.lineCount - 1,
    lastLine.text.length,
  );

  const edit = new vscode.WorkspaceEdit();
  edit.replace(uri, fullRange, content);

  await vscode.workspace.applyEdit(edit);
  await document.save();
}

/**
 * Saves permissions to both Android and iOS platform files
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
      const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
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

    return { success: true, message: "Permissions saved successfully." };
  } catch (error) {
    return { success: false, message: `Failed to save permissions: ${error}` };
  }
}
