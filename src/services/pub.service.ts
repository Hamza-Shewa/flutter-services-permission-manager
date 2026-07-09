import { exec } from 'child_process';
import * as vscode from 'vscode';
import * as https from 'https';
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

export async function addPackage(packageName: string): Promise<void> {
    const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    if (!workspaceRoot) {
        throw new Error('No workspace root found');
    }

    return new Promise((resolve, reject) => {
        exec(`flutter pub add ${packageName}`, { cwd: workspaceRoot }, (error, stdout, stderr) => {
            if (error) {
                return reject(new Error(`Failed to add package ${packageName}: ${error.message} - ${stderr}`));
            }
            resolve();
        });
    });
}

export async function searchPackages(query: string): Promise<string[]> {
    return new Promise((resolve, reject) => {
        const url = `https://pub.dev/api/search?q=${encodeURIComponent(query)}`;
        https.get(url, (res) => {
            let data = '';
            res.on('data', (chunk) => { data += chunk; });
            res.on('end', () => {
                try {
                    const parsed = JSON.parse(data);
                    if (parsed && Array.isArray(parsed.packages)) {
                        const results = parsed.packages.map((p: any) => p.package).filter(Boolean);
                        resolve(results.slice(0, 10)); // return top 10
                    } else {
                        resolve([]);
                    }
                } catch (e) {
                    reject(new Error('Failed to parse search results'));
                }
            });
        }).on('error', (err) => {
            reject(err);
        });
    });
}

export async function getPackageDetails(packageName: string): Promise<{ description?: string; latestVersion?: string }> {
    return new Promise((resolve, reject) => {
        const url = `https://pub.dev/api/packages/${encodeURIComponent(packageName)}`;
        https.get(url, (res) => {
            if (res.statusCode === 404) {
                return reject(new Error('Package not found'));
            }
            let data = '';
            res.on('data', (chunk) => { data += chunk; });
            res.on('end', () => {
                try {
                    const parsed = JSON.parse(data);
                    if (parsed && parsed.latest) {
                        resolve({
                            latestVersion: parsed.latest.version,
                            description: parsed.latest.pubspec?.description
                        });
                    } else {
                        reject(new Error('Invalid package details format'));
                    }
                } catch (e) {
                    reject(new Error('Failed to parse package details'));
                }
            });
        }).on('error', (err) => {
            reject(err);
        });
    });
}
