import { execFile } from "child_process";
import { createHash } from "crypto";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";

const COMMAND_TIMEOUT_MS = 20_000;
const MAX_OUTPUT_BYTES = 1024 * 1024;

export type CodexMcpInstallState = "installed" | "not-installed" | "outdated" | "unavailable" | "error";

export interface CodexMcpInstallStatus {
  state: CodexMcpInstallState;
  serverName: string;
  message: string;
  canInstall: boolean;
  restartRequired?: boolean;
}

export interface CodexMcpInstallerOptions {
  projectRoot: string;
  extensionRoot: string;
  configuredCodexExecutable?: string;
}

export interface ProcessInvocation {
  file: string;
  args: string[];
}

interface CommandResult {
  stdout: string;
  stderr: string;
}

interface ResolvedInstaller {
  codexExecutable: string;
  runtimeExecutable: string;
  serverEntry: string;
  serverName: string;
  expectedArgs: string[];
}

interface CodexServerDefinition {
  name?: string;
  enabled?: boolean;
  transport?: {
    type?: string;
    command?: string;
    args?: string[];
    env?: Record<string, string>;
  };
}

class CommandError extends Error {
  constructor(
    message: string,
    readonly stdout: string,
    readonly stderr: string,
  ) {
    super(message);
  }
}

function normalizeForComparison(value: string): string {
  const normalized = path.normalize(value);
  return process.platform === "win32" ? normalized.toLowerCase() : normalized;
}

function sameArguments(actual: string[] | undefined, expected: string[]): boolean {
  return Array.isArray(actual)
    && actual.length === expected.length
    && actual.every((value, index) => normalizeForComparison(value) === normalizeForComparison(expected[index]));
}

/** A stable, collision-resistant MCP name allows several Flutter workspaces to coexist. */
export function codexMcpServerName(projectRoot: string): string {
  const slug = path.basename(path.resolve(projectRoot))
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 32) || "project";
  const identity = process.platform === "win32"
    ? path.resolve(projectRoot).toLowerCase()
    : path.resolve(projectRoot);
  const hash = createHash("sha256").update(identity).digest("hex").slice(0, 8);
  return `flutter-config-manager-${slug}-${hash}`;
}

function executableCandidates(name: string, configured: string | undefined, env: NodeJS.ProcessEnv): string[] {
  const candidates: string[] = [];
  if (configured?.trim()) {
    candidates.push(configured.trim());
  }

  const extensions = process.platform === "win32"
    ? (env.PATHEXT || ".EXE;.CMD;.BAT").split(";").map((extension) => extension.toLowerCase())
    : [""];
  for (const directory of (env.PATH || "").split(path.delimiter).filter(Boolean)) {
    if (process.platform === "win32" && path.extname(name)) {
      candidates.push(path.join(directory, name));
    } else {
      extensions.forEach((extension) => candidates.push(path.join(directory, `${name}${extension}`)));
    }
  }

  const home = os.homedir();
  if (process.platform === "win32") {
    if (env.APPDATA) { candidates.push(path.join(env.APPDATA, "npm", `${name}.cmd`)); }
    if (env.LOCALAPPDATA) { candidates.push(path.join(env.LOCALAPPDATA, "Programs", name, `${name}.exe`)); }
  } else {
    candidates.push(
      `/opt/homebrew/bin/${name}`,
      `/usr/local/bin/${name}`,
      `/usr/bin/${name}`,
      path.join(home, ".local", "bin", name),
      path.join(home, ".npm-global", "bin", name),
    );
  }
  return [...new Set(candidates)];
}

export function resolveExecutable(
  name: string,
  configured?: string,
  env: NodeJS.ProcessEnv = process.env,
): string | undefined {
  for (const candidate of executableCandidates(name, configured, env)) {
    try {
      const stat = fs.statSync(candidate);
      if (!stat.isFile()) { continue; }
      if (process.platform !== "win32") {
        fs.accessSync(candidate, fs.constants.X_OK);
      }
      return path.resolve(candidate);
    } catch {
      // Keep searching PATH and the platform-specific fallback locations.
    }
  }
  return undefined;
}

/**
 * Node cannot execute Windows .cmd/.bat shims directly. PowerShell's encoded
 * command form avoids shell interpolation of workspace paths and arguments.
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
    `$payload = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${payload}')) | ConvertFrom-Json`,
    `& $payload.executable @($payload.args)`,
    `if ($null -eq $LASTEXITCODE) { exit 0 } else { exit $LASTEXITCODE }`,
  ].join("; ");
  const encoded = Buffer.from(script, "utf16le").toString("base64");
  const windowsRoot = env.SystemRoot || env.WINDIR || "C:\\Windows";
  return {
    file: path.win32.join(windowsRoot, "System32", "WindowsPowerShell", "v1.0", "powershell.exe"),
    args: ["-NoLogo", "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-EncodedCommand", encoded],
  };
}

function runExecutable(executable: string, args: string[]): Promise<CommandResult> {
  const invocation = buildProcessInvocation(executable, args);
  return new Promise((resolve, reject) => {
    execFile(
      invocation.file,
      invocation.args,
      { encoding: "utf8", timeout: COMMAND_TIMEOUT_MS, maxBuffer: MAX_OUTPUT_BYTES, windowsHide: true },
      (error, stdout, stderr) => {
        const result = { stdout: stdout || "", stderr: stderr || "" };
        if (error) {
          reject(new CommandError(error.message, result.stdout, result.stderr));
          return;
        }
        resolve(result);
      },
    );
  });
}

function resolveInstaller(options: CodexMcpInstallerOptions): ResolvedInstaller {
  const serverEntry = path.join(options.extensionRoot, "mcp-server", "out", "index.js");
  if (!fs.existsSync(serverEntry)) {
    throw new Error("The packaged MCP server is missing. Reinstall or rebuild Flutter Config Manager.");
  }

  const configured = options.configuredCodexExecutable || process.env.CODEX_CLI_PATH;
  const codexExecutable = resolveExecutable("codex", configured);
  if (!codexExecutable) {
    throw new Error("Codex CLI was not found. Install Codex or set flutter-config-manager.mcp.codexExecutable to its full path.");
  }
  const projectRoot = path.resolve(options.projectRoot);
  return {
    codexExecutable,
    // VS Code's extension-host executable is Electron on desktop and Node on
    // remote hosts. ELECTRON_RUN_AS_NODE makes either form a stable MCP runtime.
    runtimeExecutable: process.execPath,
    serverEntry,
    serverName: codexMcpServerName(projectRoot),
    expectedArgs: [serverEntry, "--project", projectRoot],
  };
}

async function readDefinition(installer: ResolvedInstaller): Promise<CodexServerDefinition | undefined> {
  try {
    const result = await runExecutable(installer.codexExecutable, ["mcp", "get", installer.serverName, "--json"]);
    return JSON.parse(result.stdout) as CodexServerDefinition;
  } catch (error) {
    if (error instanceof CommandError) { return undefined; }
    throw error;
  }
}

function matchesExpectedRegistration(definition: CodexServerDefinition, installer: ResolvedInstaller): boolean {
  return definition.transport?.type === "stdio"
    && definition.enabled !== false
    && typeof definition.transport.command === "string"
    && normalizeForComparison(definition.transport.command) === normalizeForComparison(installer.runtimeExecutable)
    && sameArguments(definition.transport.args, installer.expectedArgs)
    && definition.transport.env?.ELECTRON_RUN_AS_NODE === "1";
}

function targetsCurrentWorkspace(definition: CodexServerDefinition, installer: ResolvedInstaller): boolean {
  if (definition.transport?.type !== "stdio" || !Array.isArray(definition.transport.args)) {
    return false;
  }
  const args = definition.transport.args;
  const projectFlag = args.indexOf("--project");
  if (projectFlag < 1 || projectFlag + 1 >= args.length) {
    return false;
  }
  const configuredProject = normalizeForComparison(args[projectFlag + 1]);
  const expectedProject = normalizeForComparison(installer.expectedArgs[2]);
  if (configuredProject !== expectedProject) {
    return false;
  }

  const entry = normalizeForComparison(args[0]);
  const launcher = normalizeForComparison(
    path.resolve(path.dirname(installer.serverEntry), "../../scripts/run-mcp-server.mjs"),
  );
  return entry === normalizeForComparison(installer.serverEntry) || entry === launcher;
}

async function readDefinitions(installer: ResolvedInstaller): Promise<CodexServerDefinition[]> {
  const result = await runExecutable(installer.codexExecutable, ["mcp", "list", "--json"]);
  const parsed = JSON.parse(result.stdout) as unknown;
  if (!Array.isArray(parsed)) {
    throw new Error("Codex returned an invalid MCP server list.");
  }
  return parsed as CodexServerDefinition[];
}

export async function checkCodexMcpInstallation(
  options: CodexMcpInstallerOptions,
): Promise<CodexMcpInstallStatus> {
  const serverName = codexMcpServerName(options.projectRoot);
  let installer: ResolvedInstaller;
  try {
    installer = resolveInstaller(options);
    await runExecutable(installer.codexExecutable, ["--version"]);
  } catch (error) {
    return {
      state: "unavailable",
      serverName,
      message: error instanceof Error ? error.message : String(error),
      canInstall: false,
    };
  }

  try {
    const definitions = await readDefinitions(installer);
    const workspaceDefinition = definitions.find((definition) => targetsCurrentWorkspace(definition, installer));
    if (workspaceDefinition && workspaceDefinition.enabled !== false) {
      return {
        state: "installed",
        serverName: workspaceDefinition.name || serverName,
        message: "User-level Codex MCP is installed for this workspace.",
        canInstall: true,
      };
    }
    if (workspaceDefinition?.enabled === false) {
      return {
        state: "outdated",
        serverName: workspaceDefinition.name || serverName,
        message: "The workspace MCP is installed but disabled in the user-level Codex configuration.",
        canInstall: true,
      };
    }

    const definition = definitions.find((candidate) => candidate.name === serverName);
    if (!definition) {
      return {
        state: "not-installed",
        serverName,
        message: "Codex MCP is not installed for this Flutter workspace.",
        canInstall: true,
      };
    }
    if (!matchesExpectedRegistration(definition, installer)) {
      return {
        state: "outdated",
        serverName,
        message: "The workspace MCP registration points to an older or different extension build.",
        canInstall: true,
      };
    }
    return {
      state: "installed",
      serverName,
      message: "User-level Codex MCP is installed for this workspace.",
      canInstall: true,
    };
  } catch (error) {
    return {
      state: "error",
      serverName,
      message: error instanceof Error ? error.message : String(error),
      canInstall: true,
    };
  }
}

export async function installCodexMcp(
  options: CodexMcpInstallerOptions,
): Promise<CodexMcpInstallStatus> {
  const installer = resolveInstaller(options);
  await runExecutable(installer.codexExecutable, ["--version"]);
  const definitions = await readDefinitions(installer);
  const workspaceDefinition = definitions.find((definition) => targetsCurrentWorkspace(definition, installer));

  if (workspaceDefinition && workspaceDefinition.enabled !== false) {
    return {
      state: "installed",
      serverName: workspaceDefinition.name || installer.serverName,
      message: "User-level Codex MCP is already installed.",
      canInstall: true,
    };
  }

  const existing = workspaceDefinition
    || definitions.find((definition) => definition.name === installer.serverName);
  if (existing?.name) {
    await runExecutable(installer.codexExecutable, ["mcp", "remove", existing.name]);
  }

  try {
    await runExecutable(installer.codexExecutable, [
      "mcp",
      "add",
      "--env",
      "ELECTRON_RUN_AS_NODE=1",
      installer.serverName,
      "--",
      installer.runtimeExecutable,
      ...installer.expectedArgs,
    ]);
  } catch (error) {
    const detail = error instanceof CommandError
      ? (error.stderr || error.stdout || error.message).trim()
      : error instanceof Error ? error.message : String(error);
    throw new Error(`Codex MCP installation failed: ${detail}`);
  }

  const installed = await readDefinition(installer);
  if (!installed || !matchesExpectedRegistration(installed, installer)) {
    throw new Error("Codex accepted the command, but the resulting MCP registration could not be verified.");
  }

  return {
    state: "installed",
    serverName: installer.serverName,
    message: "Installed in the user-level Codex configuration. Open a new Codex task to load its tools.",
    canInstall: true,
    restartRequired: true,
  };
}
