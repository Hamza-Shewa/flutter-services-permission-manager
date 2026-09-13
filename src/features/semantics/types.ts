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
  accessibilityReady: number;
  opaque: number;
}

export interface InteractiveScanResult {
  schemaVersion: 1;
  projectRoot: string;
  scannedAt: string;
  totals: InteractiveScanTotals;
  excludedPaths: string[];
  diagnostics: ScanDiagnostic[];
  groups: InteractiveFileGroup[];
}

export interface InteractiveScannerOptions {
  excludedGlobs?: string[];
  customWidgets?: string[];
  callbackNames?: string[];
  ignoredWidgets?: string[];
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
