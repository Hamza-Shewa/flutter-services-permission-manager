import { createHash } from "crypto";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { ProcessError as CommandError, runProcess } from "../../core/utils/process.js";

export { buildProcessInvocation, type ProcessInvocation } from "../../core/utils/process.js";

/** `gemini mcp add` starts Node, reads settings and can touch the network on a cold start; 20s was too tight. */
const COMMAND_TIMEOUT_MS = 60_000;
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
  /** The open workspace, used only to explain client-side folder trust; registrations are not tied to it. */
  projectRoot?: string;
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

function normalizeForComparison(value: string): string {
  const normalized = path.normalize(value);
  return process.platform === "win32" ? normalized.toLowerCase() : normalized;
}

function sameArguments(actual: string[] | undefined, expected: string[]): boolean {
  return Array.isArray(actual)
    && actual.length === expected.length
    && actual.every((value, index) => normalizeForComparison(value) === normalizeForComparison(expected[index]));
}

/**
 * The single, user-level registration name. It is short on purpose: clients prefix tool names with
 * the server name and Gemini truncates fully qualified names above 63 characters.
 */
export const MCP_SERVER_NAME = "flutter-config-manager";

const LEGACY_SERVER_NAME = /^flutter-config-manager-.+-[a-f0-9]{8}$/;

/** Registrations made by earlier versions, one per project (`flutter-config-manager-<project>-<hash>`). */
export function isLegacyServerName(name: string | undefined): boolean {
  return !!name && LEGACY_SERVER_NAME.test(name);
}

/** The per-project name earlier versions registered; kept to recognize and replace those entries. */
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

export interface DiscoveryOptions {
  platform?: NodeJS.Platform;
  home?: string;
}

/** Sub-directories of `root`, newest version first (v22.1.0 before v20.11.0). */
function versionedDirectories(root: string): string[] {
  try {
    return fs.readdirSync(root, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort((left, right) => right.localeCompare(left, undefined, { numeric: true }))
      .map((name) => path.join(root, name));
  } catch {
    return [];
  }
}

/**
 * Where Node-based CLIs (gemini, codex, claude) and the `node` they need usually live. An editor started
 * from the macOS Dock or a Linux launcher inherits a minimal PATH that contains none of the version-manager
 * directories, even though the same tools work in a terminal.
 */
export function toolDirectories(
  env: NodeJS.ProcessEnv = process.env,
  options: DiscoveryOptions = {},
): string[] {
  const platform = options.platform ?? process.platform;
  const home = options.home ?? os.homedir();
  const directories: string[] = [];
  const add = (directory: string | undefined) => { if (directory) { directories.push(directory); } };

  add(env.NVM_BIN);
  add(env.PNPM_HOME);
  add(env.VOLTA_HOME && path.join(env.VOLTA_HOME, "bin"));
  add(env.BUN_INSTALL && path.join(env.BUN_INSTALL, "bin"));
  add(env.NPM_CONFIG_PREFIX && path.join(env.NPM_CONFIG_PREFIX, platform === "win32" ? "" : "bin"));

  if (platform === "win32") {
    add(env.NVM_SYMLINK);
    add(env.APPDATA && path.join(env.APPDATA, "npm"));
    add(env.LOCALAPPDATA && path.join(env.LOCALAPPDATA, "Volta", "bin"));
    add(env.LOCALAPPDATA && path.join(env.LOCALAPPDATA, "pnpm"));
    return [...new Set(directories)];
  }

  versionedDirectories(path.join(home, ".nvm", "versions", "node")).forEach((version) => add(path.join(version, "bin")));
  for (const fnmRoot of [
    path.join(home, ".fnm", "node-versions"),
    path.join(home, ".local", "share", "fnm", "node-versions"),
    path.join(home, "Library", "Application Support", "fnm", "node-versions"),
  ]) {
    versionedDirectories(fnmRoot).forEach((version) => add(path.join(version, "installation", "bin")));
  }
  add(path.join(home, ".volta", "bin"));
  add(path.join(home, ".asdf", "shims"));
  add(path.join(home, ".local", "share", "mise", "shims"));
  add(path.join(home, ".local", "share", "pnpm"));
  add(path.join(home, "Library", "pnpm"));
  add(path.join(home, ".bun", "bin"));
  add(path.join(home, ".yarn", "bin"));
  add(path.join(home, ".npm-global", "bin"));
  add(path.join(home, ".local", "bin"));
  add("/opt/homebrew/bin");
  add("/usr/local/bin");
  add("/opt/local/bin");
  add("/usr/bin");
  return [...new Set(directories)];
}

function executableCandidates(
  name: string,
  configured: string | undefined,
  env: NodeJS.ProcessEnv,
  options: DiscoveryOptions = {},
): string[] {
  const platform = options.platform ?? process.platform;
  const home = options.home ?? os.homedir();
  const candidates: string[] = [];
  if (configured?.trim()) {
    candidates.push(configured.trim());
  }

  const extensions = platform === "win32"
    ? (env.PATHEXT || ".EXE;.CMD;.BAT").split(";").map((extension) => extension.toLowerCase())
    : [""];
  const directories = [
    ...(env.PATH || "").split(path.delimiter).filter(Boolean),
    ...toolDirectories(env, { platform, home }),
  ];
  for (const directory of directories) {
    if (platform === "win32" && path.extname(name)) {
      candidates.push(path.join(directory, name));
    } else {
      extensions.forEach((extension) => candidates.push(path.join(directory, `${name}${extension}`)));
    }
  }

  if (platform === "win32") {
    if (name === "cursor" && env.LOCALAPPDATA) {
      candidates.push(path.join(env.LOCALAPPDATA, "Programs", "cursor", "resources", "app", "bin", "cursor.cmd"));
    }
    if (env.LOCALAPPDATA) { candidates.push(path.join(env.LOCALAPPDATA, "Programs", name, `${name}.exe`)); }
  } else if (platform === "darwin" && name === "cursor") {
    candidates.push("/Applications/Cursor.app/Contents/Resources/app/bin/cursor");
  }
  return [...new Set(candidates)];
}

export function resolveExecutable(
  name: string,
  configured?: string,
  env: NodeJS.ProcessEnv = process.env,
  options: DiscoveryOptions = {},
): string | undefined {
  const platform = options.platform ?? process.platform;
  for (const candidate of executableCandidates(name, configured, env, options)) {
    try {
      const stat = fs.statSync(candidate);
      if (!stat.isFile()) { continue; }
      if (platform !== "win32") {
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
 * The environment to run a discovered CLI in. A Node CLI is a `#!/usr/bin/env node` script, so `node`
 * must be findable: the CLI's own directory (npm, nvm, Homebrew and volta keep `node` beside it) and the
 * usual version-manager directories go in front of whatever PATH the editor was started with.
 * Windows resolves `.cmd` shims itself and is left alone.
 */
export function childEnvironment(
  executable: string,
  env: NodeJS.ProcessEnv = process.env,
  options: DiscoveryOptions = {},
): NodeJS.ProcessEnv {
  const platform = options.platform ?? process.platform;
  if (platform === "win32") {
    return env;
  }
  const directories = [path.dirname(executable)];
  try {
    directories.push(path.dirname(fs.realpathSync(executable)));
  } catch {
    // A missing target is reported by the command itself.
  }
  directories.push(...toolDirectories(env, options).filter((directory) => {
    try { return fs.statSync(directory).isDirectory(); } catch { return false; }
  }));
  const existing = (env.PATH || "").split(path.delimiter).filter(Boolean);
  return { ...env, PATH: [...new Set([...directories, ...existing])].join(path.delimiter) };
}

/** Terminal colour codes and the encoded PowerShell wrapper make raw process errors unreadable in a dialog. */
export function describeCommandFailure(error: unknown): string {
  // PowerShell wraps stderr in CLIXML records; terminals add colour codes. Neither belongs in a dialog.
  const clean = (text: string) => text
    .replace(/#< CLIXML[\s\S]*?<\/Objs>/g, "")
    .replace(/\u001b\[[0-9;]*m/g, "")
    .replace(/\[(?:\d{1,2};?)+m/g, "")
    .trim();
  if (error instanceof CommandError) {
    if (error.timedOut) {
      return `the command did not finish within ${COMMAND_TIMEOUT_MS / 1000}s. Run it once in a terminal (for example "gemini mcp list") to see what it is waiting for.`;
    }
    const detail = clean(error.stderr) || clean(error.stdout);
    if (detail) {
      const summary = detail.split(/\r?\n/).filter((line) => line.trim()).slice(0, 6).join(" ");
      // A `#!/usr/bin/env node` CLI cannot start when the editor was launched without Node on its PATH (macOS Dock, Linux launchers).
      return /env: ['"]?node['"]?: No such file|node: command not found|node: not found/i.test(detail)
        ? `${summary} Node.js is not on the PATH this editor was started with. Start VS Code from a terminal ("code .") or set the client's executable path in the Flutter Config Manager settings.`
        : summary;
    }
    const first = error.message.split(/\r?\n/)[0].replace(/-EncodedCommand\s+\S+/, "-EncodedCommand …").slice(0, 300);
    return error.exitCode !== undefined && error.exitCode !== null ? `${first} (exit ${error.exitCode})` : first;
  }
  return error instanceof Error ? error.message : String(error);
}

function runExecutable(executable: string, args: string[]): Promise<CommandResult> {
  return runProcess(executable, args, {
    env: childEnvironment(executable),
    timeoutMs: COMMAND_TIMEOUT_MS,
    maxBuffer: MAX_OUTPUT_BYTES,
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
  return {
    codexExecutable,
    // VS Code's extension-host executable is Electron on desktop and Node on
    // remote hosts. ELECTRON_RUN_AS_NODE makes either form a stable MCP runtime.
    runtimeExecutable: process.execPath,
    serverEntry,
    serverName: MCP_SERVER_NAME,
    // No --project: the server resolves the project from the directory the client starts it in.
    expectedArgs: [serverEntry],
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
  let installer: ResolvedInstaller;
  try {
    installer = resolveInstaller(options);
    await runExecutable(installer.codexExecutable, ["--version"]);
  } catch (error) {
    return {
      state: "unavailable",
      serverName: MCP_SERVER_NAME,
      message: describeCommandFailure(error),
      canInstall: false,
    };
  }

  try {
    const definitions = await readDefinitions(installer);
    const legacy = definitions.filter((definition) => isLegacyServerName(definition.name));
    const current = definitions.find((definition) => definition.name === installer.serverName);
    if (current && current.enabled === false) {
      return {
        state: "outdated",
        serverName: installer.serverName,
        message: "The MCP server is registered but disabled in the user-level Codex configuration.",
        canInstall: true,
      };
    }
    if (current && !matchesExpectedRegistration(current, installer)) {
      return {
        state: "outdated",
        serverName: installer.serverName,
        message: "The user-level registration points to an older or different extension build.",
        canInstall: true,
      };
    }
    if (legacy.length > 0) {
      return {
        state: "outdated",
        serverName: installer.serverName,
        message: `${legacy.length} older per-project registration${legacy.length === 1 ? "" : "s"} found. Update to replace ${legacy.length === 1 ? "it" : "them"} with one user-level server that follows whichever project you open.`,
        canInstall: true,
      };
    }
    if (!current) {
      return {
        state: "not-installed",
        serverName: installer.serverName,
        message: "Codex MCP is not installed at user level.",
        canInstall: true,
      };
    }
    return {
      state: "installed",
      serverName: installer.serverName,
      message: "User-level Codex MCP is installed; it serves the project Codex is started in.",
      canInstall: true,
    };
  } catch (error) {
    return {
      state: "error",
      serverName: MCP_SERVER_NAME,
      message: describeCommandFailure(error),
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
  const legacy = definitions.filter((definition) => isLegacyServerName(definition.name));
  const current = definitions.find((definition) => definition.name === installer.serverName);

  if (current && matchesExpectedRegistration(current, installer) && legacy.length === 0) {
    return {
      state: "installed",
      serverName: installer.serverName,
      message: "User-level Codex MCP is already installed.",
      canInstall: true,
    };
  }

  try {
    for (const definition of legacy) {
      await runExecutable(installer.codexExecutable, ["mcp", "remove", definition.name!]);
    }
    if (current) {
      await runExecutable(installer.codexExecutable, ["mcp", "remove", installer.serverName]);
    }
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
    throw new Error(`Codex MCP installation failed: ${describeCommandFailure(error)}`);
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

/**
 * One registration for every project. CLI clients start the server in the folder you run them in, so no
 * project is baked in; Cursor's global config has no such guarantee, so it passes its own workspace variable.
 */
function portableRegistration(options: CodexMcpInstallerOptions, client?: McpClientId): PortableRegistration {
  const serverEntry = path.join(options.extensionRoot, "mcp-server", "out", "index.js");
  if (!fs.existsSync(serverEntry)) {
    throw new Error("The packaged MCP server is missing. Reinstall or rebuild Flutter Config Manager.");
  }
  return {
    serverName: MCP_SERVER_NAME,
    serverEntry,
    runtimeExecutable: process.execPath,
    args: client === "cursor" ? [serverEntry, "--project", "${workspaceFolder}"] : [serverEntry],
    env: { ELECTRON_RUN_AS_NODE: "1" },
  };
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

/**
 * Client settings files (Gemini's in particular) may contain comments and trailing commas.
 * Strings are respected, so URLs and paths containing `//` survive.
 */
export function parseJsonc(text: string): unknown {
  let output = "";
  let inString = false;
  for (let index = 0; index < text.length; index++) {
    const char = text[index];
    const next = text[index + 1];
    if (inString) {
      output += char;
      if (char === "\\") {
        output += next ?? "";
        index++;
      } else if (char === "\"") {
        inString = false;
      }
    } else if (char === "\"") {
      inString = true;
      output += char;
    } else if (char === "/" && next === "/") {
      while (index < text.length && text[index] !== "\n") { index++; }
      output += "\n";
    } else if (char === "/" && next === "*") {
      index += 2;
      while (index < text.length && !(text[index] === "*" && text[index + 1] === "/")) { index++; }
      index++;
    } else {
      output += char;
    }
  }
  return JSON.parse(output.replace(/^﻿/, "").replace(/,(\s*[}\]])/g, "$1"));
}

function readJsonMcpConfig(configPath: string): JsonMcpConfig {
  if (!fs.existsSync(configPath)) { return {}; }
  let parsed: unknown;
  try {
    parsed = parseJsonc(fs.readFileSync(configPath, "utf8"));
  } catch (error) {
    throw new Error(`${configPath} is not valid JSON (${error instanceof Error ? error.message : String(error)}). Fix or remove it, then check again.`);
  }
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

function legacyEntries(config: JsonMcpConfig): string[] {
  return Object.keys(config.mcpServers || {}).filter(isLegacyServerName);
}

/** Gemini CLI relocates its ~/.gemini directory when GEMINI_CLI_HOME is set. */
function geminiHome(options?: CodexMcpInstallerOptions): string {
  return options?.userHome || process.env.GEMINI_CLI_HOME || os.homedir();
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
    return path.join(geminiHome(options), ".gemini", "settings.json");
  }
  return path.join(home, ".cursor", "mcp.json");
}

/**
 * Gemini CLI switches off user-level MCP servers in folders it does not trust, and says so only in
 * its own output. Returns a hint when the open workspace is not covered by ~/.gemini/trustedFolders.json.
 */
export function geminiFolderTrustNote(projectRoot: string | undefined, userHome: string): string | undefined {
  if (!projectRoot) { return undefined; }
  try {
    const settingsPath = path.join(userHome, ".gemini", "settings.json");
    if (fs.existsSync(settingsPath)) {
      const settings = parseJsonc(fs.readFileSync(settingsPath, "utf8")) as { security?: { folderTrust?: { enabled?: boolean } } };
      if (settings?.security?.folderTrust?.enabled === false) { return undefined; }
    }
    const trustPath = path.join(userHome, ".gemini", "trustedFolders.json");
    const rules = fs.existsSync(trustPath)
      ? parseJsonc(fs.readFileSync(trustPath, "utf8")) as Record<string, string>
      : {};
    const target = normalizeForComparison(path.resolve(projectRoot));
    const within = (parent: string) => target === parent || target.startsWith(parent.endsWith(path.sep) ? parent : parent + path.sep);
    let trusted = false;
    for (const [rulePath, level] of Object.entries(rules)) {
      const normalized = normalizeForComparison(path.resolve(rulePath));
      if (level === "TRUST_FOLDER" && within(normalized)) { trusted = true; }
      if (level === "TRUST_PARENT" && within(normalizeForComparison(path.dirname(path.resolve(rulePath))))) { trusted = true; }
    }
    for (const [rulePath, level] of Object.entries(rules)) {
      if (level === "DO_NOT_TRUST" && within(normalizeForComparison(path.resolve(rulePath)))) { trusted = false; }
    }
    return trusted ? undefined
      : `Gemini disables user-level MCP servers in folders it does not trust. Run gemini in ${projectRoot} and trust the folder (or add it to ~/.gemini/trustedFolders.json), otherwise the tools will not appear there.`;
  } catch {
    return undefined;
  }
}

function portableStatus(
  id: Exclude<McpClientId, "codex">,
  config: JsonMcpConfig,
  registration: PortableRegistration,
  executable: string | undefined,
  options?: CodexMcpInstallerOptions,
): McpClientStatus {
  const label = CLIENT_LABELS[id];
  const detected = !!executable;
  const canInstall = id === "cursor" || detected;
  const current = config.mcpServers?.[registration.serverName];
  const legacy = legacyEntries(config);

  if (current && !portableDefinitionIsCurrent(current, registration)) {
    return {
      id, label, detected, canInstall,
      state: "outdated",
      serverName: registration.serverName,
      message: "The user-level registration points to another runtime or extension build.",
    };
  }
  if (legacy.length > 0) {
    return {
      id, label, detected, canInstall,
      state: "outdated",
      serverName: registration.serverName,
      message: `${legacy.length} older per-project registration${legacy.length === 1 ? "" : "s"} found. Update to replace ${legacy.length === 1 ? "it" : "them"} with one user-level server that follows whichever project you open.`,
    };
  }
  if (current) {
    const note = id === "gemini"
      ? geminiFolderTrustNote(options?.projectRoot, geminiHome(options))
      : undefined;
    return {
      id, label, detected, canInstall,
      state: "installed",
      serverName: registration.serverName,
      message: `Installed in ${label}'s user configuration; it serves the project ${label} is started in.${note ? ` ${note}` : ""}`,
    };
  }
  return {
    id, label, detected, canInstall: detected,
    state: detected ? "not-installed" : "unavailable",
    serverName: registration.serverName,
    message: detected
      ? `Not installed in ${label}'s user configuration.`
      : `${label} was not found on this machine.`,
  };
}

async function checkPortableClient(
  id: Exclude<McpClientId, "codex">,
  options: CodexMcpInstallerOptions,
): Promise<McpClientStatus> {
  try {
    const registration = portableRegistration(options, id);
    const configured = id === "claude" ? options.configuredClaudeExecutable : options.configuredGeminiExecutable;
    const executable = resolveExecutable(id, configured);
    const config = readJsonMcpConfig(userConfigPath(id, options));
    return portableStatus(id, config, registration, executable, options);
  } catch (error) {
    return {
      id,
      label: CLIENT_LABELS[id],
      state: "error",
      serverName: MCP_SERVER_NAME,
      message: error instanceof Error ? error.message : String(error),
      detected: !!resolveExecutable(id),
      canInstall: false,
    };
  }
}

/** Standard `mcpServers` JSON for clients without a one-click installer. */
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
  const [codex, claude, gemini, cursor] = await Promise.all([
    checkCodexMcpInstallation(options),
    checkPortableClient("claude", options),
    checkPortableClient("gemini", options),
    checkPortableClient("cursor", options),
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
  const current = before.mcpServers?.[registration.serverName];
  const legacy = legacyEntries(before);
  if (current && portableDefinitionIsCurrent(current, registration) && legacy.length === 0) {
    return portableStatus(id, before, registration, executable, options);
  }

  const stale = [...legacy, ...(current ? [registration.serverName] : [])];
  try {
    for (const name of stale) {
      await runExecutable(executable, ["mcp", "remove", "--scope", "user", name]);
    }
    await runExecutable(executable, buildUserScopedMcpAddArguments(
      id,
      registration.serverName,
      registration.runtimeExecutable,
      registration.args,
    ));
  } catch (error) {
    throw new Error(`${CLIENT_LABELS[id]} could not register the MCP server: ${describeCommandFailure(error)}`);
  }

  const after = readJsonMcpConfig(configPath);
  const status = portableStatus(id, after, registration, executable, options);
  if (status.state !== "installed") {
    throw new Error(`${CLIENT_LABELS[id]} accepted the command, but its user-level MCP registration could not be verified in ${configPath}.`);
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
    // Env last: Gemini versions whose parser lets an array option keep consuming words would otherwise
    // swallow the server name and command that follow `-e KEY=value`.
    : [
      "mcp", "add", "--scope", "user", "--transport", "stdio",
      serverName, runtimeExecutable, ...serverArgs, "-e", "ELECTRON_RUN_AS_NODE=1",
    ];
}

function installCursorClient(
  registration: PortableRegistration,
  options: CodexMcpInstallerOptions,
): McpClientStatus {
  const configPath = userConfigPath("cursor", options);
  const config = readJsonMcpConfig(configPath);
  const current = config.mcpServers?.[registration.serverName];
  const legacy = legacyEntries(config);
  if (current && portableDefinitionIsCurrent(current, registration) && legacy.length === 0) {
    return portableStatus("cursor", config, registration, resolveExecutable("cursor"), options);
  }
  config.mcpServers = config.mcpServers || {};
  for (const name of legacy) {
    delete config.mcpServers[name];
  }
  config.mcpServers[registration.serverName] = {
    type: "stdio",
    command: registration.runtimeExecutable,
    args: registration.args,
    env: registration.env,
  };
  writeJsonMcpConfig(configPath, config);
  const status = portableStatus("cursor", readJsonMcpConfig(configPath), registration, resolveExecutable("cursor"), options);
  if (status.state !== "installed") {
    throw new Error("Cursor's global MCP registration could not be verified.");
  }
  return { ...status, restartRequired: true };
}

export async function installMcpClient(
  client: McpClientId,
  options: CodexMcpInstallerOptions,
): Promise<McpClientStatus> {
  if (client === "codex") {
    const status = await installCodexMcp(options);
    return { ...status, id: client, label: CLIENT_LABELS[client], detected: true };
  }
  const registration = portableRegistration(options, client);
  if (client === "cursor") {
    return installCursorClient(registration, options);
  }
  return installCliClient(client, options, registration);
}
