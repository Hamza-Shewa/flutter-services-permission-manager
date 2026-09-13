import * as assert from "assert";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import {
  buildProcessInvocation,
  buildUserScopedMcpAddArguments,
  codexMcpServerName,
  createUniversalMcpConfig,
  installMcpClient,
} from "../../features/semantics/codex-mcp-installer.js";

suite("Codex MCP user-level installer", () => {
  test("creates a stable workspace-specific server name", () => {
    const root = path.resolve("sample projects", "My Flutter App");
    const first = codexMcpServerName(root);
    const second = codexMcpServerName(root);
    assert.strictEqual(first, second);
    assert.match(first, /^flutter-config-manager-my-flutter-app-[a-f0-9]{8}$/);
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
    const args = ["server.js", "--project", "/workspace/app"];
    assert.deepStrictEqual(
      buildUserScopedMcpAddArguments("claude", "flutter-app", "/runtime/node", args),
      [
        "mcp", "add", "--scope", "user", "--transport", "stdio", "flutter-app",
        "-e", "ELECTRON_RUN_AS_NODE=1", "--", "/runtime/node", ...args,
      ],
    );
    assert.deepStrictEqual(
      buildUserScopedMcpAddArguments("gemini", "flutter-app", "/runtime/node", args),
      [
        "mcp", "add", "--scope", "user", "--transport", "stdio",
        "-e", "ELECTRON_RUN_AS_NODE=1", "flutter-app", "/runtime/node", ...args,
      ],
    );
  });

  test("creates a standard config and installs Cursor globally without duplicates", async () => {
    const userHome = fs.mkdtempSync(path.join(os.tmpdir(), "fcm-mcp-clients-"));
    const projectRoot = path.join(userHome, "flutter_app");
    fs.mkdirSync(projectRoot);
    const extensionRoot = path.resolve(__dirname, "../../..");
    const options = { projectRoot, extensionRoot, userHome };
    try {
      const portable = JSON.parse(createUniversalMcpConfig(options));
      assert.ok(portable.mcpServers[codexMcpServerName(projectRoot)]);

      const first = await installMcpClient("cursor", options);
      const second = await installMcpClient("cursor", options);
      assert.strictEqual(first.state, "installed");
      assert.strictEqual(second.state, "installed");

      const cursorConfig = JSON.parse(fs.readFileSync(path.join(userHome, ".cursor", "mcp.json"), "utf8"));
      assert.strictEqual(Object.keys(cursorConfig.mcpServers).length, 1);
      assert.strictEqual(
        cursorConfig.mcpServers[first.serverName].env.ELECTRON_RUN_AS_NODE,
        "1",
      );
    } finally {
      fs.rmSync(userHome, { recursive: true, force: true });
    }
  });
});
