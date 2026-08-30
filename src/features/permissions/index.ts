/**
 * Permissions feature barrel
 *
 * Public API for permission extraction and enrichment (Android + iOS + macOS).
 */

export {
    getUsedAndroidPermissions,
    getUsedIOSPermissions,
    getAndroidPermissions,
    getIOSPermissions,
    getCategorizedIOSPermissions,
    getPermissionMapping,
    flattenAndroidPermissions,
    flattenIOSPermissions,
    enrichAndroidPermissionsWithEquivalents,
    enrichIOSPermissionsWithEquivalents
} from './extractor.js';

export type {
    AndroidPermission,
    IOSPermission,
    IOSPermissionEntry,
    PermissionMapping
} from './extractor.js';
