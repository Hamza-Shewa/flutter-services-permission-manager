/**
 * Pure permission-catalog helpers (no vscode, no fs): the extension feeds them
 * the JSON it loads through `readJsonFile`, the MCP server the JSON it reads
 * from disk. Keep this module free of vscode imports.
 */

import type {
    AndroidPermission,
    IOSPermission,
    PermissionMapping,
    UsedAndroidPermission,
} from '../../core/types/index.js';
import {
    normalizeAndroidPermissionName,
    parseManifestPermissions,
    permissionEntryFromElement,
} from '../../core/platform/android/manifest-permissions.js';
import { parsePlistTopLevel } from '../../core/shared/plist-entries.js';

/** Category shown for permissions the catalog does not know. */
export const UNKNOWN_CATEGORY = 'Not in catalog';

export function flattenCatalog<T>(raw: T[] | Record<string, T[]> | null | undefined): T[] {
    if (!raw) {
        return [];
    }
    return Array.isArray(raw) ? raw : Object.values(raw).flat();
}

/** Looks a permission up by constant (`android.permission.CAMERA`), catalog name (`CAMERA`, `health.READ_STEPS`) or short name. */
export function findAndroidPermission(catalog: AndroidPermission[], name: string): AndroidPermission | undefined {
    const trimmed = (name ?? '').trim();
    if (!trimmed) {
        return undefined;
    }
    return catalog.find(p => p.constantValue === trimmed)
        ?? catalog.find(p => p.permission === trimmed)
        ?? catalog.find(p => p.constantValue === normalizeAndroidPermissionName(trimmed))
        ?? catalog.find(p => p.constantValue === `android.permission.${trimmed}`);
}

/** The full permission name to write for a user-supplied name. */
export function resolveAndroidPermissionName(catalog: AndroidPermission[], name: string): string {
    return findAndroidPermission(catalog, name)?.constantValue ?? normalizeAndroidPermissionName(name);
}

/**
 * Every `<uses-permission>` / `<uses-permission-sdk-23>` element of a manifest,
 * with catalog details, its attributes, whether the manifest merger removes it,
 * and `unknown: true` for names the catalog does not have (kept so a save never
 * drops them).
 */
export function buildUsedAndroidPermissions(manifestContent: string, catalog: AndroidPermission[]): UsedAndroidPermission[] {
    return parseManifestPermissions(manifestContent).map(element => {
        const entry = permissionEntryFromElement(element);
        const info = findAndroidPermission(catalog, element.name);
        const mergerRemoved = entry.toolsNode === 'remove';
        if (info) {
            return { ...info, entry, mergerRemoved };
        }
        const shortName = element.name.replace(/^android\.permission\./, '');
        return {
            permission: shortName,
            constantValue: element.name,
            description: 'Not in the permission catalog; kept as written.',
            protectionLevel: '',
            category: UNKNOWN_CATEGORY,
            apiLevel: 0,
            entry,
            mergerRemoved,
            unknown: true,
        };
    });
}

/** Keys that look like privacy usage descriptions. */
function isUsageDescriptionKey(key: string): boolean {
    return /UsageDescription(?:Dictionary)?$/.test(key);
}

/**
 * The permission keys of an Info.plist: every catalog key present, plus
 * `*UsageDescription` keys the catalog does not know (`unknown: true`).
 * Values are strings, booleans, string arrays or flat string dictionaries;
 * nested structures come back without `value` (the writer keeps them as-is).
 */
export function buildUsedIOSPermissions(plistContent: string, catalog: IOSPermission[]): IOSPermission[] {
    const parsed = parsePlistTopLevel(plistContent);
    if (!parsed) {
        return [];
    }
    const result: IOSPermission[] = [];
    for (const item of parsed.entries) {
        const info = catalog.find(p => p.permission === item.key);
        if (!info && !isUsageDescriptionKey(item.key)) {
            continue;
        }
        const type = item.type === 'boolean' || item.type === 'array' || item.type === 'dictionary' || item.type === 'string'
            ? item.type
            : (info?.type ?? 'string');
        const used: IOSPermission = info
            ? { ...info, type }
            : { permission: item.key, description: 'Not in the permission catalog; kept as written.', type, category: UNKNOWN_CATEGORY, unknown: true };
        if (item.value !== undefined) {
            used.value = item.value;
        }
        result.push(used);
    }
    return result;
}

export function enrichAndroidPermissionsWithEquivalents<T extends AndroidPermission>(permissions: T[], mapping: PermissionMapping): T[] {
    return permissions.map(permission => ({
        ...permission,
        equivalentIosPermissions: mapping?.androidToIos?.[permission.constantValue] || [],
    }));
}

export function enrichIOSPermissionsWithEquivalents(permissions: IOSPermission[], mapping: PermissionMapping): IOSPermission[] {
    return permissions.map(permission => ({
        ...permission,
        equivalentAndroidPermissions: mapping?.iosToAndroid?.[permission.permission] || [],
    }));
}
