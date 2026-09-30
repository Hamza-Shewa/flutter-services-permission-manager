/**
 * Build feature barrel
 *
 * Public API for reading/writing Android/iOS build settings
 * (Gradle properties, versions, project files).
 */

export {
    normalizeTextValue,
    stripApiPrefix,
    replaceFirst,
    escapeRegExp,
    formatGradleValue,
    replaceGradlePropertyLine,
    isKotlinDsl,
    versionNameExpression
} from './build-file-utils.js';

export { getRecommendedVersions } from './version-fetcher.js';
