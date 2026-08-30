import { exec, ExecException, ExecOptions } from 'child_process';
import * as os from 'os';
import * as vscode from 'vscode';
import * as path from 'path';

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
        env.PATH = `${currentPath}:${extraPaths.join(':')}`;
    }
    return env;
}

/**
 * Expands a leading `~` in a configured SDK path to the user's home directory.
 *
 * Values like `~/devtools/flutter` are commonly used in `dart.flutterSdkPath` /
 * `dart.sdkPath`, but the shell does NOT expand `~` when the path is wrapped in
 * quotes (which `getFlutterCommand`/`getDartCommand` do). That produced commands
 * like `"~/devtools/flutter/bin/flutter"` and failed with
 * "No such file or directory" even though the SDK exists.
 */
export function resolveSdkPath(sdkPath: string | undefined): string | undefined {
    if (!sdkPath) { return undefined; }
    if (sdkPath === '~') { return os.homedir(); }
    if (sdkPath.startsWith('~/')) { return path.join(os.homedir(), sdkPath.slice(2)); }
    return sdkPath;
}

export function getFlutterCommand(): string {
    const dartConfig = vscode.workspace.getConfiguration('dart');
    const flutterSdkPath = resolveSdkPath(dartConfig.get<string>('flutterSdkPath'));
    const exeName = os.platform() === 'win32' ? 'flutter.bat' : 'flutter';
    if (flutterSdkPath) {
        return `"${path.join(flutterSdkPath, 'bin', exeName)}"`;
    }
    return exeName;
}

export function getDartCommand(): string {
    const dartConfig = vscode.workspace.getConfiguration('dart');
    const sdkPath = resolveSdkPath(dartConfig.get<string>('sdkPath'));
    const exeName = os.platform() === 'win32' ? 'dart.bat' : 'dart';
    if (sdkPath) {
        return `"${path.join(sdkPath, 'bin', exeName)}"`;
    }
    const flutterSdkPath = resolveSdkPath(dartConfig.get<string>('flutterSdkPath'));
    if (flutterSdkPath) {
        return `"${path.join(flutterSdkPath, 'bin', exeName)}"`;
    }
    return exeName;
}

export function execWithEnv(
    command: string,
    options: ExecOptions,
    callback: (error: ExecException | null, stdout: string, stderr: string) => void
) {
    const mergedOptions: ExecOptions = {
        ...options,
        env: {
            ...getExecEnv(),
            ...(options.env || {})
        }
    };
    return exec(command, mergedOptions, callback as any);
}
