export type InteractionKind =
  | "button"
  | "textInput"
  | "selection"
  | "toggle"
  | "slider"
  | "gesture"
  | "navigation"
  | "custom"
  | "opaque";

export type DetectionConfidence = "high" | "medium";
export type AccessibilityState = "ready" | "missing" | "uncertain";
export type AutomationState = "present" | "missing" | "dynamic" | "duplicate";

export interface SourceReference {
  path: string;
  line: number;
  column: number;
  endLine: number;
  endColumn: number;
  startOffset: number;
  endOffset: number;
  sourceHash: string;
}

/** One semantics-related constructor parameter of a project widget (for example `semanticsIdentifier`). */
export interface ContractParam {
  name: string;
  required: boolean;
  nullable: boolean;
}

/**
 * How a project-owned widget lets callers set semantics:
 *  - `complete`: an identifier parameter exists and is forwarded into a `Semantics` node (or another widget's contract),
 *  - `declaredNotForwarded`: a parameter exists but nothing uses it,
 *  - `missing`: no identifier parameter.
 */
export type ContractStatus = "complete" | "declaredNotForwarded" | "missing";

export interface SemanticsContract {
  identifier?: ContractParam;
  /**
   * For widgets with several controls: a prefix each inner identifier is built from
   * (`'$semanticsIdentifierPrefix.undo'`), so every instance stays unique.
   */
  prefix?: ContractParam;
  label?: ContractParam;
  hint?: ContractParam;
  status: ContractStatus;
}

/** Where a finding sits relative to project-owned shared widgets. */
export type FindingRole =
  /** An SDK/package interactive widget inside a shared widget's own definition (fix the definition, not this line). */
  | "shared-definition-root"
  /** An invocation of a shared project widget. */
  | "shared-call-site"
  /** An invocation of a non-shared project widget. */
  | "local-call-site"
  /** A control inside a reused multi-control widget: its identifiers derive from that widget's prefix parameter. */
  | "composite-item"
  /** An SDK/package widget outside any shared definition. */
  | "sdk";

/** The project-owned definition an invocation resolves to. */
export interface ResolvedWidget {
  className: string;
  path: string;
  line: number;
  shared: boolean;
  /** The invoked widget has several controls and takes an identifier prefix instead of a single identifier. */
  composite: boolean;
  layer: number;
  contract: SemanticsContract;
  hasVisibleText: boolean;
  /** The call site passes a text-like argument (text, title, label...), so the widget shows its own name. */
  passesText: boolean;
  /** How the name was resolved: through the import/export graph, or because the class name is unique in the project. */
  resolution: "imports" | "unique-name";
}

/**
 * How a finding should be fixed (Phase 3 and the phases before it):
 *  - `shared-widget`: add the contract to the shared widget's definition first (Phase 1)
 *  - `pass-contract`: pass the widget's own semantics parameter at this call site
 *  - `composite-prefix`: derive from the composite's required prefix parameter
 *  - `reuse-wrapper`: a `Semantics` already owns this control; complete it
 *  - `builtin-label`: name it with the SDK widget's own tooltip, then add the identifier
 *  - `wrap`: wrap the exact expression in one `Semantics`
 *  - `manual`: opaque or unresolved; needs a person
 */
export type Remediation =
  | "shared-widget"
  | "pass-contract"
  | "composite-prefix"
  | "reuse-wrapper"
  | "builtin-label"
  | "wrap"
  | "manual";

export interface SemanticsEvidence {
  identifierExpression?: string;
  labelExpression?: string;
  hintExpression?: string;
  tooltipExpression?: string;
  keyExpression?: string;
  roleExpression?: string;
  /** Range of the Semantics call that owns this finding. */
  wrapper?: SourceReference;
  /** Exact value range for an existing identifier argument. */
  identifierValue?: SourceReference;
  /** Offset immediately after the opening argument parenthesis. */
  identifierInsertOffset?: number;
  /** True when identifier belongs in a nested SemanticsProperties call. */
  usesPropertiesConstructor?: boolean;
  /**
   * Where a new named argument can be appended to this invocation, and whether a
   * leading comma is required. Used to pass a widget's own semantics parameters
   * instead of wrapping it in a second `Semantics` node.
   */
  argumentInsert?: { offset: number; leadingComma: boolean; empty: boolean };
  /** True when the identifier/label above came from the widget's own parameters, not a wrapping `Semantics`. */
  viaWidgetContract?: boolean;
  localizedCandidates: string[];
}

export interface InteractiveFinding {
  occurrenceId: string;
  widgetType: string;
  kind: InteractionKind;
  callbacks: string[];
  confidence: DetectionConfidence;
  enabled: "enabled" | "disabled" | "unknown";
  source: SourceReference;
  semantics: SemanticsEvidence;
  accessibility: AccessibilityState;
  automation: AutomationState;
  suggestedIdentifier: string;
  opaqueReason?: string;
  inConstContext?: boolean;
  role: FindingRole;
  remediation: Remediation;
  /** The project widget class this finding is written in (the "owning component"). */
  owner?: { className: string; path: string };
  /** Set when the invoked widget is project-owned. */
  resolved?: ResolvedWidget;
  /** Project classes with the invoked name that could not be told apart. */
  ambiguousWith?: string[];
}

/** A shared project widget with everything needed to upgrade it once and update its call sites. */
export interface SharedWidgetSummary {
  /** A single-control widget (fix its definition once) or a reused multi-control widget (add an identifier prefix). */
  kind: "control" | "composite";
  /** Interactive roots inside the definition (1 for a control). */
  rootCount: number;
  className: string;
  path: string;
  line: number;
  sharedReason: "call-sites" | "directory";
  /** 0 = only SDK interactive roots; higher layers wrap lower ones and are fixed after them. */
  layer: number;
  callSites: number;
  callSiteFiles: number;
  /** Interactive call sites that still lack an identifier. */
  callSitesMissing: number;
  contract: SemanticsContract;
  hasVisibleText: boolean;
  wraps: string[];
  interactiveRootLines: number[];
  existingSemanticsLine?: number;
  /** Constructor parameters to add, e.g. `required String semanticsIdentifier`. */
  requiredParamsToAdd: string[];
}

export interface InteractiveFileGroup {
  path: string;
  primaryReference: SourceReference;
  readyCount: number;
  issueCount: number;
  findings: InteractiveFinding[];
}

export interface ScanDiagnostic {
  path?: string;
  severity: "info" | "warning" | "error";
  message: string;
}

export interface InteractiveScanTotals {
  filesScanned: number;
  findings: number;
  automationReady: number;
  automationMissing: number;
  automationDynamic: number;
  automationDuplicate: number;
  accessibilityReady: number;
  accessibilityMissing: number;
  accessibilityUncertain: number;
  opaque: number;
  sharedWidgets: number;
  sharedWidgetsMissingContract: number;
  callSitesMissingContract: number;
  /** Reused multi-control widgets, and their call sites that still lack a prefix. */
  composites: number;
  compositeCallSitesMissing: number;
}

export interface InteractiveScanResult {
  schemaVersion: 1;
  projectRoot: string;
  scannedAt: string;
  totals: InteractiveScanTotals;
  excludedPaths: string[];
  diagnostics: ScanDiagnostic[];
  groups: InteractiveFileGroup[];
  /** Shared project widgets, ordered so base widgets (layer 0) come before the widgets that wrap them. */
  widgets: SharedWidgetSummary[];
  /** Reused widgets with several controls; each needs a required identifier prefix (Phase 3). */
  composites: SharedWidgetSummary[];
}

export interface InteractiveScannerOptions {
  excludedGlobs?: string[];
  customWidgets?: string[];
  callbackNames?: string[];
  ignoredWidgets?: string[];
  /** A widget used at least this many times across at least two files counts as shared (default 2). */
  sharedWidgetMinCallSites?: number;
  /** Directory names under lib/ whose interactive widgets always count as shared. */
  sharedWidgetDirs?: string[];
}

export interface SemanticsFixRequest {
  occurrenceId: string;
  identifier: string;
  labelExpression?: string;
  hintExpression?: string;
}

export interface SemanticsPreviewEdit {
  startOffset: number;
  endOffset: number;
  replacement: string;
}

export interface SemanticsPreviewChange {
  path: string;
  originalHash: string;
  proposedHash: string;
  edits: SemanticsPreviewEdit[];
  beforeSnippet: string;
  afterSnippet: string;
}

export interface SemanticsFixPreview {
  previewId: string;
  createdAt: string;
  expiresAt: string;
  changes: SemanticsPreviewChange[];
  diagnostics: ScanDiagnostic[];
}

export interface ApplySemanticsResult {
  ok: boolean;
  changedFiles: string[];
  message: string;
}
