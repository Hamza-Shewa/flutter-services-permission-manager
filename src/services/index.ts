/**
 * Service barrel export
 */

// Android services
export {
    normalizePermissionNames,
    updateAndroidManifest,
    updateAndroidManifestWithServices,
    removeServicesFromAndroidManifest,
    getOrCreateStringsFile,
    updateAndroidStringsWithServices,
    getStringFromResources,
    hasStringResource,
    removeServicesFromAndroidStrings
} from './android/index.js';

// iOS services
export {
    updateIOSPlist,
    normalizePlistSpacing,
    updateIOSPlistWithServices,
    removeServicesFromIOSPlist,
    extractPodfileMacros,
    updateIOSPodfile,
    updateAppDelegateWithServices,
    removeServicesFromAppDelegate,
    updateIOSEntitlementsWithServices,
    removeServicesFromIOSEntitlements
} from './ios/index.js';

// Document service
export { replaceDocumentContent, savePermissions } from './document.service.js';

// Services extractor
export {
    extractServices,
    extractServicesFromAndroid,
    extractServicesFromIOS,
    extractServicesFromAppDelegate,
    extractServicesFromIOSEntitlements
} from './services-extractor.service.js';
