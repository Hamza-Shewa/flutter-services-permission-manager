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
import {
  getLocaleFromFileName,
  parseTranslationContent,
  serializeTranslationContent,
  normalizeTranslationDir,
  findReferenceFile,
  findMissingKeys,
  autoAddMissingKeys,
  translateLocale,
  translateAllLocales,
  translateValue,
} from './arb-core.js';

export {
  getLocaleFromFileName,
  parseTranslationContent,
  serializeTranslationContent,
  normalizeTranslationDir,
  findReferenceFile,
  findMissingKeys,
  autoAddMissingKeys,
  translateLocale,
  translateAllLocales,
  translateValue,
};
export type { TranslateResult } from './arb-core.js';

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

  const data: TranslationFileData = {
    locale,
    fileName,
    isArb,
    keys,
    metadata,
    // Copy the reference's nested paths so a new locale file keeps the same
    // nested structure (while flat dot-keys stay flat).
    ...(reference?.nestedPaths ? { nestedPaths: [...reference.nestedPaths] } : {}),
  };

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
