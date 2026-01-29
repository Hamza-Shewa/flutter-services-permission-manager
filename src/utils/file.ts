/**
 * File reading utilities for permission data
 */

import path from 'path';
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
 * Reads and parses a JSON file from the extension's src directory
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
            throw new Error(`${filePath} not found`);
        }

        return JSON.parse(rawData.toString()) as T;
    } catch (error) {
        console.error(`Error reading or parsing JSON at ${filePath}:`, error);
        return [] as unknown as T;
    }
}
