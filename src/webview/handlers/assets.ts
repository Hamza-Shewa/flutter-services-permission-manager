import * as vscode from 'vscode';
import type { WebviewRef } from './index.js';
import { toErrorMessage } from '../../shared/index.js';
import {
    analyzeUnusedAssets,
    deleteUnusedAssets,
} from '../../services/assets.service.js';

/**
 * Runs the unused-assets scan for the current workspace and posts the result
 * back to the webview.
 */
export async function handleAnalyzeUnusedAssets(ref: WebviewRef): Promise<void> {
    try {
        const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
        if (!workspaceRoot) {
            throw new Error('No workspace root found');
        }
        const result = await analyzeUnusedAssets(workspaceRoot);
        ref.webview.postMessage({
            type: 'unusedAssetsResult',
            assets: result.assets,
            totalAssets: result.totalAssets,
            usedAssets: result.usedAssets,
        });
    } catch (error) {
        console.error('Analyze unused assets error:', error);
        ref.webview.postMessage({
            type: 'unusedAssetsResult',
            assets: [],
            totalAssets: 0,
            usedAssets: 0,
            error: toErrorMessage(error),
        });
    }
}

/**
 * Deletes the given project-relative unused asset files, then re-runs the scan
 * to refresh the list.
 */
export async function handleDeleteUnusedAssets(
    ref: WebviewRef,
    assetPaths: string[],
): Promise<void> {
    try {
        const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
        if (!workspaceRoot) {
            throw new Error('No workspace root found');
        }
        ref.webview.postMessage({
            type: 'saveResult',
            success: true,
            message: `Deleting ${assetPaths.length} unused asset(s)... Please wait.`,
        });
        const deleted = await deleteUnusedAssets(workspaceRoot, assetPaths);
        ref.webview.postMessage({
            type: 'saveResult',
            success: true,
            message: `Deleted ${deleted} unused asset file(s).`,
        });

        // Refresh the unused assets list after deletion.
        await handleAnalyzeUnusedAssets(ref);
    } catch (error) {
        console.error('Delete unused assets error:', error);
        ref.webview.postMessage({
            type: 'saveResult',
            success: false,
            message: `Failed to delete unused assets: ${toErrorMessage(error)}`,
        });
    }
}
