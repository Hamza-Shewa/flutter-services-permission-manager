/**
 * File reading utilities for permission data
 */

import path from 'path';
import { logger } from '../shared/index.js';
import * as vscode from 'vscode';

let _extensionBaseUri: vscode.Uri | undefined;

/**
 * Sets the extension base URI for file resolution
 */
export function setExtensionBaseUri(uri: vscode.Uri): void {
    _extensionBaseUri = uri;
}

/**
 * Gets the extension base URI
 */
export function getExtensionBaseUri(): vscode.Uri | undefined {
    return _extensionBaseUri;
}

/**
 * Reads and parses a JSON file from the extension's src directory.
 * Returns undefined if the file cannot be found or parsed, and shows a
 * user-visible error for critical data files.
 */
export async function readJsonFile<T>(filePath: string): Promise<T> {
    try {
        const currentFile = __filename;
        const dir = path.dirname(currentFile);
        const extensionFolder = vscode.Uri.file(dir);
        
        const candidatePaths: vscode.Uri[] = [];
        
        if (_extensionBaseUri) {
            candidatePaths.push(vscode.Uri.joinPath(_extensionBaseUri, 'src', filePath));
        }
        candidatePaths.push(vscode.Uri.joinPath(extensionFolder, filePath));

        let rawData: Uint8Array | undefined;
        for (const candidate of candidatePaths) {
            try {
                rawData = await vscode.workspace.fs.readFile(candidate);
                break;
            } catch {
                continue;
            }
        }

        if (!rawData) {
            throw new Error(`${filePath} not found in any candidate path`);
        }

        return JSON.parse(rawData.toString()) as T;
    } catch (error) {
        logger.error(`Error reading or parsing JSON at ${filePath}`, error instanceof Error ? error : new Error(String(error)));

        // Show actionable error for critical data files that ship with the extension
        const criticalFiles = [
            'categorized-android-permissions.json',
            'categorized-ios-permissions.json',
            'services-config.json',
            'permission-mapping.json',
        ];
        if (criticalFiles.some(f => filePath.endsWith(f))) {
            vscode.window.showErrorMessage(
                `Flutter Config Manager: Required data file "${filePath}" is missing or corrupted. ` +
                `Try reinstalling the extension.`,
            );
        }

        return [] as unknown as T;
    }
}
