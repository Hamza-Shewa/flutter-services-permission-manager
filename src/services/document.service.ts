/**
 * VS Code document manipulation service
 */

import * as vscode from 'vscode';
import type { IOSPermissionEntry, SaveResult } from '../types/index.js';
import { updateAndroidManifest } from './android-manifest.service.js';
import { updateIOSPlist } from './ios-plist.service.js';
import { updateIOSPodfile } from './ios-podfile.service.js';

/**
 * Replaces entire document content with new content
 */
export async function replaceDocumentContent(uri: vscode.Uri, content: string): Promise<void> {
    const document = await vscode.workspace.openTextDocument(uri);
    const lastLine = document.lineAt(document.lineCount - 1);
    const fullRange = new vscode.Range(0, 0, document.lineCount - 1, lastLine.text.length);
    
    const edit = new vscode.WorkspaceEdit();
    edit.replace(uri, fullRange, content);
    
    await vscode.workspace.applyEdit(edit);
    await document.save();
}

/**
 * Saves permissions to both Android and iOS platform files
 */
export async function savePermissions(
    androidPermissions: string[],
    iosPermissions: IOSPermissionEntry[],
    androidManifestUri?: vscode.Uri,
    iosPlistUri?: vscode.Uri,
    iosPodfileUri?: vscode.Uri,
    categorizedIosPermissions?: Record<string, { permission: string; podfileMacro?: string }[]>
): Promise<SaveResult> {
    try {
        if (!androidManifestUri && !iosPlistUri) {
            return {
                success: false,
                message: 'No AndroidManifest.xml or Info.plist was found to update.'
            };
        }

        if (androidManifestUri) {
            const doc = await vscode.workspace.openTextDocument(androidManifestUri);
            const updated = updateAndroidManifest(doc.getText(), androidPermissions);
            await replaceDocumentContent(androidManifestUri, updated);
        }

        if (iosPlistUri) {
            const doc = await vscode.workspace.openTextDocument(iosPlistUri);
            const updated = updateIOSPlist(doc.getText(), iosPermissions);
            await replaceDocumentContent(iosPlistUri, updated);
        }

        // Update Podfile if we have iOS permissions with macros
        if (iosPodfileUri && categorizedIosPermissions && iosPermissions.length > 0) {
            try {
                const podDoc = await vscode.workspace.openTextDocument(iosPodfileUri);
                const podEdit = await updateIOSPodfile(podDoc, iosPermissions, categorizedIosPermissions);
                if (podEdit) {
                    await vscode.workspace.applyEdit(podEdit);
                    await podDoc.save();
                }
            } catch (podError) {
                // Don't fail the entire save if Podfile update fails
                console.error('Podfile update error:', podError);
            }
        }

        return { success: true, message: 'Permissions saved successfully.' };
    } catch (error) {
        return { success: false, message: `Failed to save permissions: ${error}` };
    }
}
