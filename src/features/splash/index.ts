/**
 * Splash screen feature barrel
 *
 * Public API for generating the Android/iOS native splash screen from a
 * single source image (PNG, JPEG, or SVG).
 */

export {
    detectSplashSourceKind,
    clampSplashScalePercent,
    generateSplash,
    generateSplashPreview,
    getCurrentSplashPreviews,
} from './splash.service.js';

export type { GenerateSplashOptions, CurrentSplashPreviewOptions } from './splash.service.js';
export * from './types.js';
