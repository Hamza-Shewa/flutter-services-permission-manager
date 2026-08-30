/**
 * Translation-file (ARB / JSON) type definitions.
 *
 * These types describe a loaded translation file (locale + flat keys + ARB
 * metadata) as well as the webview messages used to manage them. The machine
 * translation flow mirrors the "needed_docs_api" feature: a reference (fallback)
 * locale is picked, missing keys are auto-added, and values are translated
 * through a free keyless provider chain (MyMemory → Google gtx → LibreTranslate).
 */

/** A single loaded translation file (ARB or plain JSON). */
export interface TranslationFileData {
  /** Locale code derived from the file (e.g. "en", "ar", "fr") */
  locale: string;
  /** File name, e.g. "intl_en.arb" or "app.json" */
  fileName: string;
  /** Whether the file is ARB (true) or plain JSON (false) */
  isArb: boolean;
  /** Flat string keys → values (metadata keys are excluded) */
  keys: Record<string, string>;
  /**
   * ARB metadata: top-level `@@...` attributes (locale, last_modified, …) and
   * per-key `@keyName` entries. For plain JSON this is an empty object.
   */
  metadata: Record<string, unknown>;
}

/** Extension → webview: loaded translation files. */
export interface TranslationsPayload {
  type: "translations";
  translations: TranslationFileData[];
}

/** Extension → webview: result of a translation action. */
export interface TranslationsResultMessage {
  type: "translationsResult";
  success: boolean;
  message: string;
  /** Updated files (only present when a translate/add/save action succeeded). */
  translations?: TranslationFileData[];
}

/**
 * Incoming webview messages for the translation feature.
 *
 * Every message may carry a `dir` (workspace-relative path, e.g.
 * `lib/l10n`) that tells the backend where the user's translation files live.
 * When `dir` is empty/omitted, the backend falls back to auto-discovery.
 */
export type TranslationWebviewMessage =
  | {
    type: "requestTranslations";
    dir?: string;
  }
  | {
    type: "addTranslationLocale";
    locale: string;
    referenceLocale?: string;
    dir?: string;
  }
  | {
    type: "removeTranslationLocale";
    locale: string;
    dir?: string;
  }
  | {
    type: "autoAddMissingKeys";
    referenceLocale?: string;
    dir?: string;
  }
  | {
    type: "translateAll";
    referenceLocale?: string;
    dir?: string;
  }
  | {
    type: "translateMissing";
    referenceLocale?: string;
    dir?: string;
  }
  | {
    type: "translateLocale";
    locale: string;
    referenceLocale?: string;
    dir?: string;
  }
  | {
    type: "translateLocaleMissing";
    locale: string;
    referenceLocale?: string;
    dir?: string;
  }
  | {
    type: "saveTranslations";
    translations: TranslationFileData[];
    dir?: string;
  }
  | { type: "browseTranslationsDir" };
