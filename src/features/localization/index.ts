/**
 * Localization (App Name) feature barrel
 *
 * Public API for reading/writing localized app names on Android and iOS.
 *
 * NOTE: both platforms export a `getAvailableLanguages` helper; to avoid a
 * name clash it is intentionally NOT re-exported here. Import it directly
 * from the platform file when needed:
 *   - android.localization.service.js
 *   - ios.localization.service.js
 */

// Android app-name localization
export {
    getStringsFileForLanguage,
    createStringsFileForLanguage,
    extractAppNameFromStrings,
    updateAppNameInStrings,
    updateManifestToUseLocalizedAppName,
    isUsingLocalizedAppName,
    extractAppNameFromManifest,
    updateAndroidAppNameLocalizations,
    extractAndroidAppNameLocalizations
} from './android.localization.service.js';

// iOS/macOS app-name localization
export {
    getInfoPlistStringsFile,
    createInfoPlistStringsFile,
    extractAppNameFromInfoPlistStrings,
    updateAppNameInInfoPlistStrings,
    extractAppNameFromInfoPlist,
    updateInfoPlistToUseLocalizedAppName,
    updateIOSAppNameLocalizations,
    extractIOSAppNameLocalizations
} from './ios.localization.service.js';

// Shared string-reference resolver
export { resolveStringReference } from './string-resolver.js';

// ARB / JSON translation-file management
export {
    getLocaleFromFileName,
    parseTranslationContent,
    serializeTranslationContent,
    discoverTranslationUris,
    loadTranslationFiles,
    findReferenceFile,
    findMissingKeys,
    autoAddMissingKeys,
    translateLocale,
    translateAllLocales,
    createTranslationFileForLocale,
    saveTranslationFiles,
    translateValue
} from './arb-translations.service.js';

// Free keyless machine translation (needed_docs_api provider chain)
export {
    translateText,
    translateMany,
    DEFAULT_FALLBACK_LOCALE
} from './machine-translator.js';
