/**
 * Type definitions for Permission Manager extension
 */

/** Android permission data structure */
export interface AndroidPermission {
    permission: string;
    description: string;
    protectionLevel: string;
    constantValue: string;
    category: string;
    apiLevel: number;
    removedIn?: number | null;
    equivalentIosPermissions?: string[];
}

/** iOS permission data structure */
export interface IOSPermission {
    permission: string;
    description: string;
    type: string;
    category: string;
    value?: string | boolean;
    equivalentAndroidPermissions?: string[];
    podfileMacro?: string;
}

/** iOS permission entry for saving */
export interface IOSPermissionEntry {
    permission: string;
    value?: string | boolean;
    type?: string;
    podfileMacro?: string;
}

/** Cross-platform permission mapping */
export interface PermissionMapping {
    androidToIos: Record<string, string[]>;
    iosToAndroid: Record<string, string[]>;
}

/** Result of a save operation */
export interface SaveResult {
    success: boolean;
    message: string;
}

/** Configured service entry */
export interface ServiceEntry {
    id: string;
    values: Record<string, string>;
}

/** Service configuration from services-config.json */
export interface ServiceConfig {
    id: string;
    name: string;
    description: string;
    icon: string;
    fields: { id: string; label: string; placeholder?: string; required?: boolean }[];
    ios: {
        plistEntries: { key: string; valueField?: string; type: string; staticValue?: unknown; prefix?: string }[];
        urlSchemes?: { prefix?: string; valueField: string }[];
        entitlements?: { key: string; type: string; staticValue?: unknown }[];
    };
    android: {
        metaData: { name: string; valueField: string; prefix?: string; stringResource?: string; defaultValue?: string }[];
        stringResources?: { name: string; valueField: string; prefix?: string }[];
        queries: { tag: string; attributes: Record<string, string> }[];
        applicationData: { tag: string; attributes: Record<string, string>; children?: unknown[] }[];
        mainActivityIntentFilters?: { tag: string; children?: unknown[] }[];
    };
}

/** Webview message types */
export type WebviewMessage =
    | { type: 'ready' }
    | { type: 'refresh' }
    | { type: 'requestAllAndroidPermissions' }
    | { type: 'requestAllIOSPermissions' }
    | { type: 'requestServices' }
    | { type: 'savePermissions'; androidPermissions: string[]; iosPermissions: IOSPermissionEntry[]; services?: ServiceEntry[] };

/** Extension to webview payload */
export interface PermissionsPayload {
    type: 'permissions';
    androidPermissions: AndroidPermission[];
    iosPermissions: IOSPermission[];
    hasAndroidManifest: boolean;
    hasIOSPlist: boolean;
    hasPodfile: boolean;
    services: ServiceEntry[];
    availableServices: ServiceConfig[];
}
