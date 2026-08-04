/**
 * Service-related type definitions
 */

/** A dynamic asset reference detected in a Dart file */
export interface AssetDynamicRef {
    /** Project-relative Dart file path, e.g. `lib/screens/settings.dart` */
    file: string;
    /** 1-based line of the first matching occurrence */
    line: number;
    /** 0-based column of the occurrence */
    column: number;
    /**
     * `true` = no static anchor (could reference any asset, e.g.
     * `Image.asset(path)`). `false` = anchored pattern such as
     * `assets/icon/$icon`.
     */
    dynamic: boolean;
    /** Detected pattern text, e.g. `assets/icon/$icon` */
    pattern?: string;
}

/** An asset file detected as unused in the Flutter project */
export interface UnusedAsset {
    /** Project-relative path, e.g. `assets/images/old_logo.png` */
    path: string;
    /** File size in bytes, when available */
    size?: number;
    /**
     * Dynamic references that may use this asset. Empty/absent means the
     * asset has no static *or* dynamic references and is truly unused.
     */
    refs?: AssetDynamicRef[];
}

/** Configured service entry (user's configured values) */
export interface ServiceEntry {
    id: string;
    values: Record<string, string>;
}

/** Service field configuration */
export interface ServiceField {
    id: string;
    label: string;
    placeholder?: string;
    required?: boolean;
    type?: 'text' | 'list' | 'toggle';
    pattern?: string;
    patternError?: string;
}

/** iOS plist entry configuration */
export interface IOSPlistEntry {
    key: string;
    valueField?: string;
    type: string;
    staticValue?: unknown;
    prefix?: string;
}

/** iOS URL scheme configuration */
export interface IOSUrlScheme {
    prefix?: string;
    valueField: string;
}

/** iOS entitlement configuration */
export interface IOSEntitlement {
    key: string;
    type: string;
    staticValue?: unknown;
}

/** iOS AppDelegate code configuration */
export interface IOSAppDelegateConfig {
    imports?: string[];
    didFinishLaunching?: string[];
}

/** Android meta-data configuration */
export interface AndroidMetaData {
    name: string;
    valueField: string;
    prefix?: string;
    stringResource?: string;
    defaultValue?: string;
}

/** Android string resource configuration */
export interface AndroidStringResource {
    name: string;
    valueField: string;
    prefix?: string;
}

/** Android XML element configuration */
export interface AndroidXmlElement {
    tag: string;
    attributes: Record<string, string>;
    children?: AndroidXmlElement[];
}

/** iOS Podfile target configuration */
export interface IOSPodfileTarget {
    targetName: string;
    code: string;
}

/** iOS service configuration */
export interface IOSServiceConfig {
    plistEntries: IOSPlistEntry[];
    urlSchemes?: IOSUrlScheme[];
    entitlements?: IOSEntitlement[];
    appDelegate?: IOSAppDelegateConfig & { import?: string; code?: string; };
    podfileTargets?: IOSPodfileTarget[];
}

/** Android service configuration */
export interface AndroidServiceConfig {
    metaData: AndroidMetaData[];
    stringResources?: AndroidStringResource[];
    queries: AndroidXmlElement[];
    applicationData: AndroidXmlElement[];
    mainActivityIntentFilters?: AndroidXmlElement[];
}

/** Complete service configuration from services-config.json */
export interface ServiceConfig {
    id: string;
    name: string;
    description: string;
    icon: string;
    fields: ServiceField[];
    ios: IOSServiceConfig;
    android: AndroidServiceConfig;
}

/** Services configuration file structure */
export interface ServicesConfigFile {
    services: ServiceConfig[];
}

/** Android localized string entry */
export interface AndroidLocalizedString {
    languageCode: string;
    value: string;
}

/** iOS localized string entry */
export interface IOSLocalizedString {
    languageCode: string;
    value: string;
}

/** App name localization configuration */
export interface AppNameLocalizationConfig {
    defaultName: string;
    localizations: Record<string, string>;
}
