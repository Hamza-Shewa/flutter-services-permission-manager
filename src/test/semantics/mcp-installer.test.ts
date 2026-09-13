import * as assert from "assert";
import * as path from "path";
import {
  buildProcessInvocation,
  codexMcpServerName,
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
});
