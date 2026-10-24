/**
 * Permission extraction and enrichment utilities (vscode side).
 *
 * The parsing itself is pure and lives in `catalog.ts` so the MCP server
 * reuses it; this module only loads the catalogs through `readJsonFile`.
 */

import type { AndroidPermission, IOSPermission, PermissionMapping, UsedAndroidPermission } from '../../core/types/index.js';
import { readJsonFile } from '../../core/utils/file.js';
import { logger } from '../../core/shared/index.js';
import {
    buildUsedAndroidPermissions,
    buildUsedIOSPermissions,
    enrichAndroidPermissionsWithEquivalents,
    enrichIOSPermissionsWithEquivalents,
    flattenCatalog,
} from './catalog.js';

/**
 * Extracts every permission element of a manifest: catalog details, the
 * element's attributes (`entry`), `mergerRemoved` for `tools:node="remove"`,
 * and `unknown: true` entries for names the catalog does not have.
 */
export async function getUsedAndroidPermissions(manifestContent: string): Promise<UsedAndroidPermission[]> {
    const used = buildUsedAndroidPermissions(manifestContent, await getAndroidPermissions());
    logger.debug('Android permissions extracted', {
        count: used.length,
        mergerRemoved: used.filter(p => p.mergerRemoved).length,
        unknown: used.filter(p => p.unknown).length,
    });
    return used;
}

/**
 * Extracts the permission keys of an Info.plist (strings, booleans, arrays,
 * dictionaries), plus usage-description keys the catalog does not know.
 */
export async function getUsedIOSPermissions(plistContent: string): Promise<IOSPermission[]> {
    const used = buildUsedIOSPermissions(plistContent, await getIOSPermissions());
    logger.debug('iOS permissions extracted', { count: used.length, unknown: used.filter(p => p.unknown).length });
    return used;
}

/**
 * Gets all Android permissions with iOS equivalents
 */
export async function getAndroidPermissions(): Promise<AndroidPermission[]> {
    const raw = await readJsonFile<AndroidPermission[] | Record<string, AndroidPermission[]>>(
        'categorized-android-permissions.json'
    );
    const permissions = flattenAndroidPermissions(raw);
    const mapping = await getPermissionMapping();
    return enrichAndroidPermissionsWithEquivalents(permissions, mapping);
}

/**
 * Gets all iOS permissions with Android equivalents
 */
export async function getIOSPermissions(): Promise<IOSPermission[]> {
    const raw = await readJsonFile<IOSPermission[] | Record<string, IOSPermission[]>>(
        'categorized-ios-permissions.json'
    );
    const permissions = flattenIOSPermissions(raw);
    const mapping = await getPermissionMapping();
    return enrichIOSPermissionsWithEquivalents(permissions, mapping);
}

/**
 * Gets categorized iOS permissions with podfile macros for Podfile updates
 */
export async function getCategorizedIOSPermissions(): Promise<Record<string, { permission: string; podfileMacro?: string }[]>> {
    const raw = await readJsonFile<Record<string, IOSPermission[]>>('categorized-ios-permissions.json');
    const result: Record<string, { permission: string; podfileMacro?: string }[]> = {};
    for (const [category, permissions] of Object.entries(raw)) {
        result[category] = permissions.map(p => ({
            permission: p.permission,
            podfileMacro: p.podfileMacro
        }));
    }
    return result;
}

/**
 * Gets the cross-platform permission mapping
 */
export async function getPermissionMapping(): Promise<PermissionMapping> {
    return readJsonFile<PermissionMapping>('permission-mapping.json');
}

/**
 * Flattens categorized Android permissions to a flat array
 */
export function flattenAndroidPermissions(
    raw: AndroidPermission[] | Record<string, AndroidPermission[]>
): AndroidPermission[] {
    return flattenCatalog(raw);
}

/**
 * Flattens categorized iOS permissions to a flat array
 */
export function flattenIOSPermissions(
    raw: IOSPermission[] | Record<string, IOSPermission[]>
): IOSPermission[] {
    return flattenCatalog(raw);
}

export { enrichAndroidPermissionsWithEquivalents, enrichIOSPermissionsWithEquivalents } from './catalog.js';

// Re-export types for convenience
export type { AndroidPermission, IOSPermission, IOSPermissionEntry, PermissionMapping, UsedAndroidPermission } from '../../core/types/index.js';
