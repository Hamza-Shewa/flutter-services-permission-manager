/**
 * Permission extraction and enrichment utilities
 */

import type { AndroidPermission, IOSPermission, PermissionMapping } from '../types/index.js';
import { readJsonFile } from './file.js';

/**
 * Extracts used Android permissions from manifest content
 */
export async function getUsedAndroidPermissions(manifestContent: string): Promise<AndroidPermission[]> {
    const androidPermissionRegex = /<uses-permission\b[^>]*android:name="([^"]+)"[^>]*>/g;
    const usedPermissions: AndroidPermission[] = [];
    const allPermissions = await getAndroidPermissions();

    let match;
    while ((match = androidPermissionRegex.exec(manifestContent)) !== null) {
        const permissionName = match[1];
        const shortName = permissionName.replace(/^android\.permission\./, '');
        const permissionInfo = allPermissions.find(p =>
            p.constantValue === permissionName ||
            p.permission === permissionName ||
            p.permission === shortName
        );
        if (permissionInfo) {
            usedPermissions.push(permissionInfo);
        }
    }

    console.log('used permissions:', usedPermissions.length);
    return usedPermissions;
}

/**
 * Extracts used iOS permissions from plist content
 */
export async function getUsedIOSPermissions(plistContent: string): Promise<IOSPermission[]> {
    const usedPermissions: IOSPermission[] = [];
    const allPermissions = await getIOSPermissions();

    const stringRegex = /<key>(NS[^<]*)<\/key>\s*<string>([^<]*)<\/string>/g;
    const boolRegex = /<key>(NS[^<]*)<\/key>\s*<(true|false)\/>/g;

    console.log('iOS plist content length:', plistContent.length);
    console.log('allPermissions length:', allPermissions.length);

    let match;
    while ((match = stringRegex.exec(plistContent)) !== null) {
        const permissionName = match[1];
        const value = match[2];
        const permissionInfo = allPermissions.find(p => p.permission === permissionName);
        if (permissionInfo) {
            usedPermissions.push({ ...permissionInfo, value });
        } else {
            console.log('Permission not found in allPermissions:', permissionName);
        }
    }

    while ((match = boolRegex.exec(plistContent)) !== null) {
        const permissionName = match[1];
        const value = match[2] === 'true';
        const permissionInfo = allPermissions.find(p => p.permission === permissionName);
        if (permissionInfo) {
            usedPermissions.push({ ...permissionInfo, value });
        } else {
            console.log('Permission not found in allPermissions:', permissionName);
        }
    }

    console.log('used iOS permissions:', usedPermissions.length);
    return usedPermissions;
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
    // Transform to only include the fields needed for Podfile updates
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
    if (Array.isArray(raw)) {
        return raw;
    }
    return Object.values(raw).flat();
}

/**
 * Flattens categorized iOS permissions to a flat array
 */
export function flattenIOSPermissions(
    raw: IOSPermission[] | Record<string, IOSPermission[]>
): IOSPermission[] {
    if (Array.isArray(raw)) {
        return raw;
    }
    return Object.values(raw).flat();
}

function enrichAndroidPermissionsWithEquivalents(
    permissions: AndroidPermission[],
    mapping: PermissionMapping
): AndroidPermission[] {
    return permissions.map(permission => ({
        ...permission,
        equivalentIosPermissions: mapping.androidToIos[permission.constantValue] || []
    }));
}

function enrichIOSPermissionsWithEquivalents(
    permissions: IOSPermission[],
    mapping: PermissionMapping
): IOSPermission[] {
    return permissions.map(permission => ({
        ...permission,
        equivalentAndroidPermissions: mapping.iosToAndroid[permission.permission] || []
    }));
}

// Re-export types for convenience
export type { AndroidPermission, IOSPermission, IOSPermissionEntry, PermissionMapping } from '../types/index.js';