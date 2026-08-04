import * as cp from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import { toErrorMessage } from '../shared/index.js';
import type { UnusedAsset, AssetDynamicRef } from '../types/services.js';

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
 * `out/services/` this is two levels up.
 */
function getScriptPath(): string {
    return path.resolve(__dirname, '..', '..', 'scripts', 'check-unused-assets.js');
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
 */
export function getIgnoredAssetPaths(): {
    ignoredDirectories: string[];
    ignoredFiles: string[];
    ignoredDynamicDirectories: string[];
    ignoredDynamicFiles: string[];
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
    };
}

function buildIgnoreArgs(): string[] {
    const {
        ignoredDirectories,
        ignoredFiles,
        ignoredDynamicDirectories,
        ignoredDynamicFiles,
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
    return args;
}

/**
 * Scans the Flutter project at `workspaceRoot` and returns the list of asset
 * files that are not referenced from the project's Dart/JSON source.
 */
export async function analyzeUnusedAssets(workspaceRoot: string): Promise<UnusedAssetsResult> {
    const stdout = await runScript(workspaceRoot, ['--json', ...buildIgnoreArgs()]);
    try {
        const data = JSON.parse(stdout) as UnusedAssetsScriptPayload;
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
