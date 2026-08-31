/**
 * Pure (VS Code-free) translation-file logic for ARB / JSON locale files.
 *
 * This module contains the parts of `arb-translations.service.ts` that do not
 * depend on the VS Code runtime, so they can be reused by the Flutter Config
 * Manager MCP server (and any other host) without a `vscode` shim. All file
 * discovery / read / write lives in the host layer; the functions here operate
 * purely on strings and `TranslationFileData` objects.
 */

import type { TranslationFileData } from '../../core/types/index.js';
import { translateMany, translateText } from './machine-translator.js';

/** Result of a batch translation action. */
export interface TranslateResult {
  translations: TranslationFileData[];
  translatedCount: number;
}

/**
 * Determine the locale code from a file name (e.g. `intl_en.arb` → `en`,
 * `app_ar.json` → `ar`, `en.json` → `en`). Falls back to the full base name.
 */
export function getLocaleFromFileName(fileName: string): string {
  const base = fileName.replace(/\.(arb|json)$/i, '');
  const segments = base.split(/[/_\.]/).filter(Boolean);
  if (segments.length > 1) {
    const last = segments[segments.length - 1];
    if (/^[a-z]{2,5}$/i.test(last) || /^[a-z]{2,3}(-[A-Za-z]{2,4})?$/i.test(last)) {
      return last.toLowerCase();
    }
  }
  return base.toLowerCase();
}

/** True for plain objects (not arrays, not null). */
function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Recursively flatten a (possibly nested) translation value into dot-path keys
 * in `out`. Plain objects become `parent.child`, arrays become `parent.0`,
 * `parent.1`, … and scalar leaves keep their string form. This is how nested
 * easy_localization-style JSON (e.g. `{ "tabs": { "home": "Home" } }`) is
 * represented in the flat `keys` map without corrupting its structure.
 *
 * Every leaf key that actually came from a nested object/array is also pushed
 * into `nestedPaths` so serialization can distinguish it from a literal flat
 * key that merely contains dots (e.g. `input_field.context_menu.cut` or a
 * sentence ending in ".").
 */
function flattenValue(
  keyPath: string,
  value: unknown,
  out: Record<string, string>,
  nestedPaths?: string[],
): void {
  if (Array.isArray(value)) {
    value.forEach((item, index) => {
      flattenValue(`${keyPath}.${index}`, item, out, nestedPaths);
    });
    return;
  }
  if (isPlainObject(value)) {
    for (const [childKey, childValue] of Object.entries(value)) {
      flattenValue(`${keyPath}.${childKey}`, childValue, out, nestedPaths);
    }
    return;
  }
  out[keyPath] = typeof value === 'string' ? value : String(value ?? '');
  if (nestedPaths) {
    nestedPaths.push(keyPath);
  }
}

/**
 * Recursively convert contiguous `{ "0": …, "1": … }` nodes back into arrays so
 * nested arrays round-trip. Order-preserving: a node is only converted when its
 * numeric keys already appear in order starting from 0.
 */
function normalizeNestedArrays(node: unknown): unknown {
  if (Array.isArray(node)) {
    return node.map(normalizeNestedArrays);
  }
  if (isPlainObject(node)) {
    const entries = Object.entries(node);
    const isIndexedArray =
      entries.length > 0 &&
      entries.every(([k]) => /^\d+$/.test(k)) &&
      entries.every(([k], idx) => Number(k) === idx);
    if (isIndexedArray) {
      return entries.map(([, v]) => normalizeNestedArrays(v));
    }
    const out: Record<string, unknown> = {};
    for (const [k, v] of entries) {
      out[k] = normalizeNestedArrays(v);
    }
    return out;
  }
  return node;
}

/**
 * Re-nest a flat dot-path key map back into a nested object tree. Keys
 * starting with `@` (ARB metadata), keys without a dot, and keys NOT present
 * in `nestedKeys` (literal flat keys that happen to contain dots) stay
 * top-level exactly as-is. Only keys listed in `nestedKeys` are re-nested.
 */
function unflattenTranslationKeys(
  flat: Record<string, unknown>,
  nestedKeys?: Set<string>,
): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(flat)) {
    if (key.startsWith('@') || !key.includes('.') || !nestedKeys?.has(key)) {
      result[key] = value;
      continue;
    }
    const parts = key.split('.');
    let node = result;
    let i = 0;
    for (; i < parts.length - 1; i++) {
      const part = parts[i];
      if (!isPlainObject(node[part])) {
        node[part] = {};
      }
      node = node[part] as Record<string, unknown>;
    }
    node[parts[i]] = value;
  }
  return normalizeNestedArrays(result) as Record<string, unknown>;
}

/**
 * Parse a translation file's raw content. Returns `null` when the content is
 * not valid JSON. For ARB files the `@@...` / `@key` entries are stored as
 * metadata and excluded from `keys`. Nested objects/arrays are flattened into
 * dot-path keys (e.g. `tabs.home`) so the structure survives a save round-trip.
 */
export function parseTranslationContent(
  content: string,
  fileName: string,
): TranslationFileData | null {
  let raw: Record<string, unknown>;
  try {
    raw = JSON.parse(content) as Record<string, unknown>;
  } catch {
    return null;
  }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return null;
  }

  const isArb = fileName.toLowerCase().endsWith('.arb');
  const metadata: Record<string, unknown> = {};
  const keys: Record<string, string> = {};
  const nestedPaths: string[] = [];

  for (const [key, value] of Object.entries(raw)) {
    if (key.startsWith('@')) {
      metadata[key] = value;
    } else if (isPlainObject(value) || Array.isArray(value)) {
      flattenValue(key, value, keys, nestedPaths);
    } else {
      keys[key] = typeof value === 'string' ? value : String(value ?? '');
    }
  }

  let locale = getLocaleFromFileName(fileName);
  if (isArb && typeof metadata['@@locale'] === 'string' && metadata['@@locale'] !== '') {
    locale = metadata['@@locale'];
  }

  return { locale, fileName, isArb, keys, metadata, nestedPaths };
}

/**
 * Serialize a translation file back to JSON text (2-space indent, trailing
 * newline). ARB metadata is preserved and interleaved with its key. Dot-path
 * keys are re-nested into objects/arrays so nested translations round-trip.
 */
export function serializeTranslationContent(data: TranslationFileData): string {
  const entries: Array<[string, unknown]> = [];

  // Top-level ARB attributes first (@@locale, @@last_modified, ...).
  const topLevel: Record<string, unknown> = {};
  const keyMetadata: Record<string, unknown> = {};
  if (data.isArb) {
    for (const [key, value] of Object.entries(data.metadata)) {
      if (key.startsWith('@@')) {
        topLevel[key] = value;
      } else {
        keyMetadata[key] = value;
      }
    }
  }

  // Ensure @@locale is present for ARB files.
  if (data.isArb && topLevel['@@locale'] === undefined) {
    topLevel['@@locale'] = data.locale;
  }

  for (const [key, value] of Object.entries(topLevel)) {
    entries.push([key, value]);
  }
  for (const [key, value] of Object.entries(data.keys)) {
    if (data.isArb && keyMetadata[`@${key}`] !== undefined) {
      entries.push([`@${key}`, keyMetadata[`@${key}`]]);
    }
    entries.push([key, value]);
  }
  // Any leftover metadata keys (no matching translation key).
  for (const [key, value] of Object.entries(keyMetadata)) {
    const plainKey = key.startsWith('@') ? key.slice(1) : key;
    if (data.keys[plainKey] === undefined) {
      entries.push([key, value]);
    }
  }

  const obj: Record<string, unknown> = {};
  for (const [key, value] of entries) {
    obj[key] = value;
  }

  // Only re-nest keys that came from actual nested objects/arrays. Literal
  // flat keys containing dots (sentences ending in "."/"...", or flat
  // easy_localization keys like `input_field.context_menu.cut`) stay top-level.
  const nestedKeys =
    data.nestedPaths && data.nestedPaths.length > 0 ? new Set(data.nestedPaths) : undefined;

  return `${JSON.stringify(unflattenTranslationKeys(obj, nestedKeys), null, 2)}\n`;
}

/**
 * Normalize a user-provided directory (strip leading/trailing slashes).
 * Returns `undefined` when empty so callers can fall back to auto-discovery.
 */
export function normalizeTranslationDir(dir?: string): string | undefined {
  const trimmed = (dir || '').trim().replace(/^[\/]+|[\/]+$/g, '');
  return trimmed === '' ? undefined : trimmed.replace(/\\/g, '/');
}

/**
 * Pick the reference (source) file. Defaults to the configured locale, or the
 * first file when not found.
 */
export function findReferenceFile(
  translations: TranslationFileData[],
  referenceLocale?: string,
): TranslationFileData | undefined {
  if (!translations || translations.length === 0) {
    return undefined;
  }
  if (referenceLocale) {
    const match = translations.find((t) => t.locale === referenceLocale);
    if (match) {
      return match;
    }
  }
  return translations[0];
}

/** Keys present in the reference but missing (or empty) in the target. */
export function findMissingKeys(
  reference: TranslationFileData,
  target: TranslationFileData,
): string[] {
  return Object.keys(reference.keys).filter((key) => {
    const value = target.keys[key];
    return value === undefined || value === '';
  });
}

/**
 * Add every reference key to every non-reference locale (as an empty string),
 * so the keys grid has a complete set of rows. Returns a new array.
 */
export function autoAddMissingKeys(
  translations: TranslationFileData[],
  referenceLocale?: string,
): TranslationFileData[] {
  const reference = findReferenceFile(translations, referenceLocale);
  if (!reference) {
    return translations;
  }

  const refNested = reference.nestedPaths;
  return translations.map((t) => {
    if (t.locale === reference.locale) {
      return t;
    }
    const keys = { ...t.keys };
    const nestedPaths = t.nestedPaths ? [...t.nestedPaths] : [];
    let changed = false;
    for (const key of Object.keys(reference.keys)) {
      if (keys[key] === undefined) {
        keys[key] = '';
        if (refNested?.includes(key) && !nestedPaths.includes(key)) {
          nestedPaths.push(key);
        }
        changed = true;
      }
    }
    const extra = nestedPaths.length > 0 ? { nestedPaths } : {};
    return changed ? { ...t, keys, ...extra } : t;
  });
}

/**
 * Translate all values in the given locale file from the reference locale.
 * `missingOnly` keeps already-translated values and only fills gaps.
 */
export async function translateLocale(
  translations: TranslationFileData[],
  locale: string,
  referenceLocale?: string,
  missingOnly = false,
): Promise<TranslateResult> {
  const reference = findReferenceFile(translations, referenceLocale);
  const target = translations.find((t) => t.locale === locale);

  if (!reference || !target || reference.locale === target.locale) {
    return { translations, translatedCount: 0 };
  }

  const toTranslate: Record<string, string> = {};
  for (const [key, value] of Object.entries(reference.keys)) {
    const current = target.keys[key];
    if (missingOnly) {
      if (current === undefined || current === '') {
        toTranslate[key] = value;
      }
    } else if (current !== value || current === '') {
      toTranslate[key] = value;
    }
  }

  const translated = await translateMany(toTranslate, target.locale, reference.locale);
  const keys = { ...target.keys };
  const nestedPaths = target.nestedPaths ? [...target.nestedPaths] : [];
  const refNested = reference.nestedPaths;
  for (const [key, value] of Object.entries(translated)) {
    keys[key] = value;
    if (refNested?.includes(key) && !nestedPaths.includes(key)) {
      nestedPaths.push(key);
    }
  }

  const updated = translations.map((t) =>
    t.locale === target.locale
      ? { ...t, keys, ...(nestedPaths.length > 0 ? { nestedPaths } : {}) }
      : t,
  );

  return { translations: updated, translatedCount: Object.keys(translated).length };
}

/**
 * Translate all locales (or only their missing values) from the reference
 * locale.
 */
export async function translateAllLocales(
  translations: TranslationFileData[],
  referenceLocale?: string,
  missingOnly = false,
): Promise<TranslateResult> {
  const reference = findReferenceFile(translations, referenceLocale);
  if (!reference) {
    return { translations, translatedCount: 0 };
  }

  const targets = translations.filter((t) => t.locale !== reference.locale);
  let count = 0;
  let current = translations;

  for (const target of targets) {
    const result = await translateLocale(current, target.locale, reference.locale, missingOnly);
    current = result.translations;
    count += result.translatedCount;
  }

  return { translations: current, translatedCount: count };
}

/**
 * Translate a single value (used by per-locale "translate this value" flows).
 */
export function translateValue(
  value: string,
  target: string,
  source?: string,
): Promise<string | null> {
  return translateText(value, target, source);
}
