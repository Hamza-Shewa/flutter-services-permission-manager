/**
 * Permission Manager VS Code Extension
 * Entry point - handles extension activation and command registration
 */

import * as vscode from 'vscode';
import { setExtensionBaseUri } from './utils/file.js';
import { getUsedAndroidPermissions, getUsedIOSPermissions } from './utils/extractors.js';
import { createPermissionPanel, initializePermissionWebviewView, getWebviewContent } from './webview/index.js';

// Re-export for backward compatibility and testing
export {
    updateAndroidManifest,
    updateIOSPlist,
    normalizePermissionNames,
    normalizePlistSpacing
} from './services/index.js';

export {
    flattenAndroidPermissions,
    flattenIOSPermissions
} from './utils/extractors.js';

export { getExtensionBaseUri as extensionBaseUri } from './utils/file.js';

/**
 * Extension activation - called when extension is first used
 */
export function activate(context: vscode.ExtensionContext): void {
    setExtensionBaseUri(context.extensionUri);

    const editDisposable = vscode.commands.registerCommand(
        'permission-manager.edit',
        () => handleEditCommand(context)
    );

    // Register the sidebar view provider
    const sidebarProvider = new PermissionManagerSidebarProvider(context.extensionUri);
    context.subscriptions.push(
        vscode.window.registerWebviewViewProvider('permissionManagerView', sidebarProvider)
    );

    context.subscriptions.push(editDisposable);
}

class PermissionManagerSidebarProvider implements vscode.WebviewViewProvider {
    private _extensionUri: vscode.Uri;
    private _view?: vscode.WebviewView;

    constructor(extensionUri: vscode.Uri) {
        this._extensionUri = extensionUri;
    }

    public async resolveWebviewView(
        webviewView: vscode.WebviewView,
        context: vscode.WebviewViewResolveContext,
        token: vscode.CancellationToken
    ) {
        this._view = webviewView;
        webviewView.webview.options = {
            enableScripts: true,
            localResourceRoots: [vscode.Uri.joinPath(this._extensionUri, 'src')],
        };
        // Find platform-specific files
        const androidManifestUris = await vscode.workspace.findFiles(
            '**/app/src/main/AndroidManifest.xml',
            undefined,
            1
        );
        const iosPlistUris = await vscode.workspace.findFiles(
            '**/Runner/Info.plist',
            undefined,
            1
        );
        const iosPodfileUris = await vscode.workspace.findFiles(
            '**/ios/Podfile',
            undefined,
            1
        );
        const iosAppDelegateUris = await vscode.workspace.findFiles(
            '**/Runner/AppDelegate.swift',
            undefined,
            1
        );
        // Read file contents
        const androidDoc = androidManifestUris.length > 0
            ? await vscode.workspace.openTextDocument(androidManifestUris[0])
            : null;
        const iosDoc = iosPlistUris.length > 0
            ? await vscode.workspace.openTextDocument(iosPlistUris[0])
            : null;
        // Extract current permissions
        const usedAndroidPermissions = await getUsedAndroidPermissions(androidDoc?.getText() || '');
        const usedIOSPermissions = await getUsedIOSPermissions(iosDoc?.getText() || '');
        // Render the webview content into the sidebar view
        await initializePermissionWebviewView(
            webviewView,
            this._extensionUri,
            usedAndroidPermissions,
            usedIOSPermissions,
            androidManifestUris[0],
            iosPlistUris[0],
            iosPodfileUris[0],
            iosAppDelegateUris[0]
        );
    }
}


/**
 * Handles the main edit command - opens the Permission Manager panel
 */
async function handleEditCommand(context: vscode.ExtensionContext): Promise<void> {
    // Find platform-specific files
    const androidManifestUris = await vscode.workspace.findFiles(
        '**/app/src/main/AndroidManifest.xml',
        undefined,
        1
    );
    const iosPlistUris = await vscode.workspace.findFiles(
        '**/Runner/Info.plist',
        undefined,
        1
    );
    const iosPodfileUris = await vscode.workspace.findFiles(
        '**/ios/Podfile',
        undefined,
        1
    );
    const iosAppDelegateUris = await vscode.workspace.findFiles(
        '**/Runner/AppDelegate.swift',
        undefined,
        1
    );

    // Read file contents
    const androidDoc = androidManifestUris.length > 0
        ? await vscode.workspace.openTextDocument(androidManifestUris[0])
        : null;
    const iosDoc = iosPlistUris.length > 0
        ? await vscode.workspace.openTextDocument(iosPlistUris[0])
        : null;

    // Extract current permissions
    const usedAndroidPermissions = await getUsedAndroidPermissions(androidDoc?.getText() || '');
    const usedIOSPermissions = await getUsedIOSPermissions(iosDoc?.getText() || '');

    // Create the webview panel
    await createPermissionPanel(
        context.extensionUri,
        usedAndroidPermissions,
        usedIOSPermissions,
        androidManifestUris[0],
        iosPlistUris[0],
        iosPodfileUris[0],
        iosAppDelegateUris[0]
    );

    vscode.window.showInformationMessage('Edit command executed from Permission Manager!');
}

/**
 * Extension deactivation - cleanup if needed
 */
export function deactivate(): void {
    // Cleanup resources if needed
}
