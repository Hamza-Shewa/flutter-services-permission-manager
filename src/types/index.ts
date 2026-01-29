/**
 * Type definitions for Flutter Config Manager extension
 * Barrel export - re-exports all types from focused modules
 */

// Permission types
export type {
    AndroidPermission,
    IOSPermission,
    IOSPermissionEntry,
    PermissionMapping,
    CategorizedPermissions,
    IOSPermissionWithMacro
} from './permissions.js';

// Service types
export type {
    ServiceEntry,
    ServiceField,
    IOSPlistEntry,
    IOSUrlScheme,
    IOSEntitlement,
    IOSAppDelegateConfig,
    AndroidMetaData,
    AndroidStringResource,
    AndroidXmlElement,
    IOSServiceConfig,
    AndroidServiceConfig,
    ServiceConfig,
    ServicesConfigFile
} from './services.js';

// Webview types
export type {
    WebviewMessage,
    PermissionsPayload,
    AllAndroidPermissionsMessage,
    AllIOSPermissionsMessage,
    ServicesConfigMessage,
    SaveResultMessage,
    WebviewOutgoingMessage,
    SaveResult
} from './webview.js';
