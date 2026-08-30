/**
 * Packages feature barrel
 *
 * Public API for Flutter pubspec dependency analysis, package management and
 * the dependency validator integration.
 */

export {
    isNetworkError,
    assertPackageHostsReachable,
    analyzePackages,
    upgradePackage,
    addPackage,
    searchPackages,
    getPackageDetails,
    checkDependencyValidator,
    installDependencyValidator,
    runDependencyValidator,
    removePackage,
    downgradePackage
} from './pub.service.js';
