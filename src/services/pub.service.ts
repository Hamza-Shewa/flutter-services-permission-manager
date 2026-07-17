import * as vscode from 'vscode';
import { execWithEnv, getFlutterCommand, getDartCommand } from '../utils/exec.js';
import * as https from 'https';
import * as fs from 'fs';
import * as path from 'path';
import type { OutdatedPackage, DependencyValidationIssue } from '../types/webview.js';

export interface PubOutdatedResponse {
    packages: OutdatedPackage[];
}

export async function analyzePackages(): Promise<OutdatedPackage[]> {
    const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    if (!workspaceRoot) {
        throw new Error('No workspace root found');
    }

    return new Promise((resolve, reject) => {
        execWithEnv(`${getFlutterCommand()} pub outdated --json`, { cwd: workspaceRoot, maxBuffer: 1024 * 1024 * 10 }, (error, stdout, stderr) => {
            if (error && error.code !== 0 && stdout.trim() === '') {
                const errorMessage = error.message + stderr;
                if (errorMessage.includes('No pubspec.yaml file found')) {
                    return reject(new Error("the current project is not a flutter project or it doesn't have a pubspec.yaml file"));
                }
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
        execWithEnv(`${getFlutterCommand()} pub upgrade ${packageName}`, { cwd: workspaceRoot }, (error, stdout, stderr) => {
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
        execWithEnv(`${getFlutterCommand()} pub add ${packageName}`, { cwd: workspaceRoot }, (error, stdout, stderr) => {
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

export async function checkDependencyValidator(): Promise<boolean> {
    const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    if (!workspaceRoot) {return false;}

    try {
        const pubspecPath = path.join(workspaceRoot, 'pubspec.yaml');
        const content = await fs.promises.readFile(pubspecPath, 'utf-8');
        return content.includes('dependency_validator:');
    } catch {
        return false;
    }
}

export async function installDependencyValidator(): Promise<void> {
    const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    if (!workspaceRoot) {throw new Error('No workspace root found');}

    return new Promise((resolve, reject) => {
        execWithEnv(`${getFlutterCommand()} pub add dev:dependency_validator`, { cwd: workspaceRoot }, (error, stdout, stderr) => {
            if (error) {
                return reject(new Error(`Failed to install dependency_validator: ${error.message} - ${stderr}`));
            }
            resolve();
        });
    });
}

export async function runDependencyValidator(): Promise<DependencyValidationIssue[]> {
    const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    if (!workspaceRoot) {throw new Error('No workspace root found');}

    return new Promise((resolve, reject) => {
        execWithEnv(`${getDartCommand()} run dependency_validator`, { cwd: workspaceRoot }, (error, stdout, stderr) => {
            // Note: dependency_validator exits with code 1 if it finds unused dependencies,
            // so we ignore `error` and rely on stdout for parsing.
            const output = stdout.toString() + '\n' + stderr.toString();
            
            const issues: DependencyValidationIssue[] = [];
            
            const downgradeMatch = output.match(/should be downgraded to dev_dependencies:([\s\S]*?)(?=\n[A-Z]|$)/i);
            if (downgradeMatch) {
                const lines = downgradeMatch[1].split('\n');
                for (const line of lines) {
                    const pkg = line.trim().replace(/^\*\s*/, '').trim();
                    if (pkg) {issues.push({ package: pkg, issueType: 'downgrade' });}
                }
            }

            const mayBeUnusedMatch = output.match(/may be unused, or you may be using assets from these packages:([\s\S]*?)(?=\n[A-Z]|$)/i);
            if (mayBeUnusedMatch) {
                const lines = mayBeUnusedMatch[1].split('\n');
                for (const line of lines) {
                    const pkg = line.trim().replace(/^\*\s*/, '').trim();
                    if (pkg) {issues.push({ package: pkg, issueType: 'may_be_unused' });}
                }
            }

            const unusedMatch = output.match(/These packages are unused:([\s\S]*?)(?=\n[A-Z]|$)/i);
            if (unusedMatch) {
                const lines = unusedMatch[1].split('\n');
                for (const line of lines) {
                    const pkg = line.trim().replace(/^\*\s*/, '').trim();
                    if (pkg) {issues.push({ package: pkg, issueType: 'unused' });}
                }
            }

            resolve(issues);
        });
    });
}

export async function removePackage(packageName: string): Promise<void> {
    const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    if (!workspaceRoot) {throw new Error('No workspace root found');}

    return new Promise((resolve, reject) => {
        execWithEnv(`${getFlutterCommand()} pub remove ${packageName}`, { cwd: workspaceRoot }, (error, stdout, stderr) => {
            if (error) {
                return reject(new Error(`Failed to remove package ${packageName}: ${error.message} - ${stderr}`));
            }
            resolve();
        });
    });
}

export async function downgradePackage(packageName: string): Promise<void> {
    const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    if (!workspaceRoot) {throw new Error('No workspace root found');}

    return new Promise((resolve, reject) => {
        execWithEnv(`${getFlutterCommand()} pub add dev:${packageName}`, { cwd: workspaceRoot }, (error, stdout, stderr) => {
            if (error) {
                return reject(new Error(`Failed to downgrade package ${packageName}: ${error.message} - ${stderr}`));
            }
            resolve();
        });
    });
}
