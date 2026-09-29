import * as assert from "assert";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import {
  MCP_SERVER_NAME,
  buildProcessInvocation,
  buildUserScopedMcpAddArguments,
  checkMcpClients,
  childEnvironment,
  codexMcpServerName,
  createUniversalMcpConfig,
  geminiFolderTrustNote,
  installMcpClient,
  isLegacyServerName,
  parseJsonc,
  resolveExecutable,
  toolDirectories,
} from "../../features/semantics/codex-mcp-installer.js";

const extensionRoot = path.resolve(__dirname, "../../..");
const serverEntry = path.join(extensionRoot, "mcp-server", "out", "index.js");

/** A stand-in `gemini` CLI that edits ~/.gemini/settings.json like the real `mcp add` / `mcp remove`. */
function createFakeGemini(directory: string, home: string): string {
  const script = path.join(directory, "fake-gemini.js");
  fs.writeFileSync(script, `
const fs = require("fs"), path = require("path");
const file = path.join(${JSON.stringify(home)}, ".gemini", "settings.json");
const args = process.argv.slice(2);
const read = () => fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, "utf8")) : {};
const write = (json) => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, JSON.stringify(json, null, 2)); };
if (process.env.FAKE_GEMINI_FAIL === "env-node") {
  process.stderr.write("env: node: No such file or directory\\n");
  process.exit(127);
}
if (process.env.FAKE_GEMINI_FAIL) {
  process.stderr.write("\\u001b[31mError in " + file + ": Unexpected token\\u001b[0m\\nPlease fix the configuration file and try again.\\n");
  process.exit(1);
}
if (args[0] === "mcp" && args[1] === "remove") {
  const json = read();
  delete (json.mcpServers || {})[args[args.length - 1]];
  write(json);
} else if (args[0] === "mcp" && args[1] === "add") {
  let index = 2;
  const env = {};
  const positional = [];
  while (index < args.length) {
    if (args[index] === "-e") { const [key, value] = args[index + 1].split("="); env[key] = value; index += 2; }
    else if (args[index].startsWith("--")) { index += 2; }
    else { positional.push(args[index]); index += 1; }
  }
  const [name, command, ...rest] = positional;
  const json = read();
  json.mcpServers = { ...(json.mcpServers || {}), [name]: { command, args: rest, env } };
  write(json);
} else {
  process.exit(2);
}
`);
  if (process.platform === "win32") {
    const launcher = path.join(directory, "fake-gemini.cmd");
    fs.writeFileSync(launcher, `@echo off\r\nnode "%~dp0fake-gemini.js" %*\r\n`);
    return launcher;
  }
  const launcher = path.join(directory, "fake-gemini");
  fs.writeFileSync(launcher, `#!/bin/sh\nexec node "$(dirname "$0")/fake-gemini.js" "$@"\n`, { mode: 0o755 });
  return launcher;
}

suite("MCP user-level installer", () => {
  let userHome: string;

  setup(() => {
    userHome = fs.mkdtempSync(path.join(os.tmpdir(), "fcm-mcp-clients-"));
  });

  teardown(() => {
    fs.rmSync(userHome, { recursive: true, force: true });
  });

  test("uses one short user-level name and recognizes the per-project names of earlier versions", () => {
    assert.strictEqual(MCP_SERVER_NAME, "flutter-config-manager");
    assert.ok(MCP_SERVER_NAME.length <= 24, "clients prefix tool names with it; Gemini truncates above 63 characters");
    assert.ok(!isLegacyServerName(MCP_SERVER_NAME));
    const legacy = codexMcpServerName(path.resolve("sample projects", "My Flutter App"));
    assert.match(legacy, /^flutter-config-manager-my-flutter-app-[a-f0-9]{8}$/);
    assert.ok(isLegacyServerName(legacy));
  });

  test("executes native binaries directly on macOS and Linux", () => {
    const invocation = buildProcessInvocation("/usr/local/bin/codex", ["mcp", "list"], "linux");
    assert.deepStrictEqual(invocation, {
      file: "/usr/local/bin/codex",
      args: ["mcp", "list"],
    });
  });

  test("uses an encoded PowerShell invocation for Windows command shims", () => {
    const executable = "C:\\Users\\Example User\\AppData\\Roaming\\npm\\codex.cmd";
    const args = ["mcp", "add", "workspace", "--", "C:\\Program Files\\nodejs\\node.exe", "C:\\Project & App\\server.js"];
    const invocation = buildProcessInvocation(executable, args, "win32", { SystemRoot: "C:\\Windows" });

    assert.strictEqual(invocation.file, "C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe");
    assert.strictEqual(invocation.args.at(-2), "-EncodedCommand");
    const script = Buffer.from(invocation.args.at(-1) || "", "base64").toString("utf16le");
    assert.ok(!script.includes(executable), "raw paths must not be interpolated into a shell command");
    const payloadMatch = /FromBase64String\('([^']+)'\)/.exec(script);
    assert.ok(payloadMatch);
    const payload = JSON.parse(Buffer.from(payloadMatch[1], "base64").toString("utf8"));
    assert.deepStrictEqual(payload, { executable, args });
  });

  test("builds documented user-scope commands for Claude and Gemini", () => {
    const args = ["server.js"];
    assert.deepStrictEqual(
      buildUserScopedMcpAddArguments("claude", MCP_SERVER_NAME, "/runtime/node", args),
      [
        "mcp", "add", "--scope", "user", "--transport", "stdio", MCP_SERVER_NAME,
        "-e", "ELECTRON_RUN_AS_NODE=1", "--", "/runtime/node", ...args,
      ],
    );
    assert.deepStrictEqual(
      buildUserScopedMcpAddArguments("gemini", MCP_SERVER_NAME, "/runtime/node", args),
      [
        // Env last, so a Gemini whose array option keeps consuming words cannot swallow the name and command.
        "mcp", "add", "--scope", "user", "--transport", "stdio",
        MCP_SERVER_NAME, "/runtime/node", ...args, "-e", "ELECTRON_RUN_AS_NODE=1",
      ],
    );
  });

  suite("macOS and Linux discovery", () => {
    function makeHome(): string {
      const home = fs.mkdtempSync(path.join(os.tmpdir(), "fcm-mac-home-"));
      for (const version of ["v20.11.0", "v22.1.0", "v8.9.0"]) {
        const bin = path.join(home, ".nvm", "versions", "node", version, "bin");
        fs.mkdirSync(bin, { recursive: true });
        fs.writeFileSync(path.join(bin, "gemini"), "#!/usr/bin/env node\n", { mode: 0o755 });
        fs.writeFileSync(path.join(bin, "node"), "", { mode: 0o755 });
      }
      return home;
    }

    test("finds a version-manager install that a Dock-launched editor's minimal PATH cannot see", () => {
      const home = makeHome();
      try {
        const minimalPath = ["/usr/bin", "/bin", "/usr/sbin", "/sbin"].join(path.delimiter);
        const found = resolveExecutable("gemini", undefined, { PATH: minimalPath }, { platform: "darwin", home });
        assert.ok(found, "gemini should be found through ~/.nvm");
        assert.ok(found.includes(path.join("v22.1.0", "bin")), `newest Node version wins: ${found}`);
      } finally {
        fs.rmSync(home, { recursive: true, force: true });
      }
    });

    test("puts the CLI's own directory and the version-manager directories in front of a minimal PATH", () => {
      const home = makeHome();
      try {
        const executable = path.join(home, ".nvm", "versions", "node", "v22.1.0", "bin", "gemini");
        const env = childEnvironment(executable, { PATH: ["/usr/bin", "/bin"].join(path.delimiter) }, { platform: "darwin", home });
        const entries = (env.PATH || "").split(path.delimiter);
        assert.strictEqual(entries[0], path.dirname(executable), "node sits beside the CLI, so `env node` succeeds");
        assert.ok(entries.includes(path.join(home, ".nvm", "versions", "node", "v20.11.0", "bin")));
        assert.ok(entries.indexOf("/usr/bin") > 0, "the original PATH is kept, after the additions");
        assert.strictEqual(new Set(entries).size, entries.length, "no duplicate entries");
      } finally {
        fs.rmSync(home, { recursive: true, force: true });
      }
    });

    test("leaves the Windows environment alone (PowerShell resolves .cmd shims itself)", () => {
      const env = { Path: "C:\\Windows" };
      assert.strictEqual(childEnvironment("C:\\x\\gemini.cmd", env, { platform: "win32" }), env);
    });

    test("lists Homebrew, npm-global and version-manager locations on macOS", () => {
      const directories = toolDirectories({}, { platform: "darwin", home: "/Users/example" });
      for (const expected of ["/opt/homebrew/bin", "/usr/local/bin", path.join("/Users/example", ".npm-global", "bin"), path.join("/Users/example", ".volta", "bin")]) {
        assert.ok(directories.includes(expected), `${expected} missing from ${directories.join(", ")}`);
      }
    });
  });

  test("the standard config carries no project: the client's working directory decides", () => {
    const portable = JSON.parse(createUniversalMcpConfig({ extensionRoot, userHome }));
    assert.deepStrictEqual(Object.keys(portable.mcpServers), [MCP_SERVER_NAME]);
    assert.deepStrictEqual(portable.mcpServers[MCP_SERVER_NAME].args, [serverEntry]);
    assert.ok(!JSON.stringify(portable).includes("--project"));
  });

  test("installs Cursor globally once, follows its workspace, and replaces per-project entries", async () => {
    const cursorConfigPath = path.join(userHome, ".cursor", "mcp.json");
    fs.mkdirSync(path.dirname(cursorConfigPath), { recursive: true });
    const legacyA = codexMcpServerName(path.join(userHome, "app_one"));
    const legacyB = codexMcpServerName(path.join(userHome, "app_two"));
    fs.writeFileSync(cursorConfigPath, JSON.stringify({
      mcpServers: {
        other: { command: "other-server" },
        [legacyA]: { type: "stdio", command: process.execPath, args: [serverEntry, "--project", path.join(userHome, "app_one")], env: { ELECTRON_RUN_AS_NODE: "1" } },
        [legacyB]: { type: "stdio", command: process.execPath, args: [serverEntry, "--project", path.join(userHome, "app_two")], env: { ELECTRON_RUN_AS_NODE: "1" } },
      },
    }));
    const options = { extensionRoot, userHome };

    const before = (await checkMcpClients(options)).clients.find((client) => client.id === "cursor");
    assert.strictEqual(before?.state, "outdated");
    assert.match(before?.message ?? "", /2 older per-project registrations/);

    const first = await installMcpClient("cursor", options);
    const second = await installMcpClient("cursor", options);
    assert.strictEqual(first.state, "installed");
    assert.strictEqual(second.state, "installed");

    const config = JSON.parse(fs.readFileSync(cursorConfigPath, "utf8"));
    assert.deepStrictEqual(Object.keys(config.mcpServers).sort(), ["other", MCP_SERVER_NAME].sort());
    assert.deepStrictEqual(config.mcpServers[MCP_SERVER_NAME].args, [serverEntry, "--project", "${workspaceFolder}"]);
    assert.strictEqual(config.mcpServers[MCP_SERVER_NAME].env.ELECTRON_RUN_AS_NODE, "1");
  });

  suite("Gemini CLI", () => {
    let fakeGemini: string;
    let options: { extensionRoot: string; userHome: string; configuredGeminiExecutable: string };
    const settingsPath = () => path.join(userHome, ".gemini", "settings.json");

    setup(() => {
      fakeGemini = createFakeGemini(userHome, userHome);
      options = { extensionRoot, userHome, configuredGeminiExecutable: fakeGemini };
    });

    teardown(() => {
      delete process.env.FAKE_GEMINI_FAIL;
    });

    test("registers one user-level server without a project path", async () => {
      const result = await installMcpClient("gemini", options);
      assert.strictEqual(result.state, "installed");
      const settings = JSON.parse(fs.readFileSync(settingsPath(), "utf8"));
      assert.deepStrictEqual(Object.keys(settings.mcpServers), [MCP_SERVER_NAME]);
      assert.deepStrictEqual(settings.mcpServers[MCP_SERVER_NAME].args, [serverEntry]);
      assert.strictEqual(settings.mcpServers[MCP_SERVER_NAME].env.ELECTRON_RUN_AS_NODE, "1");
    });

    test("replaces per-project registrations from earlier versions and keeps unrelated servers", async () => {
      fs.mkdirSync(path.dirname(settingsPath()), { recursive: true });
      const legacy = codexMcpServerName(path.join(userHome, "old_app"));
      fs.writeFileSync(settingsPath(), JSON.stringify({
        mcpServers: {
          keep: { command: "keep-me" },
          [legacy]: { command: process.execPath, args: [serverEntry, "--project", path.join(userHome, "old_app")], env: { ELECTRON_RUN_AS_NODE: "1" } },
        },
      }));
      const status = (await checkMcpClients(options)).clients.find((client) => client.id === "gemini");
      assert.strictEqual(status?.state, "outdated");

      await installMcpClient("gemini", options);
      const settings = JSON.parse(fs.readFileSync(settingsPath(), "utf8"));
      assert.deepStrictEqual(Object.keys(settings.mcpServers).sort(), ["keep", MCP_SERVER_NAME].sort());
      const again = (await checkMcpClients(options)).clients.find((client) => client.id === "gemini");
      assert.strictEqual(again?.state, "installed");
    });

    test("reads a settings file with comments and trailing commas instead of failing", async () => {
      fs.mkdirSync(path.dirname(settingsPath()), { recursive: true });
      fs.writeFileSync(settingsPath(), `{
  // Gemini allows comments in settings.json
  "security": { "auth": { "selectedType": "oauth-personal" }, },
  /* block */ "mcpServers": {}
}`);
      const status = (await checkMcpClients(options)).clients.find((client) => client.id === "gemini");
      assert.strictEqual(status?.state, "not-installed");
      assert.strictEqual(status?.canInstall, true);
    });

    test("shows Gemini's own error, not the encoded PowerShell command", async () => {
      process.env.FAKE_GEMINI_FAIL = "1";
      await assert.rejects(
        () => installMcpClient("gemini", options),
        (error: Error) => {
          assert.match(error.message, /Gemini CLI could not register the MCP server/);
          assert.match(error.message, /Please fix the configuration file and try again/);
          assert.ok(!error.message.includes("EncodedCommand"), error.message);
          assert.ok(!error.message.includes("\u001b"), "terminal colour codes are stripped");
          return true;
        },
      );
    });

    test("explains a missing Node.js when the CLI cannot start (env: node: No such file)", async () => {
      process.env.FAKE_GEMINI_FAIL = "env-node";
      await assert.rejects(
        () => installMcpClient("gemini", options),
        (error: Error) => {
          assert.match(error.message, /env: node: No such file or directory/);
          assert.match(error.message, /Node\.js is not on the PATH this editor was started with/);
          return true;
        },
      );
    });

    test("follows GEMINI_CLI_HOME, where Gemini keeps its settings when the variable is set", async () => {
      const relocated = fs.mkdtempSync(path.join(os.tmpdir(), "fcm-gemini-home-"));
      const previous = process.env.GEMINI_CLI_HOME;
      try {
        process.env.GEMINI_CLI_HOME = relocated;
        fs.mkdirSync(path.join(relocated, ".gemini"), { recursive: true });
        fs.writeFileSync(path.join(relocated, ".gemini", "settings.json"), JSON.stringify({
          mcpServers: { [MCP_SERVER_NAME]: { command: process.execPath, args: [serverEntry], env: { ELECTRON_RUN_AS_NODE: "1" } } },
        }));
        const status = (await checkMcpClients({ extensionRoot, configuredGeminiExecutable: fakeGemini }))
          .clients.find((client) => client.id === "gemini");
        assert.strictEqual(status?.state, "installed");
      } finally {
        if (previous === undefined) { delete process.env.GEMINI_CLI_HOME; } else { process.env.GEMINI_CLI_HOME = previous; }
        fs.rmSync(relocated, { recursive: true, force: true });
      }
    });

    test("warns when Gemini will ignore user-level servers in an untrusted folder", async () => {
      const project = path.join(userHome, "workspace", "app");
      assert.match(geminiFolderTrustNote(project, userHome) ?? "", /does not trust|not trust/);

      fs.mkdirSync(path.join(userHome, ".gemini"), { recursive: true });
      fs.writeFileSync(path.join(userHome, ".gemini", "trustedFolders.json"), JSON.stringify({ [path.join(userHome, "workspace")]: "TRUST_FOLDER" }));
      assert.strictEqual(geminiFolderTrustNote(project, userHome), undefined);

      fs.writeFileSync(path.join(userHome, ".gemini", "trustedFolders.json"), JSON.stringify({ [project]: "TRUST_PARENT" }));
      assert.strictEqual(geminiFolderTrustNote(project, userHome), undefined, "TRUST_PARENT trusts the parent directory");

      fs.writeFileSync(path.join(userHome, ".gemini", "trustedFolders.json"), JSON.stringify({ [path.join(userHome, "workspace")]: "TRUST_FOLDER", [project]: "DO_NOT_TRUST" }));
      assert.ok(geminiFolderTrustNote(project, userHome));

      fs.writeFileSync(path.join(userHome, ".gemini", "settings.json"), JSON.stringify({ security: { folderTrust: { enabled: false } } }));
      assert.strictEqual(geminiFolderTrustNote(project, userHome), undefined, "nothing to warn about when folder trust is off");
    });

    test("puts the trust warning in the installed status message", async () => {
      await installMcpClient("gemini", { ...options, projectRoot: path.join(userHome, "workspace", "app") });
      const status = (await checkMcpClients({ ...options, projectRoot: path.join(userHome, "workspace", "app") }))
        .clients.find((client) => client.id === "gemini");
      assert.strictEqual(status?.state, "installed");
      assert.match(status?.message ?? "", /trust/i);
    });
  });

  test("parseJsonc keeps // inside strings and removes comments and trailing commas", () => {
    const parsed = parseJsonc(`{
      // comment
      "url": "https://example.com//path", /* inline */ "list": [1, 2,],
    }`) as { url: string; list: number[] };
    assert.strictEqual(parsed.url, "https://example.com//path");
    assert.deepStrictEqual(parsed.list, [1, 2]);
  });
});
