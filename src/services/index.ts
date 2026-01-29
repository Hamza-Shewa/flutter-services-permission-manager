/**
 * Service barrel export
 */

export { normalizePermissionNames, updateAndroidManifest, updateAndroidManifestWithServices, removeServicesFromAndroidManifest } from './android-manifest.service.js';
export { updateIOSPlist, normalizePlistSpacing, updateIOSPlistWithServices, removeServicesFromIOSPlist } from './ios-plist.service.js';
export { extractPodfileMacros, updateIOSPodfile } from './ios-podfile.service.js';
export { updateAppDelegateWithServices, removeServicesFromAppDelegate } from './ios-appdelegate.service.js';
export { getOrCreateStringsFile, updateAndroidStringsWithServices, getStringFromResources, hasStringResource, removeServicesFromAndroidStrings } from './android-strings.service.js';
export { replaceDocumentContent, savePermissions } from './document.service.js';
export { extractServices, extractServicesFromAndroid, extractServicesFromIOS, extractServicesFromAppDelegate } from './services-extractor.service.js';
