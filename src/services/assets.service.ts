import * as cp from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { toErrorMessage } from '../shared/index.js';
import type { UnusedAsset } from '../types/services.js';

/**
 * Result of scanning a Flutter project for unused assets.
 */
export interface UnusedAssetsResult {
    assets: UnusedAsset[];
    totalAssets: number;
    usedAssets: number;
}

interface UnusedAssetsScriptPayload {
    projectRoot: string;
    totalAssets: number;
    usedAssets: number;
    deleted: number;
    unusedAssets: Array<{ path: string; size?: number }>;
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
 * Scans the Flutter project at `workspaceRoot` and returns the list of asset
 * files that are not referenced from the project's Dart/JSON source.
 */
export async function analyzeUnusedAssets(workspaceRoot: string): Promise<UnusedAssetsResult> {
    const stdout = await runScript(workspaceRoot, ['--json']);
    try {
        const data = JSON.parse(stdout) as UnusedAssetsScriptPayload;
        const assets: UnusedAsset[] = (data.unusedAssets || []).map((a) => ({
            path: a.path,
            size: a.size,
        }));
        return {
            assets,
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
