import * as cp from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';
import { toErrorMessage } from '../../core/shared/index.js';
import { runProcess } from '../../core/utils/process.js';
import type { UnusedAsset, AssetDynamicRef, WebpConversionResult } from '../../core/types/services.js';

export type { WebpConversionImage, WebpConversionResult } from '../../core/types/services.js';

/**
 * Result of scanning a Flutter project for unused assets.
 */
export interface UnusedAssetsResult {
    /** Truly unused assets (no static or dynamic references) */
    assets: UnusedAsset[];
    /** Assets not statically referenced, but referenced via dynamic paths */
    maybeUsedAssets: UnusedAsset[];
    totalAssets: number;
    usedAssets: number;
}

interface UnusedAssetsScriptPayload {
    projectRoot: string;
    totalAssets: number;
    usedAssets: number;
    deleted: number;
    unusedAssets: Array<{ path: string; size?: number; refs?: AssetDynamicRef[] }>;
}

/**
 * Resolves the bundled standalone script that performs the scan. It lives at
 * `<extensionRoot>/scripts/check-unused-assets.js`; from the compiled
 * `out/features/assets/` this is three levels up (out/features -> out -> root).
 */
function getScriptPath(name = 'check-unused-assets.js'): string {
    return path.resolve(__dirname, '..', '..', '..', 'scripts', name);
}

function runScript(workspaceRoot: string, extraArgs: string[]): Promise<string> {
    return new Promise((resolve, reject) => {
        const script = getScriptPath();
        const nodeBin = process.execPath || 'node';
        const args = [script, '--path', workspaceRoot, ...extraArgs];
        cp.execFile(
            nodeBin,
            args,
            { maxBuffer: 1024 * 1024 * 10 },
            (error, stdout, stderr) => {
                if (error) {
                    return reject(new Error(`Unused assets script failed: ${error.message} - ${stderr}`));
                }
                resolve(stdout);
            }
        );
    });
}

/**
 * Reads the user-configured ignored directories/files for the unused-assets
 * scan from VS Code workspace settings.
 *
 * - `ignoredDirectories` / `ignoredFiles`: files/dirs skipped entirely.
 * - `ignoredDynamicDirectories` / `ignoredDynamicFiles`: only dynamic pattern
 *   detection is suppressed for these; literal references still count.
 * - `ignoredAssetDirectories`: asset folders skipped entirely from the scan;
 *   their files are never reported, counted or deleted.
 * - `ignoredLoaders`: loader APIs (e.g. Image.asset, SvgPicture.asset) skipped
 *   for fully-dynamic detection; literal calls still count as used.
 */
export function getIgnoredAssetPaths(): {
    ignoredDirectories: string[];
    ignoredFiles: string[];
    ignoredDynamicDirectories: string[];
    ignoredDynamicFiles: string[];
    ignoredAssetDirectories: string[];
    ignoredLoaders: string[];
} {
    const config = vscode.workspace.getConfiguration('flutter-config-manager.unusedAssets');
    const clean = (key: string): string[] =>
        (config.get<string[]>(key, []) ?? [])
            .map((v) => v.trim())
            .filter((v) => v.length > 0);
    return {
        ignoredDirectories: clean('ignoredDirectories'),
        ignoredFiles: clean('ignoredFiles'),
        ignoredDynamicDirectories: clean('ignoredDynamicDirectories'),
        ignoredDynamicFiles: clean('ignoredDynamicFiles'),
        ignoredAssetDirectories: clean('ignoredAssetDirectories'),
        ignoredLoaders: clean('ignoredLoaders'),
    };
}

function buildIgnoreArgs(): string[] {
    const {
        ignoredDirectories,
        ignoredFiles,
        ignoredDynamicDirectories,
        ignoredDynamicFiles,
        ignoredAssetDirectories,
        ignoredLoaders,
    } = getIgnoredAssetPaths();
    const args: string[] = [];
    for (const dir of ignoredDirectories) {
        args.push('--ignore-dirs', dir);
    }
    for (const file of ignoredFiles) {
        args.push('--ignore-files', file);
    }
    for (const dir of ignoredDynamicDirectories) {
        args.push('--ignore-dynamic-dirs', dir);
    }
    for (const file of ignoredDynamicFiles) {
        args.push('--ignore-dynamic-files', file);
    }
    for (const dir of ignoredAssetDirectories) {
        args.push('--ignore-asset-dirs', dir);
    }
    for (const loader of ignoredLoaders) {
        args.push('--ignore-loaders', loader);
    }
    return args;
}

/**
 * Scans the Flutter project at `workspaceRoot` and returns the list of asset
 * files that are not referenced from the project's Dart/JSON source.
 */
export async function analyzeUnusedAssets(workspaceRoot: string): Promise<UnusedAssetsResult> {
    // The script writes its --json report to a temp file (synchronously, so it
    // is always complete); we parse that file instead of stdout. Parsing stdout
    // is unreliable for large reports: the OS pipe buffer is only 64 KB on
    // macOS, and if the JSON exceeds it the output can be truncated mid-flight,
    // producing a parse error like "Expected ',' or '}' ... at position 65536".
    const logFile = path.join(os.tmpdir(), `flutter-config-unused-assets-${process.pid}-${Date.now()}.json`);
    try {
        const stdout = await runScript(workspaceRoot, ['--json', '--log-path', logFile, ...buildIgnoreArgs()]);
        const raw = fs.existsSync(logFile) ? fs.readFileSync(logFile, 'utf8') : stdout;
        const data = JSON.parse(raw) as UnusedAssetsScriptPayload;
        const all: UnusedAsset[] = (data.unusedAssets || []).map((a) => ({
            path: a.path,
            size: a.size,
            refs: Array.isArray(a.refs) && a.refs.length > 0 ? a.refs : undefined,
        }));
        const assets = all.filter((a) => !a.refs);
        const maybeUsedAssets = all.filter((a) => !!a.refs);
        return {
            assets,
            maybeUsedAssets,
            totalAssets: data.totalAssets ?? 0,
            usedAssets: data.usedAssets ?? 0,
        };
    } catch (parseError) {
        throw new Error(`Failed to parse unused assets output: ${toErrorMessage(parseError)}`);
    } finally {
        try {
            fs.unlinkSync(logFile);
        } catch {
            // best-effort cleanup of the temp report
        }
    }
}

/**
 * Deletes the given project-relative asset paths. Only files that resolve to
 * paths inside `workspaceRoot` are removed; anything else is skipped.
 * Returns the number of successfully deleted files.
 */
export async function deleteUnusedAssets(
    workspaceRoot: string,
    assetPaths: string[],
): Promise<number> {
    const root = path.resolve(workspaceRoot);
    let deleted = 0;

    for (const rel of assetPaths) {
        const target = path.resolve(root, rel);
        if (target === root || !target.startsWith(root + path.sep)) {
            continue; // safety: never delete outside the project root
        }
        try {
            fs.unlinkSync(target);
            deleted++;
        } catch (error) {
            console.warn(`Failed to delete ${target}: ${toErrorMessage(error)}`);
        }
    }
    return deleted;
}

/** Options for {@link convertImagesToWebp}; they map one-to-one to `scripts/convert-images-to-webp.js`. */
export interface WebpConversionOptions {
    /** Write the files, delete the originals and rewrite references. Without it nothing is written. */
    apply?: boolean;
    /** With `apply`: keep the originals and leave references alone. */
    keepOriginals?: boolean;
    /** Lossy quality 1-100 (default 85). */
    quality?: number;
    lossless?: boolean;
    /** Limit the conversion to this project-relative folder. */
    assetsPath?: string;
    /** Asset folders to leave alone. */
    ignoreAssetDirs?: string[];
}

/**
 * Converts the project's PNG/JPG/JPEG assets to WebP (see `scripts/convert-images-to-webp.js`).
 * Runs as a dry run unless `options.apply` is set.
 */
export async function convertImagesToWebp(
    workspaceRoot: string,
    options: WebpConversionOptions = {},
): Promise<WebpConversionResult> {
    const args = [getScriptPath('convert-images-to-webp.js'), '--path', workspaceRoot, '--json'];
    if (options.apply) { args.push('--apply'); }
    if (options.apply && options.keepOriginals) { args.push('--keep-originals'); }
    if (options.lossless) { args.push('--lossless'); }
    if (options.quality !== undefined) { args.push('--quality', String(options.quality)); }
    if (options.assetsPath) { args.push('--assets-path', options.assetsPath); }
    for (const dir of options.ignoreAssetDirs ?? []) { args.push('--ignore-asset-dirs', dir); }

    // The extension host runs on Electron; ELECTRON_RUN_AS_NODE makes the same binary behave as plain Node.
    const env = { ...process.env, ELECTRON_RUN_AS_NODE: '1' };
    try {
        const { stdout } = await runProcess(process.execPath || 'node', args, { cwd: workspaceRoot, env, timeoutMs: 600_000, maxBuffer: 1024 * 1024 * 50 });
        return JSON.parse(stdout) as WebpConversionResult;
    } catch (error) {
        throw new Error(`WebP conversion failed: ${toErrorMessage(error)}`);
    }
}
