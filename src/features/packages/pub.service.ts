import * as vscode from 'vscode';
import { runDart, runFlutter } from '../../core/utils/exec.js';
import { ProcessError } from '../../core/utils/process.js';
import { toErrorMessage } from '../../core/shared/index.js';
import * as https from 'https';
import * as net from 'net';
import * as fs from 'fs';
import * as path from 'path';
import type { OutdatedPackage, DependencyValidationIssue } from '../../core/types/webview.js';

export interface PubOutdatedResponse {
    packages: OutdatedPackage[];
}

/**
 * Patterns that indicate a git/network connectivity problem while resolving
 * packages. This commonly happens with locally hosted dependencies that are
 * only reachable over a VPN (e.g. `http://10.10.20.51/...`).
 */
const NETWORK_ERROR_PATTERNS: RegExp[] = [
    /Git error/i,
    /Failed to update packages/i,
    /unable to access/i,
    /Failed to connect to /i,
    /Couldn't connect to server/i,
    /Cannot connect to the host/i,
    /Connection refused/i,
    /socket hang up/i,
    /ECONNREFUSED/i,
    /ECONNRESET/i,
    /ENOTFOUND/i,
    /ETIMEDOUT/i,
    /EAI_AGAIN/i
];

export function isNetworkError(message: string): boolean {
    return NETWORK_ERROR_PATTERNS.some((pattern) => pattern.test(message));
}

/**
 * Extracts the first reachable URL from an error message so the user knows
 * exactly which package server is unreachable, e.g. `http://10.10.20.51/...`.
 */
function extractUnreachableUrl(message: string): string | undefined {
    const match = message.match(/https?:\/\/[^\s'"`]+/i);
    return match ? match[0] : undefined;
}

/** Safety net so `pub` commands never hang forever (e.g. unreachable git host). */
const PUB_COMMAND_TIMEOUT = 120_000;

/** pub.dev package names: lower-case letters, digits and underscores, starting with a letter. */
const PACKAGE_NAME = /^[a-z][a-z0-9_]{0,63}$/;

/**
 * Package names arrive from pubspec.yaml (repo-controlled) and from the webview, and end up as a `pub`
 * argument. Anything outside the pub.dev naming rules is rejected before a process is started.
 */
export function assertValidPackageName(name: unknown): string {
    if (typeof name !== 'string' || !PACKAGE_NAME.test(name)) {
        throw new Error(`"${String(name).slice(0, 60)}" is not a valid pub package name (lower-case letters, digits and underscores only).`);
    }
    return name;
}

/** Runs `flutter pub <args>` in the workspace and turns a failure into the friendly VPN/network message when it applies. */
async function runPub(args: string[], workspaceRoot: string, failure: string): Promise<void> {
    try {
        await runFlutter(['pub', ...args], { cwd: workspaceRoot, timeoutMs: PUB_COMMAND_TIMEOUT });
    } catch (error) {
        const detail = error instanceof ProcessError ? `${error.message} - ${error.stderr}` : toErrorMessage(error);
        throw friendlyCommandError(`${failure}: ${detail}`, workspaceRoot);
    }
}

function requireWorkspaceRoot(): string {
    const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    if (!workspaceRoot) {
        throw new Error('No workspace root found');
    }
    return workspaceRoot;
}

/**
 * Converts a command failure into a clear, actionable error. When the failure
 * is a git/network connectivity problem (e.g. locally hosted packages only
 * reachable over a VPN), the raw pub/git dump is replaced with a friendly
 * message that tells the user to connect to their VPN.
 */
function friendlyCommandError(fullMessage: string, workspaceRoot?: string): Error {
    if (isNetworkError(fullMessage)) {
        const url = extractUnreachableUrl(fullMessage);
        const name = url && workspaceRoot ? findGitPackageName(workspaceRoot, url) : undefined;
        const hint = name
            ? `Package "${name}" requires VPN access.`
            : url
                ? `A git-hosted dependency is unreachable.\nUnreachable package server: ${url}`
                : `A git-hosted dependency is unreachable.`;
        return new Error(
            hint +
            `\nThis usually means the package is only accessible over a VPN.` +
            `\nConnect to your VPN and try again.`
        );
    }
    return new Error(fullMessage);
}

function lineIndent(line: string): number {
    const match = line.match(/^[ \t]*/);
    return match ? match[0].length : 0;
}

interface GitDependency {
    /** Pubspec dependency name, e.g. `mitf_ocr` */
    name?: string;
    /** Git repository URL */
    url: string;
}

/**
 * Extract git-hosted dependencies (name + URL) declared in a pubspec.yaml.
 * These are the hosts that `pub` will try to fetch; when unreachable (e.g. the
 * VPN is off), every pub command hangs for ~75s per host before failing.
 */
function extractGitDependencies(pubspecText: string): GitDependency[] {
    const deps: GitDependency[] = [];
    const lines = pubspecText.split('\n');

    for (let i = 0; i < lines.length; i++) {
        if (!/^\s*git:\s*$/.test(lines[i])) {
            continue;
        }
        const gitIndent = lineIndent(lines[i]);

        // Find the dependency name: nearest `key:` line above `git:` with
        // smaller indentation (e.g. `  mitf_ocr:` then `    git:`).
        let name: string | undefined;
        for (let k = i - 1; k >= 0; k--) {
            const prev = lines[k];
            if (prev.trim() === '' || prev.trim().startsWith('#')) {
                continue;
            }
            if (lineIndent(prev) >= gitIndent) {
                continue;
            }
            const match = prev.match(/^\s*([A-Za-z0-9_]+):\s*$/);
            if (match) {
                name = match[1];
            }
            break;
        }

        // Find the `url:` under this git block.
        for (let j = i + 1; j < Math.min(lines.length, i + 8); j++) {
            const line = lines[j];
            if (line.trim() === '') {
                continue;
            }
            if (lineIndent(line) <= gitIndent) {
                break;
            }
            const match = line.match(/^\s*url:\s*(.+?)\s*$/);
            if (match) {
                const url = match[1].trim().replace(/^['"]|['"]$/g, '');
                if (url) {
                    deps.push({ name, url });
                }
                break;
            }
        }
    }

    const seen = new Set<string>();
    return deps.filter((d) => {
        if (seen.has(d.url)) {
            return false;
        }
        seen.add(d.url);
        return true;
    });
}

/**
 * Looks up the pubspec dependency name for a given git URL (if known).
 */
function findGitPackageName(workspaceRoot: string, url: string): string | undefined {
    try {
        const text = fs.readFileSync(path.join(workspaceRoot, 'pubspec.yaml'), 'utf8');
        return extractGitDependencies(text).find((d) => d.url === url)?.name;
    } catch {
        return undefined;
    }
}

/**
 * Builds a friendly message for unreachable git-hosted packages, naming the
 * packages that require VPN access.
 */
function buildUnreachableMessage(unreachable: GitDependency[]): string {
    if (unreachable.length === 1 && unreachable[0].name) {
        const dep = unreachable[0];
        return (
            `Package "${dep.name}" requires VPN access.` +
            `\nIts git repository (${dep.url}) is currently unreachable.` +
            `\nConnect to your VPN and try again.`
        );
    }
    const details = unreachable.map((d) =>
        d.name ? `  • ${d.name} (${d.url})` : `  • ${d.url}`
    );
    return (
        `The following packages require VPN access and are currently unreachable:\n` +
        details.join('\n') +
        `\nConnect to your VPN and try again.`
    );
}

/**
 * Quickly checks whether a git package host is reachable over TCP. A short
 * socket timeout is used so an unreachable (e.g. VPN-only) host fails fast
 * instead of blocking on the OS connect timeout (~75s).
 */
function checkHostReachable(url: string, timeoutMs = 2000): Promise<boolean> {
    return new Promise((resolve) => {
        let host: string;
        let port: number;
        try {
            const parsed = new URL(url);
            if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
                resolve(true); // ssh/file deps - can't TCP-check, don't block
                return;
            }
            host = parsed.hostname;
            port = parsed.port
                ? parseInt(parsed.port, 10)
                : (parsed.protocol === 'https:' ? 443 : 80);
        } catch {
            resolve(true);
            return;
        }

        const socket = new net.Socket();
        let settled = false;
        const done = (ok: boolean): void => {
            if (settled) { return; }
            settled = true;
            socket.destroy();
            resolve(ok);
        };
        socket.setTimeout(timeoutMs);
        socket.once('connect', () => done(true));
        socket.once('timeout', () => done(false));
        socket.once('error', () => done(false));
        socket.connect(port, host);
    });
}

/**
 * Throws a friendly, actionable error when a git-hosted dependency's server is
 * unreachable (e.g. locally hosted packages only accessible over a VPN). Call
 * this before any `pub` command so the extension fails fast instead of hanging.
 */
export async function assertPackageHostsReachable(workspaceRoot: string): Promise<void> {
    let pubspecText: string;
    try {
        pubspecText = await fs.promises.readFile(path.join(workspaceRoot, 'pubspec.yaml'), 'utf8');
    } catch {
        return; // no pubspec - let the actual command produce the real error
    }

    const gitDeps = extractGitDependencies(pubspecText);
    if (gitDeps.length === 0) {
        return;
    }

    const results = await Promise.all(
        gitDeps.map(async (dep) => ({ ...dep, ok: await checkHostReachable(dep.url) }))
    );
    const unreachable = results.filter((r) => !r.ok);
    if (unreachable.length > 0) {
        throw new Error(buildUnreachableMessage(unreachable));
    }
}

async function runPubOutdated(workspaceRoot: string): Promise<OutdatedPackage[]> {
    let stdout: string;
    try {
        ({ stdout } = await runFlutter(['pub', 'outdated', '--json'], {
            cwd: workspaceRoot,
            maxBuffer: 1024 * 1024 * 10,
            timeoutMs: PUB_COMMAND_TIMEOUT,
        }));
    } catch (error) {
        // `pub outdated` can exit non-zero yet still print usable JSON.
        if (error instanceof ProcessError && error.stdout.trim() !== '') {
            stdout = error.stdout;
        } else {
            const errorMessage = error instanceof ProcessError ? error.message + error.stderr : toErrorMessage(error);
            if (errorMessage.includes('No pubspec.yaml file found')) {
                throw new Error("the current project is not a flutter project or it doesn't have a pubspec.yaml file");
            }
            throw new Error(errorMessage);
        }
    }

    try {
        const result = JSON.parse(stdout) as PubOutdatedResponse;
        return result.packages || [];
    } catch (parseError) {
        throw new Error(`Failed to parse pub outdated JSON output: ${toErrorMessage(parseError)}`);
    }
}

export async function analyzePackages(): Promise<OutdatedPackage[]> {
    const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    if (!workspaceRoot) {
        throw new Error('No workspace root found');
    }

    // Fail fast (instead of hanging ~75s) when a git package host is unreachable.
    await assertPackageHostsReachable(workspaceRoot);

    try {
        return await runPubOutdated(workspaceRoot);
    } catch (error) {
        const errorMessage = toErrorMessage(error);

        if (errorMessage.includes('No pubspec.yaml file found')) {
            throw new Error("the current project is not a flutter project or it doesn't have a pubspec.yaml file");
        }

        // A git-hosted dependency could not be reached (e.g. locally hosted
        // packages that are only accessible over a VPN). Surface a clear,
        // actionable message instead of the raw git/pub error dump.
        if (isNetworkError(errorMessage)) {
            const url = extractUnreachableUrl(errorMessage);
            const name = url ? findGitPackageName(workspaceRoot, url) : undefined;
            const hint = name
                ? `Package "${name}" requires VPN access.`
                : url
                    ? `a git-hosted dependency is unreachable.\nUnreachable package server: ${url}`
                    : `a git-hosted dependency is unreachable.`;
            throw new Error(
                `Could not analyze packages: ${hint}` +
                `\nThis usually means the package is only accessible over a VPN.` +
                `\nConnect to your VPN and try again.`
            );
        }

        throw new Error(`Failed to analyze packages: ${errorMessage}`);
    }
}

export interface UpgradeOptions {
    /**
     * Also move past the version range in pubspec.yaml (`pub upgrade --major-versions`). A plain `pub upgrade <pkg>`
     * stays inside the existing constraint, so it cannot reach a new major version.
     */
    major?: boolean;
}

export async function upgradePackage(packageName: string, options: UpgradeOptions = {}): Promise<void> {
    const name = assertValidPackageName(packageName);
    const workspaceRoot = requireWorkspaceRoot();
    await assertPackageHostsReachable(workspaceRoot);
    await runPub(
        ['upgrade', ...(options.major ? ['--major-versions'] : []), name],
        workspaceRoot,
        `Failed to upgrade package ${name}`,
    );
}

export async function addPackage(packageName: string): Promise<void> {
    const name = assertValidPackageName(packageName);
    const workspaceRoot = requireWorkspaceRoot();
    await assertPackageHostsReachable(workspaceRoot);
    await runPub(['add', name], workspaceRoot, `Failed to add package ${name}`);
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
    if (!workspaceRoot) { return false; }

    try {
        const pubspecPath = path.join(workspaceRoot, 'pubspec.yaml');
        const content = await fs.promises.readFile(pubspecPath, 'utf-8');
        return content.includes('dependency_validator:');
    } catch {
        return false;
    }
}

export async function installDependencyValidator(): Promise<void> {
    const workspaceRoot = requireWorkspaceRoot();
    await assertPackageHostsReachable(workspaceRoot);
    await runPub(['add', 'dev:dependency_validator'], workspaceRoot, 'Failed to install dependency_validator');
}

export async function runDependencyValidator(): Promise<DependencyValidationIssue[]> {
    const workspaceRoot = requireWorkspaceRoot();

    // dependency_validator exits with code 1 when it finds unused dependencies, so a non-zero exit is expected:
    // the report is parsed from whatever it printed.
    let output: string;
    try {
        const result = await runDart(['run', 'dependency_validator'], { cwd: workspaceRoot, timeoutMs: PUB_COMMAND_TIMEOUT });
        output = `${result.stdout}\n${result.stderr}`;
    } catch (error) {
        if (!(error instanceof ProcessError)) {
            throw error;
        }
        output = `${error.stdout}\n${error.stderr}`;
    }

    const issues: DependencyValidationIssue[] = [];
    const collect = (pattern: RegExp, issueType: DependencyValidationIssue['issueType']): void => {
        const match = output.match(pattern);
        if (!match) { return; }
        for (const line of match[1].split('\n')) {
            const pkg = line.trim().replace(/^\*\s*/, '').trim();
            if (pkg) { issues.push({ package: pkg, issueType }); }
        }
    };
    collect(/should be downgraded to dev_dependencies:([\s\S]*?)(?=\n[A-Z]|$)/i, 'downgrade');
    collect(/may be unused, or you may be using assets from these packages:([\s\S]*?)(?=\n[A-Z]|$)/i, 'may_be_unused');
    collect(/These packages are unused:([\s\S]*?)(?=\n[A-Z]|$)/i, 'unused');
    return issues;
}

export async function removePackage(packageName: string): Promise<void> {
    const name = assertValidPackageName(packageName);
    const workspaceRoot = requireWorkspaceRoot();
    await assertPackageHostsReachable(workspaceRoot);
    await runPub(['remove', name], workspaceRoot, `Failed to remove package ${name}`);
}

export async function downgradePackage(packageName: string): Promise<void> {
    const name = assertValidPackageName(packageName);
    const workspaceRoot = requireWorkspaceRoot();
    await assertPackageHostsReachable(workspaceRoot);
    await runPub(['add', `dev:${name}`], workspaceRoot, `Failed to downgrade package ${name}`);
}
