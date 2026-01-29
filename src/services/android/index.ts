/**
 * Android services barrel export
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
