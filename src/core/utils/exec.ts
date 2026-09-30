import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';
import { findFlutterExecutable, findOnPath } from '../shared/flutter-locator.js';
import { logger } from '../shared/logging.js';
import { ProcessError, runProcess, type ProcessResult } from './process.js';

/** Directories Flutter and Dart tooling commonly live in, appended after the inherited PATH on macOS/Linux. */
export function getExecEnv(): NodeJS.ProcessEnv {
    const env = { ...process.env };
    if (os.platform() === 'darwin' || os.platform() === 'linux') {
        const home = process.env.HOME || '';
        const extraPaths = [
            '/usr/local/bin',
            '/opt/homebrew/bin',
            '/opt/local/bin',
            home ? `${home}/development/flutter/bin` : '',
            home ? `${home}/flutter/bin` : '',
            home ? `${home}/.pub-cache/bin` : ''
        ].filter(Boolean);

        const currentPath = env.PATH || '';
        env.PATH = [currentPath, ...extraPaths].filter(Boolean).join(path.delimiter);
    }
    return env;
}

/**
 * Expands a leading `~` in a configured SDK path to the user's home directory.
 * Values like `~/devtools/flutter` are commonly used in `dart.flutterSdkPath`
 * / `dart.sdkPath`, but nothing else expands `~` for us.
 */
export function resolveSdkPath(sdkPath: string | undefined): string | undefined {
    if (!sdkPath) { return undefined; }
    if (sdkPath === '~') { return os.homedir(); }
    if (sdkPath.startsWith('~/') || sdkPath.startsWith('~\\')) { return path.join(os.homedir(), sdkPath.slice(2)); }
    return sdkPath;
}

export type ToolSource = 'setting' | 'discovered';

export interface ResolvedTool {
    executable: string;
    source: ToolSource;
    /** Configured locations that were ignored because nothing runnable exists there. */
    skipped: string[];
}

export class ToolNotFoundError extends Error {
    constructor(tool: string, skipped: string[], checked: string) {
        super(
            `${tool} was not found. ` +
            (skipped.length > 0 ? `Ignored: ${skipped.join('; ')}. ` : '') +
            `Also checked ${checked}. ` +
            `Set "dart.flutterSdkPath" to an SDK folder that exists, or add ${tool} to your PATH.`
        );
        this.name = 'ToolNotFoundError';
    }
}

function isFile(candidate: string): boolean {
    try {
        return fs.statSync(candidate).isFile();
    } catch {
        return false;
    }
}

function workspaceRoot(): string | undefined {
    return vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
}

/** A configured SDK folder: `~` expanded, and relative paths (for example FVM's `.fvm/flutter_sdk`) resolved against the workspace. */
function configuredSdkDirectory(value: string | undefined): string | undefined {
    const expanded = resolveSdkPath(value?.trim() || undefined);
    if (!expanded) { return undefined; }
    if (path.isAbsolute(expanded)) { return expanded; }
    const root = workspaceRoot();
    return root ? path.join(root, expanded) : undefined;
}

/**
 * The Flutter executable to run. A configured `dart.flutterSdkPath` only counts when it really contains
 * flutter - a workspace setting copied from another machine (`~/devtools/flutter`) otherwise made every
 * `pub` command fail with "The system cannot find the path specified".
 */
export function resolveFlutter(): ResolvedTool {
    const exe = os.platform() === 'win32' ? 'flutter.bat' : 'flutter';
    const skipped: string[] = [];
    const setting = vscode.workspace.getConfiguration('dart').get<string>('flutterSdkPath');
    const directory = configuredSdkDirectory(setting);
    if (directory) {
        const candidate = path.join(directory, 'bin', exe);
        if (isFile(candidate)) {
            return { executable: candidate, source: 'setting', skipped };
        }
        skipped.push(`dart.flutterSdkPath = "${setting}" (no ${exe} in ${path.join(directory, 'bin')})`);
        logger.warn(`dart.flutterSdkPath points to a missing SDK, searching elsewhere: ${directory}`);
    }
    const discovered = findFlutterExecutable({ projectRoot: workspaceRoot() });
    if (discovered) {
        return { executable: discovered, source: 'discovered', skipped };
    }
    throw new ToolNotFoundError('Flutter', skipped, 'FLUTTER_ROOT, .fvm, android/local.properties and PATH');
}

/** The Dart executable: `dart.sdkPath`, else the `dart` inside the Flutter SDK, else PATH. */
export function resolveDart(): ResolvedTool {
    const exe = os.platform() === 'win32' ? 'dart.bat' : 'dart';
    const skipped: string[] = [];
    const setting = vscode.workspace.getConfiguration('dart').get<string>('sdkPath');
    const directory = configuredSdkDirectory(setting);
    if (directory) {
        const candidate = path.join(directory, 'bin', exe);
        if (isFile(candidate)) {
            return { executable: candidate, source: 'setting', skipped };
        }
        skipped.push(`dart.sdkPath = "${setting}" (no ${exe} in ${path.join(directory, 'bin')})`);
    }
    try {
        const flutter = resolveFlutter();
        const sibling = path.join(path.dirname(flutter.executable), exe);
        if (isFile(sibling)) {
            return { executable: sibling, source: 'discovered', skipped: [...skipped, ...flutter.skipped] };
        }
    } catch {
        // No Flutter SDK: a standalone Dart on PATH may still exist.
    }
    const onPath = findOnPath(exe);
    if (onPath) {
        return { executable: onPath, source: 'discovered', skipped };
    }
    throw new ToolNotFoundError('Dart', skipped, 'the Flutter SDK and PATH');
}

export interface RunToolOptions {
    cwd?: string;
    timeoutMs?: number;
    maxBuffer?: number;
}

/** Windows' Flutter scripts hand their own path to PowerShell inside single quotes, which an apostrophe in a folder name breaks. */
function withPathHint(error: unknown, executable: string): unknown {
    if (process.platform === 'win32' && executable.includes("'") && error instanceof ProcessError) {
        const wrapped = new ProcessError(
            `${error.message}\nThe SDK path contains an apostrophe (${executable}); Flutter's Windows scripts can fail there. Move or junction the SDK to a path without one.`,
            error.stdout,
            error.stderr,
            error.exitCode,
            error.timedOut,
        );
        return wrapped;
    }
    return error;
}

async function runTool(executable: string, args: string[], options: RunToolOptions): Promise<ProcessResult> {
    try {
        return await runProcess(executable, args, {
            cwd: options.cwd,
            env: getExecEnv(),
            timeoutMs: options.timeoutMs,
            maxBuffer: options.maxBuffer,
        });
    } catch (error) {
        throw withPathHint(error, executable);
    }
}

/** Runs `flutter <args>` without a shell. */
export function runFlutter(args: string[], options: RunToolOptions = {}): Promise<ProcessResult> {
    return runTool(resolveFlutter().executable, args, options);
}

/** Runs `dart <args>` without a shell. */
export function runDart(args: string[], options: RunToolOptions = {}): Promise<ProcessResult> {
    return runTool(resolveDart().executable, args, options);
}
