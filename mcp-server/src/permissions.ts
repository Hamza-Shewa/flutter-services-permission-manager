/**
 * Permission tools for the Flutter Config Manager MCP server.
 *
 * These reuse the extension's PURE, vscode-free compiled modules (the
 * structure-preserving manifest / plist writers, catalog lookups, project SDK
 * facts and the variant advice engine) so writes and advice are identical to
 * what the VS Code UI produces, then persist the result with Node `fs`.
 */

import { z } from 'zod';

import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';

import {
  extractAndroidPermissionEntries,
  updateAndroidManifest,
} from '../../out/core/platform/android/manifest.service.js';
import { updateIOSPlist } from '../../out/core/platform/ios/plist.service.js';
import {
  buildUsedAndroidPermissions,
  buildUsedIOSPermissions,
  enrichAndroidPermissionsWithEquivalents,
  enrichIOSPermissionsWithEquivalents,
  resolveAndroidPermissionName,
} from '../../out/features/permissions/catalog.js';
import { readProjectPermissionFacts } from '../../out/features/permissions/project-facts.js';
import { buildPermissionAdvice } from '../../out/features/permissions/advice.js';
import type {
  AndroidPermission,
  AndroidPermissionEntry,
  IOSPermission,
  IOSPermissionEntry,
  PermissionMapping,
} from '../../out/core/types/index.js';

import {
  PlatformFile,
  getAllAndroidPermissions,
  getAllIOSPermissions,
  getFile,
  loadPermissionMapping,
  readText,
  writeText,
} from './host.js';

const ANDROID_KIND = 'ANDROID_MANIFEST';
const IOS_KIND = 'IOS_PLIST';
const MACOS_KIND = 'MACOS_PLIST';

function androidCatalog(): AndroidPermission[] {
  const mapping = loadPermissionMapping() as unknown as PermissionMapping;
  return enrichAndroidPermissionsWithEquivalents(getAllAndroidPermissions() as unknown as AndroidPermission[], mapping);
}

function iosCatalog(): IOSPermission[] {
  const mapping = loadPermissionMapping() as unknown as PermissionMapping;
  return enrichIOSPermissionsWithEquivalents(getAllIOSPermissions() as unknown as IOSPermission[], mapping);
}

function iosCatalogKeys(catalog: IOSPermission[]): Set<string> {
  return new Set(catalog.map((p) => p.permission));
}

/** Build an MCP text result. */
function textResult(data: unknown): CallToolResult {
  return { content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }] };
}

function describeAndroid(manifestContent: string, catalog: AndroidPermission[]) {
  return buildUsedAndroidPermissions(manifestContent, catalog).map((p) => ({
    name: p.constantValue,
    permission: p.permission,
    description: p.description,
    category: p.category,
    protectionLevel: p.protectionLevel || undefined,
    apiLevel: p.apiLevel || undefined,
    deprecatedIn: p.deprecatedIn ?? undefined,
    removedIn: p.removedIn ?? undefined,
    audience: p.audience,
    source: p.source,
    maxSdkVersion: p.entry.maxSdkVersion,
    minSdkVersion: p.entry.minSdkVersion,
    usesPermissionFlags: p.entry.usesPermissionFlags,
    sdk23: p.entry.sdk23,
    toolsNode: p.entry.toolsNode,
    toolsAttributes: p.entry.toolsAttributes,
    mergerRemoved: p.mergerRemoved,
    unknown: p.unknown,
    recommended: p.recommended,
    replacedBy: p.replacedBy,
    playPolicy: p.playPolicy,
    equivalentIosPermissions: p.equivalentIosPermissions,
  }));
}

function describeIOS(plistContent: string, catalog: IOSPermission[]) {
  return buildUsedIOSPermissions(plistContent, catalog).map((p) => ({
    permission: p.permission,
    value: p.value,
    type: p.type,
    description: p.description,
    category: p.category,
    minOS: p.minOS,
    minMacOS: p.minMacOS,
    deprecatedInOS: p.deprecatedInOS,
    replacedBy: p.replacedBy,
    podfileMacro: p.podfileMacro,
    unknown: p.unknown,
    equivalentAndroidPermissions: p.equivalentAndroidPermissions,
  }));
}

function iosEntriesOf(plistContent: string, catalog: IOSPermission[]): IOSPermissionEntry[] {
  return buildUsedIOSPermissions(plistContent, catalog).map((p) => ({ permission: p.permission, value: p.value, type: p.type }));
}

/** Advice + SDK facts for the current files (read-only). */
function adviceFor(root: string, files: PlatformFile[], androidCat: AndroidPermission[], iosCat: IOSPermission[]) {
  const facts = readProjectPermissionFacts(root);
  const manifest = getFile(files, ANDROID_KIND);
  const manifestContent = manifest ? readText(manifest) : undefined;
  const plist = getFile(files, IOS_KIND);
  const plistContent = plist ? readText(plist) : undefined;
  return buildPermissionAdvice({
    facts,
    android: manifestContent !== undefined ? { entries: extractAndroidPermissionEntries(manifestContent), catalog: androidCat } : undefined,
    ios: plistContent !== undefined ? { entries: iosEntriesOf(plistContent, iosCat), catalog: iosCat, platform: 'ios' } : undefined,
  });
}

/** List permissions currently present in the Android manifest and iOS plists, with advice. */
export async function listPermissionsTool(
  files: PlatformFile[],
  _args: Record<string, unknown>,
  root: string,
): Promise<CallToolResult> {
  const result: Record<string, unknown> = {};
  const androidCat = androidCatalog();
  const iosCat = iosCatalog();

  const manifest = getFile(files, ANDROID_KIND);
  if (manifest) {
    const content = readText(manifest);
    if (content !== undefined) {
      const permissions = describeAndroid(content, androidCat);
      result.android = {
        file: manifest.relativePath,
        permissions: permissions.filter((p) => !p.mergerRemoved),
        mergerRemoved: permissions.filter((p) => p.mergerRemoved),
      };
    }
  }

  const iosFiles = [IOS_KIND, MACOS_KIND]
    .map((kind) => getFile(files, kind))
    .filter((f): f is PlatformFile => !!f);
  for (const file of iosFiles) {
    const content = readText(file);
    if (content !== undefined) {
      result[file.kind === MACOS_KIND ? 'macos' : 'ios'] = {
        file: file.relativePath,
        permissions: describeIOS(content, iosCat),
      };
    }
  }

  const report = adviceFor(root, files, androidCat, iosCat);
  result.sdk = report.header;
  result.advice = report.advice;
  return textResult(result);
}

/** Read-only audit: SDK facts and advice for every declared permission. */
export async function auditPermissionsTool(
  files: PlatformFile[],
  _args: Record<string, unknown>,
  root: string,
): Promise<CallToolResult> {
  const report = adviceFor(root, files, androidCatalog(), iosCatalog());
  const counts = { error: 0, warning: 0, info: 0 };
  for (const item of report.advice) {
    counts[item.level]++;
  }
  return textResult({ ...report, counts });
}

function optionalInt(value: unknown): number | null | undefined {
  if (value === null) {
    return null;
  }
  if (value === undefined || value === '') {
    return undefined;
  }
  const parsed = typeof value === 'number' ? value : parseInt(String(value), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}

/**
 * Add a permission (or change its attributes) in the Android manifest and/or
 * iOS plist. Existing elements keep their attributes unless the call sets them;
 * `tools:node="remove"` lines are never dropped.
 */
export async function addPermissionTool(
  files: PlatformFile[],
  args: Record<string, unknown>,
  root: string,
): Promise<CallToolResult> {
  const platform = String(args.platform ?? 'both').toLowerCase(); // 'android' | 'ios' | 'both'
  const rawName = String(args.name ?? '').trim();
  if (!rawName) {
    return textResult({ ok: false, error: 'Missing required "name".' });
  }

  const summary: Record<string, unknown> = { name: rawName, platform };
  const writes: string[] = [];
  const androidCat = androidCatalog();
  const iosCat = iosCatalog();

  if (platform === 'android' || platform === 'both') {
    const manifest = getFile(files, ANDROID_KIND);
    if (!manifest) {
      return textResult({ ok: false, error: 'No AndroidManifest.xml found in project.' });
    }
    const content = readText(manifest);
    if (content === undefined) {
      return textResult({ ok: false, error: 'Could not read AndroidManifest.xml.' });
    }
    const fullName = resolveAndroidPermissionName(androidCat, rawName);
    const requested: Record<string, unknown> = { name: fullName };
    const maxSdk = optionalInt(args.maxSdkVersion);
    const minSdk = optionalInt(args.minSdkVersion);
    if (maxSdk !== undefined) { requested.maxSdkVersion = maxSdk; }
    if (minSdk !== undefined) { requested.minSdkVersion = minSdk; }
    if (args.usesPermissionFlags !== undefined) {
      requested.usesPermissionFlags = args.usesPermissionFlags === null ? null : String(args.usesPermissionFlags);
    }
    if (typeof args.sdk23 === 'boolean') { requested.sdk23 = args.sdk23; }
    if (args.toolsNode !== undefined) { requested.toolsNode = args.toolsNode; }

    const existing = extractAndroidPermissionEntries(content);
    const index = existing.findIndex((entry) => entry.name === fullName && (args.toolsNode !== undefined || entry.toolsNode !== 'remove'));
    const next: Array<AndroidPermissionEntry | Record<string, unknown>> = index === -1
      ? [...existing, requested]
      : existing.map((entry, position) => (position === index ? { ...entry, ...requested } : entry));
    const updated = updateAndroidManifest(content, next as AndroidPermissionEntry[]);
    if (updated !== content) {
      writeText(manifest, updated);
      writes.push(manifest.relativePath);
    }
    summary.android = fullName;
  }

  if (platform === 'ios' || platform === 'both') {
    const plist = getFile(files, IOS_KIND) ?? getFile(files, MACOS_KIND);
    if (!plist) {
      if (platform === 'ios') {
        return textResult({ ok: false, error: 'No Info.plist found in project.' });
      }
    } else {
      const content = readText(plist);
      if (content !== undefined) {
        const info = iosCat.find((p) => p.permission === rawName);
        const type = String(args.type ?? info?.type ?? 'string').toLowerCase();
        const value = args.value as IOSPermissionEntry['value'];
        const existing = iosEntriesOf(content, iosCat);
        const entry: IOSPermissionEntry = { permission: rawName, value, type };
        const already = existing.some((e) => e.permission === rawName);
        const next = already ? existing.map((e) => (e.permission === rawName ? entry : e)) : [...existing, entry];
        const updated = updateIOSPlist(content, next, iosCatalogKeys(iosCat));
        if (updated !== content) {
          writeText(plist, updated);
          writes.push(plist.relativePath);
        }
        summary[plist.kind === MACOS_KIND ? 'macos' : 'ios'] = rawName;
      }
    }
  }

  const report = adviceFor(root, files, androidCat, iosCat);
  const name = typeof summary.android === 'string' ? summary.android : rawName;
  return textResult({
    ok: true,
    ...summary,
    writtenFiles: writes,
    advice: report.advice.filter((item) => item.permission === name || item.permission === rawName),
  });
}

/**
 * Remove a permission from the Android manifest and/or iOS plist. Android
 * `tools:node="remove"` lines are kept (they are not declarations).
 */
export async function removePermissionTool(
  files: PlatformFile[],
  args: Record<string, unknown>,
  _root: string,
): Promise<CallToolResult> {
  const platform = String(args.platform ?? 'both').toLowerCase();
  const rawName = String(args.name ?? '').trim();
  if (!rawName) {
    return textResult({ ok: false, error: 'Missing required "name".' });
  }

  const summary: Record<string, unknown> = { name: rawName, platform };
  const writes: string[] = [];

  if (platform === 'android' || platform === 'both') {
    const manifest = getFile(files, ANDROID_KIND);
    if (manifest) {
      const content = readText(manifest);
      if (content !== undefined) {
        const fullName = resolveAndroidPermissionName(androidCatalog(), rawName);
        const existing = extractAndroidPermissionEntries(content).filter(
          (entry) => entry.name !== fullName || entry.toolsNode === 'remove',
        );
        const updated = updateAndroidManifest(content, existing);
        if (updated !== content) {
          writeText(manifest, updated);
          writes.push(manifest.relativePath);
        }
        summary.android = fullName;
      }
    }
  }

  if (platform === 'ios' || platform === 'both') {
    const plist = getFile(files, IOS_KIND) ?? getFile(files, MACOS_KIND);
    if (plist) {
      const content = readText(plist);
      if (content !== undefined) {
        const catalog = iosCatalog();
        const keys = iosCatalogKeys(catalog);
        keys.add(rawName);
        const existing = iosEntriesOf(content, catalog).filter((e) => e.permission !== rawName);
        const updated = updateIOSPlist(content, existing, keys);
        if (updated !== content) {
          writeText(plist, updated);
          writes.push(plist.relativePath);
        }
        summary[plist.kind === MACOS_KIND ? 'macos' : 'ios'] = rawName;
      }
    }
  }

  return textResult({ ok: true, ...summary, writtenFiles: writes });
}

/** Shared zod input schemas used by the tool registration. */
export const listPermissionsSchema = z.object({});
export const auditPermissionsSchema = z.object({});
export const addPermissionSchema = z.object({
  platform: z
    .enum(['android', 'ios', 'both'])
    .optional()
    .describe('Which platform(s) to update. Defaults to "both".'),
  name: z.string().describe('Permission name, e.g. "CAMERA", "android.permission.CAMERA", "health.READ_STEPS", "com.google.android.gms.permission.AD_ID" (Android) or "NSCameraUsageDescription" (iOS).'),
  value: z
    .union([z.string(), z.boolean(), z.array(z.string()), z.record(z.string(), z.string())])
    .optional()
    .describe('iOS value: usage description (string), true/false (boolean), list of strings (array, e.g. NSBonjourServices) or string map (dictionary).'),
  type: z.enum(['string', 'boolean', 'array', 'dictionary']).optional().describe('iOS entry type. Defaults to the catalog type, else "string".'),
  maxSdkVersion: z.number().int().positive().nullable().optional().describe('Android: android:maxSdkVersion (e.g. 32 for READ_EXTERNAL_STORAGE). null removes it.'),
  minSdkVersion: z.number().int().positive().nullable().optional().describe('Android: android:minSdkVersion. null removes it.'),
  usesPermissionFlags: z.string().nullable().optional().describe('Android: android:usesPermissionFlags, e.g. "neverForLocation" for BLUETOOTH_SCAN / NEARBY_WIFI_DEVICES. null removes it.'),
  sdk23: z.boolean().optional().describe('Android: write <uses-permission-sdk-23> instead of <uses-permission>.'),
  toolsNode: z.enum(['remove', 'replace', 'merge']).nullable().optional().describe('Android: tools:node (e.g. "remove" to strip a library-declared permission from the merged manifest). null removes it.'),
});
export const removePermissionSchema = z.object({
  platform: z
    .enum(['android', 'ios', 'both'])
    .optional()
    .describe('Which platform(s) to update. Defaults to "both".'),
  name: z.string().describe('Permission name to remove, e.g. "android.permission.CAMERA" or "NSCameraUsageDescription".'),
});
