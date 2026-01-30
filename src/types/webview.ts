/**
 * Webview-related type definitions
 */

import type {
  AndroidPermission,
  IOSPermission,
  IOSPermissionEntry,
} from "./permissions.js";
import type { ServiceEntry, ServiceConfig } from "./services.js";

/** Webview incoming message types */
export type WebviewMessage =
  | { type: "ready" }
  | { type: "refresh" }
  | { type: "requestAllAndroidPermissions" }
  | { type: "requestAllIOSPermissions" }
  | { type: "requestServices" }
  | {
      type: "savePermissions";
      androidPermissions: string[];
      iosPermissions: IOSPermissionEntry[];
      macosPermissions: IOSPermissionEntry[];
      services?: ServiceEntry[];
    };

/** Extension to webview payload */
export interface PermissionsPayload {
  type: "permissions";
  androidPermissions: AndroidPermission[];
  iosPermissions: IOSPermission[];
  macosPermissions: IOSPermission[];
  hasAndroidManifest: boolean;
  hasIOSPlist: boolean;
  hasMacOSPlist: boolean;
  hasPodfile: boolean;
  services: ServiceEntry[];
  availableServices: ServiceConfig[];
}

/** Outgoing message for all Android permissions */
export interface AllAndroidPermissionsMessage {
  type: "allAndroidPermissions";
  permissions: AndroidPermission[];
}

/** Outgoing message for all iOS permissions */
export interface AllIOSPermissionsMessage {
  type: "allIOSPermissions";
  permissions: IOSPermission[];
}

/** Outgoing message for services config */
export interface ServicesConfigMessage {
  type: "servicesConfig";
  services: ServiceConfig[];
}

/** Outgoing message for save result */
export interface SaveResultMessage {
  type: "saveResult";
  success: boolean;
  message: string;
}

/** All outgoing webview message types */
export type WebviewOutgoingMessage =
  | PermissionsPayload
  | AllAndroidPermissionsMessage
  | AllIOSPermissionsMessage
  | ServicesConfigMessage
  | SaveResultMessage;

/** Result of a save operation */
export interface SaveResult {
  success: boolean;
  message: string;
}
