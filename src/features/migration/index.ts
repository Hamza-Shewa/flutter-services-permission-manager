/**
 * Migration feature barrel
 *
 * Public API for the Android Gradle / SDK migration tooling.
 */

export {
    migrateAndroidSetup,
    migrateAndroid16kbSetup
} from './migration.service.js';

export {
    runFullMigration,
    run16kbMigration,
    detectGradleLayout,
    readFlutterNdk
} from './migration-core.js';

export type { MigrationReport, AndroidLayout, GradleFile } from './migration-core.js';

export {
    parseVersion,
    compareVersions,
    maxVersion,
    isPrerelease,
    ensurePluginManagement,
    isLegacySettings,
    buildDeclarativeSettings,
    updateSettingsPlugins,
    migrateProjectBuildGradle,
    ensureProjectRepositories,
    ensureDependencyResolutionManagement,
    migrateAppBuildGradle,
    normalizeNdk,
    ndkSupports16Kb,
    readLiteralMinSdk,
    updateGradleWrapper,
    bumpGradleWrapperMinimum,
    ensureAgpGradleProperties,
    bumpAgpVersion,
    bumpSdkVersions,
    bumpNdkVersion,
    getAgpVersion,
    ensureUseLegacyPackaging,
    removeExtractNativeLibs,
    detectFirebaseUsage
} from './migration-transforms.js';

export type { MigrationVersions, FirebaseUsage, AppBuildOptions } from './migration-transforms.js';
