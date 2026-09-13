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
- Never invent or hardcode user-facing English. Reuse an existing localized Dart expression. If no correct localized expression exists, leave the accessibility item unresolved and report the exact file/control needing product copy.
- Keep labels concise and user-facing; keep implementation details in identifiers, not labels.
- Preserve disabled state, focus behavior, gestures, merge/exclude semantics behavior, and tap targets.

Safe execution and verification
- Review duplicate identifiers globally before editing.
- For simple leaf identifier changes supported by the MCP workflow, call preview_semantics_fixes and inspect its file-grouped preview before apply_semantics_fixes. Shared-widget API refactors require normal source edits and a reviewed diff.
- Refuse an unsafe rewrite instead of removing const, changing widget behavior, or applying a broad wrapper.
- Run dart format on changed Dart files, flutter analyze, and relevant tests.
- Run scan_interactives again. Report before/after counts for accessibility missing/uncertain, automation missing/dynamic/duplicate, the shared widget definitions changed, call sites updated, wrapper fallbacks used, and any opaque/manual items that remain.
`;
}
