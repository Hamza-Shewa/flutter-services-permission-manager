import * as crypto from "crypto";
import * as fs from "fs";
import * as path from "path";
import {
  flattenInteractiveFindings,
  scanInteractives,
  sha256,
  validateDartSyntax,
} from "./scanner.js";
import type {
  ApplySemanticsResult,
  InteractiveFinding,
  InteractiveScannerOptions,
  ScanDiagnostic,
  SemanticsFixPreview,
  SemanticsFixRequest,
  SemanticsPreviewChange,
  SemanticsPreviewEdit,
} from "./types.js";

const PREVIEW_TTL_MS = 15 * 60 * 1000;

interface StoredPreview extends SemanticsFixPreview {
  root: string;
  consumed: boolean;
  files: Map<string, { originalContent: string; proposedContent: string }>;
}

const previews = new Map<string, StoredPreview>();

function normalizePath(value: string): string {
  return value.split(path.sep).join("/");
}

function projectFile(root: string, relativePath: string): string {
  const absoluteRoot = path.resolve(root);
  const absolute = path.resolve(absoluteRoot, relativePath);
  if (absolute === absoluteRoot || !absolute.startsWith(`${absoluteRoot}${path.sep}`)) {
    throw new Error(`Source path escapes the project root: ${relativePath}`);
  }
  return absolute;
}

function validateIdentifier(value: string): { dynamic: boolean } {
  const trimmed = value.trim();
  if (!trimmed || trimmed.includes("\n") || trimmed.includes("\r") || trimmed.includes("'") || trimmed.includes('"')) {
    throw new Error(`Invalid semantics identifier: ${value}`);
  }
  const dynamic = /\$(?:\{|[A-Za-z_$])/.test(trimmed);
  const normalized = trimmed
    .replace(/\$\{[^{}]+\}/g, "dynamic")
    .replace(/\$[A-Za-z_$][\w$]*/g, "dynamic");
  if (!/^[a-z][a-z0-9_]*(?:\.[a-z][a-z0-9_]*)+$/.test(normalized)) {
    throw new Error(`Identifier must use a dotted lower-case hierarchy, for example auth.login.submit: ${value}`);
  }
  return { dynamic };
}

function dartString(value: string): string {
  return `'${value.replace(/\\/g, "\\\\")}'`;
}

/**
 * The expression must be a non-literal that already exists in the widget or somewhere in the
 * project's Dart sources (generated localization accessors included), so semantics never
 * introduces new hardcoded copy.
 */
function validateLocalizedExpression(
  expression: string | undefined,
  widgetSource: string,
  property: string,
  projectHas: (expression: string) => boolean,
): void {
  if (!expression) {
    return;
  }
  const trimmed = expression.trim();
  if (!trimmed || /^r?['"]/.test(trimmed) || trimmed.includes(";") || trimmed.includes("\n") ||
    !(widgetSource.includes(trimmed) || projectHas(trimmed))) {
    throw new Error(`${property} must be an existing non-literal localized expression from the widget source or the project's localization code.`);
  }
}

/** Lazily reads every Dart file under lib/ (generated ones too) to answer "does this expression exist?". */
function projectSearch(root: string): (expression: string) => boolean {
  let text: string | undefined;
  return (expression) => {
    if (text === undefined) {
      const chunks: string[] = [];
      const stack = [path.join(root, "lib")];
      while (stack.length > 0) {
        const directory = stack.pop()!;
        let entries: fs.Dirent[] = [];
        try {
          entries = fs.readdirSync(directory, { withFileTypes: true });
        } catch {
          continue;
        }
        for (const entry of entries) {
          const absolute = path.join(directory, entry.name);
          if (entry.isDirectory() && !entry.isSymbolicLink()) {
            stack.push(absolute);
          } else if (entry.isFile() && entry.name.endsWith(".dart")) {
            chunks.push(fs.readFileSync(absolute, "utf8"));
          }
        }
      }
      text = chunks.join("\n");
    }
    return text.includes(expression);
  };
}

function buildEdit(finding: InteractiveFinding, request: SemanticsFixRequest, source: string, projectHas: (expression: string) => boolean): SemanticsPreviewEdit {
  const identifier = dartString(request.identifier.trim());
  const widgetSource = source.slice(finding.source.startOffset, finding.source.endOffset);
  validateLocalizedExpression(request.labelExpression, widgetSource, "labelExpression", projectHas);
  validateLocalizedExpression(request.hintExpression, widgetSource, "hintExpression", projectHas);

  if (finding.opaqueReason) {
    throw new Error(`${finding.widgetType} is opaque and cannot be fixed automatically.`);
  }

  if (finding.role === "shared-definition-root") {
    const owner = finding.owner?.className ?? "the shared widget";
    throw new Error(`${finding.widgetType} at ${finding.source.path}:${finding.source.line} is inside ${owner}. Add required semantics parameters to ${owner} and pass them from its call sites instead of hardcoding one identifier here.`);
  }

  if (finding.role === "composite-item") {
    const owner = finding.owner?.className ?? "the widget";
    throw new Error(`${finding.widgetType} at ${finding.source.path}:${finding.source.line} is one of several controls inside ${owner}, which is reused. Give ${owner} a required identifier prefix parameter and build this control's identifier from it.`);
  }

  if (finding.semantics.identifierValue) {
    return {
      startOffset: finding.semantics.identifierValue.startOffset,
      endOffset: finding.semantics.identifierValue.endOffset,
      replacement: identifier,
    };
  }

  const contract = finding.resolved?.contract;
  if ((contract?.identifier ?? contract?.prefix) && contract.status === "complete" && !finding.semantics.wrapper && finding.semantics.argumentInsert) {
    return buildContractEdit(finding, request, identifier);
  }

  // Icon-only SDK buttons name themselves through `tooltip`; that is the label, so it is not repeated on the Semantics node.
  const labelViaTooltip = finding.remediation === "builtin-label" && !!request.labelExpression &&
    !finding.semantics.labelExpression && !finding.semantics.tooltipExpression && !!finding.semantics.argumentInsert;
  const child = labelViaTooltip
    ? withNamedArgument(widgetSource, finding.semantics.argumentInsert!, finding.source.startOffset, `tooltip: ${request.labelExpression!.trim()}`)
    : widgetSource;

  const extra = [
    `identifier: ${identifier}`,
    request.labelExpression && !finding.semantics.labelExpression && !labelViaTooltip ? `label: ${request.labelExpression.trim()}` : undefined,
    request.hintExpression && !finding.semantics.hintExpression ? `hint: ${request.hintExpression.trim()}` : undefined,
  ].filter((value): value is string => !!value);

  if (finding.semantics.wrapper && finding.semantics.identifierInsertOffset !== undefined) {
    return {
      startOffset: finding.semantics.identifierInsertOffset,
      endOffset: finding.semantics.identifierInsertOffset,
      replacement: `${extra.join(", ")}, `,
    };
  }

  const { dynamic } = validateIdentifier(request.identifier);
  if (finding.inConstContext && (dynamic || request.labelExpression || request.hintExpression)) {
    throw new Error(`Dynamic identifiers or localized label/hint expressions cannot be inserted safely in the const context at ${finding.source.path}:${finding.source.line}.`);
  }
  const replacement = finding.inConstContext
    ? `const Semantics.fromProperties(properties: SemanticsProperties(${extra.join(", ")}), child: ${child})`
    : `Semantics(${extra.join(", ")}, child: ${child})`;
  return {
    startOffset: finding.source.startOffset,
    endOffset: finding.source.endOffset,
    replacement,
  };
}

/** Returns `widgetSource` with `argument` appended to its argument list (positions are relative to `base`). */
function withNamedArgument(widgetSource: string, insert: { offset: number; leadingComma: boolean; empty: boolean }, base: number, argument: string): string {
  const at = insert.offset - base;
  const piece = insert.leadingComma ? `, ${argument}` : insert.empty ? argument : ` ${argument},`;
  return widgetSource.slice(0, at) + piece + widgetSource.slice(at);
}

/**
 * Passes the semantics through the project widget's own parameters
 * (`MyButton(..., semanticsIdentifier: 'x')`) instead of wrapping it in a second
 * `Semantics` node, which would compete with the one the widget already owns.
 */
function buildContractEdit(finding: InteractiveFinding, request: SemanticsFixRequest, identifier: string): SemanticsPreviewEdit {
  const contract = finding.resolved!.contract;
  const insert = finding.semantics.argumentInsert!;
  const { dynamic } = validateIdentifier(request.identifier);
  const needsLabel = !!contract.label?.required && !finding.semantics.labelExpression;
  if (needsLabel && !request.labelExpression) {
    throw new Error(`${finding.resolved!.className} requires ${contract.label!.name}; provide an existing localized labelExpression for ${finding.source.path}:${finding.source.line}.`);
  }
  if (finding.inConstContext && (dynamic || request.labelExpression || request.hintExpression)) {
    throw new Error(`Dynamic identifiers or localized label/hint expressions cannot be inserted safely in the const context at ${finding.source.path}:${finding.source.line}.`);
  }
  const identifierParam = (contract.identifier ?? contract.prefix)!;
  const args = [
    `${identifierParam.name}: ${identifier}`,
    request.labelExpression && contract.label && !finding.semantics.labelExpression
      ? `${contract.label.name}: ${request.labelExpression.trim()}` : undefined,
    request.hintExpression && contract.hint && !finding.semantics.hintExpression
      ? `${contract.hint.name}: ${request.hintExpression.trim()}` : undefined,
  ].filter((value): value is string => !!value);
  const body = args.join(", ");
  const trailingComma = !insert.leadingComma && !insert.empty;
  const replacement = insert.leadingComma ? `, ${body}` : trailingComma ? ` ${body},` : body;
  return { startOffset: insert.offset, endOffset: insert.offset, replacement };
}

function applyEdits(source: string, edits: SemanticsPreviewEdit[]): string {
  const sorted = [...edits].sort((left, right) => right.startOffset - left.startOffset);
  let lastStart = source.length + 1;
  let output = source;
  for (const edit of sorted) {
    if (edit.endOffset > lastStart || edit.startOffset < 0 || edit.endOffset < edit.startOffset || edit.endOffset > source.length) {
      throw new Error("Selected semantics fixes overlap or contain invalid source ranges.");
    }
    output = output.slice(0, edit.startOffset) + edit.replacement + output.slice(edit.endOffset);
    lastStart = edit.startOffset;
  }
  return output;
}

function snippet(source: string, edits: SemanticsPreviewEdit[]): string {
  const first = Math.min(...edits.map((edit) => edit.startOffset));
  const last = Math.max(...edits.map((edit) => edit.endOffset));
  const start = Math.max(0, source.lastIndexOf("\n", Math.max(0, first - 1)) + 1);
  const endBreak = source.indexOf("\n", last);
  const end = endBreak === -1 ? source.length : endBreak;
  return source.slice(start, end).trim();
}

function prunePreviews(): void {
  const now = Date.now();
  for (const [id, preview] of previews) {
    if (preview.consumed || Date.parse(preview.expiresAt) <= now) {
      previews.delete(id);
    }
  }
}

export async function previewSemanticsFixes(
  rootPath: string,
  requests: SemanticsFixRequest[],
  options: InteractiveScannerOptions = {},
): Promise<SemanticsFixPreview> {
  prunePreviews();
  if (requests.length === 0) {
    throw new Error("Select at least one semantics fix to preview.");
  }
  const root = path.resolve(rootPath);
  const scan = await scanInteractives(root, options);
  const findings = flattenInteractiveFindings(scan);
  const byId = new Map(findings.map((finding) => [finding.occurrenceId, finding]));
  const selectedIds = new Set(requests.map((request) => request.occurrenceId));
  const requestedLiterals = new Map<string, string>();
  for (const request of requests) {
    const { dynamic } = validateIdentifier(request.identifier);
    if (!dynamic) {
      const previous = requestedLiterals.get(request.identifier);
      if (previous && previous !== request.occurrenceId) {
        throw new Error(`Duplicate requested identifier: ${request.identifier}`);
      }
      requestedLiterals.set(request.identifier, request.occurrenceId);
      const conflict = findings.find((finding) => {
        if (selectedIds.has(finding.occurrenceId)) {
          return false;
        }
        const expression = finding.semantics.identifierExpression?.trim();
        return expression === `'${request.identifier}'` || expression === `"${request.identifier}"`;
      });
      if (conflict) {
        throw new Error(`Identifier ${request.identifier} already exists at ${conflict.source.path}:${conflict.source.line}.`);
      }
    }
  }

  const projectHas = projectSearch(root);
  const grouped = new Map<string, Array<{ finding: InteractiveFinding; request: SemanticsFixRequest }>>();
  for (const request of requests) {
    const finding = byId.get(request.occurrenceId);
    if (!finding) {
      throw new Error(`Finding ${request.occurrenceId} is stale or no longer exists. Rescan before previewing.`);
    }
    const list = grouped.get(finding.source.path) ?? [];
    list.push({ finding, request });
    grouped.set(finding.source.path, list);
  }

  const diagnostics: ScanDiagnostic[] = [];
  const changes: SemanticsPreviewChange[] = [];
  const files = new Map<string, { originalContent: string; proposedContent: string }>();
  for (const [relativePath, entries] of grouped) {
    const absolute = projectFile(root, relativePath);
    const originalContent = fs.readFileSync(absolute, "utf8");
    const expectedHash = entries[0].finding.source.sourceHash;
    if (sha256(originalContent) !== expectedHash) {
      throw new Error(`${relativePath} changed after scanning. Rescan before previewing fixes.`);
    }
    const edits = entries.map(({ finding, request }) => buildEdit(finding, request, originalContent, projectHas));
    const proposedContent = applyEdits(originalContent, edits);
    if (!await validateDartSyntax(proposedContent)) {
      throw new Error(`Proposed changes would not parse as valid Dart: ${relativePath}`);
    }
    changes.push({
      path: relativePath,
      originalHash: sha256(originalContent),
      proposedHash: sha256(proposedContent),
      edits,
      beforeSnippet: snippet(originalContent, edits),
      afterSnippet: snippet(proposedContent, edits.map((edit) => ({ ...edit, endOffset: edit.startOffset + edit.replacement.length }))),
    });
    files.set(relativePath, { originalContent, proposedContent });
  }

  const now = new Date();
  const previewId = crypto.randomUUID();
  const stored: StoredPreview = {
    previewId,
    createdAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + PREVIEW_TTL_MS).toISOString(),
    changes,
    diagnostics,
    root,
    consumed: false,
    files,
  };
  previews.set(previewId, stored);
  return { previewId, createdAt: stored.createdAt, expiresAt: stored.expiresAt, changes, diagnostics };
}

export function getValidatedSemanticsPreview(rootPath: string, previewId: string): StoredPreview {
  prunePreviews();
  const preview = previews.get(previewId);
  const root = path.resolve(rootPath);
  if (!preview || preview.root !== root || preview.consumed || Date.parse(preview.expiresAt) <= Date.now()) {
    throw new Error("Semantics preview is missing, expired, consumed, or belongs to another project.");
  }
  for (const change of preview.changes) {
    const content = fs.readFileSync(projectFile(root, change.path), "utf8");
    if (sha256(content) !== change.originalHash) {
      throw new Error(`${change.path} changed after preview. Generate a new preview before applying.`);
    }
  }
  return preview;
}

export function consumeSemanticsPreview(previewId: string): void {
  const preview = previews.get(previewId);
  if (preview) {
    preview.consumed = true;
    previews.delete(previewId);
  }
}

export async function applySemanticsPreviewToFiles(rootPath: string, previewId: string): Promise<ApplySemanticsResult> {
  const preview = getValidatedSemanticsPreview(rootPath, previewId);
  const backups = new Map<string, string>();
  try {
    for (const change of preview.changes) {
      const absolute = projectFile(preview.root, change.path);
      const proposed = preview.files.get(change.path)?.proposedContent;
      if (proposed === undefined) {
        throw new Error(`Preview content is missing for ${change.path}.`);
      }
      backups.set(absolute, fs.readFileSync(absolute, "utf8"));
      fs.writeFileSync(absolute, proposed, "utf8");
    }
  } catch (error) {
    for (const [absolute, original] of backups) {
      try {
        fs.writeFileSync(absolute, original, "utf8");
      } catch {
        // Best-effort rollback; the original error is more actionable.
      }
    }
    throw error;
  }
  consumeSemanticsPreview(previewId);
  return {
    ok: true,
    changedFiles: preview.changes.map((change) => normalizePath(change.path)),
    message: `Applied semantics fixes to ${preview.changes.length} file(s).`,
  };
}

export function getPreviewContents(preview: StoredPreview): Map<string, { originalContent: string; proposedContent: string }> {
  return new Map(preview.files);
}

