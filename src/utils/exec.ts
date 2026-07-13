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

export function getFlutterCommand(): string {
    const dartConfig = vscode.workspace.getConfiguration('dart');
    const flutterSdkPath = dartConfig.get<string>('flutterSdkPath');
    const exeName = os.platform() === 'win32' ? 'flutter.bat' : 'flutter';
    if (flutterSdkPath) {
        return `"${path.join(flutterSdkPath, 'bin', exeName)}"`;
    }
    return exeName;
}

export function getDartCommand(): string {
    const dartConfig = vscode.workspace.getConfiguration('dart');
    const sdkPath = dartConfig.get<string>('sdkPath');
    const exeName = os.platform() === 'win32' ? 'dart.bat' : 'dart';
    if (sdkPath) {
        return `"${path.join(sdkPath, 'bin', exeName)}"`;
    }
    const flutterSdkPath = dartConfig.get<string>('flutterSdkPath');
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
