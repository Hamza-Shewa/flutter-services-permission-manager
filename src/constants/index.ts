/**
 * Shared constants and patterns
 */

/** File glob patterns for workspace file discovery */
export const FILE_PATTERNS = {
    ANDROID_MANIFEST: '**/app/src/main/AndroidManifest.xml',
    ANDROID_STRINGS: '**/app/src/main/res/values/strings.xml',
    IOS_PLIST: '**/Runner/Info.plist',
    IOS_PODFILE: '**/ios/Podfile',
    IOS_APPDELEGATE: '**/Runner/AppDelegate.swift'
} as const;

/** Android permission namespace prefix */
export const ANDROID_PERMISSION_PREFIX = 'android.permission.';

/** Common XML/Plist structure elements */
export const XML_ELEMENTS = {
    MANIFEST_TAG: 'manifest',
    APPLICATION_TAG: 'application',
    USES_PERMISSION_TAG: 'uses-permission',
    META_DATA_TAG: 'meta-data',
    ACTIVITY_TAG: 'activity',
    QUERIES_TAG: 'queries',
    INTENT_TAG: 'intent',
    PACKAGE_TAG: 'package'
} as const;

export const PLIST_ELEMENTS = {
    DICT: 'dict',
    KEY: 'key',
    STRING: 'string',
    ARRAY: 'array',
    TRUE: 'true',
    FALSE: 'false'
} as const;

/** iOS permission key suffix for usage descriptions */
export const IOS_USAGE_DESCRIPTION_SUFFIX = 'UsageDescription';

/** Common iOS plist keys to preserve (not permission-related) */
export const PRESERVED_IOS_KEYS = [
    'CFBundle',
    'LSRequires',
    'UILaunch',
    'UIMain',
    'UISupported',
    'UIRequires',
    'UIStatus',
    'UIApplication',
    'UIView',
    'NSHumanReadableCopyright',
    'NSMainNibFile',
    'NSPrincipalClass',
    'NSMainStoryboardFile'
] as const;

/** Max file read limit */
export const MAX_SEARCH_RESULTS = 1;

/** Indentation for generated code */
export const INDENT = {
    SINGLE: '    ',
    DOUBLE: '        ',
    TRIPLE: '            '
} as const;
