/**
 * iOS services barrel export
 */

export {
    updateIOSPlist,
    normalizePlistSpacing,
    updateIOSPlistWithServices,
    removeServicesFromIOSPlist
} from './plist.service.js';

export {
    extractPodfileMacros,
    updateIOSPodfile
} from './podfile.service.js';

export {
    updateAppDelegateWithServices,
    removeServicesFromAppDelegate
} from './appdelegate.service.js';

export {
    updateIOSEntitlementsWithServices,
    removeServicesFromIOSEntitlements
} from './entitlements.service.js';
