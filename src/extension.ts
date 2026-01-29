/**
 * Flutter Config Manager VS Code Extension
 * Entry point - handles extension activation and command registration
 */

import * as vscode from 'vscode';
import { setExtensionBaseUri } from './utils/file.js';
import { getUsedAndroidPermissions, getUsedIOSPermissions } from './utils/extractors.js';
import { createPermissionPanel } from './webview/index.js';
import { discoverProjectFilesWithContent } from './services/workspace.js';
import { FlutterConfigSidebarProvider } from './providers/sidebar.provider.js';

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

    // Register edit command
    const editDisposable = vscode.commands.registerCommand(
        'flutter-config-manager.edit',
        () => handleEditCommand(context)
    );

    // Register sidebar view provider
    const sidebarProvider = new FlutterConfigSidebarProvider(context.extensionUri);
    const sidebarDisposable = vscode.window.registerWebviewViewProvider(
        FlutterConfigSidebarProvider.viewType,
        sidebarProvider
    );

    context.subscriptions.push(editDisposable, sidebarDisposable);
}

/**
 * Handles the main edit command - opens the Flutter Config Manager panel
 */
async function handleEditCommand(context: vscode.ExtensionContext): Promise<void> {
    const files = await discoverProjectFilesWithContent();

    const [usedAndroidPermissions, usedIOSPermissions] = await Promise.all([
        getUsedAndroidPermissions(files.androidManifestContent ?? ''),
        getUsedIOSPermissions(files.iosPlistContent ?? '')
    ]);

    await createPermissionPanel(
        context.extensionUri,
        usedAndroidPermissions,
        usedIOSPermissions,
        files
    );

    vscode.window.showInformationMessage('Flutter Config Manager opened!');
}

/**
 * Extension deactivation - cleanup if needed
 */
export function deactivate(): void {
    // Cleanup resources if needed
}
