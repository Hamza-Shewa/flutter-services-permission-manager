import { flattenInteractiveFindings } from "./scanner.js";
import type { InteractiveFinding, InteractiveScanResult, Remediation, SharedWidgetSummary } from "./types.js";

export interface SemanticsPromptOptions {
  /** How many shared widgets to list in the inventory table (the rest are in scan_interactives.widgets). */
  maxTableRows?: number;
}

const DEFAULT_TABLE_ROWS = 40;
const COMPOSITE_ROWS = 15;
const MANUAL_ROWS = 12;

function callSiteUsage(widget: SharedWidgetSummary, findings: InteractiveFinding[]): string {
  const calls = findings.filter((finding) => finding.resolved?.path === widget.path &&
    finding.resolved.className === widget.className);
  const count = (state: InteractiveFinding["automation"]) => calls.filter((finding) => finding.automation === state).length;
  return `${widget.callSites} call sites, ${count("missing")} missing, ${count("dynamic")} dynamic, ${count("duplicate")} duplicate`;
}

function tableRow(widget: SharedWidgetSummary, findings: InteractiveFinding[]): string {
  const additions = widget.requiredParamsToAdd.length ? widget.requiredParamsToAdd.join("; ") : "none";
  const parameter = widget.contract.identifier ?? widget.contract.prefix;
  const contract = widget.contract.status === "complete"
    ? `complete (${parameter?.name}${parameter?.required ? ", required" : ", optional"})`
    : widget.contract.status;
  const wraps = widget.wraps.length ? widget.wraps.join(", ") : "-";
  const roots = widget.interactiveRootLines.length ? widget.interactiveRootLines.join(",") : "-";
  const rootCount = widget.kind === "composite" ? `${widget.rootCount} controls, ` : "";
  const semantics = widget.existingSemanticsLine ? `; existing Semantics at line ${widget.existingSemanticsLine}` : "";
  return `L${widget.layer} | ${widget.className} | ${widget.path}:${widget.line} | ${callSiteUsage(widget, findings)} | contract: ${contract} | ${widget.hasVisibleText ? "text detected; inspect each variant" : "no visible text detected"} | add: ${additions} | ${rootCount}root line ${roots}${semantics} | wraps: ${wraps}`;
}

function inventory(result: InteractiveScanResult, maxRows: number): string {
  const totals = result.totals;
  const findings = flattenInteractiveFindings(result);
  const lines = [
    `- Dart files scanned: ${totals.filesScanned}`,
    `- Interactive candidates: ${totals.findings}`,
    `- Accessibility ready / missing / uncertain: ${totals.accessibilityReady} / ${totals.accessibilityMissing} / ${totals.accessibilityUncertain}`,
    `- Automation identifiers present / missing: ${totals.automationReady} / ${totals.automationMissing}`,
    `- Dynamic identifiers needing runtime verification: ${totals.automationDynamic}`,
    `- Duplicate literal identifiers: ${totals.automationDuplicate}`,
    `- Opaque surfaces needing manual/runtime inspection: ${totals.opaque}`,
    `- Shared interactive widgets: ${totals.sharedWidgets} (${totals.sharedWidgetsMissingContract} without a complete semantics contract)`,
    `- Shared-widget call-site scanner flags: ${totals.callSitesMissingContract} (includes dynamic/duplicate IDs, not just absent arguments)`,
    `- Reused multi-control widgets: ${totals.composites} (${totals.compositeCallSitesMissing} call-site scanner flags; dynamic prefixes included)`,
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
    ...shown.map((widget) => tableRow(widget, findings)),
    ...(omitted > 0 ? [`(+${omitted} more; the full list is scan_interactives.widgets)`] : []),
  ].join("\n");
}

const CONSTRAINTS = `Scope and constraints
- Work only in production lib/**/*.dart sources. Do not edit generated files, vendored code, SDK or package-cache sources, or the internals of opaque WebView/platform-view/map/custom-paint surfaces.
- Treat the inventory as a confidence-based audit, not proof that every interaction was found. Project widgets were resolved through imports and export barrels; if a name is listed as ambiguous, resolve it yourself before editing.
- Never modify Flutter SDK or dependency-package widgets. Use their own parameters (tooltip, decoration, semanticLabel) or a Semantics wrapper around the exact expression.
- Preserve behavior: const constructors, keys, callbacks, generic types, disabled state, focus, gestures, existing semantics ownership, and tap targets. Change merging/exclusion only narrowly, with a test proving names and actions remain correct.
- Capture baseline analyze/test results before editing. Format only changed production files, not all of lib/. Keep temporary audit/test artifacts outside the repository when the requested source scope is lib/ only.
- Validate the actual interactive root before following a suggestion. Passive containers, rows without a tap callback, Marker/ContextMenuButtonItem metadata, offscreen bitmap-rendering widgets and whole-screen keyboard-dismiss gestures do not each need a fabricated button node. Report scanner false positives with evidence.
- Use small structural edits or Dart-aware parsing. Reopen edited constructors and helpers; comments, nested arguments, aliases and generic callbacks can defeat text-only replacements.`;

const PHASE_SHARED = `Phase 1 - Give every shared widget a semantics contract (fix layer 0 first, then layer 1, and so on)
Do this once per widget in the table, in table order. Never wrap a call site of a shared widget in another Semantics.
1. If the widget already has a parameter that does the same job (semanticsIdentifier, semanticIdentifier, semanticsLabel, tooltip, semanticsHint...), reuse its name and type, make the identifier required, and make sure it is really forwarded. Do not introduce a second parallel API.
2. Otherwise add constructor parameters and final fields in the widget's local style:
   - required String semanticsIdentifier - always required, this is the automation tag.
   - required String semanticsLabel - required only when the widget shows no text of its own (icon, image or custom-painted controls). The table is a heuristic: inspect the actual call-site variant. A Text child can supply the name without an explicit label; do not repeat that text in a label.
   - For mixed text/icon-only widgets, reuse an existing label/tooltip API and inspect every unnamed branch. If needed, add a label contract for the icon-only/custom-child variant without requiring redundant labels from visible-text callers. A required nullable String? tooltip still allows null: making it required does not prove the control has a name.
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

   Add a role flag (button, textField, toggled, selected, slider) only when the role is unambiguous and Flutter does not already expose it. For a widget that shows its own text, omit a redundant label or hint. Forward a caller-provided meaningful hint independently of whether label is null. If the visible text alone is a poor name, pass the label and wrap only the redundant Text in ExcludeSemantics so it is not read twice; do not exclude the whole subtree, which removes the tap action.
   A wrapper can export an ID on a node separate from the SDK button's name/action. If widget tests demonstrate this, use MergeSemantics around exactly that one control's Semantics + SDK button. Never merge a card, input with suffix action, toolbar, row or whole composite containing independent controls.
4. A widget that wraps another shared widget forwards its own parameters into the wrapped widget's contract instead of inventing values, and keeps its own copy of the parameters only when its API needs them.
5. Adding required parameters intentionally creates missing-argument errors. Update that layer's Phase 2 call sites before requiring a clean analyzer and moving to the next layer; fix unrelated/new errors immediately. Keep the parameters required everywhere: never make one optional, pass empty strings, or give it a default just to avoid updating call sites.`;

const PHASE_CALL_SITES = `Phase 2 - Pass the contract at every call site of each shared widget
Look up the widget in the table (or in scan_interactives: finding.resolved.contract) before touching an invocation, and use exactly the parameter names it defines.
- Pass an identifier at every call site. Pass a label only where the widget requires one or accessibility genuinely needs it.
- Fix the call sites of layer 0 widgets first, then layer 1. Inside a wrapper widget's own build(), pass the wrapper's parameters through; do not create new identifiers there.
- For plain leaf changes you can use preview_semantics_fixes / apply_semantics_fixes: for widgets with a complete contract they append the named argument instead of adding a Semantics wrapper, and they refuse to edit code inside a shared widget's own definition.`;

function compositeRow(widget: SharedWidgetSummary, findings: InteractiveFinding[]): string {
  const additions = widget.requiredParamsToAdd.length ? widget.requiredParamsToAdd.join("; ") : "none";
  const contract = widget.contract.status === "complete" ? `complete (${(widget.contract.prefix ?? widget.contract.identifier)?.name})` : widget.contract.status;
  return `${widget.className} | ${widget.path}:${widget.line} | ${callSiteUsage(widget, findings)} | contract: ${contract} | add: ${additions} | ${widget.rootCount} controls at lines ${widget.interactiveRootLines.join(",")}`;
}

function compositeTable(result: InteractiveScanResult): string {
  const shown = result.composites.slice(0, COMPOSITE_ROWS);
  const omitted = result.composites.length - shown.length;
  const findings = flattenInteractiveFindings(result);
  return [
    "widget | definition | usage | contract | required changes | controls",
    ...shown.map((widget) => compositeRow(widget, findings)),
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
- Inner names come from localized child text, a verified SDK tooltip, or an explicit localized label on the action node. Do not duplicate a native name just because Semantics.label is null. Add a required label parameter only for a control that has no text and whose meaning the caller decides.
- A widget that wraps another composite forwards its own prefix plus a suffix ('\${semanticsIdentifierPrefix}.appbar') instead of inventing a new one.
- flutter analyze; the errors left are the call sites. Pass a unique, stable prefix at each one (domain ids only, never an index), following the same identifier rules as Phase 2.

`
    : "";
  return `Phase 3 - Everything else (project widgets used once, screens, and SDK controls)
${composites}${composites ? "3b. " : ""}Work through the remaining findings by their remediation field (scan_interactives returns it on every finding). Counts now: pass-contract ${counts["pass-contract"]}, composite-prefix ${counts["composite-prefix"]}, reuse-wrapper ${counts["reuse-wrapper"]}, builtin-label ${counts["builtin-label"]}, wrap ${counts.wrap}, manual ${counts.manual}, shared-widget ${counts["shared-widget"]} (fixed in Phases 1-2).
- pass-contract: the widget already has its own semantics parameter; pass it. Never add an outer Semantics.
- composite-prefix: a control inside a composite; done by 3a, not by editing the control.
- reuse-wrapper: a Semantics already owns exactly this control; add the identifier (and label) to it.
- builtin-label: an icon-only SDK button (IconButton, FloatingActionButton, PopupMenuButton) with no name. Use its localized tooltip and one identifier boundary. The preview fixer can add tooltip + identifier, but a preview is not runtime proof of an accessible action name; verify the exported node as described below.
- wrap: wrap the exact widget expression in one Semantics (identifier, plus label/hint only where the control shows no text of its own). Never wrap a broad subtree containing several interactive candidates, and keep one semantics boundary per logical control.
Screens and one-off widgets take literal identifiers that are unique across the project. A repeated private row uses one domain identifier with a stable interpolated id, not one literal per row. Input/context-menu coordinators expose separate field, suffix and actual toolbar-button nodes; never wrap button-item metadata. An already identified Semantics node with onIncrease/onDecrease is the slider control itself, not another candidate to wrap.${manualList(findings)}`;
}

const RULES = `Identifier rules
- Semantics.identifier is the automation contract; Flutter Key values and localized labels are not substitutes.
- Literal identifiers are unique across the whole project and use stable lowercase dotted names that follow the path and domain, for example auth.login.submit or pages.login_screens.open_bank_account.branches.select.
- Repeated rows may interpolate a stable domain id, e.g. 'cart.item.\${item.id}.remove'. Never use a list index, localized text, current position, random value, or hashCode.
- Audit runtime repetition, not just duplicate literals in source. A single constructor inside a builder/map can expand to duplicate IDs. Scope cards, headers and banner carousels by their owning domain entity; scope attachments by message ID + attachment ID and paged controls by image ID. Existing model IDs are allowed; never generate random values only for semantics.
- Loading placeholders with empty/sentinel entity IDs must not export duplicate resource IDs. Suppress only placeholder automation tags at the owning leaf boundary; preserve real controls, labels and actions, and document the exception. Do not fabricate entity IDs or exclude an action subtree to hide duplicates.
- If repeated empty targets have no domain identity and invoke one logical action, ask whether one stable action ID is intended. Preserve all tap targets. Do not disguise list positions as slot names or silently bypass required IDs with null/empty values; intentional suppression needs an explicit reason or user authorization.
- Keep a valid existing identifier unless it is duplicate, unstable, or attached to the wrong node. Report every dynamic identifier as needing runtime uniqueness verification.

Label and hint rules
- Derive the control's meaning from, in order: resolved project path, owning component/class (the inventory's owner and resolved definition), call-site variable or field name, screen/feature, visible or localized text, callback name, actual role. Prefer the most specific domain-bearing owner over a generic implementation widget: a VisitorArea component built with MobileButton is a visitor-area control, not a "mobile button".
- Turn that into a concise human phrase: split PascalCase/camelCase/snake_case, keep acronyms, drop technical suffixes, and add the control role exactly once ("visitor area button", never "visitor area button button"; "branch selector dropdown"). Layout, styling or callback words (container, mobile, changed, pressed, gesture detector) are not part of the meaning.
- The phrase is the intent, not the copy. Search visible text and the project's localization catalogs for the equivalent expression and reuse it. Also use MaterialLocalizations for native back/close actions. If none exists, leave that label unresolved and report the file, the control, the phrase, and the localization key/value to add. Never hardcode a new English literal in a multilingual UI, invent a generic unrelated name, or use the identifier as the label. Null/empty unresolved values remain genuine name gaps; they must not be called accessibility-ready just because the argument exists.
- Semantics.label being null is valid when child Text or SDK semantics already supplies the name. An icon/image-only control still needs a meaningful exported name. Never fill every label mechanically or assume the class always renders its optional text.
- A tooltip can populate SemanticsData.tooltip while SemanticsData.label stays empty. If an icon control must export its name in label/content-desc, reuse its existing localized tooltip parameter as Semantics.label on the same action boundary; do not add a parallel label API. Keep the visual tooltip. Suppress only duplicate tooltip semantics, for example with a local TooltipTheme copying excludeFromSemantics: true when that explicit label is used; never ExcludeSemantics the IconButton or remove its tap/disabled state. Test both the spoken label and visible tooltip. Preserve working native SDK names unless runtime evidence shows a gap.
- Every Semantics node with an explicit label or hint sets textDirection: Directionality.of(context) (never a hardcoded TextDirection). In shared widgets, obtain it inside build() and attach it to the same single Semantics node.
- Keep labels short and user-facing; implementation detail belongs in identifiers.`;

const VERIFY = `Phase 4 - Verify
- dart format on every changed file, flutter analyze, and the relevant tests.
- Add focused widget tests of the exported semantics nodes: one ID, a nonempty name from the intended source, correct hint/direction, tap callback, disabled/checked/selected state, and independent nested actions. A node that only has an ID, or only a tooltip when a label/content-desc is needed, is insufficient. Test actual label values, not just constructor arguments or tooltip presence. Distinguish nodes merged into their parent from nodes exported to the platform; use ensureSemantics only in test code.
- Run scan_interactives again. Targets: no genuinely missing required contracts/call-site arguments, automationDuplicate = 0, and only documented unresolved localization, dynamic IDs, opaque surfaces or evidenced false positives remaining. Preserve raw before/after totals. Some scanners count dynamic/duplicate call sites as missing and fail to recognize identifier-to-prefix forwarding; audit the actual required argument and destination Semantics node before changing correct code to force zero counters.
- Separate raw scanner flags, confirmed missing IDs/names, dynamic runtime checks, placeholders deliberately suppressed, and false positives. Verify SDK back tooltips, nested exact-root wrappers, coordinator widgets and metadata before treating them as missing. Never fabricate Semantics wrappers or interactive roles merely to satisfy counts.
- Compare failures with baseline and reproduce suspected pre-existing failures. Keep unrelated cubit/business behavior unchanged; report exact failing tests and evidence. Respect lib-only scope by keeping temporary focused tests outside production sources.
- Report before/after counts, the shared widgets changed (with the parameters added), the number of call sites updated per widget, wrapper fallbacks used, unresolved localization keys, and opaque items left for manual work.
- On Android no forced semantics handle, SemanticsBinding.ensureSemantics call, or QA build flag should be needed. With the target screen showing, run:

  adb shell uiautomator dump /sdcard/window.xml
  adb exec-out cat /sdcard/window.xml

  Confirm each exported action's identifier appears as resource-id and its intended name/hint is available in Android content-desc or the applicable native accessibility field. Names can come from merged child text; a tooltip-only property is not proof of content-desc. Native concatenation can combine label/value/hint. If no device is attached, report this check unverified, not passed. If the dump shows only Flutter's host FrameLayout with empty resource-id/content-desc, check accessibility activation, inherited direction on explicit label/hint nodes, and identifier/name/action boundary ownership; widget-test success alone does not prove Android export.`;

/** Build the implementation prompt copied from the Semantics tab. */
export function buildSemanticsImplementationPrompt(
  result: InteractiveScanResult,
  options: SemanticsPromptOptions = {},
): string {
  const hasShared = result.widgets.length > 0;
  const sections = [
    `You are adding accessibility semantics and stable UI-automation identifiers to this Flutter project:
${result.projectRoot}

Do the work, do not stop at a plan: inspect the repository, implement the changes, format, analyze, test, and rescan. Work in dependency order: each shared layer's required contract and its call sites form one compile-clean unit; finish that unit before the next layer. Shared widgets come first because one change there covers all of their call sites.`,
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
