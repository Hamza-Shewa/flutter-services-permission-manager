/**
 * VS Code document manipulation service
 */

import * as vscode from 'vscode';
import type { IOSPermissionEntry, SaveResult, ServiceEntry, ServiceConfig } from '../types/index.js';
import { updateAndroidManifest, updateAndroidManifestWithServices, removeServicesFromAndroidManifest } from './android-manifest.service.js';
import { updateIOSPlist, updateIOSPlistWithServices, removeServicesFromIOSPlist } from './ios-plist.service.js';
import { updateIOSPodfile } from './ios-podfile.service.js';
import { updateAppDelegateWithServices, removeServicesFromAppDelegate } from './ios-appdelegate.service.js';
import { getOrCreateStringsFile, updateAndroidStringsWithServices, removeServicesFromAndroidStrings } from './android-strings.service.js';

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
    iosAppDelegateUri?: vscode.Uri,
    categorizedIosPermissions?: Record<string, { permission: string; podfileMacro?: string }[]>,
    services?: ServiceEntry[],
    servicesConfig?: ServiceConfig[],
    previousServices?: ServiceEntry[]
): Promise<SaveResult> {
    try {
        if (!androidManifestUri && !iosPlistUri) {
            return {
                success: false,
                message: 'No AndroidManifest.xml or Info.plist was found to update.'
            };
        }

        // Determine which services were removed
        const currentServiceIds = new Set((services || []).map(s => s.id));
        const removedServiceIds = (previousServices || [])
            .filter(s => !currentServiceIds.has(s.id))
            .map(s => s.id);

        if (androidManifestUri) {
            const doc = await vscode.workspace.openTextDocument(androidManifestUri);
            let updated = updateAndroidManifest(doc.getText(), androidPermissions);
            
            // Remove services that were deleted
            if (removedServiceIds.length > 0 && servicesConfig) {
                updated = removeServicesFromAndroidManifest(updated, removedServiceIds, servicesConfig);
            }
            
            // Apply services if any
            if (services && services.length > 0 && servicesConfig) {
                updated = updateAndroidManifestWithServices(updated, services, servicesConfig);
            }
            
            // Handle strings.xml
            const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
            if (workspaceFolder && servicesConfig) {
                const stringsUri = await getOrCreateStringsFile(workspaceFolder.uri);
                if (stringsUri) {
                    try {
                        const stringsDoc = await vscode.workspace.openTextDocument(stringsUri);
                        let updatedStrings = stringsDoc.getText();
                        
                        // Remove strings from deleted services
                        if (removedServiceIds.length > 0) {
                            updatedStrings = removeServicesFromAndroidStrings(updatedStrings, removedServiceIds, servicesConfig);
                        }
                        
                        // Add/update strings from current services
                        if (services && services.length > 0) {
                            updatedStrings = updateAndroidStringsWithServices(updatedStrings, services, servicesConfig);
                        }
                        
                        if (updatedStrings !== stringsDoc.getText()) {
                            await replaceDocumentContent(stringsUri, updatedStrings);
                        }
                    } catch (stringsError) {
                        console.error('strings.xml update error:', stringsError);
                    }
                }
            }
            
            await replaceDocumentContent(androidManifestUri, updated);
        }

        if (iosPlistUri) {
            const doc = await vscode.workspace.openTextDocument(iosPlistUri);
            let updated = updateIOSPlist(doc.getText(), iosPermissions);
            
            // Remove services that were deleted
            if (removedServiceIds.length > 0 && servicesConfig) {
                updated = removeServicesFromIOSPlist(updated, removedServiceIds, servicesConfig);
            }
            
            // Apply services if any
            if (services && services.length > 0 && servicesConfig) {
                updated = updateIOSPlistWithServices(updated, services, servicesConfig);
            }
            
            await replaceDocumentContent(iosPlistUri, updated);
        }

        // Update AppDelegate.swift for services that require it (e.g., Google Maps)
        if (iosAppDelegateUri && servicesConfig) {
            try {
                const appDelegateDoc = await vscode.workspace.openTextDocument(iosAppDelegateUri);
                let updated = appDelegateDoc.getText();
                
                // Remove services that were deleted
                if (removedServiceIds.length > 0) {
                    updated = removeServicesFromAppDelegate(updated, removedServiceIds, servicesConfig);
                }
                
                // Apply services if any
                if (services && services.length > 0) {
                    updated = updateAppDelegateWithServices(updated, services, servicesConfig);
                }
                
                if (updated !== appDelegateDoc.getText()) {
                    await replaceDocumentContent(iosAppDelegateUri, updated);
                }
            } catch (appDelegateError) {
                console.error('AppDelegate update error:', appDelegateError);
            }
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
