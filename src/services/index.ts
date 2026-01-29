/**
 * Service barrel export
 */

export { normalizePermissionNames, updateAndroidManifest } from './android-manifest.service.js';
export { updateIOSPlist, normalizePlistSpacing } from './ios-plist.service.js';
export { extractPodfileMacros, updateIOSPodfile } from './ios-podfile.service.js';
export { replaceDocumentContent, savePermissions } from './document.service.js';
