import { flattenInteractiveFindings } from "./scanner.js";
import type { InteractiveFinding, InteractiveScanResult, Remediation, SharedWidgetSummary } from "./types.js";

export interface SemanticsPromptOptions {
  /** How many shared widgets to list in the inventory table (the rest are in scan_interactives.widgets). */
  maxTableRows?: number;
}

const DEFAULT_TABLE_ROWS = 40;
const COMPOSITE_ROWS = 15;
const MANUAL_ROWS = 12;

function tableRow(widget: SharedWidgetSummary): string {
  const additions = widget.requiredParamsToAdd.length ? widget.requiredParamsToAdd.join("; ") : "none";
  const contract = widget.contract.status === "complete"
    ? `complete (${widget.contract.identifier?.name}${widget.contract.identifier?.required ? ", required" : ", optional"})`
    : widget.contract.status;
  const wraps = widget.wraps.length ? widget.wraps.join(", ") : "-";
  const roots = widget.interactiveRootLines.length ? widget.interactiveRootLines.join(",") : "-";
  const rootCount = widget.kind === "composite" ? `${widget.rootCount} controls, ` : "";
  const semantics = widget.existingSemanticsLine ? `; existing Semantics at line ${widget.existingSemanticsLine}` : "";
  return `L${widget.layer} | ${widget.className} | ${widget.path}:${widget.line} | ${widget.callSites} call sites, ${widget.callSitesMissing} without identifier | contract: ${contract} | ${widget.hasVisibleText ? "shows its own text" : "no visible text"} | add: ${additions} | ${rootCount}root line ${roots}${semantics} | wraps: ${wraps}`;
}

function inventory(result: InteractiveScanResult, maxRows: number): string {
  const totals = result.totals;
  const lines = [
    `- Dart files scanned: ${totals.filesScanned}`,
    `- Interactive candidates: ${totals.findings}`,
    `- Accessibility ready / missing / uncertain: ${totals.accessibilityReady} / ${totals.accessibilityMissing} / ${totals.accessibilityUncertain}`,
    `- Automation identifiers present / missing: ${totals.automationReady} / ${totals.automationMissing}`,
    `- Dynamic identifiers needing runtime verification: ${totals.automationDynamic}`,
    `- Duplicate literal identifiers: ${totals.automationDuplicate}`,
    `- Opaque surfaces needing manual/runtime inspection: ${totals.opaque}`,
    `- Shared interactive widgets: ${totals.sharedWidgets} (${totals.sharedWidgetsMissingContract} without a complete semantics contract)`,
    `- Shared-widget call sites without an identifier: ${totals.callSitesMissingContract}`,
    `- Reused multi-control widgets: ${totals.composites} (${totals.compositeCallSitesMissing} call sites without an identifier prefix)`,
  ];
  if (result.widgets.length === 0) {
    return lines.join("\n");
  }
  const shown = result.widgets.slice(0, maxRows);
  const omitted = result.widgets.length - shown.length;
  return [
    ...lines,
    "",
    "Shared widgets, in the order to fix them (layer 0 = built only from SDK widgets; a higher layer wraps a lower one):",
    "layer | widget | definition | usage | contract | text | required changes | root | wraps",
    ...shown.map(tableRow),
    ...(omitted > 0 ? [`(+${omitted} more; the full list is scan_interactives.widgets)`] : []),
  ].join("\n");
}

const CONSTRAINTS = `Scope and constraints
- Work only in production lib/**/*.dart sources. Do not edit generated files, vendored code, SDK or package-cache sources, or the internals of opaque WebView/platform-view/map/custom-paint surfaces.
- Treat the inventory as a confidence-based audit, not proof that every interaction was found. Project widgets were resolved through imports and export barrels; if a name is listed as ambiguous, resolve it yourself before editing.
- Never modify Flutter SDK or dependency-package widgets. Use their own parameters (tooltip, decoration, semanticLabel) or a Semantics wrapper around the exact expression.
- Preserve behavior: const constructors, keys, callbacks, generic types, disabled state, focus, gestures, merge/exclude behavior, and tap targets.`;

const PHASE_SHARED = `Phase 1 - Give every shared widget a semantics contract (fix layer 0 first, then layer 1, and so on)
Do this once per widget in the table, in table order. Never wrap a call site of a shared widget in another Semantics.
1. If the widget already has a parameter that does the same job (semanticsIdentifier, semanticIdentifier, semanticsLabel, tooltip, semanticsHint...), reuse its name and type, make the identifier required, and make sure it is really forwarded. Do not introduce a second parallel API.
2. Otherwise add constructor parameters and final fields in the widget's local style:
   - required String semanticsIdentifier - always required, this is the automation tag.
   - required String semanticsLabel - required only when the widget shows no text of its own (icon, image or custom-painted controls; the table says "no visible text"). A widget that shows its own Text already has an accessible name: do not add a label parameter, and never pass the label that would repeat that text.
   - String? semanticsHint - optional, always.
   Applying "required" is intentional: every call site that is not updated becomes a compile error, which is how you prove nothing was missed.
3. Inside build(), reuse the widget's nearest existing Semantics; otherwise attach exactly ONE Semantics around the single interactive root (the table gives its line) and forward the parameters:

   Semantics(
     identifier: semanticsIdentifier,
     label: semanticsLabel,
     hint: semanticsHint,
     textDirection: Directionality.of(context),
     button: true,
     child: <interactive root>,
   )

   Add a role flag (button, textField, toggled, selected, slider) only when the role is unambiguous and Flutter does not already expose it. For a widget that shows its own text, omit label and hint. If the visible text alone is a poor name, pass the label and wrap only the redundant Text in ExcludeSemantics so it is not read twice; do not exclude the whole subtree, which removes the tap action.
4. A widget that wraps another shared widget forwards its own parameters into the wrapped widget's contract instead of inventing values, and keeps its own copy of the parameters only when its API needs them.
5. After each layer run dart format and flutter analyze. The remaining errors are exactly the call sites for Phase 2. Keep the parameters required everywhere: never make one optional or give it a default just to avoid updating call sites.`;

const PHASE_CALL_SITES = `Phase 2 - Pass the contract at every call site of each shared widget
Look up the widget in the table (or in scan_interactives: finding.resolved.contract) before touching an invocation, and use exactly the parameter names it defines.
- Pass an identifier at every call site. Pass a label only where the widget requires one or accessibility genuinely needs it.
- Fix the call sites of layer 0 widgets first, then layer 1. Inside a wrapper widget's own build(), pass the wrapper's parameters through; do not create new identifiers there.
- For plain leaf changes you can use preview_semantics_fixes / apply_semantics_fixes: for widgets with a complete contract they append the named argument instead of adding a Semantics wrapper, and they refuse to edit code inside a shared widget's own definition.`;

function compositeRow(widget: SharedWidgetSummary): string {
  const additions = widget.requiredParamsToAdd.length ? widget.requiredParamsToAdd.join("; ") : "none";
  const contract = widget.contract.status === "complete" ? `complete (${(widget.contract.prefix ?? widget.contract.identifier)?.name})` : widget.contract.status;
  return `${widget.className} | ${widget.path}:${widget.line} | ${widget.callSites} call sites, ${widget.callSitesMissing} without prefix | contract: ${contract} | add: ${additions} | ${widget.rootCount} controls at lines ${widget.interactiveRootLines.join(",")}`;
}

function compositeTable(result: InteractiveScanResult): string {
  const shown = result.composites.slice(0, COMPOSITE_ROWS);
  const omitted = result.composites.length - shown.length;
  return [
    "widget | definition | usage | contract | required changes | controls",
    ...shown.map(compositeRow),
    ...(omitted > 0 ? [`(+${omitted} more; the full list is scan_interactives.composites)`] : []),
  ].join("\n");
}

function remediationCounts(findings: InteractiveFinding[]): Record<Remediation, number> {
  const counts: Record<Remediation, number> = {
    "shared-widget": 0, "pass-contract": 0, "composite-prefix": 0, "reuse-wrapper": 0, "builtin-label": 0, wrap: 0, manual: 0,
  };
  findings.forEach((finding) => { counts[finding.remediation] += 1; });
  return counts;
}

function manualList(findings: InteractiveFinding[]): string {
  const manual = findings.filter((finding) => finding.remediation === "manual");
  if (manual.length === 0) {
    return "";
  }
  const reason = (finding: InteractiveFinding) => finding.opaqueReason
    ?? (finding.ambiguousWith ? `ambiguous between ${finding.ambiguousWith.join(", ")}` : "needs a person");
  return [
    "",
    `Needs a person (${manual.length}); resolve or report these, do not guess:`,
    ...manual.slice(0, MANUAL_ROWS).map((finding) => `- ${finding.source.path}:${finding.source.line} ${finding.widgetType}: ${reason(finding)}`),
    ...(manual.length > MANUAL_ROWS ? [`(+${manual.length - MANUAL_ROWS} more in scan_interactives)`] : []),
  ].join("\n");
}

function phaseLocal(result: InteractiveScanResult): string {
  const findings = flattenInteractiveFindings(result);
  const counts = remediationCounts(findings);
  const composites = result.composites.length > 0
    ? `3a. Reused widgets with several controls (fix each definition, then its call sites)
${compositeTable(result)}
These cannot take a single identifier, so give each a required identifier prefix and derive every inner identifier from it:
- Add \`required String semanticsIdentifierPrefix\` and its final field (keep the parameter required, like the shared-widget parameters).
- Give each inner control its own Semantics, reusing the nearest existing one, with identifier: '\${semanticsIdentifierPrefix}.<short unique suffix>', for example '\${semanticsIdentifierPrefix}.undo'. Suffixes are unique inside the widget.
- Inner labels come from the widget's own localized text or the SDK control's own tooltip. Add a required label parameter only for a control that has no text and whose meaning the caller decides.
- A widget that wraps another composite forwards its own prefix plus a suffix ('\${semanticsIdentifierPrefix}.appbar') instead of inventing a new one.
- flutter analyze; the errors left are the call sites. Pass a unique, stable prefix at each one (domain ids only, never an index), following the same identifier rules as Phase 2.

`
    : "";
  return `Phase 3 - Everything else (project widgets used once, screens, and SDK controls)
${composites}${composites ? "3b. " : ""}Work through the remaining findings by their remediation field (scan_interactives returns it on every finding). Counts now: pass-contract ${counts["pass-contract"]}, composite-prefix ${counts["composite-prefix"]}, reuse-wrapper ${counts["reuse-wrapper"]}, builtin-label ${counts["builtin-label"]}, wrap ${counts.wrap}, manual ${counts.manual}, shared-widget ${counts["shared-widget"]} (fixed in Phases 1-2).
- pass-contract: the widget already has its own semantics parameter; pass it. Never add an outer Semantics.
- composite-prefix: a control inside a composite; done by 3a, not by editing the control.
- reuse-wrapper: a Semantics already owns exactly this control; add the identifier (and label) to it.
- builtin-label: an icon-only SDK button (IconButton, FloatingActionButton, PopupMenuButton) with no name. Put the localized name in its tooltip, then add the identifier with one Semantics wrapper. The fixer does both when you give it a labelExpression.
- wrap: wrap the exact widget expression in one Semantics (identifier, plus label/hint only where the control shows no text of its own). Never wrap a broad subtree containing several interactive candidates, and keep one semantics boundary per logical control.
Screens and one-off widgets take literal identifiers that are unique across the project. A repeated private row uses one domain identifier with a stable interpolated id, not one literal per row.${manualList(findings)}`;
}

const RULES = `Identifier rules
- Semantics.identifier is the automation contract; Flutter Key values and localized labels are not substitutes.
- Literal identifiers are unique across the whole project and use stable lowercase dotted names that follow the path and domain, for example auth.login.submit or pages.login_screens.open_bank_account.branches.select.
- Repeated rows may interpolate a stable domain id, e.g. 'cart.item.\${item.id}.remove'. Never use a list index, localized text, current position, random value, or hashCode.
- Keep a valid existing identifier unless it is duplicate, unstable, or attached to the wrong node. Report every dynamic identifier as needing runtime uniqueness verification.

Label and hint rules
- Derive the control's meaning from, in order: resolved project path, owning component/class (the inventory's owner and resolved definition), call-site variable or field name, screen/feature, visible or localized text, callback name, actual role. Prefer the most specific domain-bearing owner over a generic implementation widget: a VisitorArea component built with MobileButton is a visitor-area control, not a "mobile button".
- Turn that into a concise human phrase: split PascalCase/camelCase/snake_case, keep acronyms, drop technical suffixes, and add the control role exactly once ("visitor area button", never "visitor area button button"; "branch selector dropdown"). Layout, styling or callback words (container, mobile, changed, pressed, gesture detector) are not part of the meaning.
- The phrase is the intent, not the copy. Search visible text and the project's localization catalogs for the equivalent expression and reuse it. If none exists, leave that label unresolved and report the file, the control, the phrase, and the localization key/value to add. Never hardcode a new English literal in a multilingual UI.
- Every Semantics node with an explicit label or hint sets textDirection: Directionality.of(context) (never a hardcoded TextDirection). In shared widgets, obtain it inside build() and attach it to the same single Semantics node.
- Keep labels short and user-facing; implementation detail belongs in identifiers.`;

const VERIFY = `Phase 4 - Verify
- dart format on every changed file, flutter analyze, and the relevant tests.
- Run scan_interactives again. Targets: sharedWidgetsMissingContract = 0, callSitesMissingContract = 0, automationDuplicate = 0, and only the unresolved localization items and dynamic identifiers remaining.
- Report before/after counts, the shared widgets changed (with the parameters added), the number of call sites updated per widget, wrapper fallbacks used, unresolved localization keys, and opaque items left for manual work.
- On Android no forced semantics handle, SemanticsBinding.ensureSemantics call, or QA build flag should be needed. With the target screen showing, run:

  adb shell uiautomator dump /sdcard/window.xml
  adb exec-out cat /sdcard/window.xml

  Each Semantics.identifier must appear as resource-id and each explicit label/hint as content-desc. If the dump shows only Flutter's host FrameLayout with empty resource-id/content-desc, first check for a missing textDirection on explicit label/hint nodes (especially custom GestureDetector and dropdown controls), then for duplicate or overly broad semantics boundaries.`;

/** Build the implementation prompt copied from the Semantics tab. */
export function buildSemanticsImplementationPrompt(
  result: InteractiveScanResult,
  options: SemanticsPromptOptions = {},
): string {
  const hasShared = result.widgets.length > 0;
  const sections = [
    `You are adding accessibility semantics and stable UI-automation identifiers to this Flutter project:
${result.projectRoot}

Do the work, do not stop at a plan: inspect the repository, implement the changes, format, analyze, test, and rescan. Follow the phases in order and do not start a phase before the previous one analyzes cleanly. Shared widgets come first because one change there covers all of their call sites.`,
    `Current static inventory\n${inventory(result, options.maxTableRows ?? DEFAULT_TABLE_ROWS)}`,
    `Tools: use the Flutter Config Manager MCP tools when available. scan_interactives returns this inventory: widgets (shared widgets in fix order) and, per finding, role (shared-definition-root, shared-call-site, local-call-site, sdk), owner, resolved definition and contract.`,
    CONSTRAINTS,
    hasShared
      ? `${PHASE_SHARED}\n\n${PHASE_CALL_SITES}`
      : "No shared interactive widgets were detected, so Phases 1 and 2 do not apply. Treat every project widget under Phase 3, and still reuse a widget's own semantics parameters before wrapping it.",
    phaseLocal(result),
    RULES,
    VERIFY,
  ];
  return `${sections.join("\n\n")}\n`;
}
