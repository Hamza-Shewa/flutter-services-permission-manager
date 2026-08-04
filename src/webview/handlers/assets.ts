import * as path from 'path';
import * as vscode from 'vscode';
import type { WebviewRef } from './index.js';
import { toErrorMessage } from '../../shared/index.js';
import {
    analyzeUnusedAssets,
    deleteUnusedAssets,
    getIgnoredAssetPaths,
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
        const ignore = getIgnoredAssetPaths();
        ref.webview.postMessage({
            type: 'unusedAssetsResult',
            assets: result.assets,
            maybeUsedAssets: result.maybeUsedAssets,
            totalAssets: result.totalAssets,
            usedAssets: result.usedAssets,
            ignoredDirectories: ignore.ignoredDirectories,
            ignoredFiles: ignore.ignoredFiles,
            ignoredDynamicDirectories: ignore.ignoredDynamicDirectories,
            ignoredDynamicFiles: ignore.ignoredDynamicFiles,
        });
    } catch (error) {
        console.error('Analyze unused assets error:', error);
        const ignore = getIgnoredAssetPaths();
        ref.webview.postMessage({
            type: 'unusedAssetsResult',
            assets: [],
            maybeUsedAssets: [],
            totalAssets: 0,
            usedAssets: 0,
            ignoredDirectories: ignore.ignoredDirectories,
            ignoredFiles: ignore.ignoredFiles,
            ignoredDynamicDirectories: ignore.ignoredDynamicDirectories,
            ignoredDynamicFiles: ignore.ignoredDynamicFiles,
            error: toErrorMessage(error),
        });
    }
}

/**
 * Adds or removes a user-configured ignored directory/file for the
 * unused-assets scan, then re-runs the scan.
 */
export async function handleUpdateIgnoredAssetPaths(
    ref: WebviewRef,
    payload: { action: 'add' | 'remove'; mode: 'full' | 'dynamic'; kind: 'directory' | 'file'; value: string },
): Promise<void> {
    try {
        const value = (payload?.value || '').trim();
        if (!value) {
            return;
        }
        const mode = payload?.mode === 'dynamic' ? 'dynamic' : 'full';
        const key =
            mode === 'dynamic'
                ? payload?.kind === 'file'
                    ? 'ignoredDynamicFiles'
                    : 'ignoredDynamicDirectories'
                : payload?.kind === 'file'
                    ? 'ignoredFiles'
                    : 'ignoredDirectories';
        const config = vscode.workspace.getConfiguration('flutter-config-manager.unusedAssets');
        const current = (config.get<string[]>(key, []) ?? []).filter((v) => v && v.trim());
        const next = payload?.action === 'remove'
            ? current.filter((v) => v !== value)
            : current.includes(value)
                ? current
                : [...current, value];
        await config.update(key, next, vscode.ConfigurationTarget.Workspace);
        await handleAnalyzeUnusedAssets(ref);
    } catch (error) {
        console.error('Update ignored asset paths error:', error);
        ref.webview.postMessage({
            type: 'saveResult',
            success: false,
            message: `Failed to update ignored paths: ${toErrorMessage(error)}`,
        });
    }
}

/**
 * Opens a Dart file and reveals the exact line/column where a dynamic asset
 * pattern was detected.
 */
export async function handleRevealAssetReference(
    ref: WebviewRef,
    payload: { file: string; line: number; column: number },
): Promise<void> {
    try {
        const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
        if (!workspaceRoot || !payload?.file) {
            return;
        }
        const filePath = path.isAbsolute(payload.file)
            ? payload.file
            : path.join(workspaceRoot, payload.file);
        const uri = vscode.Uri.file(filePath);
        const doc = await vscode.workspace.openTextDocument(uri);
        const editor = await vscode.window.showTextDocument(doc, { preview: true });
        const line = Math.max(0, (payload.line || 1) - 1);
        const column = Math.max(0, payload.column || 0);
        const range = new vscode.Range(line, column, line, column + 1);
        editor.revealRange(range, vscode.TextEditorRevealType.InCenter);
        editor.selection = new vscode.Selection(range.start, range.end);
    } catch (error) {
        console.error('Reveal asset reference error:', error);
        ref.webview.postMessage({
            type: 'saveResult',
            success: false,
            message: `Failed to open ${payload?.file}: ${toErrorMessage(error)}`,
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
