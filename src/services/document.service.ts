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
  PlatformDetails,
  PlatformDetailItem,
} from "../types/index.js";
import { logger } from "../shared/index.js";
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
import type { ProjectFiles } from "./workspace.js";

const APPLINKS_SERVICE_ID = "applinks";

function normalizeFingerprints(raw?: string): string[] {
  if (!raw) {
    return [];
  }
  return raw
    .split(/[,;\n]+/)
    .map((value) => value.trim())
    .filter(Boolean);
}

function findPlatformRoot(filePath: string, platformDirName: string): string | undefined {
  const segments = filePath.split(path.sep);
  const index = segments.lastIndexOf(platformDirName);
  if (index === -1) {
    return undefined;
  }
  return segments.slice(0, index + 1).join(path.sep);
}

function normalizeTextValue(value: string | undefined): string {
  return String(value ?? "").replace(/\r\n|\r|\n/g, " ").trim();
}

function stripApiPrefix(value: string | undefined): string {
  return normalizeTextValue(value).replace(/^API\s+/i, "");
}

function replaceFirst(content: string, regex: RegExp, replacement: string): string {
  return regex.test(content) ? content.replace(regex, replacement) : content;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function formatGradleValue(value: string, quote: boolean): string {
  const trimmed = value.trim();
  if (!quote) {
    return trimmed;
  }

  return `"${trimmed.replace(/"/g, '\\"')}"`;
}

function replaceGradlePropertyLine(
  content: string,
  key: string,
  value: string,
  quoteValue: boolean,
): string {
  const safeValue = normalizeTextValue(value);
  const escapedKey = escapeRegExp(key);
  const regex = new RegExp(`^(\\s*)${escapedKey}(\\s*=)?\\s*.*$`, "m");

  return content.replace(regex, (_match, indent: string, assignment: string | undefined) => {
    const operator = assignment ? " = " : " ";
    return `${indent}${key}${operator}${formatGradleValue(safeValue, quoteValue)}`;
  });
}

function updateFileIfChanged(uri: vscode.Uri | undefined, content: string | undefined, nextContent: string): Promise<void> {
  if (!uri || !content || content === nextContent) {
    return Promise.resolve();
  }

  return replaceDocumentContent(uri, nextContent);
}

function getDetailValue(details: PlatformDetailItem[], key: string): string | undefined {
  return details.find((detail) => detail.key === key)?.value;
}

function updateAndroidBuildFiles(
  files: ProjectFiles,
  details: PlatformDetailItem[],
): Promise<void[]> {
  const tasks: Promise<void>[] = [];

  const gradleWrapperVersion = getDetailValue(details, "gradleWrapperVersion");
  if (gradleWrapperVersion) {
    tasks.push((async () => {
      const uri = files.androidGradleWrapperUri;
      if (!uri) {
        return;
      }
      const doc = await vscode.workspace.openTextDocument(uri);
      const updated = replaceFirst(
        doc.getText(),
        /(distributionUrl=.*gradle-)[^\r\n]+(-(?:all|bin)\.zip)/i,
        `$1${gradleWrapperVersion}$2`,
      );
      await updateFileIfChanged(uri, doc.getText(), updated);
    })());
  }

  const agpVersion = getDetailValue(details, "androidGradlePluginVersion");
  if (agpVersion) {
    tasks.push((async () => {
      const uris = [files.androidBuildGradleUri, files.androidBuildGradleKtsUri, files.androidSettingsGradleUri, files.androidSettingsGradleKtsUri].filter(Boolean) as vscode.Uri[];
      for (const uri of uris) {
        const doc = await vscode.workspace.openTextDocument(uri);
        const original = doc.getText();
        let updated = original;
        updated = replaceFirst(updated, /(com\.android\.tools\.build:gradle:)[^"'\s)]+/i, `$1${agpVersion}`);
        updated = replaceFirst(updated, /(id\s*["']com\.android\.(?:application|library)["']\s*version\s*["'])[^"']+(["'])/i, `$1${agpVersion}$2`);
        await updateFileIfChanged(uri, original, updated);
      }
    })());
  }

  const kotlinVersion = getDetailValue(details, "kotlinVersion");
  if (kotlinVersion) {
    tasks.push((async () => {
      const uris = [files.androidBuildGradleUri, files.androidBuildGradleKtsUri, files.androidSettingsGradleUri, files.androidSettingsGradleKtsUri].filter(Boolean) as vscode.Uri[];
      for (const uri of uris) {
        const doc = await vscode.workspace.openTextDocument(uri);
        const original = doc.getText();
        
        // Only update if Kotlin configuration already exists
        const hasKotlin = /kotlin_version|org\.jetbrains\.kotlin|kotlin\("android"\)/i.test(original);
        if (!hasKotlin) {
          continue;
        }

        let updated = original;
        updated = replaceFirst(updated, /(kotlin_version\s*=?\s*["'])[^"']+(["'])/i, `$1${kotlinVersion}$2`);
        updated = replaceFirst(updated, /(id\s*["']org\.jetbrains\.kotlin\.[^"']+["']\s*version\s*["'])[^"']+(["'])/i, `$1${kotlinVersion}$2`);
        updated = replaceFirst(updated, /(org\.jetbrains\.kotlin\.(?:android|jvm)["']\s*version\s*["'])[^"']+(["'])/i, `$1${kotlinVersion}$2`);
        await updateFileIfChanged(uri, original, updated);
      }
    })());
  }

  const appBuildUris = [files.androidAppBuildGradleUri, files.androidAppBuildGradleKtsUri].filter(Boolean) as vscode.Uri[];
  const numericValues = {
    compileSdk: stripApiPrefix(getDetailValue(details, "compileSdk")),
    minSdk: stripApiPrefix(getDetailValue(details, "minSdk")),
    targetSdk: stripApiPrefix(getDetailValue(details, "targetSdk")),
    versionCode: stripApiPrefix(getDetailValue(details, "versionCode")),
  };
  const textValues = {
    namespace: normalizeTextValue(getDetailValue(details, "namespace")),
    applicationId: normalizeTextValue(getDetailValue(details, "applicationId")),
    versionName: normalizeTextValue(getDetailValue(details, "versionName")),
  };

  if (appBuildUris.length > 0) {
    tasks.push((async () => {
      for (const uri of appBuildUris) {
        const doc = await vscode.workspace.openTextDocument(uri);
        const original = doc.getText();
        let updated = original;
        if (numericValues.compileSdk) {
          updated = replaceGradlePropertyLine(updated, "compileSdkVersion", numericValues.compileSdk, false);
          updated = replaceGradlePropertyLine(updated, "compileSdk", numericValues.compileSdk, false);
        }
        if (numericValues.minSdk) {
          updated = replaceGradlePropertyLine(updated, "minSdkVersion", numericValues.minSdk, false);
        }
        if (numericValues.targetSdk) {
          updated = replaceGradlePropertyLine(updated, "targetSdkVersion", numericValues.targetSdk, false);
        }
        if (textValues.namespace) {
          updated = replaceGradlePropertyLine(updated, "namespace", textValues.namespace, true);
        }
        if (textValues.applicationId) {
          updated = replaceGradlePropertyLine(updated, "applicationId", textValues.applicationId, true);
        }

        // Always set versionName to flutterVersionName.toString()
        updated = replaceGradlePropertyLine(updated, "versionName", "flutterVersionName.toString()", false);

        if (numericValues.versionCode) {
          updated = replaceGradlePropertyLine(updated, "versionCode", numericValues.versionCode, false);
        }
        await updateFileIfChanged(uri, original, updated);
      }
    })());
  }

  return Promise.all(tasks);
}

function updateIOSBuildFiles(
  files: ProjectFiles,
  details: PlatformDetailItem[],
): Promise<void[]> {
  const tasks: Promise<void>[] = [];

  const deploymentTarget = getDetailValue(details, "iosDeploymentTarget");
  if (deploymentTarget) {
    tasks.push((async () => {
      const podfileUri = files.iosPodfileUri;
      if (podfileUri) {
        const doc = await vscode.workspace.openTextDocument(podfileUri);
        const original = doc.getText();
        
        // Fix platform line
        let updated = replaceFirst(original, /platform\s*:ios,\s*['"][^'"]+['"]/i, `platform :ios, '${deploymentTarget}'`);
        
        // Ensure COCOAPODS_DISABLE_STATS is present
        if (!updated.includes("COCOAPODS_DISABLE_STATS")) {
          const envBlock = "\n# CocoaPods analytics sends network stats synchronously affecting flutter build latency.\nENV['COCOAPODS_DISABLE_STATS'] = 'true'\n";
          // Insert after platform line
          updated = updated.replace(/(platform\s*:ios,\s*['"][^'"]+['"])/i, `$1\n${envBlock}`);
        }

        // Ensure project 'Runner' block is present
        if (!updated.includes("project 'Runner'")) {
          const projectBlock = "\nproject 'Runner', {\n  'Debug' => :debug,\n  'Profile' => :release,\n  'Release' => :release,\n}\n";
          // Insert after ENV block or platform line
          if (updated.includes("COCOAPODS_DISABLE_STATS")) {
            updated = updated.replace(/(ENV\['COCOAPODS_DISABLE_STATS'\]\s*=\s*'true')/i, `$1\n${projectBlock}`);
          } else {
             updated = updated.replace(/(platform\s*:ios,\s*['"][^'"]+['"])/i, `$1\n${projectBlock}`);
          }
        }

        await updateFileIfChanged(podfileUri, original, updated);
      }

      const pbxprojUri = files.iosPbxprojUri;
      if (pbxprojUri) {
        const doc = await vscode.workspace.openTextDocument(pbxprojUri);
        const original = doc.getText();
        const updated = replaceFirst(original, /(IPHONEOS_DEPLOYMENT_TARGET\s*=\s*)[^;]+(;)/i, `$1${deploymentTarget}$2`);
        await updateFileIfChanged(pbxprojUri, original, updated);
      }
    })());
  }

  const swiftVersion = getDetailValue(details, "swiftVersion");
  if (swiftVersion && files.iosPbxprojUri) {
    tasks.push((async () => {
      const doc = await vscode.workspace.openTextDocument(files.iosPbxprojUri!);
      const original = doc.getText();
      const updated = replaceFirst(original, /(SWIFT_VERSION\s*=\s*)[^;]+(;)/i, `$1${swiftVersion}$2`);
      await updateFileIfChanged(files.iosPbxprojUri, original, updated);
    })());
  }

  const bundleIdentifier = getDetailValue(details, "bundleIdentifier");
  if (bundleIdentifier && files.iosPbxprojUri) {
    tasks.push((async () => {
      const doc = await vscode.workspace.openTextDocument(files.iosPbxprojUri!);
      const original = doc.getText();
      const updated = replaceFirst(original, /(PRODUCT_BUNDLE_IDENTIFIER\s*=\s*)[^;]+(;)/i, `$1${bundleIdentifier}$2`);
      await updateFileIfChanged(files.iosPbxprojUri, original, updated);
    })());
  }

  return Promise.all(tasks);
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
  if (!workspaceFolder) {
    return;
  }

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
          new TextEncoder().encode(assetLinksContent),
        );
      }
    } catch (e) {
      logger.error("Failed to write assetlinks.json:", e instanceof Error ? e : new Error(String(e)));
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
          new TextEncoder().encode(aasaContent),
        );
      }
    } catch (e) {
      logger.error("Failed to write apple-app-site-association:", e instanceof Error ? e : new Error(String(e)));
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
            logger.error("strings.xml update error:", stringsError instanceof Error ? stringsError : new Error(String(stringsError)));
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
        logger.error("Entitlements update error:", entitlementsError instanceof Error ? entitlementsError : new Error(String(entitlementsError)));
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
        logger.error("AppDelegate update error:", appDelegateError instanceof Error ? appDelegateError : new Error(String(appDelegateError)));
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
        logger.error("Podfile update error:", podError instanceof Error ? podError : new Error(String(podError)));
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
        logger.error("Podfile update error:", podError instanceof Error ? podError : new Error(String(podError)));
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
            logger.error("strings.xml update error:", stringsError instanceof Error ? stringsError : new Error(String(stringsError)));
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
        logger.error("Entitlements update error:", entitlementsError instanceof Error ? entitlementsError : new Error(String(entitlementsError)));
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
        logger.error("AppDelegate update error:", appDelegateError instanceof Error ? appDelegateError : new Error(String(appDelegateError)));
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

/**
 * Saves editable Android and iOS build details.
 */
export async function savePlatformDetails(
  platformDetails: PlatformDetails,
  files: ProjectFiles,
): Promise<SaveResult> {
  try {
    await Promise.all([
      updateAndroidBuildFiles(files, platformDetails.android ?? []),
      updateIOSBuildFiles(files, platformDetails.ios ?? []),
    ]);

    return { success: true, message: "Platform build details saved successfully." };
  } catch (error) {
    return { success: false, message: `Failed to save platform build details: ${error}` };
  }
}
