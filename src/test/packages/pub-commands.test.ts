import * as assert from "assert";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import * as vscode from "vscode";
import { ToolNotFoundError, resolveFlutter, runFlutter } from "../../core/utils/exec.js";
import { assertValidPackageName, downgradePackage, removePackage, upgradePackage } from "../../features/packages/pub.service.js";

/** A fake Flutter SDK whose `flutter` records its arguments (as JSON) in `logFile`. */
function createFakeSdk(root: string, logFile: string): string {
  const sdk = path.join(root, "sdk with space");
  const bin = path.join(sdk, "bin");
  fs.mkdirSync(bin, { recursive: true });
  fs.writeFileSync(path.join(bin, "record.js"), `
require("fs").writeFileSync(${JSON.stringify(logFile)}, JSON.stringify(process.argv.slice(2)));
console.log(JSON.stringify(process.argv.slice(2)));
`);
  if (process.platform === "win32") {
    fs.writeFileSync(path.join(bin, "flutter.bat"), `@echo off\r\nnode "%~dp0record.js" %*\r\n`);
  } else {
    fs.writeFileSync(path.join(bin, "flutter"), `#!/bin/sh\nexec node "$(dirname "$0")/record.js" "$@"\n`, { mode: 0o755 });
  }
  return sdk;
}

suite("pub commands", () => {
  let scratch: string;
  let logFile: string;
  let sdk: string;
  const previousFlutterRoot = process.env.FLUTTER_ROOT;
  const originalGetConfiguration = vscode.workspace.getConfiguration;
  let configured: Record<string, string | undefined> = {};

  /** The Dart extension registers `dart.*`; the test host has none, so serve the values from here. */
  const setDartSetting = (key: string, value: string | undefined): void => {
    configured[key] = value;
  };

  setup(() => {
    scratch = fs.mkdtempSync(path.join(os.tmpdir(), "fcm-pub-"));
    logFile = path.join(scratch, "args.json");
    sdk = createFakeSdk(scratch, logFile);
    process.env.FLUTTER_ROOT = sdk;
    configured = {};
    (vscode.workspace as { getConfiguration: unknown }).getConfiguration = (section?: string, scope?: unknown) => {
      if (section === "dart") {
        return { get: (key: string) => configured[key] } as unknown as vscode.WorkspaceConfiguration;
      }
      return originalGetConfiguration.call(vscode.workspace, section, scope as vscode.ConfigurationScope);
    };
  });

  teardown(() => {
    (vscode.workspace as { getConfiguration: unknown }).getConfiguration = originalGetConfiguration;
    if (previousFlutterRoot === undefined) { delete process.env.FLUTTER_ROOT; } else { process.env.FLUTTER_ROOT = previousFlutterRoot; }
    fs.rmSync(scratch, { recursive: true, force: true });
  });

  const recordedArguments = (): string[] => JSON.parse(fs.readFileSync(logFile, "utf8")) as string[];

  test("ignores a configured SDK path that does not exist and falls back (the 'cannot find the path' failure)", async () => {
    setDartSetting("flutterSdkPath", path.join(scratch, "devtools", "flutter"));
    const resolved = resolveFlutter();
    assert.strictEqual(resolved.source, "discovered");
    assert.ok(resolved.executable.startsWith(sdk), resolved.executable);
    assert.strictEqual(resolved.skipped.length, 1);
    assert.match(resolved.skipped[0], /dart\.flutterSdkPath/);
  });

  test("uses the configured SDK when it exists", async () => {
    setDartSetting("flutterSdkPath", sdk);
    const resolved = resolveFlutter();
    assert.strictEqual(resolved.source, "setting");
    assert.deepStrictEqual(resolved.skipped, []);
  });

  test("explains what was checked when no Flutter SDK can be found", async () => {
    delete process.env.FLUTTER_ROOT;
    setDartSetting("flutterSdkPath", path.join(scratch, "missing"));
    // PATH and the usual install folders may legitimately contain Flutter on a developer machine.
    try {
      resolveFlutter();
    } catch (error) {
      assert.ok(error instanceof ToolNotFoundError);
      assert.match((error as Error).message, /dart\.flutterSdkPath/);
      assert.match((error as Error).message, /PATH/);
    }
  });

  test("runs Flutter without a shell: arguments reach it exactly as given", async () => {
    await runFlutter(["pub", "add", "name with space & more; echo injected"]);
    assert.deepStrictEqual(recordedArguments(), ["pub", "add", "name with space & more; echo injected"]);
  });

  test("Update uses --major-versions only when asked to move past the version range", async () => {
    await upgradePackage("http");
    assert.deepStrictEqual(recordedArguments(), ["pub", "upgrade", "http"]);
    await upgradePackage("http", { major: true });
    assert.deepStrictEqual(recordedArguments(), ["pub", "upgrade", "--major-versions", "http"]);
  });

  test("remove and downgrade pass a single validated argument", async () => {
    await removePackage("flutter_bloc");
    assert.deepStrictEqual(recordedArguments(), ["pub", "remove", "flutter_bloc"]);
    await downgradePackage("mockito");
    assert.deepStrictEqual(recordedArguments(), ["pub", "add", "dev:mockito"]);
  });

  test("rejects package names that could carry shell syntax, before any process starts", async () => {
    for (const hostile of ["http & calc", "a;b", "a|b", "$(id)", "`id`", "../x", "Foo", "a b", "", "1abc", "x\nrm"]) {
      assert.throws(() => assertValidPackageName(hostile), /not a valid pub package name/, hostile);
      await assert.rejects(() => removePackage(hostile), /not a valid pub package name/, hostile);
    }
    assert.ok(!fs.existsSync(logFile), "no process should have been started");
    for (const good of ["http", "flutter_bloc", "a2", "very_long_name_with_digits_123"]) {
      assert.strictEqual(assertValidPackageName(good), good);
    }
  });
});
