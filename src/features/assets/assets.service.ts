import * as cp from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';
import { toErrorMessage } from '../../core/shared/index.js';
import type { UnusedAsset, AssetDynamicRef } from '../../core/types/services.js';

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
function getScriptPath(): string {
    return path.resolve(__dirname, '..', '..', '..', 'scripts', 'check-unused-assets.js');
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
