import * as vscode from 'vscode';
import { execWithEnv, getFlutterCommand } from '../../core/utils/exec.js';
import { migrateAndroidSetup, migrateAndroid16kbSetup, type MigrationReport } from '../../features/migration/migration.service.js';
import { logger, toError, toErrorMessage } from '../../core/shared/index.js';
import type { WebviewRef } from './index.js';

function formatReport(report: MigrationReport): string {
    return [
        report.message,
        ...report.details.map((d) => `• ${d}`),
        ...report.warnings.map((w) => `⚠ ${w}`)
    ].join('\n');
}

export async function handleMigrateAndroid(ref: WebviewRef): Promise<void> {
    try {
        const report = await migrateAndroidSetup();
        ref.webview.postMessage({
            type: 'saveResult',
            success: true,
            message: formatReport(report),
            refresh: report.changed
        });
    } catch (error) {
        logger.error('Android migration error:', toError(error));
        ref.webview.postMessage({
            type: 'saveResult',
            success: false,
            message: `Failed to migrate Android setup: ${toErrorMessage(error)}`
        });
    }
}

export async function handleMigrateAndroid16kb(ref: WebviewRef): Promise<void> {
    try {
        const report = await migrateAndroid16kbSetup();
        ref.webview.postMessage({
            type: 'saveResult',
            success: true,
            message: formatReport(report),
            refresh: report.changed
        });
    } catch (error) {
        logger.error('16 KB page-size migration error:', toError(error));
        ref.webview.postMessage({
            type: 'saveResult',
            success: false,
            message: `Failed to enable 16 KB page size support: ${toErrorMessage(error)}`
        });
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
        ref.webview.postMessage({ type: 'saveResult', success: false, message: `Failed to upgrade packages: ${toErrorMessage(error)}` });
    }
}
