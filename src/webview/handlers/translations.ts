/**
 * Webview handlers for the translation-file (ARB / JSON) feature.
 *
 * These mirror the needed_docs_api translation flow: a reference locale is the
 * source of truth, missing keys can be auto-added, and values are machine
 * translated through the free keyless provider chain. All translation actions
 * run in the extension host (network access lives here, not in the webview).
 */

import * as vscode from 'vscode';
import type { TranslationFileData } from '../../core/types/index.js';
import {
  loadTranslationFiles,
  autoAddMissingKeys,
  translateAllLocales,
  translateLocale,
  createTranslationFileForLocale,
  saveTranslationFiles,
  findReferenceFile,
} from '../../features/localization/index.js';
import type { WebviewRef } from './index.js';

function workspaceRoot(): vscode.Uri | undefined {
  return vscode.workspace.workspaceFolders?.[0]?.uri;
}

function replyTranslations(
  ref: WebviewRef,
  translations: TranslationFileData[],
): void {
  ref.webview.postMessage({ type: 'translations', translations });
}

function replyResult(
  ref: WebviewRef,
  success: boolean,
  message: string,
  translations?: TranslationFileData[],
): void {
  ref.webview.postMessage({ type: 'translationsResult', success, message, translations });
}

/**
 * Build the result message for a translation action. When nothing was
 * translated the free provider chain is most likely unavailable (rate-limited
 * or blocked), so we surface that instead of a confusing "0 values" message.
 */
function translationResultMessage(
  actionLabel: string,
  count: number,
  extra = '',
): string {
  const base = `${actionLabel} ${count} value${count === 1 ? '' : 's'}${extra}.`;
  if (count > 0) {
    return base;
  }
  return `${base} No free provider could translate right now (MyMemory / Google / LibreTranslate are often rate-limited) — try again later or set the values manually.`;
}

/** Scan the workspace (or the given directory) and send the loaded files. */
export async function handleRequestTranslations(
  ref: WebviewRef,
  dir?: string,
): Promise<void> {
  const root = workspaceRoot();
  if (!root) {
    replyTranslations(ref, []);
    return;
  }
  try {
    const translations = await loadTranslationFiles(root, dir);
    replyTranslations(ref, translations);
  } catch (error) {
    replyResult(ref, false, `Failed to load translation files: ${String(error)}`);
  }
}

/** Create a new translation file for a locale (keys copied empty from reference). */
export async function handleAddTranslationLocale(
  ref: WebviewRef,
  locale: string,
  referenceLocale?: string,
  dir?: string,
): Promise<void> {
  const root = workspaceRoot();
  if (!root) {
    replyResult(ref, false, 'No workspace folder is open.');
    return;
  }
  if (!locale) {
    replyResult(ref, false, 'A language code is required.');
    return;
  }
  try {
    const translations = await loadTranslationFiles(root, dir);
    const reference = findReferenceFile(translations, referenceLocale);
    const created = await createTranslationFileForLocale(root, locale.toLowerCase(), reference, dir);
    if (!created) {
      replyResult(ref, false, `Could not create translation file for "${locale}".`);
      return;
    }
    const next = await loadTranslationFiles(root, dir);
    replyResult(ref, true, `Added language "${created.locale}" (${created.fileName}).`, next);
  } catch (error) {
    replyResult(ref, false, `Failed to add language: ${String(error)}`);
  }
}

/** Delete the translation file for a locale from disk. */
export async function handleRemoveTranslationLocale(
  ref: WebviewRef,
  locale: string,
  dir?: string,
): Promise<void> {
  const root = workspaceRoot();
  if (!root) {
    replyResult(ref, false, 'No workspace folder is open.');
    return;
  }
  try {
    const translations = await loadTranslationFiles(root, dir);
    const target = translations.find((t) => t.locale === locale);
    if (!target) {
      replyResult(ref, false, `No translation file found for "${locale}".`);
      return;
    }
    const uri = vscode.Uri.joinPath(root, target.fileName);
    try {
      await vscode.workspace.fs.delete(uri);
    } catch {
      replyResult(ref, false, `Could not delete "${target.fileName}".`);
      return;
    }
    const next = await loadTranslationFiles(root, dir);
    replyResult(ref, true, `Removed language "${target.locale}" (${target.fileName}).`, next);
  } catch (error) {
    replyResult(ref, false, `Failed to remove language: ${String(error)}`);
  }
}

/** Add every reference key (as empty) to all non-reference locales. */
export async function handleAutoAddMissingKeys(
  ref: WebviewRef,
  referenceLocale?: string,
  dir?: string,
): Promise<void> {
  const root = workspaceRoot();
  if (!root) {
    replyResult(ref, false, 'No workspace folder is open.');
    return;
  }
  try {
    const translations = await loadTranslationFiles(root, dir);
    const next = autoAddMissingKeys(translations, referenceLocale);
    replyResult(ref, true, 'Missing keys added (empty values).', next);
  } catch (error) {
    replyResult(ref, false, `Failed to add missing keys: ${String(error)}`);
  }
}

/** Translate every locale from the reference locale. */
export async function handleTranslateAll(
  ref: WebviewRef,
  referenceLocale?: string,
  dir?: string,
): Promise<void> {
  const root = workspaceRoot();
  if (!root) {
    replyResult(ref, false, 'No workspace folder is open.');
    return;
  }
  try {
    const translations = await loadTranslationFiles(root, dir);
    const { translations: next, translatedCount } = await translateAllLocales(
      translations,
      referenceLocale,
      false,
    );
    replyResult(
      ref,
      true,
      translationResultMessage('Translated', translatedCount, ' across all languages'),
      next,
    );
  } catch (error) {
    replyResult(ref, false, `Translation failed: ${String(error)}`);
  }
}

/** Fill only missing values in every locale from the reference locale. */
export async function handleTranslateMissing(
  ref: WebviewRef,
  referenceLocale?: string,
  dir?: string,
): Promise<void> {
  const root = workspaceRoot();
  if (!root) {
    replyResult(ref, false, 'No workspace folder is open.');
    return;
  }
  try {
    const translations = await loadTranslationFiles(root, dir);
    const { translations: next, translatedCount } = await translateAllLocales(
      translations,
      referenceLocale,
      true,
    );
    replyResult(
      ref,
      true,
      translationResultMessage('Filled', translatedCount, ' missing values across all languages'),
      next,
    );
  } catch (error) {
    replyResult(ref, false, `Translation failed: ${String(error)}`);
  }
}

/** Translate all values for a single locale. */
export async function handleTranslateLocale(
  ref: WebviewRef,
  locale: string,
  referenceLocale?: string,
  dir?: string,
): Promise<void> {
  const root = workspaceRoot();
  if (!root) {
    replyResult(ref, false, 'No workspace folder is open.');
    return;
  }
  try {
    const translations = await loadTranslationFiles(root, dir);
    const { translations: next, translatedCount } = await translateLocale(
      translations,
      locale,
      referenceLocale,
      false,
    );
    replyResult(
      ref,
      true,
      translationResultMessage('Translated', translatedCount, ` for "${locale}"`),
      next,
    );
  } catch (error) {
    replyResult(ref, false, `Translation failed: ${String(error)}`);
  }
}

/** Fill only missing values for a single locale. */
export async function handleTranslateLocaleMissing(
  ref: WebviewRef,
  locale: string,
  referenceLocale?: string,
  dir?: string,
): Promise<void> {
  const root = workspaceRoot();
  if (!root) {
    replyResult(ref, false, 'No workspace folder is open.');
    return;
  }
  try {
    const translations = await loadTranslationFiles(root, dir);
    const { translations: next, translatedCount } = await translateLocale(
      translations,
      locale,
      referenceLocale,
      true,
    );
    replyResult(
      ref,
      true,
      translationResultMessage('Filled', translatedCount, ` missing values for "${locale}"`),
      next,
    );
  } catch (error) {
    replyResult(ref, false, `Translation failed: ${String(error)}`);
  }
}

/**
 * Show a quick-pick of workspace sub-directories so the user can choose where
 * their translation files live. Posts the selected directory back to the
 * webview via a `translationsDirSelected` message.
 */
export async function handleBrowseTranslationsDir(ref: WebviewRef): Promise<void> {
  const root = workspaceRoot();
  if (!root) {
    replyResult(ref, false, 'No workspace folder is open.');
    return;
  }

  try {
    const dirs = await collectSubDirectories(root, 0, 100);
    dirs.sort((a, b) => a.localeCompare(b));

    const pick = await vscode.window.showQuickPick(
      [
        { label: 'Auto-detect (scan whole project)', description: 'default', value: '' },
        ...dirs.map((d) => ({ label: d, description: '', value: d })),
      ],
      { placeHolder: 'Choose the directory that contains your .arb / .json translation files' },
    );

    if (pick) {
      ref.webview.postMessage({ type: 'translationsDirSelected', dir: pick.value });
    }
  } catch (error) {
    replyResult(ref, false, `Failed to browse directories: ${String(error)}`);
  }
}

/** Recursively collect workspace-relative directory paths (bounded depth). */
async function collectSubDirectories(
  root: vscode.Uri,
  depth: number,
  limit: number,
): Promise<string[]> {
  if (depth > 5) {
    return [];
  }
  const result: string[] = [];
  let entries: [string, vscode.FileType][] = [];
  try {
    entries = await vscode.workspace.fs.readDirectory(root);
  } catch {
    return result;
  }

  for (const [name, type] of entries) {
    if (type !== vscode.FileType.Directory) {
      continue;
    }
    if (IGNORED_DIR_NAMES.has(name)) {
      continue;
    }
    result.push(name);
    if (result.length >= limit) {
      return result;
    }
    const sub = await collectSubDirectories(
      vscode.Uri.joinPath(root, name),
      depth + 1,
      limit - result.length,
    );
    for (const child of sub) {
      result.push(`${name}/${child}`);
      if (result.length >= limit) {
        return result;
      }
    }
  }

  return result;
}

/** Directory names never suggested as translation locations. */
const IGNORED_DIR_NAMES = new Set([
  'node_modules', '.git', '.dart_tool', 'build', 'out', 'dist', 'coverage',
  '.idea', '.vscode', 'android', 'ios', 'macos', 'linux', 'windows', 'web',
  'test', 'tests', '.github', 'gradle',
]);

/** Write all translation files back to disk. */
export async function handleSaveTranslations(
  ref: WebviewRef,
  translations: TranslationFileData[],
  dir?: string,
): Promise<void> {
  const root = workspaceRoot();
  if (!root) {
    replyResult(ref, false, 'No workspace folder is open.');
    return;
  }
  try {
    const result = await saveTranslationFiles(translations, root);
    replyResult(ref, result.success, result.message, translations);
  } catch (error) {
    replyResult(ref, false, `Save failed: ${String(error)}`);
  }
}
