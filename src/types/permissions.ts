/**
 * Permission-related type definitions
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

/** Categorized permission groups */
export interface CategorizedPermissions<T> {
    [category: string]: T[];
}

/** Permission with podfile macro info */
export interface IOSPermissionWithMacro {
    permission: string;
    podfileMacro?: string;
}
