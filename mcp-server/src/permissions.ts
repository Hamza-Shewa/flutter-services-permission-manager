/**
 * Permission tools for the Flutter Config Manager MCP server.
 *
 * These reuse the extension's PURE, vscode-free compiled modules
 * (`updateAndroidManifest` / `updateIOSPlist`) so writes are identical to what
 * the VS Code UI produces, then persist the result with Node `fs`.
 */

import { z } from 'zod';

import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';

import { updateAndroidManifest } from '../../out/core/platform/android/manifest.service.js';
import { updateIOSPlist } from '../../out/core/platform/ios/plist.service.js';

import {
  PlatformFile,
  extractAndroidPermissionNames,
  extractIOSPermissionEntries,
  getAllAndroidPermissions,
  getAllIOSPermissions,
  getFile,
  readText,
  writeText,
} from './host.js';

const ANDROID_KIND = 'ANDROID_MANIFEST';
const IOS_KIND = 'IOS_PLIST';
const MACOS_KIND = 'MACOS_PLIST';

const ANDROID_PERMISSION_PREFIX = 'android.permission.';

/** Normalize a user-supplied Android permission name to its full constant. */
function normalizeAndroidPermission(name: string): string {
  const trimmed = name.trim();
  return trimmed.startsWith(ANDROID_PERMISSION_PREFIX)
    ? trimmed
    : `${ANDROID_PERMISSION_PREFIX}${trimmed}`;
}

/** A permission fully-qualified with catalog metadata (when known). */
interface EnrichedAndroidPermission {
  name: string;
  description?: string;
  category?: string;
  protectionLevel?: string;
  apiLevel?: number;
  equivalentIosPermissions?: string[];
}

function enrichAndroidNames(names: string[]): EnrichedAndroidPermission[] {
  const catalog = getAllAndroidPermissions();
  return names.map((name) => {
    const short = name.replace(/^android\.permission\./, '');
    const info = catalog.find(
      (p) => p.constantValue === name || p.permission === name || p.permission === short,
    );
    return {
      name,
      description: info?.description,
      category: info?.category,
      protectionLevel: info?.protectionLevel,
      apiLevel: info?.apiLevel,
      equivalentIosPermissions: info?.equivalentIosPermissions,
    };
  });
}

interface EnrichedIOSPermission {
  permission: string;
  value?: string | boolean;
  type?: string;
  description?: string;
  category?: string;
  podfileMacro?: string;
  equivalentAndroidPermissions?: string[];
}

function enrichIOSEntries(entries: ReturnType<typeof extractIOSPermissionEntries>) {
  const catalog = getAllIOSPermissions();
  return entries.map((entry) => {
    const info = catalog.find((p) => p.permission === entry.permission);
    return {
      permission: entry.permission,
      value: entry.value,
      type: entry.type,
      description: info?.description,
      category: info?.category,
      podfileMacro: info?.podfileMacro,
      equivalentAndroidPermissions: info?.equivalentAndroidPermissions,
    } satisfies EnrichedIOSPermission;
  });
}

/** Build an MCP text result. */
function textResult(data: unknown): CallToolResult {
  return { content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }] };
}

/** List permissions currently present in the Android manifest and iOS plists. */
export async function listPermissionsTool(
  files: PlatformFile[],
  _args: Record<string, unknown>,
): Promise<CallToolResult> {
  const result: Record<string, unknown> = {};

  const manifest = getFile(files, ANDROID_KIND);
  if (manifest) {
    const content = readText(manifest);
    if (content !== undefined) {
      result.android = {
        file: manifest.relativePath,
        permissions: enrichAndroidNames(extractAndroidPermissionNames(content)),
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
        permissions: enrichIOSEntries(extractIOSPermissionEntries(content)),
      };
    }
  }

  return textResult(result);
}

/**
 * Add a permission to the Android manifest and/or iOS plist. The extension's
 * `updateAndroidManifest`/`updateIOSPlist` replace the full set, so we pass the
 * existing set plus the new entry.
 */
export async function addPermissionTool(
  files: PlatformFile[],
  args: Record<string, unknown>,
): Promise<CallToolResult> {
  const platform = String(args.platform ?? 'both').toLowerCase(); // 'android' | 'ios' | 'both'
  const rawName = String(args.name ?? '').trim();
  if (!rawName) {
    return textResult({ ok: false, error: 'Missing required "name".' });
  }
  const iosValue =
    typeof args.value === 'string' ? args.value : typeof args.value === 'boolean' ? args.value : undefined;
  const iosType = String(args.type ?? 'string').toLowerCase();

  const summary: Record<string, unknown> = { name: rawName, platform };
  const writes: string[] = [];

  if (platform === 'android' || platform === 'both') {
    const manifest = getFile(files, ANDROID_KIND);
    if (!manifest) {
      return textResult({ ok: false, error: 'No AndroidManifest.xml found in project.' });
    }
    const content = readText(manifest);
    if (content === undefined) {
      return textResult({ ok: false, error: 'Could not read AndroidManifest.xml.' });
    }
    const fullName = normalizeAndroidPermission(rawName);
    const existing = extractAndroidPermissionNames(content);
    const next = existing.includes(fullName) ? existing : [...existing, fullName];
    const updated = updateAndroidManifest(content, next);
    writeText(manifest, updated);
    writes.push(manifest.relativePath);
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
        const existing = extractIOSPermissionEntries(content);
        const already = existing.some((e) => e.permission === rawName);
        const entry = { permission: rawName, value: iosValue, type: iosType };
        const next = already
          ? existing.map((e) => (e.permission === rawName ? entry : e))
          : [...existing, entry];
        const updated = updateIOSPlist(content, next);
        writeText(plist, updated);
        writes.push(plist.relativePath);
        summary[plist.kind === MACOS_KIND ? 'macos' : 'ios'] = rawName;
      }
    }
  }

  return textResult({ ok: true, ...summary, writtenFiles: writes });
}

/**
 * Remove a permission from the Android manifest and/or iOS plist by replacing
 * the full set without the removed entry.
 */
export async function removePermissionTool(
  files: PlatformFile[],
  args: Record<string, unknown>,
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
        const fullName = normalizeAndroidPermission(rawName);
        const existing = extractAndroidPermissionNames(content).filter((n) => n !== fullName);
        const updated = updateAndroidManifest(content, existing);
        writeText(manifest, updated);
        writes.push(manifest.relativePath);
        summary.android = fullName;
      }
    }
  }

  if (platform === 'ios' || platform === 'both') {
    const plist = getFile(files, IOS_KIND) ?? getFile(files, MACOS_KIND);
    if (plist) {
      const content = readText(plist);
      if (content !== undefined) {
        const existing = extractIOSPermissionEntries(content).filter(
          (e) => e.permission !== rawName,
        );
        const updated = updateIOSPlist(content, existing);
        writeText(plist, updated);
        writes.push(plist.relativePath);
        summary[plist.kind === MACOS_KIND ? 'macos' : 'ios'] = rawName;
      }
    }
  }

  return textResult({ ok: true, ...summary, writtenFiles: writes });
}

/** Shared zod input schemas used by the tool registration. */
export const listPermissionsSchema = z.object({});
export const addPermissionSchema = z.object({
  platform: z
    .enum(['android', 'ios', 'both'])
    .optional()
    .describe('Which platform(s) to update. Defaults to "both".'),
  name: z.string().describe('Permission name, e.g. "CAMERA" (Android) or "NSCameraUsageDescription" (iOS).'),
  value: z.union([z.string(), z.boolean()]).optional().describe('iOS usage description value (string) or true/false (boolean).'),
  type: z.enum(['string', 'boolean']).optional().describe('iOS entry type. Defaults to "string".'),
});
export const removePermissionSchema = z.object({
  platform: z
    .enum(['android', 'ios', 'both'])
    .optional()
    .describe('Which platform(s) to update. Defaults to "both".'),
  name: z.string().describe('Permission name to remove, e.g. "android.permission.CAMERA" or "NSCameraUsageDescription".'),
});
