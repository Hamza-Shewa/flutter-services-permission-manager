/**
 * Webview panel creation
 * Creates the Flutter Config Manager panel in the editor area
 */

import * as vscode from 'vscode';
import type { AndroidPermission, IOSPermission } from '../types/index.js';
import type { ProjectFiles } from '../services/workspace.js';
import { initializePermissionWebview } from './initializer.js';

/**
 * Creates and manages the Flutter Config Manager webview panel
 */
export async function createPermissionPanel(
    extensionUri: vscode.Uri,
    androidPermissions: AndroidPermission[],
    iosPermissions: IOSPermission[],
    files: ProjectFiles
): Promise<vscode.WebviewPanel> {
    const panel = vscode.window.createWebviewPanel(
        'flutterConfigManager',
        'Flutter Config Manager',
        vscode.ViewColumn.One,
        {
            enableScripts: true,
            localResourceRoots: [vscode.Uri.joinPath(extensionUri, 'src'), vscode.Uri.joinPath(extensionUri, 'images')],
            retainContextWhenHidden: true
        }
    );

    panel.iconPath = vscode.Uri.joinPath(extensionUri, 'images', 'flutter-config.png');

    await initializePermissionWebview(
        { type: 'panel', panel },
        extensionUri,
        androidPermissions,
        iosPermissions,
        files
    );

    return panel;
}
