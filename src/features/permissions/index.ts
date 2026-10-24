/**
 * Permissions feature barrel
 *
 * Public API for permission extraction and enrichment (Android + iOS + macOS),
 * the pure catalog helpers, project SDK facts and the variant advice engine.
 * `extractor.ts` uses vscode; the MCP server imports `catalog.js`,
 * `project-facts.js` and `advice.js` directly instead of this barrel.
 */

export {
    getUsedAndroidPermissions,
    getUsedIOSPermissions,
    getAndroidPermissions,
    getIOSPermissions,
    getCategorizedIOSPermissions,
    getPermissionMapping,
    flattenAndroidPermissions,
    flattenIOSPermissions,
    enrichAndroidPermissionsWithEquivalents,
    enrichIOSPermissionsWithEquivalents
} from './extractor.js';

export {
    UNKNOWN_CATEGORY,
    flattenCatalog,
    findAndroidPermission,
    resolveAndroidPermissionName,
    buildUsedAndroidPermissions,
    buildUsedIOSPermissions
} from './catalog.js';

export {
    readProjectPermissionFacts,
    readFlutterSdkDefaults,
    readGradleSdkExpressions,
    evaluateSdkExpression,
    compareOsVersions
} from './project-facts.js';
export type { ProjectPermissionFacts, AndroidProjectFacts, IOSProjectFacts, SdkLevel } from './project-facts.js';

export {
    adviseAndroidPermissions,
    adviseIOSPermissions,
    adviceHeader,
    buildPermissionAdvice,
    worstAdviceLevel,
    applyAndroidAdviceFixes
} from './advice.js';
export type { PermissionAdvice, PermissionAdviceReport, AdviceHeader, AdviceLevel, AndroidAdviceFix } from './advice.js';

export type {
    AndroidPermission,
    IOSPermission,
    IOSPermissionEntry,
    PermissionMapping,
    UsedAndroidPermission
} from './extractor.js';
