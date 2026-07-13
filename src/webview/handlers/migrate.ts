import * as vscode from 'vscode';
import { execWithEnv, getFlutterCommand } from '../../utils/exec.js';
import { migrateAndroidSetup } from '../../services/android/index.js';
import type { WebviewRef } from './index.js';

export async function handleMigrateAndroid(ref: WebviewRef): Promise<void> {
    try {
        await migrateAndroidSetup();
        ref.webview.postMessage({ type: 'saveResult', success: true, message: "Android setup successfully migrated to declarative plugins!" });
    } catch (error) {
        console.error('Migration error:', error);
        ref.webview.postMessage({ type: 'saveResult', success: false, message: `Failed to migrate Android setup: ${error instanceof Error ? error.message : String(error)}` });
    }
}

export async function handleUpgradePackages(ref: WebviewRef): Promise<void> {
    try {
        const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
        if (!workspaceRoot) {
            throw new Error('No workspace root found');
        }

        // Send an initial status indicating it's running
        ref.webview.postMessage({ type: 'saveResult', success: true, message: "Upgrading Flutter packages... Please wait." });

        execWithEnv(`${getFlutterCommand()} pub upgrade`, { cwd: workspaceRoot }, (error, stdout, stderr) => {
            if (error) {
                console.error('Flutter pub upgrade error:', error);
                console.error('stderr:', stderr);
                ref.webview.postMessage({ type: 'saveResult', success: false, message: `Failed to upgrade packages: ${error.message}` });
                return;
            }

            console.log('Flutter pub upgrade stdout:', stdout);
            ref.webview.postMessage({ type: 'saveResult', success: true, message: "Flutter packages upgraded successfully!" });
        });
    } catch (error) {
        console.error('Upgrade packages error:', error);
        ref.webview.postMessage({ type: 'saveResult', success: false, message: `Failed to upgrade packages: ${error instanceof Error ? error.message : String(error)}` });
    }
}
