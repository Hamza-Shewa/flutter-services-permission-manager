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

/** Webview message types */
export type WebviewMessage =
    | { type: 'ready' }
    | { type: 'refresh' }
    | { type: 'requestAllAndroidPermissions' }
    | { type: 'requestAllIOSPermissions' }
    | { type: 'savePermissions'; androidPermissions: string[]; iosPermissions: IOSPermissionEntry[] };

/** Extension to webview payload */
export interface PermissionsPayload {
    type: 'permissions';
    androidPermissions: AndroidPermission[];
    iosPermissions: IOSPermission[];
    hasAndroidManifest: boolean;
    hasIOSPlist: boolean;
    hasPodfile: boolean;
}
