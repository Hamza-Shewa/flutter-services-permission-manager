import { execFile } from "child_process";
import * as path from "path";

/**
 * Runs external programs without a shell. Arguments are passed as an array, so
 * nothing the user, a pubspec or a webview supplies can be interpreted as shell
 * syntax. Pure Node (no vscode) so the MCP installer and the extension share it.
 */

export interface ProcessInvocation {
  file: string;
  args: string[];
}

export interface ProcessResult {
  stdout: string;
  stderr: string;
}

export interface RunProcessOptions {
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  timeoutMs?: number;
  maxBuffer?: number;
}

export class ProcessError extends Error {
  constructor(
    message: string,
    readonly stdout: string,
    readonly stderr: string,
    readonly exitCode?: number | string | null,
    readonly timedOut = false,
  ) {
    super(message);
  }
}

const DEFAULT_TIMEOUT_MS = 60_000;
const DEFAULT_MAX_BUFFER = 1024 * 1024;

/**
 * Node cannot execute Windows .cmd/.bat shims directly. PowerShell's encoded
 * command form avoids shell interpolation of paths and arguments.
 * `-OutputFormat Text` keeps the child's stderr readable (the default for a
 * redirected -EncodedCommand is CLIXML) and `$ProgressPreference` silences the
 * "Preparing modules for first use" record.
 */
export function buildProcessInvocation(
  executable: string,
  args: string[],
  platform: NodeJS.Platform = process.platform,
  env: NodeJS.ProcessEnv = process.env,
): ProcessInvocation {
  if (platform !== "win32" || !/\.(?:cmd|bat)$/i.test(executable)) {
    return { file: executable, args };
  }

  const payload = Buffer.from(JSON.stringify({ executable, args }), "utf8").toString("base64");
  const script = [
    `$ProgressPreference = 'SilentlyContinue'`,
    `$payload = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${payload}')) | ConvertFrom-Json`,
    `& $payload.executable @($payload.args)`,
    `if ($null -eq $LASTEXITCODE) { exit 0 } else { exit $LASTEXITCODE }`,
  ].join("; ");
  const encoded = Buffer.from(script, "utf16le").toString("base64");
  const windowsRoot = env.SystemRoot || env.WINDIR || "C:\\Windows";
  return {
    file: path.win32.join(windowsRoot, "System32", "WindowsPowerShell", "v1.0", "powershell.exe"),
    args: ["-NoLogo", "-NoProfile", "-NonInteractive", "-InputFormat", "None", "-OutputFormat", "Text", "-ExecutionPolicy", "Bypass", "-EncodedCommand", encoded],
  };
}

export function runProcess(executable: string, args: string[], options: RunProcessOptions = {}): Promise<ProcessResult> {
  const invocation = buildProcessInvocation(executable, args, process.platform, options.env ?? process.env);
  return new Promise((resolve, reject) => {
    execFile(
      invocation.file,
      invocation.args,
      {
        encoding: "utf8",
        cwd: options.cwd,
        env: options.env,
        timeout: options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
        maxBuffer: options.maxBuffer ?? DEFAULT_MAX_BUFFER,
        windowsHide: true,
      },
      (error, stdout, stderr) => {
        const result = { stdout: stdout || "", stderr: stderr || "" };
        if (error) {
          reject(new ProcessError(
            error.message,
            result.stdout,
            result.stderr,
            (error as NodeJS.ErrnoException).code,
            (error as { killed?: boolean }).killed === true,
          ));
          return;
        }
        resolve(result);
      },
    );
  });
}
