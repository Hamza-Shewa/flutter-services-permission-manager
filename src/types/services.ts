/**
 * Service-related type definitions
 */

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

/** iOS service configuration */
export interface IOSServiceConfig {
    plistEntries: IOSPlistEntry[];
    urlSchemes?: IOSUrlScheme[];
    entitlements?: IOSEntitlement[];
    appDelegate?: IOSAppDelegateConfig;
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
