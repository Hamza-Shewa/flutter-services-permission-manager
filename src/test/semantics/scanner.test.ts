import * as assert from "assert";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import {
  applySemanticsPreviewToFiles,
  buildSemanticsImplementationPrompt,
  flattenInteractiveFindings,
  previewSemanticsFixes,
  scanInteractives,
} from "../../features/semantics/index.js";

suite("Semantics scanner and fixer", () => {
  const fixture = path.resolve(__dirname, "../../../src/test/fixtures/semantics_project");

  test("groups interactive widgets, preserves evidence, and excludes generated files", async () => {
    const result = await scanInteractives(fixture, { callbackNames: ["onActivate"] });
    assert.strictEqual(result.totals.filesScanned, 1);
    assert.strictEqual(result.groups.length, 1);
    assert.strictEqual(result.groups[0].path, "lib/main.dart");
    assert.ok(result.excludedPaths.includes("lib/generated/model.g.dart"));
    const findings = flattenInteractiveFindings(result);
    assert.strictEqual(findings.length, 6);
    assert.strictEqual(result.totals.accessibilityMissing, 1);
    assert.strictEqual(result.totals.accessibilityUncertain, 2);
    assert.strictEqual(result.totals.automationMissing, 5);
    assert.strictEqual(findings.find((item) => item.widgetType === "TextButton")?.automation, "present");
    assert.strictEqual(findings.find((item) => item.widgetType === "IconButton")?.accessibility, "missing");
    assert.strictEqual(findings.find((item) => item.widgetType === "CustomAction")?.confidence, "medium");
    assert.strictEqual(findings.find((item) => item.widgetType === "WebViewWidget")?.kind, "opaque");
  });

  test("builds a project-specific shared-widget-first AI prompt", async () => {
    const result = await scanInteractives(fixture, { callbackNames: ["onActivate"] });
    const prompt = buildSemanticsImplementationPrompt(result);
    assert.ok(prompt.includes(result.projectRoot));
    assert.ok(prompt.includes("Resolve ownership and shared-widget usage before editing"));
    assert.ok(prompt.includes("resolving its import/export path"));
    assert.ok(prompt.includes("resolved project-relative source path"));
    assert.ok(prompt.includes("VisitorArea used as a button"));
    assert.ok(prompt.includes('"visitor area button"'));
    assert.ok(prompt.includes("never \"visitor area button button\""));
    assert.ok(prompt.includes("Generic shared names such as MobileButton"));
    assert.ok(prompt.includes("recommend the localization key/value"));
    assert.ok(prompt.includes("Only as a last resort"));
    assert.ok(prompt.includes(`Accessibility missing: ${result.totals.accessibilityMissing}`));
    assert.ok(prompt.includes("Never use a list index"));
    assert.ok(prompt.includes("textDirection: Directionality.of(context)"));
    assert.ok(prompt.includes("custom Semantics-wrapped GestureDetector controls"));
    assert.ok(prompt.includes("adb shell uiautomator dump /sdcard/window.xml"));
    assert.ok(prompt.includes("resource-id"));
    assert.ok(prompt.includes("content-desc"));
    assert.ok(prompt.includes("No forced semantics handle"));
  });

  test("previews and applies a content-hashed identifier fix", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "flutter-semantics-test-"));
    fs.mkdirSync(path.join(root, "lib"));
    fs.copyFileSync(path.join(fixture, "lib", "main.dart"), path.join(root, "lib", "main.dart"));
    try {
      const result = await scanInteractives(root);
      const finding = flattenInteractiveFindings(result).find((item) => item.widgetType === "ElevatedButton");
      assert.ok(finding);
      const preview = await previewSemanticsFixes(root, [{
        occurrenceId: finding.occurrenceId,
        identifier: "auth.login.submit",
      }]);
      assert.strictEqual(preview.changes.length, 1);
      assert.ok(preview.changes[0].afterSnippet.includes("Semantics(identifier: 'auth.login.submit'"));
      const applied = await applySemanticsPreviewToFiles(root, preview.previewId);
      assert.strictEqual(applied.ok, true);
      assert.ok(fs.readFileSync(path.join(root, "lib", "main.dart"), "utf8").includes("auth.login.submit"));
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  test("rejects stale previews without overwriting the file", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "flutter-semantics-stale-"));
    fs.mkdirSync(path.join(root, "lib"));
    const target = path.join(root, "lib", "main.dart");
    fs.copyFileSync(path.join(fixture, "lib", "main.dart"), target);
    try {
      const result = await scanInteractives(root);
      const finding = flattenInteractiveFindings(result).find((item) => item.widgetType === "IconButton");
      assert.ok(finding);
      const preview = await previewSemanticsFixes(root, [{
        occurrenceId: finding.occurrenceId,
        identifier: "auth.login.help",
      }]);
      fs.appendFileSync(target, "\n// concurrent edit\n");
      await assert.rejects(() => applySemanticsPreviewToFiles(root, preview.previewId), /changed after preview/);
      assert.ok(fs.readFileSync(target, "utf8").includes("concurrent edit"));
      assert.ok(!fs.readFileSync(target, "utf8").includes("auth.login.help"));
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});
