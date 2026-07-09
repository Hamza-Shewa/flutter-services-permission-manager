/**
 * Webview-related type definitions
 */

import type {
  AndroidPermission,
  IOSPermission,
  IOSPermissionEntry,
} from "./permissions.js";
import type { ServiceEntry, ServiceConfig } from "./services.js";

/** Platform build metadata item */
export interface PlatformDetailItem {
  key: string;
  label: string;
  value: string;
  editable?: boolean;
  source?: string;
}

/** Platform build metadata payload */
export interface PlatformDetails {
  android: PlatformDetailItem[];
  ios: PlatformDetailItem[];
}

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
  }
  | {
    type: "saveAppName";
    appName: AppNameLocalization;
  }
  | {
    type: "saveServices";
    services: ServiceEntry[];
  }
  | {
    type: "savePlatformDetails";
    platformDetails: PlatformDetails;
  }
  | {
    type: "savePackageNames";
    applicationId?: string;
    bundleIdentifier?: string;
  }
  | {
    type: "saveAndroidBuildDetails";
    androidDetails: PlatformDetailItem[];
  }
  | {
    type: "saveIosBuildDetails";
    iosDetails: PlatformDetailItem[];
  }
  | { type: "migrateAndroid" }
  | { type: "upgradePackages" }
  | { type: "requestPackagesAnalysis" }
  | {
    type: "upgradeSinglePackage";
    packageName: string;
  }
  | {
    type: "searchPackages";
    query: string;
  }
  | {
    type: "requestPackageDetails";
    packageName: string;
  }
  | {
    type: "addPackage";
    packageName: string;
  }
  | { type: "checkDependencyValidator" }
  | { type: "installDependencyValidator" }
  | { type: "runDependencyValidator" }
  | {
    type: "removePackage";
    packageName: string;
  }
  | {
    type: "downgradePackage";
    packageName: string;
  }
  | {
    type: "removeAllFlaggedPackages";
    packages: string[];
  };

/** Language info */
export interface LanguageInfo {
  code: string;
  name: string;
  nativeName: string;
}

/** App name localization data */
export interface AppNameLocalization {
  defaultName: string;
  localizations: Record<string, string>;
}

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
  platformDetails: PlatformDetails;
  appName: AppNameLocalization;
  languages?: LanguageInfo[];
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
  | SaveResultMessage
  | PackagesAnalysisResultMessage
  | SearchPackagesResultMessage
  | PackageDetailsResultMessage
  | DependencyValidatorStateMessage
  | DependencyValidationResultMessage;

/** Result of a save operation */
export interface SaveResult {
  success: boolean;
  message: string;
}

/** Represents a package version in pub outdated */
export interface PackageVersion {
  version: string;
}

/** Represents an outdated package from flutter pub outdated */
export interface OutdatedPackage {
  package: string;
  kind: "direct" | "dev" | "transitive" | string;
  isDiscontinued?: boolean;
  current?: PackageVersion;
  upgradable?: PackageVersion;
  resolvable?: PackageVersion;
  latest?: PackageVersion;
}

/** Outgoing message for packages analysis result */
export interface PackagesAnalysisResultMessage {
  type: "packagesAnalysisResult";
  packages: OutdatedPackage[];
  error?: string;
}

/** Outgoing message for package search result */
export interface SearchPackagesResultMessage {
  type: "searchPackagesResult";
  packages: string[];
  error?: string;
}

/** Outgoing message for package details result */
export interface PackageDetailsResultMessage {
  type: "packageDetailsResult";
  packageName: string;
  description?: string;
  latestVersion?: string;
  error?: string;
}

export interface DependencyValidationIssue {
  package: string;
  issueType: "unused" | "downgrade" | "may_be_unused";
}

export interface DependencyValidatorStateMessage {
  type: "dependencyValidatorState";
  isInstalled: boolean;
}

export interface DependencyValidationResultMessage {
  type: "dependencyValidationResult";
  issues: DependencyValidationIssue[];
  error?: string;
}
