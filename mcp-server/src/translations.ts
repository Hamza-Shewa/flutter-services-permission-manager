/**
 * Translation (ARB / JSON) tools for the Flutter Config Manager MCP server.
 *
 * These reuse the pure, vscode-free logic from the extension's `arb-core.ts`
 * (parse/serialize/translate) and `machine-translator.ts` (free keyless
 * translation), and persist files with Node `fs`.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { z } from 'zod';

import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';

import type { TranslationFileData } from '../../out/core/types/index.js';
import {
  autoAddMissingKeys,
  findReferenceFile,
  normalizeTranslationDir,
  parseTranslationContent,
  serializeTranslationContent,
  translateLocale,
} from '../../out/features/localization/arb-core.js';

/** Directories whose JSON files are treated as translation files. */
const LOCALIZATION_JSON_DIRS = [
  'l10n',
  'translations',
  'locales',
  'locale',
  'lang',
  'i18n',
  'assets/locales',
  'assets/translations',
  'lib/l10n',
  'lib/l10n/arb',
];

/** Directories never searched for translation files. */
const IGNORED_DIRS = new Set([
  'build',
  '.dart_tool',
  'node_modules',
  '.git',
  'out',
  'dist',
  'coverage',
]);

/** Simple recursive file walk returning POSIX-relative paths. */
function walk(root: string): string[] {
  const out: string[] = [];
  const stack: string[] = [root];
  while (stack.length > 0) {
    const dir = stack.pop()!;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (entry.name.startsWith('.') && entry.name !== '.well-known') {
        continue;
      }
      const abs = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (!IGNORED_DIRS.has(entry.name)) {
          stack.push(abs);
        }
      } else if (entry.isFile()) {
        out.push(path.relative(root, abs).split(path.sep).join('/'));
      }
    }
  }
  return out;
}

/** True when the relative path sits inside one of the localization dirs. */
function inLocalizationDir(rel: string): boolean {
  return LOCALIZATION_JSON_DIRS.some((d) => rel === d || rel.startsWith(`${d}/`));
}

/** Discover translation file relative paths (POSIX), honoring an optional dir. */
export function discoverTranslationFiles(root: string, dir?: string): string[] {
  const scanDir = normalizeTranslationDir(dir);
  const all = walk(root);
  return all.filter((rel) => {
    if (scanDir) {
      return (
        (rel === scanDir || rel.startsWith(`${scanDir}/`)) &&
        /\.(arb|json)$/i.test(rel)
      );
    }
    return /\.arb$/i.test(rel) || (/\.json$/i.test(rel) && inLocalizationDir(rel));
  });
}

/** Load and parse every discovered translation file. */
export function loadTranslationFiles(root: string, dir?: string): TranslationFileData[] {
  const result: TranslationFileData[] = [];
  for (const rel of discoverTranslationFiles(root, dir)) {
    try {
      const content = fs.readFileSync(path.join(root, rel.split('/').join(path.sep)), 'utf8');
      const data = parseTranslationContent(content, rel);
      if (data) {
        result.push(data);
      }
    } catch {
      // Skip unreadable files.
    }
  }
  return result.sort((a, b) => a.locale.localeCompare(b.locale));
}

/** Write a translation file back to disk (no-op when unchanged). */
function saveTranslationFile(root: string, data: TranslationFileData): void {
  const target = path.join(root, data.fileName.split('/').join(path.sep));
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, serializeTranslationContent(data), 'utf8');
}

/** Build an MCP text result. */
function textResult(data: unknown): CallToolResult {
  return { content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }] };
}

/** List translation files present in the project. */
export function listTranslationsTool(
  root: string,
  args: Record<string, unknown>,
): CallToolResult {
  const dir = typeof args.dir === 'string' ? args.dir : undefined;
  const translations = loadTranslationFiles(root, dir);
  const summary = translations.map((t) => ({
    locale: t.locale,
    file: t.fileName,
    isArb: t.isArb,
    keyCount: Object.keys(t.keys).length,
    nestedKeys: t.nestedPaths?.length ?? 0,
  }));
  return textResult({ count: summary.length, dir: dir ?? '(auto)', translations: summary });
}

/** Translate a single locale file from the reference locale. */
export async function translateLocaleTool(
  root: string,
  args: Record<string, unknown>,
): Promise<CallToolResult> {
  const locale = String(args.locale ?? '').trim().toLowerCase();
  const referenceLocale = typeof args.referenceLocale === 'string' ? args.referenceLocale : undefined;
  const missingOnly = args.missingOnly === true;
  const dir = typeof args.dir === 'string' ? args.dir : undefined;

  if (!locale) {
    return textResult({ ok: false, error: 'Missing required "locale".' });
  }

  const translations = loadTranslationFiles(root, dir);
  if (translations.length === 0) {
    return textResult({ ok: false, error: 'No translation files found.' });
  }

  // Make sure all reference keys exist in every locale before translating.
  const prepared = autoAddMissingKeys(translations, referenceLocale);
  const result = await translateLocale(prepared, locale, referenceLocale, missingOnly);

  // Persist every file that changed.
  const written: string[] = [];
  for (const data of result.translations) {
    const original = prepared.find((p) => p.locale === data.locale);
    const changed =
      !original ||
      JSON.stringify(original.keys) !== JSON.stringify(data.keys) ||
      JSON.stringify(original.nestedPaths) !== JSON.stringify(data.nestedPaths);
    if (changed) {
      saveTranslationFile(root, data);
      written.push(data.fileName);
    }
  }

  return textResult({
    ok: true,
    locale,
    translatedCount: result.translatedCount,
    writtenFiles: written,
  });
}

/** Add a new translation locale (creates the file with reference keys empty). */
export async function addTranslationLocaleTool(
  root: string,
  args: Record<string, unknown>,
): Promise<CallToolResult> {
  const locale = String(args.locale ?? '').trim().toLowerCase();
  const referenceLocale = typeof args.referenceLocale === 'string' ? args.referenceLocale : undefined;
  const dir = typeof args.dir === 'string' ? args.dir : undefined;

  if (!locale) {
    return textResult({ ok: false, error: 'Missing required "locale".' });
  }

  const translations = loadTranslationFiles(root, dir);
  const reference = findReferenceFile(translations, referenceLocale);
  if (!reference) {
    return textResult({ ok: false, error: 'No reference translation file found.' });
  }
  if (translations.some((t) => t.locale === locale)) {
    return textResult({ ok: false, error: `Locale "${locale}" already exists.` });
  }

  const isArb = reference.isArb;
  const extension = isArb ? 'arb' : 'json';

  // Where the new file goes: next to the reference, or the requested dir.
  let relDir: string;
  if (reference.fileName.includes('/')) {
    relDir = reference.fileName.slice(0, reference.fileName.lastIndexOf('/'));
  } else {
    relDir = normalizeTranslationDir(dir) ?? 'lib/l10n';
  }

  const keys: Record<string, string> = {};
  for (const key of Object.keys(reference.keys)) {
    keys[key] = '';
  }
  const metadata: Record<string, unknown> = isArb ? { '@@locale': locale } : {};

  // Build a file base name matching the reference pattern (intl_xx.arb → intl_<locale>.arb).
  let base = `${locale}.${extension}`;
  if (reference) {
    const refBase = reference.fileName
      .split('/')
      .pop()!
      .replace(/\.(arb|json)$/i, '');
    const refLoc = getLocaleFromBase(refBase);
    const prefix = refBase.toLowerCase().endsWith(refLoc) ? refBase.slice(0, -refLoc.length) : `${refBase}_`;
    base = `${prefix}${locale}.${extension}`;
  }
  const fileName = relDir === '.' ? base : `${relDir}/${base}`;

  const data: TranslationFileData = {
    locale,
    fileName,
    isArb,
    keys,
    metadata,
    ...(reference?.nestedPaths ? { nestedPaths: [...reference.nestedPaths] } : {}),
  };

  saveTranslationFile(root, data);
  return textResult({ ok: true, locale, file: fileName, keyCount: Object.keys(keys).length });
}

/** Extract locale code from a bare base name (mirrors arb-core logic). */
function getLocaleFromBase(base: string): string {
  const segments = base.split(/[/_.]/).filter(Boolean);
  if (segments.length > 1) {
    const last = segments[segments.length - 1];
    if (/^[a-z]{2,5}$/i.test(last) || /^[a-z]{2,3}(-[A-Za-z]{2,4})?$/i.test(last)) {
      return last.toLowerCase();
    }
  }
  return base.toLowerCase();
}

/** Shared zod input schemas for translation tools. */
export const listTranslationsSchema = z.object({
  dir: z
    .string()
    .optional()
    .describe('Optional workspace-relative directory to scan (e.g. "lib/l10n" or "assets/translations").'),
});
export const translateLocaleSchema = z.object({
  locale: z.string().describe('Target locale to translate, e.g. "ar" or "fr".'),
  referenceLocale: z
    .string()
    .optional()
    .describe('Source/fallback locale to translate from. Defaults to the first file.'),
  missingOnly: z
    .boolean()
    .optional()
    .describe('Only translate keys that are missing/empty, keeping existing translations.'),
  dir: z
    .string()
    .optional()
    .describe('Optional workspace-relative directory to scan.'),
});
export const addTranslationLocaleSchema = z.object({
  locale: z.string().describe('New locale to add, e.g. "es" or "de".'),
  referenceLocale: z
    .string()
    .optional()
    .describe('Locale whose keys the new file should inherit (empty values).'),
  dir: z
    .string()
    .optional()
    .describe('Optional workspace-relative directory for the new file.'),
});
