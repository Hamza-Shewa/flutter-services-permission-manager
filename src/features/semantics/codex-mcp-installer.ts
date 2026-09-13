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
  configuredClaudeExecutable?: string;
  configuredGeminiExecutable?: string;
  /** Overrides the user config root for tests and managed environments. */
  userHome?: string;
}

export type McpClientId = "codex" | "claude" | "gemini" | "cursor";

export interface McpClientStatus extends CodexMcpInstallStatus {
  id: McpClientId;
  label: string;
  detected: boolean;
}

export interface McpClientsStatus {
  clients: McpClientStatus[];
  manualConfig: string;
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
    if (name === "cursor" && env.LOCALAPPDATA) {
      candidates.push(path.join(env.LOCALAPPDATA, "Programs", "cursor", "resources", "app", "bin", "cursor.cmd"));
    }
  } else {
    candidates.push(
      `/opt/homebrew/bin/${name}`,
      `/usr/local/bin/${name}`,
      `/usr/bin/${name}`,
      path.join(home, ".local", "bin", name),
      path.join(home, ".npm-global", "bin", name),
    );
    if (process.platform === "darwin" && name === "cursor") {
      candidates.push("/Applications/Cursor.app/Contents/Resources/app/bin/cursor");
    }
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

interface PortableServerDefinition {
  type?: string;
  command?: string;
  args?: string[];
  env?: Record<string, string>;
}

interface JsonMcpConfig {
  mcpServers?: Record<string, PortableServerDefinition>;
  [key: string]: unknown;
}

interface PortableRegistration {
  serverName: string;
  serverEntry: string;
  launcherEntry: string;
  projectRoot: string;
  runtimeExecutable: string;
  args: string[];
  env: Record<string, string>;
}

const CLIENT_LABELS: Record<McpClientId, string> = {
  codex: "Codex",
  claude: "Claude Code",
  gemini: "Gemini CLI",
  cursor: "Cursor",
};

function portableRegistration(options: CodexMcpInstallerOptions): PortableRegistration {
  const serverEntry = path.join(options.extensionRoot, "mcp-server", "out", "index.js");
  if (!fs.existsSync(serverEntry)) {
    throw new Error("The packaged MCP server is missing. Reinstall or rebuild Flutter Config Manager.");
  }
  const projectRoot = path.resolve(options.projectRoot);
  return {
    serverName: codexMcpServerName(projectRoot),
    serverEntry,
    launcherEntry: path.join(options.extensionRoot, "scripts", "run-mcp-server.mjs"),
    projectRoot,
    runtimeExecutable: process.execPath,
    args: [serverEntry, "--project", projectRoot],
    env: { ELECTRON_RUN_AS_NODE: "1" },
  };
}

function portableDefinitionTargetsWorkspace(
  definition: PortableServerDefinition | undefined,
  registration: PortableRegistration,
): boolean {
  if (!definition || !Array.isArray(definition.args)) { return false; }
  const projectFlag = definition.args.indexOf("--project");
  if (projectFlag < 1 || projectFlag + 1 >= definition.args.length) { return false; }
  if (normalizeForComparison(definition.args[projectFlag + 1]) !== normalizeForComparison(registration.projectRoot)) {
    return false;
  }
  const entry = normalizeForComparison(definition.args[0]);
  return entry === normalizeForComparison(registration.serverEntry)
    || entry === normalizeForComparison(registration.launcherEntry);
}

function portableDefinitionIsCurrent(
  definition: PortableServerDefinition | undefined,
  registration: PortableRegistration,
): boolean {
  return !!definition
    && (definition.type === undefined || definition.type === "stdio")
    && typeof definition.command === "string"
    && normalizeForComparison(definition.command) === normalizeForComparison(registration.runtimeExecutable)
    && sameArguments(definition.args, registration.args)
    && definition.env?.ELECTRON_RUN_AS_NODE === "1";
}

function readJsonMcpConfig(configPath: string): JsonMcpConfig {
  if (!fs.existsSync(configPath)) { return {}; }
  const parsed = JSON.parse(fs.readFileSync(configPath, "utf8")) as unknown;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(`${configPath} must contain a JSON object.`);
  }
  const config = parsed as JsonMcpConfig;
  if (config.mcpServers !== undefined
    && (!config.mcpServers || typeof config.mcpServers !== "object" || Array.isArray(config.mcpServers))) {
    throw new Error(`${configPath} has an invalid mcpServers value.`);
  }
  return config;
}

function writeJsonMcpConfig(configPath: string, config: JsonMcpConfig): void {
  fs.mkdirSync(path.dirname(configPath), { recursive: true });
  const temporaryPath = path.join(
    path.dirname(configPath),
    `.${path.basename(configPath)}.${process.pid}.${Date.now()}.tmp`,
  );
  try {
    fs.writeFileSync(temporaryPath, `${JSON.stringify(config, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
    fs.renameSync(temporaryPath, configPath);
  } catch (error) {
    try { fs.unlinkSync(temporaryPath); } catch { /* Nothing to clean up. */ }
    throw error;
  }
}

function findPortableRegistration(
  config: JsonMcpConfig,
  registration: PortableRegistration,
): [string, PortableServerDefinition] | undefined {
  return Object.entries(config.mcpServers || {})
    .find(([, definition]) => portableDefinitionTargetsWorkspace(definition, registration));
}

function userConfigPath(
  client: Exclude<McpClientId, "codex">,
  options?: CodexMcpInstallerOptions,
): string {
  const home = options?.userHome || os.homedir();
  if (client === "claude") {
    const root = process.env.CLAUDE_CONFIG_DIR || home;
    return path.join(root, ".claude.json");
  }
  if (client === "gemini") {
    return path.join(home, ".gemini", "settings.json");
  }
  return path.join(home, ".cursor", "mcp.json");
}

function portableStatus(
  id: Exclude<McpClientId, "codex">,
  config: JsonMcpConfig,
  registration: PortableRegistration,
  executable: string | undefined,
): McpClientStatus {
  const matching = findPortableRegistration(config, registration);
  if (matching) {
    const current = portableDefinitionIsCurrent(matching[1], registration);
    return {
      id,
      label: CLIENT_LABELS[id],
      state: current ? "installed" : "outdated",
      serverName: matching[0],
      message: current
        ? `Installed in ${CLIENT_LABELS[id]}'s user configuration.`
        : `Installed for this workspace, but the registration points to another runtime or extension build.`,
      detected: !!executable,
      canInstall: id === "cursor" || !!executable,
    };
  }

  const named = config.mcpServers?.[registration.serverName];
  if (named) {
    return {
      id,
      label: CLIENT_LABELS[id],
      state: "outdated",
      serverName: registration.serverName,
      message: "A registration with this workspace name exists but targets different content.",
      detected: !!executable,
      canInstall: id === "cursor" || !!executable,
    };
  }

  const detected = !!executable;
  return {
    id,
    label: CLIENT_LABELS[id],
    state: detected ? "not-installed" : "unavailable",
    serverName: registration.serverName,
    message: detected
      ? `Not installed in ${CLIENT_LABELS[id]}'s user configuration.`
      : `${CLIENT_LABELS[id]} was not found on this machine.`,
    detected,
    canInstall: detected,
  };
}

async function checkPortableClient(
  id: Exclude<McpClientId, "codex">,
  options: CodexMcpInstallerOptions,
  registration: PortableRegistration,
): Promise<McpClientStatus> {
  try {
    const configured = id === "claude" ? options.configuredClaudeExecutable : options.configuredGeminiExecutable;
    const executable = resolveExecutable(id, configured);
    const config = readJsonMcpConfig(userConfigPath(id, options));
    return portableStatus(id, config, registration, executable);
  } catch (error) {
    return {
      id,
      label: CLIENT_LABELS[id],
      state: "error",
      serverName: registration.serverName,
      message: error instanceof Error ? error.message : String(error),
      detected: !!resolveExecutable(id),
      canInstall: false,
    };
  }
}

export function createUniversalMcpConfig(options: CodexMcpInstallerOptions): string {
  const registration = portableRegistration(options);
  return JSON.stringify({
    mcpServers: {
      [registration.serverName]: {
        type: "stdio",
        command: registration.runtimeExecutable,
        args: registration.args,
        env: registration.env,
      },
    },
  }, null, 2);
}

export async function checkMcpClients(
  options: CodexMcpInstallerOptions,
): Promise<McpClientsStatus> {
  const registration = portableRegistration(options);
  const [codex, claude, gemini, cursor] = await Promise.all([
    checkCodexMcpInstallation(options),
    checkPortableClient("claude", options, registration),
    checkPortableClient("gemini", options, registration),
    checkPortableClient("cursor", options, registration),
  ]);
  return {
    clients: [
      { ...codex, id: "codex", label: CLIENT_LABELS.codex, detected: codex.state !== "unavailable" },
      claude,
      gemini,
      cursor,
    ],
    manualConfig: createUniversalMcpConfig(options),
  };
}

async function installCliClient(
  id: "claude" | "gemini",
  options: CodexMcpInstallerOptions,
  registration: PortableRegistration,
): Promise<McpClientStatus> {
  const configured = id === "claude" ? options.configuredClaudeExecutable : options.configuredGeminiExecutable;
  const executable = resolveExecutable(id, configured);
  if (!executable) {
    throw new Error(`${CLIENT_LABELS[id]} CLI was not found. Install it or configure its executable path in Flutter Config Manager settings.`);
  }
  const configPath = userConfigPath(id, options);
  const before = readJsonMcpConfig(configPath);
  const existing = findPortableRegistration(before, registration)
    || (before.mcpServers?.[registration.serverName]
      ? [registration.serverName, before.mcpServers[registration.serverName]] as [string, PortableServerDefinition]
      : undefined);
  if (existing && portableDefinitionIsCurrent(existing[1], registration)) {
    return portableStatus(id, before, registration, executable);
  }
  if (existing) {
    await runExecutable(executable, ["mcp", "remove", "--scope", "user", existing[0]]);
  }

  const addArgs = buildUserScopedMcpAddArguments(
    id,
    registration.serverName,
    registration.runtimeExecutable,
    registration.args,
  );
  await runExecutable(executable, addArgs);
  const after = readJsonMcpConfig(configPath);
  const status = portableStatus(id, after, registration, executable);
  if (status.state !== "installed") {
    throw new Error(`${CLIENT_LABELS[id]} accepted the command, but its user-level MCP registration could not be verified.`);
  }
  return { ...status, restartRequired: true };
}

/** Official Claude and Gemini CLI argument layouts differ around stdio args. */
export function buildUserScopedMcpAddArguments(
  id: "claude" | "gemini",
  serverName: string,
  runtimeExecutable: string,
  serverArgs: string[],
): string[] {
  return id === "claude"
    ? [
      "mcp", "add", "--scope", "user", "--transport", "stdio", serverName,
      "-e", "ELECTRON_RUN_AS_NODE=1", "--", runtimeExecutable, ...serverArgs,
    ]
    : [
      "mcp", "add", "--scope", "user", "--transport", "stdio",
      "-e", "ELECTRON_RUN_AS_NODE=1", serverName, runtimeExecutable, ...serverArgs,
    ];
}

function installCursorClient(
  registration: PortableRegistration,
  options: CodexMcpInstallerOptions,
): McpClientStatus {
  const configPath = userConfigPath("cursor", options);
  const config = readJsonMcpConfig(configPath);
  const matching = findPortableRegistration(config, registration);
  if (matching && portableDefinitionIsCurrent(matching[1], registration)) {
    return portableStatus("cursor", config, registration, resolveExecutable("cursor"));
  }
  config.mcpServers = config.mcpServers || {};
  if (matching && matching[0] !== registration.serverName) {
    delete config.mcpServers[matching[0]];
  }
  config.mcpServers[registration.serverName] = {
    type: "stdio",
    command: registration.runtimeExecutable,
    args: registration.args,
    env: registration.env,
  };
  writeJsonMcpConfig(configPath, config);
  const status = portableStatus("cursor", readJsonMcpConfig(configPath), registration, resolveExecutable("cursor"));
  if (status.state !== "installed") {
    throw new Error("Cursor's global MCP registration could not be verified.");
  }
  return { ...status, restartRequired: true };
}

export async function installMcpClient(
  client: McpClientId,
  options: CodexMcpInstallerOptions,
): Promise<McpClientStatus> {
  const registration = portableRegistration(options);
  if (client === "codex") {
    const status = await installCodexMcp(options);
    return { ...status, id: client, label: CLIENT_LABELS[client], detected: true };
  }
  if (client === "cursor") {
    return installCursorClient(registration, options);
  }
  return installCliClient(client, options, registration);
}
