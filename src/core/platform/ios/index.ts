/**
 * iOS/macOS platform write services barrel
 *
 * Shared platform primitives for editing Info.plist, Podfile, AppDelegate and
 * entitlements. Feature-specific logic (permissions, services, localization,
 * build) lives under src/features/.
 */

export {
    updateIOSPlist,
    normalizePlistSpacing,
    updateIOSPlistWithServices,
    removeServicesFromIOSPlist
} from './plist.service.js';

export {
    extractPodfileMacros,
    updateIOSPodfile,
    updateIOSPodfileWithServices
} from './podfile.service.js';

export {
    updateAppDelegateWithServices,
    removeServicesFromAppDelegate
} from './appdelegate.service.js';

export {
    updateIOSEntitlementsWithServices,
    removeServicesFromIOSEntitlements
} from './entitlements.service.js';
