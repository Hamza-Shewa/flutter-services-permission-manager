/**
 * Android platform write services barrel
 *
 * Shared platform primitives for editing AndroidManifest.xml and strings.xml.
 * Feature-specific logic (permissions, services, localization, migration,
 * build) lives under src/features/.
 */

export {
    normalizePermissionNames,
    updateAndroidManifest,
    updateAndroidManifestWithServices,
    removeServicesFromAndroidManifest
} from './manifest.service.js';

export {
    getOrCreateStringsFile,
    updateAndroidStringsWithServices,
    getStringFromResources,
    hasStringResource,
    removeServicesFromAndroidStrings
} from './strings.service.js';
