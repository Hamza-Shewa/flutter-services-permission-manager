/**
 * Migration feature barrel
 *
 * Public API for the Android Gradle / SDK migration tooling.
 */

export {
    migrateAndroidSetup,
    migrateAndroid16kbSetup
} from './migration.service.js';

export type { MigrationReport } from './migration.service.js';

export {
    parseVersion,
    compareVersions,
    maxVersion,
    ensurePluginManagement,
    updateSettingsPlugins,
    migrateProjectBuildGradle,
    ensureProjectRepositories,
    ensureDependencyResolutionManagement,
    migrateAppBuildGradle,
    updateGradleWrapper,
    bumpGradleWrapperMinimum,
    bumpAgpVersion,
    bumpSdkVersions,
    bumpNdkVersion,
    getAgpVersion,
    ensureUseLegacyPackaging,
    ensureExtractNativeLibs,
    detectFirebaseUsage
} from './migration-transforms.js';
