/**
 * Workspace file discovery service
 * Centralizes all VS Code workspace file finding operations
 */

import * as vscode from "vscode";
import { FILE_PATTERNS, MAX_SEARCH_RESULTS } from "../constants/index.js";
import type { PlatformDetailItem, PlatformDetails } from "../types/index.js";

/** Discovered project files */
export interface ProjectFiles {
  androidManifestUri?: vscode.Uri;
  androidStringsUri?: vscode.Uri;
  androidMainActivityUri?: vscode.Uri;
  androidAppBuildGradleUri?: vscode.Uri;
  androidAppBuildGradleKtsUri?: vscode.Uri;
  androidBuildGradleUri?: vscode.Uri;
  androidBuildGradleKtsUri?: vscode.Uri;
  androidSettingsGradleUri?: vscode.Uri;
  androidSettingsGradleKtsUri?: vscode.Uri;
  androidGradleWrapperUri?: vscode.Uri;
  iosPlistUri?: vscode.Uri;
  iosEntitlementsUri?: vscode.Uri;
  iosPbxprojUri?: vscode.Uri;
  iosPodfileUri?: vscode.Uri;
  iosAppDelegateUri?: vscode.Uri;
  macosPlistUri?: vscode.Uri;
}

/** Project files with loaded content */
export interface ProjectFilesWithContent extends ProjectFiles {
  androidManifestContent?: string;
  iosPlistContent?: string;
  macosPlistContent?: string;
}

/**
 * Discovers all relevant project files in the workspace
 */
export async function discoverProjectFiles(): Promise<ProjectFiles> {
  const [
    androidManifestUris,
    androidMainActivityUris,
    androidAppBuildGradleUris,
    androidAppBuildGradleKtsUris,
    androidBuildGradleUris,
    androidBuildGradleKtsUris,
    androidSettingsGradleUris,
    androidSettingsGradleKtsUris,
    androidGradleWrapperUris,
    iosPlistUris,
    iosEntitlementsUris,
    iosPbxprojUris,
    iosPodfileUris,
    iosAppDelegateUris,
    macosPlistUris,
  ] = await Promise.all([
    vscode.workspace.findFiles(
      FILE_PATTERNS.ANDROID_MANIFEST,
      undefined,
      MAX_SEARCH_RESULTS,
    ),
    vscode.workspace.findFiles(
      FILE_PATTERNS.ANDROID_MAIN_ACTIVITY,
      undefined,
      MAX_SEARCH_RESULTS,
    ),
    vscode.workspace.findFiles(
      FILE_PATTERNS.ANDROID_APP_BUILD_GRADLE,
      undefined,
      MAX_SEARCH_RESULTS,
    ),
    vscode.workspace.findFiles(
      FILE_PATTERNS.ANDROID_APP_BUILD_GRADLE_KTS,
      undefined,
      MAX_SEARCH_RESULTS,
    ),
    vscode.workspace.findFiles(
      FILE_PATTERNS.ANDROID_BUILD_GRADLE,
      undefined,
      MAX_SEARCH_RESULTS,
    ),
    vscode.workspace.findFiles(
      FILE_PATTERNS.ANDROID_BUILD_GRADLE_KTS,
      undefined,
      MAX_SEARCH_RESULTS,
    ),
    vscode.workspace.findFiles(
      FILE_PATTERNS.ANDROID_SETTINGS_GRADLE,
      undefined,
      MAX_SEARCH_RESULTS,
    ),
    vscode.workspace.findFiles(
      FILE_PATTERNS.ANDROID_SETTINGS_GRADLE_KTS,
      undefined,
      MAX_SEARCH_RESULTS,
    ),
    vscode.workspace.findFiles(
      FILE_PATTERNS.ANDROID_GRADLE_WRAPPER,
      undefined,
      MAX_SEARCH_RESULTS,
    ),
    vscode.workspace.findFiles(
      FILE_PATTERNS.IOS_PLIST,
      undefined,
      MAX_SEARCH_RESULTS,
    ),
    vscode.workspace.findFiles(
      FILE_PATTERNS.IOS_ENTITLEMENTS,
      undefined,
      MAX_SEARCH_RESULTS,
    ),
    vscode.workspace.findFiles(
      FILE_PATTERNS.IOS_PBXPROJ,
      undefined,
      MAX_SEARCH_RESULTS,
    ),
    vscode.workspace.findFiles(
      FILE_PATTERNS.IOS_PODFILE,
      undefined,
      MAX_SEARCH_RESULTS,
    ),
    vscode.workspace.findFiles(
      FILE_PATTERNS.IOS_APPDELEGATE,
      undefined,
      MAX_SEARCH_RESULTS,
    ),
    vscode.workspace.findFiles(
      FILE_PATTERNS.MACOS_PLIST,
      undefined,
      MAX_SEARCH_RESULTS,
    ),
  ]);

  return {
    androidManifestUri: androidManifestUris[0],
    androidMainActivityUri: androidMainActivityUris[0],
    androidAppBuildGradleUri: androidAppBuildGradleUris[0],
    androidAppBuildGradleKtsUri: androidAppBuildGradleKtsUris[0],
    androidBuildGradleUri: androidBuildGradleUris[0],
    androidBuildGradleKtsUri: androidBuildGradleKtsUris[0],
    androidSettingsGradleUri: androidSettingsGradleUris[0],
    androidSettingsGradleKtsUri: androidSettingsGradleKtsUris[0],
    androidGradleWrapperUri: androidGradleWrapperUris[0],
    iosPlistUri: iosPlistUris[0],
    iosEntitlementsUri: iosEntitlementsUris[0],
    iosPbxprojUri: iosPbxprojUris[0],
    iosPodfileUri: iosPodfileUris[0],
    iosAppDelegateUri: iosAppDelegateUris[0],
    macosPlistUri: macosPlistUris[0],
  };
}

/**
 * Discovers project files and loads their content
 */
export async function discoverProjectFilesWithContent(): Promise<ProjectFilesWithContent> {
  const files = await discoverProjectFiles();

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

  return {
    ...files,
    androidManifestContent: androidDoc?.getText(),
    iosPlistContent: iosDoc?.getText(),
    macosPlistContent: macosDoc?.getText(),
  };
}

function addDetail(
  details: PlatformDetailItem[],
  key: string,
  label: string,
  value: string | undefined,
  editable: boolean,
  source: string,
): void {
  if (!value) {
    return;
  }

  details.push({
    key,
    label,
    value: value.trim(),
    editable,
    source,
  });
}

function extractFirstMatch(
  content: string | undefined,
  patterns: RegExp[],
): string | undefined {
  if (!content) {
    return undefined;
  }

  for (const pattern of patterns) {
    const match = content.match(pattern);
    if (match?.[1]) {
      return match[1].trim();
    }
  }

  return undefined;
}

function findFirstMatchInSources(
  sources: Array<{ content: string | undefined; source: string }>,
  patterns: RegExp[],
): { value: string; source: string } | undefined {
  for (const source of sources) {
    const value = extractFirstMatch(source.content, patterns);
    if (value) {
      return { value, source: source.source };
    }
  }

  return undefined;
}

/**
 * Discovers major Android and iOS build metadata in the workspace.
 */
export async function discoverProjectPlatformDetails(
  files: ProjectFiles,
): Promise<PlatformDetails> {
  const [
    androidAppBuildGradle,
    androidAppBuildGradleKts,
    androidBuildGradle,
    androidBuildGradleKts,
    androidSettingsGradle,
    androidSettingsGradleKts,
    androidGradleWrapper,
    iosPodfile,
    iosPbxproj,
  ] = await Promise.all([
    readFileContent(files.androidAppBuildGradleUri),
    readFileContent(files.androidAppBuildGradleKtsUri),
    readFileContent(files.androidBuildGradleUri),
    readFileContent(files.androidBuildGradleKtsUri),
    readFileContent(files.androidSettingsGradleUri),
    readFileContent(files.androidSettingsGradleKtsUri),
    readFileContent(files.androidGradleWrapperUri),
    readFileContent(files.iosPodfileUri),
    readFileContent(files.iosPbxprojUri),
  ]);

  const androidDetails: PlatformDetailItem[] = [];
  const iosDetails: PlatformDetailItem[] = [];

  addDetail(
    androidDetails,
    "gradleWrapperVersion",
    "Gradle wrapper",
    extractFirstMatch(androidGradleWrapper, [
      /distributionUrl=.*gradle-([0-9A-Za-z.-]+)-(?:all|bin)\.zip/i,
    ]),
    true,
    "gradle-wrapper.properties",
  );

  const androidBuildSources = [
    { content: androidBuildGradle, source: "android/build.gradle" },
    { content: androidBuildGradleKts, source: "android/build.gradle.kts" },
    { content: androidSettingsGradle, source: "android/settings.gradle" },
    { content: androidSettingsGradleKts, source: "android/settings.gradle.kts" },
  ];

  const androidAppSources = [
    { content: androidAppBuildGradle, source: "android/app/build.gradle" },
    { content: androidAppBuildGradleKts, source: "android/app/build.gradle.kts" },
  ];

  const gradlePlugin = findFirstMatchInSources(androidBuildSources, [
    /com\.android\.tools\.build:gradle:([0-9A-Za-z.-]+)/i,
    /id\s*\(\s*["']com\.android\.(?:application|library)["']\s*\)\s*version\s*["']([^\r\n"']+)["']/i,
    /id\s*["']com\.android\.(?:application|library)["']\s*version\s*["']([^\r\n"']+)["']/i,
  ]);
  addDetail(
    androidDetails,
    "androidGradlePluginVersion",
    "Android Gradle Plugin",
    gradlePlugin?.value,
    true,
    gradlePlugin?.source ?? "android/build files",
  );

  const kotlinVersion = findFirstMatchInSources(androidBuildSources, [
    /kotlin_version\s*=?\s*["']([^\r\n"']+)["']/i,
    /id\s*\(\s*["']org\.jetbrains\.kotlin\.[^"']+["']\s*\)\s*version\s*["']([^\r\n"']+)["']/i,
    /id\s*["']org\.jetbrains\.kotlin\.[^"']+["']\s*version\s*["']([^\r\n"']+)["']/i,
    /kotlin\("android"\)\s*version\s*["']([^\r\n"']+)["']/i,
  ]);
  addDetail(
    androidDetails,
    "kotlinVersion",
    "Kotlin version",
    kotlinVersion?.value,
    true,
    kotlinVersion?.source ?? "android/build files",
  );

  const compileSdk = findFirstMatchInSources(androidAppSources, [
    /compileSdk(?:Version)?\s*(?:=)?\s*([0-9]+)/i,
  ]);
  addDetail(
    androidDetails,
    "compileSdk",
    "Compile SDK",
    compileSdk?.value ? `API ${compileSdk.value}` : undefined,
    true,
    compileSdk?.source ?? "android/app/build.gradle",
  );

  const minSdk = findFirstMatchInSources(androidAppSources, [
    /minSdk(?:Version)?\s*(?:=)?\s*([0-9]+)/i,
  ]);
  addDetail(
    androidDetails,
    "minSdk",
    "Min SDK",
    minSdk?.value ? `API ${minSdk.value}` : undefined,
    true,
    minSdk?.source ?? "android/app/build.gradle",
  );

  const targetSdk = findFirstMatchInSources(androidAppSources, [
    /targetSdk(?:Version)?\s*(?:=)?\s*([0-9]+)/i,
  ]);
  addDetail(
    androidDetails,
    "targetSdk",
    "Target SDK",
    targetSdk?.value ? `API ${targetSdk.value}` : undefined,
    true,
    targetSdk?.source ?? "android/app/build.gradle",
  );

  const namespace = findFirstMatchInSources(androidAppSources, [
    /namespace\s*(?:=)?\s*["']([^\r\n"']+)["']/i,
  ]);
  addDetail(
    androidDetails,
    "namespace",
    "Namespace",
    namespace?.value,
    true,
    namespace?.source ?? "android/app/build.gradle",
  );

  const applicationId = findFirstMatchInSources(androidAppSources, [
    /applicationId\s*(?:=)?\s*["']([^\r\n"']+)["']/i,
  ]);
  addDetail(
    androidDetails,
    "applicationId",
    "Application ID",
    applicationId?.value,
    true,
    applicationId?.source ?? "android/app/build.gradle",
  );

  const versionName = findFirstMatchInSources(androidAppSources, [
    /versionName\s*(?:=)?\s*["']([^\r\n"']+)["']/i,
  ]);
  addDetail(
    androidDetails,
    "versionName",
    "Version name",
    versionName?.value,
    true,
    versionName?.source ?? "android/app/build.gradle",
  );

  const versionCode = findFirstMatchInSources(androidAppSources, [
    /versionCode\s*(?:=)?\s*([0-9]+)/i,
  ]);
  addDetail(
    androidDetails,
    "versionCode",
    "Version code",
    versionCode?.value,
    true,
    versionCode?.source ?? "android/app/build.gradle",
  );

  const iosDeploymentTarget = findFirstMatchInSources(
    [
      { content: iosPodfile, source: "ios/Podfile" },
      { content: iosPbxproj, source: "project.pbxproj" },
    ],
    [
      /platform\s*:ios,\s*["']([^\r\n"']+)["']/i,
      /IPHONEOS_DEPLOYMENT_TARGET\s*=\s*([^;]+);/i,
    ],
  );
  addDetail(
    iosDetails,
    "iosDeploymentTarget",
    "iOS deployment target",
    iosDeploymentTarget?.value,
    true,
    iosDeploymentTarget?.source ?? "ios/Podfile",
  );

  const swiftVersion = findFirstMatchInSources(
    [{ content: iosPbxproj, source: "project.pbxproj" }],
    [/SWIFT_VERSION\s*=\s*([^;]+);/i],
  );
  addDetail(
    iosDetails,
    "swiftVersion",
    "Swift version",
    swiftVersion?.value,
    true,
    swiftVersion?.source ?? "project.pbxproj",
  );

  const bundleIdentifier = findFirstMatchInSources(
    [{ content: iosPbxproj, source: "project.pbxproj" }],
    [/PRODUCT_BUNDLE_IDENTIFIER\s*=\s*([^;]+);/i],
  );
  addDetail(
    iosDetails,
    "bundleIdentifier",
    "Bundle identifier",
    bundleIdentifier?.value,
    true,
    bundleIdentifier?.source ?? "project.pbxproj",
  );

  const projectObjectVersion = findFirstMatchInSources(
    [{ content: iosPbxproj, source: "project.pbxproj" }],
    [/objectVersion\s*=\s*([0-9]+);/i],
  );
  addDetail(
    iosDetails,
    "projectFormatVersion",
    "Project format version",
    projectObjectVersion?.value,
    false,
    projectObjectVersion?.source ?? "project.pbxproj",
  );

  return {
    android: androidDetails,
    ios: iosDetails,
  };
}

/**
 * Reads content from a file URI
 */
export async function readFileContent(
  uri: vscode.Uri | undefined,
): Promise<string | undefined> {
  if (!uri) {
    return undefined;
  }

  try {
    const doc = await vscode.workspace.openTextDocument(uri);
    return doc.getText();
  } catch {
    return undefined;
  }
}

/**
 * Checks if project has Android support
 */
export function hasAndroidSupport(files: ProjectFiles): boolean {
  return !!files.androidManifestUri;
}

/**
 * Checks if project has iOS support
 */
export function hasIOSSupport(files: ProjectFiles): boolean {
  return !!files.iosPlistUri;
}

/**
 * Checks if project has macOS support
 */
export function hasMacOSSupport(files: ProjectFiles): boolean {
  return !!files.macosPlistUri;
}

/**
 * Checks if project has Podfile
 */
export function hasPodfile(files: ProjectFiles): boolean {
  return !!files.iosPodfileUri;
}
