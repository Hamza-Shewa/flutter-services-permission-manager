/**
 * Webview panel creation and message handling
 */

import * as vscode from 'vscode';
import type { AndroidPermission, IOSPermission, IOSPermissionEntry, PermissionsPayload, WebviewMessage } from '../types/index.js';
import { getUsedAndroidPermissions, getUsedIOSPermissions, getAndroidPermissions, getIOSPermissions, getCategorizedIOSPermissions } from '../utils/extractors.js';
import { savePermissions } from '../services/index.js';
import { getWebviewContent } from './content.js';

// Cached categorized iOS permissions for Podfile updates
let categorizedIosPermissionsCache: Record<string, { permission: string; podfileMacro?: string }[]> | null = null;

/**
 * Creates and manages the Permission Manager webview panel
 */
export async function createPermissionPanel(
    extensionUri: vscode.Uri,
    androidPermissions: AndroidPermission[],
    iosPermissions: IOSPermission[],
    androidManifestUri?: vscode.Uri,
    iosPlistUri?: vscode.Uri,
    iosPodfileUri?: vscode.Uri
): Promise<vscode.WebviewPanel> {
    const panel = vscode.window.createWebviewPanel(
        'permissionManager',
        'Permission Manager',
        vscode.ViewColumn.One,
        {
            enableScripts: true,
            localResourceRoots: [vscode.Uri.joinPath(extensionUri, 'src')]
        }
    );

    panel.webview.html = await getWebviewContent(panel.webview, extensionUri);

    // Cache categorized permissions for Podfile updates
    categorizedIosPermissionsCache = await getCategorizedIOSPermissions();

    const payload: PermissionsPayload = {
        type: 'permissions',
        androidPermissions,
        iosPermissions,
        hasAndroidManifest: !!androidManifestUri,
        hasIOSPlist: !!iosPlistUri,
        hasPodfile: !!iosPodfileUri
    };

    setupMessageHandler(panel, payload, androidManifestUri, iosPlistUri, iosPodfileUri);
    
    // Send initial payload
    panel.webview.postMessage(payload);

    return panel;
}

/**
 * Sets up the message handler for webview communication
 */
function setupMessageHandler(
    panel: vscode.WebviewPanel,
    initialPayload: PermissionsPayload,
    androidManifestUri?: vscode.Uri,
    iosPlistUri?: vscode.Uri,
    iosPodfileUri?: vscode.Uri
): void {
    panel.webview.onDidReceiveMessage(async (message: WebviewMessage) => {
        switch (message.type) {
            case 'ready':
                panel.webview.postMessage(initialPayload);
                break;

            case 'refresh':
                await handleRefresh(panel, androidManifestUri, iosPlistUri, iosPodfileUri);
                break;

            case 'requestAllAndroidPermissions':
                await handleRequestAllAndroid(panel);
                break;

            case 'requestAllIOSPermissions':
                await handleRequestAllIOS(panel);
                break;

            case 'savePermissions':
                await handleSave(panel, message, androidManifestUri, iosPlistUri, iosPodfileUri);
                break;
        }
    });
}

async function handleRefresh(
    panel: vscode.WebviewPanel,
    androidManifestUri?: vscode.Uri,
    iosPlistUri?: vscode.Uri,
    iosPodfileUri?: vscode.Uri
): Promise<void> {
    const androidDoc = androidManifestUri
        ? await vscode.workspace.openTextDocument(androidManifestUri)
        : null;
    const iosDoc = iosPlistUri
        ? await vscode.workspace.openTextDocument(iosPlistUri)
        : null;

    const usedAndroidPermissions = await getUsedAndroidPermissions(androidDoc?.getText() || '');
    const usedIOSPermissions = await getUsedIOSPermissions(iosDoc?.getText() || '');

    panel.webview.postMessage({
        type: 'permissions',
        androidPermissions: usedAndroidPermissions,
        iosPermissions: usedIOSPermissions,
        hasAndroidManifest: !!androidManifestUri,
        hasIOSPlist: !!iosPlistUri,
        hasPodfile: !!iosPodfileUri
    });
}

async function handleRequestAllAndroid(panel: vscode.WebviewPanel): Promise<void> {
    const allAndroidPermissions = await getAndroidPermissions();
    panel.webview.postMessage({
        type: 'allAndroidPermissions',
        permissions: allAndroidPermissions
    });
}

async function handleRequestAllIOS(panel: vscode.WebviewPanel): Promise<void> {
    const allIOSPermissions = await getIOSPermissions();
    panel.webview.postMessage({
        type: 'allIOSPermissions',
        permissions: allIOSPermissions
    });
}

async function handleSave(
    panel: vscode.WebviewPanel,
    message: { androidPermissions: string[]; iosPermissions: IOSPermissionEntry[] },
    androidManifestUri?: vscode.Uri,
    iosPlistUri?: vscode.Uri,
    iosPodfileUri?: vscode.Uri
): Promise<void> {
    const androidList = Array.isArray(message.androidPermissions) ? message.androidPermissions : [];
    const iosList = Array.isArray(message.iosPermissions) ? message.iosPermissions : [];
    
    const result = await savePermissions(
        androidList, 
        iosList, 
        androidManifestUri, 
        iosPlistUri, 
        iosPodfileUri, 
        categorizedIosPermissionsCache || undefined
    );
    panel.webview.postMessage({ type: 'saveResult', ...result });
}
