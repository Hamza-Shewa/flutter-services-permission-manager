import * as assert from "assert";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import * as vscode from "vscode";
import { replaceDocumentContent, updateDocument } from "../../core/document.service.js";
import {
  isKotlinDsl,
  replaceGradlePropertyLine,
  versionNameExpression,
} from "../../features/build/build-file-utils.js";

suite("Document edits", () => {
  let scratch: string;
  setup(() => { scratch = fs.mkdtempSync(path.join(os.tmpdir(), "fcm-doc-")); });
  teardown(() => { fs.rmSync(scratch, { recursive: true, force: true }); });

  test("parallel edits to one file all land (no lost updates)", async () => {
    const file = path.join(scratch, "Podfile");
    fs.writeFileSync(file, "base\n");
    const uri = vscode.Uri.file(file);
    const markers = Array.from({ length: 12 }, (_, i) => `# edit ${i}`);
    const results = await Promise.all(markers.map((marker) => updateDocument(uri, (text) => `${text}${marker}\n`)));
    assert.ok(results.every(Boolean));
    const onDisk = fs.readFileSync(file, "utf8");
    for (const marker of markers) {
      assert.ok(onDisk.includes(marker), `${marker} was lost`);
    }
    assert.ok(onDisk.startsWith("base\n"));
  });

  test("a no-op transform does not touch the file", async () => {
    const file = path.join(scratch, "a.gradle");
    fs.writeFileSync(file, "x");
    const before = fs.statSync(file).mtimeMs;
    assert.strictEqual(await updateDocument(vscode.Uri.file(file), (text) => text), false);
    assert.strictEqual(fs.statSync(file).mtimeMs, before);
  });

  test("a failing edit does not block later edits to the same file", async () => {
    const file = path.join(scratch, "b.gradle");
    fs.writeFileSync(file, "one");
    const uri = vscode.Uri.file(file);
    const failing = updateDocument(uri, () => { throw new Error("boom"); });
    const following = updateDocument(uri, (text) => `${text}-two`);
    await assert.rejects(failing, /boom/);
    assert.strictEqual(await following, true);
    assert.strictEqual(fs.readFileSync(file, "utf8"), "one-two");
  });

  test("replaceDocumentContent writes to disk and reports failures instead of pretending to succeed", async () => {
    const file = path.join(scratch, "Info.plist");
    fs.writeFileSync(file, "old");
    await replaceDocumentContent(vscode.Uri.file(file), "new");
    assert.strictEqual(fs.readFileSync(file, "utf8"), "new");
    await assert.rejects(() => replaceDocumentContent(vscode.Uri.file(path.join(scratch, "missing", "nope.plist")), "x"));
  });

  suite("Gradle property rewriting", () => {
    test("isKotlinDsl", () => {
      assert.strictEqual(isKotlinDsl("android/app/build.gradle.kts"), true);
      assert.strictEqual(isKotlinDsl("android/app/build.gradle"), false);
    });

    test("compileSdk does not clobber compileSdkVersion and vice versa", () => {
      const groovy = "    compileSdkVersion 33\n    applicationIdSuffix \".dev\"\n    applicationId \"a.b\"\n";
      let out = replaceGradlePropertyLine(groovy, "compileSdkVersion", "34", false);
      out = replaceGradlePropertyLine(out, "compileSdk", "34", false);
      assert.strictEqual(out, "    compileSdkVersion 34\n    applicationIdSuffix \".dev\"\n    applicationId \"a.b\"\n");
      const suffix = replaceGradlePropertyLine(groovy, "applicationId", "x.y", true);
      assert.ok(suffix.includes("applicationIdSuffix \".dev\""));
      assert.ok(suffix.includes("applicationId \"x.y\""));
    });

    test("Kotlin DSL always gets an assignment", () => {
      const kts = "        minSdk = flutter.minSdkVersion\n        applicationId = \"a.b\"\n";
      const out = replaceGradlePropertyLine(kts, "minSdk", "23", false, { kotlinDsl: true });
      assert.strictEqual(out, "        minSdk = 23\n        applicationId = \"a.b\"\n");
      assert.strictEqual(replaceGradlePropertyLine("        minSdk 21\n", "minSdk", "23", false, { kotlinDsl: true }), "        minSdk = 23\n");
    });

    test("versionName never references a variable the file does not define", () => {
      const kts = "        versionName = flutter.versionName\n";
      assert.strictEqual(versionNameExpression(kts, true), "flutter.versionName");
      assert.strictEqual(versionNameExpression("        versionName = flutter.versionName\n", false), "flutter.versionName");
      assert.strictEqual(versionNameExpression("def flutterVersionName = localProperties.getProperty('x')\nversionName flutterVersionName\n", false), "flutterVersionName");
      const out = replaceGradlePropertyLine(kts, "versionName", versionNameExpression(kts, true), false, { kotlinDsl: true });
      assert.strictEqual(out, kts);
    });
  });
});
