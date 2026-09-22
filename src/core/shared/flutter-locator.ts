import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { spawnSync } from 'node:child_process';

/**
 * Locates a usable Flutter SDK across the extension host and the standalone
 * mcp-server (which has no `vscode` API and no VS Code settings to read),
 * and validates the `flutter --version --machine` output against the
 * minimum version required for `Semantics.identifier` support.
 */

function flutterExeName(): string {
    return process.platform === 'win32' ? 'flutter.bat' : 'flutter';
}

function isFile(candidate: string): boolean {
    try {
        return fs.statSync(candidate).isFile();
    } catch {
        return false;
    }
}

function fromPath(): string | undefined {
    const result = spawnSync(process.platform === 'win32' ? 'where' : 'which', [flutterExeName()], { encoding: 'utf8' });
    if (result.status === 0 && result.stdout) {
        return result.stdout.trim().split(/\r?\n/)[0];
    }
    return undefined;
}

/**
 * `FLUTTER_ROOT` and the machine/user PATH env vars are the two places a
 * Windows Flutter install registers itself, and both are already covered by
 * `fromPath()`/the explicit candidates above it. When neither is set (fresh
 * install, or PATH not yet refreshed in the current session) fall back to
 * the handful of directories the official installer, a manual `git clone`,
 * and FVM commonly use.
 */
function windowsDefaultCandidates(): string[] {
    const exe = flutterExeName();
    const systemDrive = process.env.SystemDrive || 'C:';
    const roots = [`${systemDrive}\\src\\flutter`, `${systemDrive}\\flutter`];
    if (process.env.USERPROFILE) {
        roots.push(
            path.join(process.env.USERPROFILE, 'flutter'),
            path.join(process.env.USERPROFILE, 'dev', 'flutter'),
            path.join(process.env.USERPROFILE, 'fvm', 'default'),
        );
    }
    if (process.env.LOCALAPPDATA) {
        roots.push(path.join(process.env.LOCALAPPDATA, 'flutter'));
    }
    return roots.map((root) => path.join(root, 'bin', exe));
}

/**
 * GUI-launched processes (VS Code opened from the Dock, an MCP client
 * launched outside a terminal) inherit launchd's minimal PATH on
 * macOS/Linux, not the one a login shell builds up in `~/.zshrc` - so
 * `flutter` can work in Terminal.app but be invisible here. Scan the common
 * shell rc files for `export PATH=...` assignments and pull out any segment
 * that looks like a Flutter SDK's bin directory.
 */
function posixShellRcCandidates(): string[] {
    const home = os.homedir();
    if (!home) { return []; }
    const exe = flutterExeName();
    const rcFiles = ['.zshrc', '.zprofile', '.bash_profile', '.bashrc', '.profile'].map((f) => path.join(home, f));
    const candidates: string[] = [];
    for (const rcFile of rcFiles) {
        let content: string;
        try {
            content = fs.readFileSync(rcFile, 'utf8');
        } catch {
            continue;
        }
        const exportPattern = /export\s+PATH=(["']?)([^"'\n]+)\1/g;
        let match: RegExpExecArray | null;
        while ((match = exportPattern.exec(content))) {
            const expanded = match[2].replace(/\$\{?(\w+)\}?/g, (token, name) => (name === 'PATH' ? '' : process.env[name] ?? token));
            for (const segment of expanded.split(':')) {
                const trimmed = segment.trim().replace(/^~(?=\/|$)/, home);
                if (trimmed && trimmed.toLowerCase().includes('flutter')) {
                    candidates.push(path.join(trimmed, exe));
                }
            }
        }
    }
    return candidates;
}

export interface FlutterLocatorOptions {
    /** Project root; checked for a local FVM SDK at `.fvm/flutter_sdk` before any wider search. */
    projectRoot?: string;
    /** An already-resolved executable path (e.g. from the `dart.flutterSdkPath` VS Code setting) that wins over everything else when present. */
    overridePath?: string;
}

/**
 * Resolves a Flutter executable, trying the most explicit signal first and
 * progressively widening the search. Returns `undefined` if nothing is
 * found anywhere.
 */
export function findFlutterExecutable(options: FlutterLocatorOptions = {}): string | undefined {
    const exe = flutterExeName();
    const explicitCandidates = [
        options.overridePath,
        process.env.FCM_FLUTTER_EXECUTABLE,
        process.env.FLUTTER_ROOT ? path.join(process.env.FLUTTER_ROOT, 'bin', exe) : undefined,
        options.projectRoot ? path.join(options.projectRoot, '.fvm', 'flutter_sdk', 'bin', exe) : undefined,
    ].filter((candidate): candidate is string => !!candidate);

    for (const candidate of explicitCandidates) {
        if (isFile(candidate)) { return candidate; }
    }

    const onPath = fromPath();
    if (onPath) { return onPath; }

    const platformCandidates = process.platform === 'win32' ? windowsDefaultCandidates() : posixShellRcCandidates();
    return platformCandidates.find(isFile);
}

export interface FlutterVersionCheckResult {
    ok: boolean;
    version: string;
}

export interface FlutterVersionProbe {
    status: number | null;
    stdout: string;
}

/**
 * Runs `<executable> --version --machine`. On Windows a resolved Flutter
 * executable is a `.bat` script, and Node's `spawnSync` refuses to launch a
 * batch file directly without a shell (a deliberate security fix, since
 * batch files are shell-interpreted) - it fails with EINVAL instead. Route
 * through a shell only for that case; the args here are static literals,
 * never user input, so building the quoted command string ourselves is safe.
 */
export function probeFlutterVersion(executable: string, cwd: string): FlutterVersionProbe {
    const needsShell = process.platform === 'win32' && /\.(bat|cmd)$/i.test(executable);
    const result = needsShell
        ? spawnSync(`"${executable}" --version --machine`, { cwd, encoding: 'utf8', shell: true })
        : spawnSync(executable, ['--version', '--machine'], { cwd, encoding: 'utf8' });
    return { status: result.status, stdout: result.stdout ?? '' };
}

const MIN_MAJOR = 3;
const MIN_MINOR = 19;

/**
 * Parses `flutter --version --machine` stdout and checks it meets the
 * minimum version required for `Semantics.identifier` support (3.19+).
 */
export function checkFlutterVersion(machineOutput: string): FlutterVersionCheckResult {
    let version = '';
    try {
        version = String((JSON.parse(machineOutput) as { frameworkVersion?: string }).frameworkVersion ?? '');
    } catch {
        return { ok: false, version: '' };
    }
    const [major, minor] = version.split('.').map(Number);
    const ok = Number.isFinite(major) && Number.isFinite(minor) && (major > MIN_MAJOR || (major === MIN_MAJOR && minor >= MIN_MINOR));
    return { ok, version };
}
