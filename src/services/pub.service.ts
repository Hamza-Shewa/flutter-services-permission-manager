import { exec } from 'child_process';
import * as vscode from 'vscode';
import type { OutdatedPackage } from '../types/webview.js';

export interface PubOutdatedResponse {
    packages: OutdatedPackage[];
}

export async function analyzePackages(): Promise<OutdatedPackage[]> {
    const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    if (!workspaceRoot) {
        throw new Error('No workspace root found');
    }

    return new Promise((resolve, reject) => {
        exec('flutter pub outdated --json', { cwd: workspaceRoot, maxBuffer: 1024 * 1024 * 10 }, (error, stdout, stderr) => {
            if (error && error.code !== 0 && stdout.trim() === '') {
                return reject(new Error(`Failed to analyze packages: ${error.message} - ${stderr}`));
            }

            try {
                const result = JSON.parse(stdout) as PubOutdatedResponse;
                resolve(result.packages || []);
            } catch (parseError) {
                reject(new Error(`Failed to parse pub outdated JSON output: ${parseError instanceof Error ? parseError.message : String(parseError)}`));
            }
        });
    });
}

export async function upgradePackage(packageName: string): Promise<void> {
    const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    if (!workspaceRoot) {
        throw new Error('No workspace root found');
    }

    return new Promise((resolve, reject) => {
        exec(`flutter pub upgrade ${packageName}`, { cwd: workspaceRoot }, (error, stdout, stderr) => {
            if (error) {
                return reject(new Error(`Failed to upgrade package ${packageName}: ${error.message} - ${stderr}`));
            }
            resolve();
        });
    });
}
