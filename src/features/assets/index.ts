/**
 * Assets feature barrel
 *
 * Public API for unused-asset detection and deletion.
 */

export {
    analyzeUnusedAssets,
    deleteUnusedAssets,
    getIgnoredAssetPaths
} from './assets.service.js';

export type { UnusedAssetsResult } from './assets.service.js';
