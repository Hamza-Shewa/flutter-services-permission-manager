import type { InteractiveScanResult } from "./types.js";

/** Build the implementation prompt copied from the Semantics tab. */
export function buildSemanticsImplementationPrompt(result: InteractiveScanResult): string {
  const totals = result.totals;
  return `You are improving Flutter accessibility semantics and stable UI-automation identifiers in this project:
${result.projectRoot}

Do not merely produce a plan. Inspect the repository, implement the safe changes, format the edited Dart files, run relevant analysis/tests, and finish by rescanning semantics.

Current static inventory
- Dart files scanned: ${totals.filesScanned}
- Interactive candidates: ${totals.findings}
- Accessibility ready: ${totals.accessibilityReady}
- Accessibility missing: ${totals.accessibilityMissing}
- Accessibility uncertain: ${totals.accessibilityUncertain}
- Automation identifiers present: ${totals.automationReady}
- Automation identifiers missing: ${totals.automationMissing}
- Dynamic identifiers requiring runtime verification: ${totals.automationDynamic}
- Duplicate literal identifiers: ${totals.automationDuplicate}
- Opaque surfaces requiring manual/runtime inspection: ${totals.opaque}

Use the Flutter Config Manager MCP tools when available. Start with scan_interactives and treat it as a confidence-based audit, not proof that every interaction was found. Work only in production lib/**/*.dart sources. Do not edit generated files, opaque WebView/platform/map/custom-paint internals, vendored code, SDK sources, or package-cache files.

For every actionable finding, use this strict priority order:

1. Resolve ownership and shared-widget usage before editing
- Build a map from each custom widget invocation to its project-owned class/function definition by resolving its import/export path. Search all call sites and relevant constructors.
- Do not classify widgets as shared merely because class names match. A shared widget must resolve to the same project-owned definition and be used at multiple call sites or intentionally live in a shared/component layer.
- Distinguish Flutter SDK and dependency-package widgets from project-owned widgets. Never modify external package source.
- Inspect parents and children so one logical control gets one semantic boundary; do not create duplicate or competing semantic nodes.
- Before proposing any label or identifier, derive the control's domain intent from all available evidence in this order: resolved project-relative source path, owning component/class/function name, call-site variable or field name, surrounding feature/screen, visible or localized text, callback name, and actual interaction role. Record which evidence determined the result.
- Prefer the most specific domain-bearing owner over a generic implementation widget. For example, a VisitorArea component implemented with MobileButton is a visitor-area control, not a "mobile button" control. Use the resolved path to disambiguate generic names such as ActionButton, ItemTile, or CustomField.

2. Reuse an existing semantic contract
- If the resolved widget already accepts parameters such as semanticsIdentifier, semanticIdentifier, semanticsLabel, semanticLabel, semanticsHint, tooltip, or another clearly equivalent API, reuse its established names and types.
- Pass the missing values at every relevant call site. Do not introduce a second parallel semantics API.

3. Extend a shared project-owned widget once
- When a shared interactive widget has no semantic API, add optional named constructor parameters and immutable fields using the local naming/style. Prefer String? semanticsIdentifier, String? semanticsLabel, and String? semanticsHint unless the widget already establishes another convention.
- Preserve public API compatibility, null defaults, const constructors, keys, callbacks, generic types, and existing behavior.
- Inside the shared widget, reuse its nearest applicable Semantics wrapper. Otherwise attach exactly one Semantics widget around the smallest single interactive root owned by that component.
- Forward identifier, label, and hint independently. Add a role flag such as button, textField, toggled, selected, or slider only when the widget's role is unambiguous and Flutter does not already expose it correctly.
- Update every project call site. Each logical control must receive an identifier; pass label/hint only when accessibility actually needs them.

4. Handle non-shared widgets
- If a non-shared project widget already exposes a semantics parameter, pass it rather than wrapping the invocation.
- If it lacks such a parameter and changing its API would not improve reuse, first reuse a nearby Semantics wrapper.
- Only as a last resort, wrap the exact widget expression at the call site with Semantics. Never wrap a broad subtree containing multiple interactive candidates.

Identifier rules
- Use Semantics.identifier as the native automation contract; Flutter Key values and localized labels are not substitutes.
- Literal identifiers must be unique across the entire project and use stable lowercase dotted names such as auth.login.submit.
- Repeated rows may use interpolation only with a stable domain identifier, for example 'cart.item.\${item.id}.remove'. Never use a list index, localized text, current position, random value, or hashCode.
- Preserve an existing valid identifier unless it is duplicate, unstable, or attached to the wrong semantic node.
- Dynamic identifiers must be called out as requiring runtime uniqueness verification.

Accessibility rules
- A visible Text child, TextField decoration, tooltip, or existing localized semantic expression may already provide an accessible name. Do not add redundant labels just to increase a counter.
- Convert component and path tokens into a concise human phrase: split PascalCase/camelCase/snake_case/kebab-case, preserve recognized acronyms, remove purely technical suffixes, and append the actual control role exactly once. This prompt requires role-explicit label candidates. VisitorArea used as a button must produce the canonical English label candidate "visitor area button"; VisitorAreaButton must produce the same phrase, never "visitor area button button". A dropdown named BranchSelector should produce "branch selector dropdown". Generic shared names such as MobileButton must not override the owning feature name.
- Treat that canonical phrase as semantic intent, then search visible text and the project's localization APIs/catalogs for the equivalent user-facing expression. Reuse an existing localized Dart expression whenever available. The English example "visitor area button" describes the required meaning; do not hardcode it into Arabic or multilingual production UI when a localized expression exists.
- If no correct localized expression exists, do not silently invent production copy. Leave the code change unresolved, report the exact file/control plus the derived canonical phrase, and recommend the localization key/value that should be added. Reuse an existing hardcoded visible literal only when it already supplies the same meaning; do not introduce a new hardcoded English literal solely for semantics.
- Validate the derived phrase against behavior. Names that describe layout, styling, implementation, or callbacks—such as "container", "mobile", "changed", "pressed", or "gesture detector"—are invalid unless they are genuinely part of the user-facing domain meaning.
- Every Semantics node with an explicit label or hint must also set textDirection: Directionality.of(context). This is required for custom Semantics-wrapped GestureDetector controls, dropdown/select controls, and any other explicit semantic text. Do not infer direction from the string and do not hardcode TextDirection.rtl or TextDirection.ltr; Directionality.of(context) must work for both Arabic and English.
- Keep one semantics boundary per logical control. The Arabic literals below illustrate the required node shape; in production, replace them with the project's existing localized expressions:

  Semantics(
    identifier: 'pages.login_screens.open_bank_account.branches.select',
    label: 'الفرع',
    hint: 'إختر الفرع',
    textDirection: Directionality.of(context),
    button: true,
    child: control,
  )

- When extending a shared widget with semantic label/hint parameters, obtain Directionality.of(context) inside its build method and attach it to the same single Semantics boundary. Do not add another outer Semantics wrapper merely to supply textDirection.
- Keep labels concise and user-facing; keep implementation details in identifiers, not labels.
- Preserve disabled state, focus behavior, gestures, merge/exclude semantics behavior, and tap targets.

Safe execution and verification
- Review duplicate identifiers globally before editing.
- For simple leaf identifier changes supported by the MCP workflow, call preview_semantics_fixes and inspect its file-grouped preview before apply_semantics_fixes. Shared-widget API refactors require normal source edits and a reviewed diff.
- Refuse an unsafe rewrite instead of removing const, changing widget behavior, or applying a broad wrapper.
- Run dart format on changed Dart files, flutter analyze, and relevant tests.
- Run scan_interactives again. Report before/after counts for accessibility missing/uncertain, automation missing/dynamic/duplicate, the shared widget definitions changed, call sites updated, wrapper fallbacks used, and any opaque/manual items that remain.
- No forced semantics handle, SemanticsBinding.ensureSemantics call, or special QA build flag should be needed on Android. With the target screen displayed, verify the native accessibility hierarchy using:

  adb shell uiautomator dump /sdcard/window.xml
  adb exec-out cat /sdcard/window.xml

  The exact Semantics.identifier values must appear as resource-id and explicit labels/hints must appear in content-desc. If the dump contains only Flutter's host FrameLayout with empty resource-id/content-desc, first audit missing textDirection on explicit label/hint nodes—especially custom GestureDetector and dropdown controls—then inspect duplicate or overly broad semantics boundaries.
`;
}
