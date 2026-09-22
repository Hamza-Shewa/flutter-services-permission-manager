/**
 * Icons feature barrel
 *
 * Public API for generating Android/iOS launcher icons from a single
 * source image (PNG, JPEG, or SVG).
 */

export {
    detectIconSourceKind,
    computeAndroidIconTargets,
    parseAppIconPoints,
    parseAppIconScale,
    computeAppIconPixelSize,
    synthesizeAppIconFilename,
    clampIconScalePercent,
    generateIcons,
    generateIconPreview,
    getCurrentIconPreviews,
} from './icons.service.js';

export type { GenerateIconsOptions, CurrentIconPreviewOptions } from './icons.service.js';
export * from './types.js';
