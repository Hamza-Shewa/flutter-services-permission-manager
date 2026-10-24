/**
 * Webview handlers for permission advice and the "Apply recommended variants"
 * preview. The advice engine and writers are pure; this file only reads the
 * current documents and posts results back.
 */

import * as vscode from "vscode";
import type { AndroidPermissionEntry, IOSPermissionEntry } from "../../core/types/index.js";
import type { ProjectFiles } from "../../core/workspace.service.js";
import { getAndroidPermissions, getIOSPermissions, getUsedAndroidPermissions, getUsedIOSPermissions } from "../../features/permissions/extractor.js";
import { readProjectPermissionFacts } from "../../features/permissions/project-facts.js";
import { buildPermissionAdvice } from "../../features/permissions/advice.js";
import { updateAndroidManifest } from "../../core/platform/android/manifest.service.js";
import { updateIOSPlist } from "../../core/platform/ios/plist.service.js";
import { compactDiff, diffLines } from "../../core/shared/line-diff.js";
import { toErrorMessage } from "../../core/shared/errors.js";
import { getCategorizedIosPermissionsCache } from "../state.js";
import type { WebviewRef } from "./index.js";

async function readDocument(uri: vscode.Uri | undefined): Promise<string | undefined> {
  if (!uri) {
    return undefined;
  }
  try {
    return (await vscode.workspace.openTextDocument(uri)).getText();
  } catch {
    return undefined;
  }
}

function knownIosKeys(): Set<string> | undefined {
  const categorized = getCategorizedIosPermissionsCache();
  if (!categorized) {
    return undefined;
  }
  return new Set(Object.values(categorized).flat().map((p) => p.permission).filter(Boolean));
}

/**
 * Advice for the permissions the webview currently holds (unsaved edits
 * included). Falls back to what is in the files when the webview sends none.
 */
export async function handleRequestPermissionAdvice(
  ref: WebviewRef,
  files: ProjectFiles,
  androidEntries: AndroidPermissionEntry[] | undefined,
  iosEntries: IOSPermissionEntry[] | undefined,
): Promise<void> {
  try {
    const root = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    const facts = root ? readProjectPermissionFacts(root) : {};
    const [androidCatalog, iosCatalog] = await Promise.all([getAndroidPermissions(), getIOSPermissions()]);

    let android = androidEntries;
    if (!android && files.androidManifestUri) {
      android = (await getUsedAndroidPermissions((await readDocument(files.androidManifestUri)) ?? "")).map((p) => p.entry);
    }
    let ios = iosEntries;
    if (!ios && files.iosPlistUri) {
      ios = (await getUsedIOSPermissions((await readDocument(files.iosPlistUri)) ?? "")).map((p) => ({ permission: p.permission, value: p.value, type: p.type }));
    }

    const report = buildPermissionAdvice({
      facts,
      android: files.androidManifestUri && android ? { entries: android, catalog: androidCatalog } : undefined,
      ios: files.iosPlistUri && ios ? { entries: ios, catalog: iosCatalog, platform: "ios" } : undefined,
    });
    ref.webview.postMessage({ type: "permissionAdvice", ...report });
  } catch (error) {
    ref.webview.postMessage({ type: "permissionAdvice", header: { notes: [] }, advice: [], error: toErrorMessage(error) });
  }
}

/** What saving these entries would change, as a compact line diff per file (nothing is written). */
export async function handlePreviewPermissionChanges(
  ref: WebviewRef,
  files: ProjectFiles,
  androidEntries: AndroidPermissionEntry[] | undefined,
  iosEntries: IOSPermissionEntry[] | undefined,
): Promise<void> {
  try {
    const previews: Array<{ file: string; lines: ReturnType<typeof compactDiff> }> = [];
    const manifest = await readDocument(files.androidManifestUri);
    if (manifest !== undefined && androidEntries) {
      const updated = updateAndroidManifest(manifest, androidEntries);
      if (updated !== manifest) {
        previews.push({ file: vscode.workspace.asRelativePath(files.androidManifestUri!), lines: compactDiff(diffLines(manifest, updated)) });
      }
    }
    const plist = await readDocument(files.iosPlistUri);
    if (plist !== undefined && iosEntries) {
      const updated = updateIOSPlist(plist, iosEntries, knownIosKeys());
      if (updated !== plist) {
        previews.push({ file: vscode.workspace.asRelativePath(files.iosPlistUri!), lines: compactDiff(diffLines(plist, updated)) });
      }
    }
    ref.webview.postMessage({ type: "permissionChangesPreview", previews });
  } catch (error) {
    ref.webview.postMessage({ type: "permissionChangesPreview", previews: [], error: toErrorMessage(error) });
  }
}
