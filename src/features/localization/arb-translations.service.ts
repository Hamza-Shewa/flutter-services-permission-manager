/**
 * Translation-file management for ARB / JSON locale files.
 *
 * Loads, parses, edits and saves Flutter `*.arb` files and plain `*.json`
 * translation files inside the workspace. ARB metadata (`@@locale`,
 * `@keyName`, …) is preserved on save. The reference locale behaves like the
 * "fallback language" in the needed_docs_api translation feature: missing keys
 * are computed against it, and machine translation uses it as the source
 * language.
 */

import * as vscode from 'vscode';
import * as path from 'path';
import type { TranslationFileData } from '../../core/types/index.js';
import { translateMany, translateText } from './machine-translator.js';

/** Directories whose JSON files are treated as translation files. */
const LOCALIZATION_JSON_DIRS = ['l10n', 'translations', 'locales', 'locale', 'lang', 'i18n', 'assets/locales', 'assets/translations', 'lib/l10n', 'lib/l10n/arb'];

/** Glob of ARB files to discover (excluding build output). */
const ARB_GLOB = '**/*.arb';

const IGNORED_DIRS = ['build', '.dart_tool', 'node_modules', '.git', 'out', 'dist', 'coverage'];

/** Result of a single save operation. */
export interface SaveTranslationsResult {
  success: boolean;
  message: string;
}

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
 */
function flattenValue(keyPath: string, value: unknown, out: Record<string, string>): void {
  if (Array.isArray(value)) {
    value.forEach((item, index) => {
      flattenValue(`${keyPath}.${index}`, item, out);
    });
    return;
  }
  if (isPlainObject(value)) {
    for (const [childKey, childValue] of Object.entries(value)) {
      flattenValue(`${keyPath}.${childKey}`, childValue, out);
    }
    return;
  }
  out[keyPath] = typeof value === 'string' ? value : String(value ?? '');
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
 * starting with `@` (ARB metadata) and keys without a dot stay top-level.
 */
function unflattenTranslationKeys(flat: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(flat)) {
    if (key.startsWith('@') || !key.includes('.')) {
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

  for (const [key, value] of Object.entries(raw)) {
    if (key.startsWith('@')) {
      metadata[key] = value;
    } else if (isPlainObject(value) || Array.isArray(value)) {
      flattenValue(key, value, keys);
    } else {
      keys[key] = typeof value === 'string' ? value : String(value ?? '');
    }
  }

  let locale = getLocaleFromFileName(fileName);
  if (isArb && typeof metadata['@@locale'] === 'string' && metadata['@@locale'] !== '') {
    locale = metadata['@@locale'];
  }

  return { locale, fileName, isArb, keys, metadata };
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

  return `${JSON.stringify(unflattenTranslationKeys(obj), null, 2)}\n`;
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
 * Discover translation files. When `dir` is provided, only that workspace
 * sub-directory is scanned (for `*.arb` and `*.json`). Otherwise every `*.arb`
 * file (excluding build output) plus `*.json` files under known localization
 * directories are found. Returns URIs grouped by kind.
 */
export async function discoverTranslationUris(
  workspaceRoot: vscode.Uri,
  dir?: string,
): Promise<{ arbUris: vscode.Uri[]; jsonUris: vscode.Uri[] }> {
  const scanDir = normalizeTranslationDir(dir);
  const ignore = `{${IGNORED_DIRS.map((d) => `**/${d}/**`).join(',')}}`;
  const maxResults = 500;

  const arbGlob = scanDir ? `${scanDir}/**/*.arb` : ARB_GLOB;
  const arbUris = await vscode.workspace.findFiles(arbGlob, ignore, maxResults);

  const jsonUris: vscode.Uri[] = [];
  const jsonGlobs = scanDir
    ? [`${scanDir}/**/*.json`]
    : LOCALIZATION_JSON_DIRS.map((d) => `${d}/**/*.json`);

  for (const glob of jsonGlobs) {
    const found = await vscode.workspace.findFiles(glob, ignore, maxResults);
    for (const uri of found) {
      if (!jsonUris.some((u) => u.fsPath === uri.fsPath)) {
        jsonUris.push(uri);
      }
    }
  }

  return { arbUris, jsonUris };
}

/**
 * Load every translation file into a `TranslationFileData` array. When `dir`
 * is provided, only that workspace sub-directory is scanned. `fileName` is a
 * workspace-relative POSIX path (e.g. `lib/l10n/intl_ar.arb`) so saved files
 * land in their original location. Invalid/unreadable files are skipped.
 */
export async function loadTranslationFiles(
  workspaceRoot: vscode.Uri,
  dir?: string,
): Promise<TranslationFileData[]> {
  const { arbUris, jsonUris } = await discoverTranslationUris(workspaceRoot, dir);
  const uris = [...arbUris, ...jsonUris];
  const result: TranslationFileData[] = [];

  for (const uri of uris) {
    try {
      const doc = await vscode.workspace.openTextDocument(uri);
      const relative = path
        .relative(workspaceRoot.fsPath, uri.fsPath)
        .split(path.sep)
        .join('/');
      const data = parseTranslationContent(doc.getText(), relative);
      if (data) {
        result.push(data);
      }
    } catch {
      // Skip unreadable files.
    }
  }

  // Stable order: alphabetical by locale.
  return result.sort((a, b) => a.locale.localeCompare(b.locale));
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

  return translations.map((t) => {
    if (t.locale === reference.locale) {
      return t;
    }
    const keys = { ...t.keys };
    let changed = false;
    for (const key of Object.keys(reference.keys)) {
      if (keys[key] === undefined) {
        keys[key] = '';
        changed = true;
      }
    }
    return changed ? { ...t, keys } : t;
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
  for (const [key, value] of Object.entries(translated)) {
    keys[key] = value;
  }

  const updated = translations.map((t) =>
    t.locale === target.locale ? { ...t, keys } : t,
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
 * Create a new translation file for `locale`. When a reference file exists, the
 * new file gets all reference keys as empty values so it can be filled in, and
 * it is written next to the reference file. Otherwise it is written into the
 * user-provided `dir` (default `lib/l10n/` when omitted). The returned
 * `fileName` is a workspace-relative POSIX path so saves work correctly.
 * Returns `null` on failure.
 */
export async function createTranslationFileForLocale(
  workspaceRoot: vscode.Uri,
  locale: string,
  reference?: TranslationFileData,
  dir?: string,
): Promise<TranslationFileData | null> {
  const isArb = reference ? reference.isArb : true;
  const extension = isArb ? 'arb' : 'json';

  // Determine the target directory (workspace-relative, POSIX).
  let relDir: string;
  if (reference) {
    relDir = path.dirname(reference.fileName).replace(/\\/g, '/');
  } else {
    relDir = normalizeTranslationDir(dir) ?? 'lib/l10n';
  }

  const keys: Record<string, string> = {};
  if (reference) {
    for (const key of Object.keys(reference.keys)) {
      keys[key] = '';
    }
  }

  const metadata: Record<string, unknown> = isArb ? { '@@locale': locale } : {};

  // Build a file base name matching the reference pattern (intl_xx.arb → intl_<locale>.arb).
  let base = `${locale}.${extension}`;
  if (reference) {
    const refBase = path.basename(reference.fileName).replace(/\.(arb|json)$/i, '');
    const refLoc = getLocaleFromFileName(path.basename(reference.fileName));
    const prefix = refBase.toLowerCase().endsWith(refLoc)
      ? refBase.slice(0, -refLoc.length)
      : `${refBase}_`;
    base = `${prefix}${locale}.${extension}`;
  }

  const fileName = relDir === '.' ? base : `${relDir}/${base}`;
  const dirUri = vscode.Uri.joinPath(workspaceRoot, relDir);
  const targetUri = vscode.Uri.joinPath(dirUri, base);

  const data: TranslationFileData = { locale, fileName, isArb, keys, metadata };

  try {
    await vscode.workspace.fs.createDirectory(dirUri);
    await vscode.workspace.fs.writeFile(
      targetUri,
      Buffer.from(serializeTranslationContent(data), 'utf8'),
    );
    return data;
  } catch {
    return null;
  }
}

/**
 * Write all translation files back to disk. Returns per-file results.
 */
export async function saveTranslationFiles(
  translations: TranslationFileData[],
  workspaceRoot: vscode.Uri,
): Promise<SaveTranslationsResult> {
  let saved = 0;

  for (const data of translations) {
    try {
      const uri = vscode.Uri.joinPath(workspaceRoot, data.fileName);
      await vscode.workspace.fs.writeFile(
        uri,
        Buffer.from(serializeTranslationContent(data), 'utf8'),
      );
      saved++;
    } catch {
      // Continue with the remaining files.
    }
  }

  if (saved === 0) {
    return { success: false, message: 'No translation files could be saved.' };
  }
  return {
    success: true,
    message: `Saved ${saved} translation file${saved === 1 ? '' : 's'}.`,
  };
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
