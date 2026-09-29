import * as assert from "assert";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import {
  buildSemanticsImplementationPrompt,
  flattenInteractiveFindings,
  previewSemanticsFixes,
  scanInteractives,
} from "../../features/semantics/index.js";
import type { InteractiveFinding, InteractiveScanResult } from "../../features/semantics/types.js";

suite("Shared widget semantics", () => {
  const fixture = path.resolve(__dirname, "../../../src/test/fixtures/semantics_shared_project");
  let scan: InteractiveScanResult;
  let findings: InteractiveFinding[];

  suiteSetup(async () => {
    scan = await scanInteractives(fixture);
    findings = flattenInteractiveFindings(scan);
  });

  const widget = (name: string) => scan.widgets.find((candidate) => candidate.className === name);
  const at = (file: string, line: number) =>
    findings.find((finding) => finding.source.path.endsWith(file) && finding.source.line === line);

  test("resolves project widgets through export barrels and lists shared controls in fix order", () => {
    const names = scan.widgets.map((item) => item.className);
    assert.deepStrictEqual(new Set(names), new Set(["PrimaryButton", "IconAction", "LabeledButton", "SaveBar"]));
    const layers = scan.widgets.map((item) => item.layer);
    assert.deepStrictEqual(layers, [...layers].sort((left, right) => left - right), "base widgets come before wrappers");

    const primary = widget("PrimaryButton")!;
    assert.strictEqual(primary.callSites, 4);
    assert.strictEqual(primary.callSiteFiles, 3);
    assert.strictEqual(primary.sharedReason, "call-sites");
    assert.strictEqual(primary.layer, 0);

    const saveBar = widget("SaveBar")!;
    assert.strictEqual(saveBar.layer, 1);
    assert.deepStrictEqual(saveBar.wraps, ["PrimaryButton"]);
  });

  test("composites and screens are not shared controls", () => {
    assert.ok(!widget("ToolbarRow"), "two independent controls need their own identifiers");
    assert.ok(!widget("CartScreen"));
    assert.strictEqual(at("toolbar_row.dart", 14)?.role, "sdk");
  });

  test("decides which parameters each widget still needs", () => {
    assert.deepStrictEqual(widget("PrimaryButton")!.requiredParamsToAdd, ["required String semanticsIdentifier"]);
    assert.strictEqual(widget("PrimaryButton")!.hasVisibleText, true);
    // No visible text and an optional tooltip: the label must become required, reusing the widget's own name.
    assert.deepStrictEqual(widget("IconAction")!.requiredParamsToAdd, ["required String semanticsIdentifier", "make tooltip required"]);
    assert.strictEqual(widget("IconAction")!.hasVisibleText, false);
    // A wrapper of a text-bearing widget shows text too.
    assert.strictEqual(widget("SaveBar")!.hasVisibleText, true);
  });

  test("recognises a complete contract and counts the call sites that use it", () => {
    const labeled = widget("LabeledButton")!;
    assert.strictEqual(labeled.contract.status, "complete");
    assert.strictEqual(labeled.contract.identifier?.name, "semanticsIdentifier");
    assert.strictEqual(labeled.contract.identifier?.required, true);
    assert.deepStrictEqual(labeled.requiredParamsToAdd, []);
    assert.strictEqual(labeled.callSitesMissing, 1);
    assert.strictEqual(at("cart_screen.dart", 19)?.automation, "present");
    assert.strictEqual(at("cart_screen.dart", 19)?.semantics.viaWidgetContract, true);
    assert.strictEqual(at("cart_screen.dart", 20)?.automation, "missing");
  });

  test("a shared widget's own interactive root delegates its identifier to the contract", () => {
    const root = at("labeled_button.dart", 21);
    assert.strictEqual(root?.role, "shared-definition-root");
    assert.strictEqual(root?.automation, "present");
    const unfixed = at("primary_button.dart", 11);
    assert.strictEqual(unfixed?.role, "shared-definition-root");
    assert.strictEqual(unfixed?.automation, "missing");
  });

  test("call sites are findings even when the callback has a custom name", () => {
    const call = at("cart_screen.dart", 21);
    assert.strictEqual(call?.widgetType, "SaveBar");
    assert.strictEqual(call?.role, "shared-call-site");
    assert.strictEqual(call?.resolved?.shared, true);
    assert.strictEqual(call?.owner?.className, "CartScreen");
  });

  test("ambiguous names are reported instead of guessed, and unambiguous ones resolve by imports", () => {
    const both = at("both_page.dart", 9);
    assert.ok(both?.ambiguousWith && both.ambiguousWith.length === 2);
    assert.strictEqual(both?.resolved, undefined);
    const single = at("a_page.dart", 8);
    assert.strictEqual(single?.resolved?.path, "lib/features/a/tile.dart");
    assert.strictEqual(single?.resolved?.shared, false);
  });

  test("totals summarize the shared work left", () => {
    assert.strictEqual(scan.totals.sharedWidgets, 4);
    assert.strictEqual(scan.totals.sharedWidgetsMissingContract, 3);
    assert.strictEqual(scan.totals.callSitesMissingContract, findings.filter((item) => item.role === "shared-call-site" && item.automation !== "present").length);
  });

  test("suggests path-based identifiers and uses caption arguments for project widgets", () => {
    assert.strictEqual(at("cart_screen.dart", 11)?.suggestedIdentifier, "cart.checkout");
    assert.strictEqual(at("profile_screen.dart", 11)?.suggestedIdentifier, "profile.edit_profile");
  });

  test("the prompt lists shared widgets by layer with their required changes", () => {
    const prompt = buildSemanticsImplementationPrompt(scan);
    const phase1 = prompt.indexOf("Phase 1 - Give every shared widget a semantics contract");
    const phase2 = prompt.indexOf("Phase 2 - Pass the contract at every call site");
    const phase3 = prompt.indexOf("Phase 3 - Everything else");
    const phase4 = prompt.indexOf("Phase 4 - Verify");
    assert.ok(phase1 > 0 && phase1 < phase2 && phase2 < phase3 && phase3 < phase4, "phases are in order");
    assert.ok(prompt.includes("Shared interactive widgets: 4 (3 without a complete semantics contract)"));
    assert.ok(prompt.includes("L0 | PrimaryButton | lib/shared/widgets/primary_button.dart:"));
    assert.ok(prompt.includes("add: required String semanticsIdentifier; make tooltip required"));
    assert.ok(prompt.includes("contract: complete (semanticsIdentifier, required)"));
    assert.ok(prompt.includes("L1 | SaveBar"));
    assert.ok(prompt.indexOf("L0 | PrimaryButton") < prompt.indexOf("L1 | SaveBar"));
    assert.ok(prompt.includes("required String semanticsIdentifier - always required"));
    assert.ok(prompt.includes("required String semanticsLabel - required only when the widget shows no text of its own"));
    assert.ok(prompt.includes("Never wrap a call site of a shared widget in another Semantics"));
    assert.ok(prompt.includes("compile error"));
  });

  test("the prompt caps the table and points to the full list", () => {
    const prompt = buildSemanticsImplementationPrompt(scan, { maxTableRows: 1 });
    assert.ok(prompt.includes("(+3 more; the full list is scan_interactives.widgets)"));
  });

  suite("fixes", () => {
    function copyFixture(): string {
      const root = fs.mkdtempSync(path.join(os.tmpdir(), "flutter-shared-semantics-"));
      fs.cpSync(fixture, root, { recursive: true });
      return root;
    }

    test("passes the identifier through the widget's own parameter instead of wrapping it", async () => {
      const root = copyFixture();
      try {
        const local = await scanInteractives(root);
        const finding = flattenInteractiveFindings(local).find((item) =>
          item.source.path.endsWith("cart_screen.dart") && item.semantics.identifierExpression === undefined && item.widgetType === "LabeledButton");
        assert.ok(finding);
        const preview = await previewSemanticsFixes(root, [{ occurrenceId: finding.occurrenceId, identifier: "cart.refund" }]);
        const after = preview.changes[0].afterSnippet;
        assert.ok(after.includes("semanticsIdentifier: 'cart.refund'"), after);
        assert.ok(!after.includes("Semantics("), "no second Semantics node");
      } finally {
        fs.rmSync(root, { recursive: true, force: true });
      }
    });

    test("refuses to hardcode an identifier inside a shared widget's own definition", async () => {
      const root = copyFixture();
      try {
        const local = await scanInteractives(root);
        const finding = flattenInteractiveFindings(local).find((item) => item.role === "shared-definition-root" && item.owner?.className === "PrimaryButton");
        assert.ok(finding);
        await assert.rejects(
          () => previewSemanticsFixes(root, [{ occurrenceId: finding.occurrenceId, identifier: "shared.primary" }]),
          /Add required semantics parameters to PrimaryButton/,
        );
      } finally {
        fs.rmSync(root, { recursive: true, force: true });
      }
    });

    test("a widget without a contract still falls back to a single wrapper", async () => {
      const root = copyFixture();
      try {
        const local = await scanInteractives(root);
        const finding = flattenInteractiveFindings(local).find((item) => item.widgetType === "IconAction" && item.source.path.endsWith("cart_screen.dart"));
        assert.ok(finding);
        const preview = await previewSemanticsFixes(root, [{ occurrenceId: finding.occurrenceId, identifier: "cart.delete" }]);
        assert.ok(preview.changes[0].afterSnippet.includes("Semantics(identifier: 'cart.delete'"));
      } finally {
        fs.rmSync(root, { recursive: true, force: true });
      }
    });
  });

  test("after the contract is applied, the rescan reports the shared widget as done", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "flutter-shared-semantics-done-"));
    fs.cpSync(fixture, root, { recursive: true });
    try {
      const file = path.join(root, "lib", "shared", "widgets", "primary_button.dart");
      fs.writeFileSync(file, `import 'package:flutter/material.dart';

class PrimaryButton extends StatelessWidget {
  const PrimaryButton({
    required this.onPressed,
    required this.text,
    required this.semanticsIdentifier,
    super.key,
  });

  final VoidCallback onPressed;
  final String text;
  final String semanticsIdentifier;

  @override
  Widget build(BuildContext context) {
    return Semantics(
      identifier: semanticsIdentifier,
      button: true,
      child: InkWell(onTap: onPressed, child: Text(text)),
    );
  }
}
`);
      const rescanned = await scanInteractives(root);
      const primary = rescanned.widgets.find((item) => item.className === "PrimaryButton")!;
      assert.strictEqual(primary.contract.status, "complete");
      assert.deepStrictEqual(primary.requiredParamsToAdd, []);
      const root11 = flattenInteractiveFindings(rescanned).find((item) => item.owner?.className === "PrimaryButton" && item.widgetType === "InkWell");
      assert.strictEqual(root11?.automation, "present");
      assert.ok(rescanned.totals.sharedWidgetsMissingContract < scan.totals.sharedWidgetsMissingContract);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});

suite("Semantics Phase 3: composites and local controls", () => {
  const fixture = path.resolve(__dirname, "../../../src/test/fixtures/semantics_shared_project");
  let scan: InteractiveScanResult;
  let findings: InteractiveFinding[];

  suiteSetup(async () => {
    scan = await scanInteractives(fixture);
    findings = flattenInteractiveFindings(scan);
  });

  const at = (file: string, line: number) =>
    findings.find((finding) => finding.source.path.endsWith(file) && finding.source.line === line);
  const composite = (name: string) => scan.composites.find((item) => item.className === name);

  function copyFixture(): string {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "flutter-phase3-"));
    fs.cpSync(fixture, root, { recursive: true });
    return root;
  }

  test("reused multi-control widgets are composites; screens and single-use widgets are not", () => {
    assert.deepStrictEqual(new Set(scan.composites.map((item) => item.className)), new Set(["ProductRow", "ActionBar"]));
    assert.ok(!composite("SettingsView"), "a screen referenced twice is still a screen");
    assert.ok(!composite("ToolbarRow"), "used once, so its controls just get literal identifiers");
    assert.strictEqual(scan.totals.composites, 2);
  });

  test("a composite without a prefix needs a required identifier prefix", () => {
    const row = composite("ProductRow")!;
    assert.strictEqual(row.kind, "composite");
    assert.strictEqual(row.rootCount, 2);
    assert.strictEqual(row.callSites, 3);
    assert.strictEqual(row.callSitesMissing, 3);
    assert.strictEqual(row.contract.status, "missing");
    assert.deepStrictEqual(row.requiredParamsToAdd, ["required String semanticsIdentifierPrefix"]);
    assert.strictEqual(at("product_row.dart", 14)?.role, "composite-item");
    assert.strictEqual(at("product_row.dart", 14)?.remediation, "composite-prefix");
    assert.strictEqual(at("cart_screen.dart", 23)?.remediation, "shared-widget", "fix the composite's definition first");
  });

  test("a composite with a forwarded prefix is complete and its inner controls count as done", () => {
    const bar = composite("ActionBar")!;
    assert.strictEqual(bar.contract.status, "complete");
    assert.strictEqual(bar.contract.prefix?.name, "semanticsIdentifierPrefix");
    assert.strictEqual(bar.contract.prefix?.required, true);
    assert.deepStrictEqual(bar.requiredParamsToAdd, []);
    assert.strictEqual(bar.callSitesMissing, 1);
    assert.strictEqual(at("action_bar.dart", 23)?.automation, "present");
    assert.strictEqual(at("cart_screen.dart", 25)?.automation, "present");
    assert.strictEqual(at("cart_screen.dart", 25)?.remediation, "pass-contract");
    assert.strictEqual(at("cart_screen.dart", 26)?.automation, "missing");
  });

  test("assigns a concrete remediation to the remaining findings", () => {
    assert.strictEqual(at("profile_screen.dart", 15)?.remediation, "builtin-label", "icon-only SDK button with no name");
    assert.strictEqual(at("profile_screen.dart", 18)?.remediation, "reuse-wrapper", "already inside a Semantics");
    assert.strictEqual(at("settings_view.dart", 11)?.remediation, "wrap");
    assert.strictEqual(at("cart_screen.dart", 20)?.remediation, "pass-contract");
    assert.strictEqual(at("both_page.dart", 9)?.remediation, "manual", "ambiguous names are never guessed");
  });

  test("the prompt lists composites, remediation counts and keeps every parameter required", () => {
    const prompt = buildSemanticsImplementationPrompt(scan);
    assert.ok(prompt.includes("Reused multi-control widgets: 2"));
    assert.ok(prompt.includes("3a. Reused widgets with several controls"));
    assert.ok(prompt.includes("ProductRow | lib/shared/widgets/product_row.dart:"));
    assert.ok(prompt.includes("add: required String semanticsIdentifierPrefix"));
    assert.ok(prompt.includes("3b. Work through the remaining findings by their remediation field"));
    assert.ok(/builtin-label \d+/.test(prompt));
    assert.ok(prompt.includes("Needs a person (") && prompt.includes("ambiguous between"));
    assert.ok(prompt.includes("Keep the parameters required everywhere"));
    assert.ok(!prompt.includes("published package"), "no optional escape hatch");
    assert.ok(prompt.indexOf("Phase 2 - Pass the contract") < prompt.indexOf("3a. Reused widgets"));
  });

  test("passes a composite's prefix through its own parameter", async () => {
    const root = copyFixture();
    try {
      const local = await scanInteractives(root);
      const call = flattenInteractiveFindings(local).find((item) =>
        item.source.path.endsWith("cart_screen.dart") && item.widgetType === "ActionBar" && item.automation === "missing");
      assert.ok(call);
      const preview = await previewSemanticsFixes(root, [{ occurrenceId: call.occurrenceId, identifier: "cart.history" }]);
      const after = preview.changes[0].afterSnippet;
      assert.ok(after.includes("semanticsIdentifierPrefix: 'cart.history'"), after);
      assert.ok(!after.includes("Semantics("), "no wrapper");
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  test("refuses to hardcode an identifier inside a reused composite", async () => {
    const root = copyFixture();
    try {
      const local = await scanInteractives(root);
      const inner = flattenInteractiveFindings(local).find((item) => item.role === "composite-item" && item.owner?.className === "ProductRow");
      assert.ok(inner);
      await assert.rejects(
        () => previewSemanticsFixes(root, [{ occurrenceId: inner.occurrenceId, identifier: "shared.row.open" }]),
        /required identifier prefix parameter/,
      );
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  test("names an icon-only SDK button through its tooltip and adds the identifier once", async () => {
    const root = copyFixture();
    try {
      const local = await scanInteractives(root);
      const button = flattenInteractiveFindings(local).find((item) => item.remediation === "builtin-label" && item.widgetType === "IconButton");
      assert.ok(button);
      const preview = await previewSemanticsFixes(root, [{ occurrenceId: button.occurrenceId, identifier: "profile.share", labelExpression: "strings.share" }]);
      const after = preview.changes[0].afterSnippet;
      assert.ok(after.includes("tooltip: strings.share"), after);
      assert.ok(after.includes("Semantics(identifier: 'profile.share'"), after);
      assert.ok(!/label:/.test(after), "the tooltip is the label; it is not repeated on the Semantics node");
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  test("rejects a label expression that exists nowhere in the project", async () => {
    const root = copyFixture();
    try {
      const local = await scanInteractives(root);
      const button = flattenInteractiveFindings(local).find((item) => item.remediation === "builtin-label");
      assert.ok(button);
      await assert.rejects(
        () => previewSemanticsFixes(root, [{ occurrenceId: button.occurrenceId, identifier: "profile.share", labelExpression: "strings.inventedKey" }]),
        /existing non-literal localized expression/,
      );
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});
