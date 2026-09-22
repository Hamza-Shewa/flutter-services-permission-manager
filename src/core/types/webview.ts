/**
 * Webview-related type definitions
 */

import type {
  AndroidPermission,
  IOSPermission,
  IOSPermissionEntry,
} from "./permissions.js";
import type { ServiceEntry, ServiceConfig, UnusedAsset } from "./services.js";
import type { TranslationFileData } from "./translations.js";
import type {
  ApplySemanticsResult,
  InteractiveScanResult,
  SemanticsFixPreview,
  SemanticsFixRequest,
} from "../../features/semantics/types.js";
import type {
  McpClientId,
  McpClientStatus,
} from "../../features/semantics/codex-mcp-installer.js";
import type {
  AndroidIconFamilySelection,
  CurrentIconPreviews,
  IconComposeOptions,
  IconGenerationResult,
  IconPlatformTarget,
  IconSourceKind,
} from "../../features/icons/types.js";
import type { ImageComposeOptions, ImageSourceKind, SourcePreview } from "../shared/image-compose.js";
import type {
  CurrentSplashPreviews,
  SplashGenerationResult,
  SplashPlatformTarget,
} from "../../features/splash/types.js";

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
  | { type: "migrateAndroid16kb" }
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
  }
  | { type: "analyzeUnusedAssets" }
  | {
    type: "deleteUnusedAsset";
    assetPath: string;
  }
  | {
    type: "deleteAllUnusedAssets";
    assetPaths: string[];
  }
  | {
    type: "revealAssetReference";
    file: string;
    line: number;
    column: number;
  }
  | {
    type: "updateIgnoredAssetPaths";
    action: "add" | "remove";
    /** "full" skips the file/dir entirely; "dynamic" skips only dynamic patterns */
    mode: "full" | "dynamic";
    kind: "directory" | "file";
    value: string;
  }
  | {
    type: "webview_error";
    message: string;
    filename?: string;
    lineno?: number;
    colno?: number;
    error?: string;
  }
  | {
    type: "webview_log";
    message: string;
  }
  // Translation-file management (ARB / JSON)
  | {
    type: "requestTranslations";
    dir?: string;
  }
  | {
    type: "addTranslationLocale";
    locale: string;
    referenceLocale?: string;
    dir?: string;
  }
  | {
    type: "removeTranslationLocale";
    locale: string;
    dir?: string;
  }
  | {
    type: "autoAddMissingKeys";
    referenceLocale?: string;
    dir?: string;
  }
  | {
    type: "translateAll";
    referenceLocale?: string;
    dir?: string;
  }
  | {
    type: "translateMissing";
    referenceLocale?: string;
    dir?: string;
  }
  | {
    type: "translateLocale";
    locale: string;
    referenceLocale?: string;
    dir?: string;
  }
  | {
    type: "translateLocaleMissing";
    locale: string;
    referenceLocale?: string;
    dir?: string;
  }
  | {
    type: "saveTranslations";
    translations: TranslationFileData[];
    dir?: string;
  }
  | { type: "browseTranslationsDir" }
  | { type: "scanInteractives" }
  | { type: "copySemanticsPrompt" }
  | { type: "dumpAndroidUi"; mode: "export" | "clipboard" }
  | { type: "checkMcpClients" }
  | { type: "installMcpClient"; client: McpClientId }
  | { type: "copyMcpConfig" }
  | {
    type: "previewSemanticsFixes";
    requests: SemanticsFixRequest[];
  }
  | {
    type: "applySemanticsFixes";
    previewId: string;
  }
  | {
    type: "revealSourceReference";
    path: string;
    line?: number;
    column?: number;
  }
  | { type: "browseIconSource" }
  | { type: "requestCurrentIconPreview" }
  | ({
    type: "generateIcons";
    sourcePath: string;
    platforms: IconPlatformTarget;
    androidFamilies?: AndroidIconFamilySelection;
  } & IconComposeOptions)
  | { type: "browseSplashSource" }
  | { type: "requestCurrentSplashPreview" }
  | ({
    type: "generateSplash";
    sourcePath: string;
    platforms: SplashPlatformTarget;
    logoSize?: number;
  } & ImageComposeOptions);

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

/** Unused assets scan result (extension to webview) */
export interface UnusedAssetsPayload {
  type: "unusedAssetsResult";
  /** Truly unused assets (no static or dynamic references) */
  assets: UnusedAsset[];
  /** Assets not statically referenced but referenced via dynamic paths */
  maybeUsedAssets: UnusedAsset[];
  totalAssets: number;
  usedAssets: number;
  /** User-configured directories to skip when scanning for references */
  ignoredDirectories?: string[];
  /** User-configured files to skip when scanning for references */
  ignoredFiles?: string[];
  /** Directories whose dynamic patterns are ignored (literal refs still count) */
  ignoredDynamicDirectories?: string[];
  /** Files whose dynamic patterns are ignored (literal refs still count) */
  ignoredDynamicFiles?: string[];
  error?: string;
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
  | DependencyValidationResultMessage
  | InteractivesResultMessage
  | InteractivesLoadingMessage
  | InteractivesErrorMessage
  | InteractivesInvalidatedMessage
  | SemanticsFixPreviewMessage
  | SemanticsFixAppliedMessage
  | SemanticsPromptCopyingMessage
  | SemanticsPromptCopiedMessage
  | McpClientsStatusMessage
  | McpClientInstallingMessage
  | McpConfigCopiedMessage
  | IconSourceSelectedMessage
  | IconsGeneratingMessage
  | IconsGeneratedMessage
  | CurrentIconPreviewMessage
  | SplashSourceSelectedMessage
  | SplashGeneratingMessage
  | SplashGeneratedMessage
  | CurrentSplashPreviewMessage;

export interface InteractivesResultMessage {
  type: "interactivesResult";
  result: InteractiveScanResult;
}

export interface InteractivesLoadingMessage {
  type: "interactivesLoading";
  loading: boolean;
}

export interface InteractivesErrorMessage {
  type: "interactivesError";
  message: string;
}

export interface InteractivesInvalidatedMessage {
  type: "interactivesInvalidated";
}

export interface SemanticsFixPreviewMessage {
  type: "semanticsFixPreview";
  preview: SemanticsFixPreview;
}

export interface SemanticsFixAppliedMessage {
  type: "semanticsFixApplied";
  result: ApplySemanticsResult;
}

export interface SemanticsPromptCopyingMessage {
  type: "semanticsPromptCopying";
  copying: boolean;
}

export interface SemanticsPromptCopiedMessage {
  type: "semanticsPromptCopied";
}

export interface McpClientsStatusMessage {
  type: "mcpClientsStatus";
  clients: McpClientStatus[];
  manualConfig: string;
  loading?: boolean;
  error?: string;
}

export interface McpClientInstallingMessage {
  type: "mcpClientInstalling";
  client: McpClientId;
}

export interface McpConfigCopiedMessage {
  type: "mcpConfigCopied";
}

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

export interface IconSourceSelectedMessage {
  type: "iconSourceSelected";
  path: string;
  fileName: string;
  kind: IconSourceKind;
  preview: SourcePreview;
}

export interface IconsGeneratingMessage {
  type: "iconsGenerating";
  generating: boolean;
}

export interface IconsGeneratedMessage {
  type: "iconsGenerated";
  result: IconGenerationResult;
}

export interface CurrentIconPreviewMessage {
  type: "currentIconPreview";
  previews: CurrentIconPreviews;
}

export interface SplashSourceSelectedMessage {
  type: "splashSourceSelected";
  path: string;
  fileName: string;
  kind: ImageSourceKind;
  preview: SourcePreview;
}

export interface SplashGeneratingMessage {
  type: "splashGenerating";
  generating: boolean;
}

export interface SplashGeneratedMessage {
  type: "splashGenerated";
  result: SplashGenerationResult;
}

export interface CurrentSplashPreviewMessage {
  type: "currentSplashPreview";
  previews: CurrentSplashPreviews;
}
