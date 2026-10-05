/**
 * Assets feature barrel
 *
 * Public API for unused-asset detection and deletion.
 */

export {
    analyzeUnusedAssets,
    deleteUnusedAssets,
    getIgnoredAssetPaths,
    convertImagesToWebp
} from './assets.service.js';

export type { UnusedAssetsResult, WebpConversionOptions, WebpConversionResult, WebpConversionImage } from './assets.service.js';
