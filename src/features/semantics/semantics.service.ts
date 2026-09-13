import * as path from "path";
import * as vscode from "vscode";
import { execWithEnv, getFlutterCommand } from "../../core/utils/exec.js";
import {
  consumeSemanticsPreview,
  getPreviewContents,
  getValidatedSemanticsPreview,
  previewSemanticsFixes,
  scanInteractives,
  buildSemanticsImplementationPrompt,
} from "./index.js";
import type {
  ApplySemanticsResult,
  InteractiveScannerOptions,
  InteractiveScanResult,
  SemanticsFixPreview,
  SemanticsFixRequest,
} from "./types.js";

export function getInteractiveScannerOptions(): InteractiveScannerOptions {
  const config = vscode.workspace.getConfiguration("flutter-config-manager.interactives");
  const clean = (key: string): string[] => (config.get<string[]>(key, []) ?? [])
    .map((value) => value.trim())
    .filter(Boolean);
  return {
    excludedGlobs: clean("excludedGlobs"),
    customWidgets: clean("customWidgets"),
    callbackNames: clean("callbackNames"),
    ignoredWidgets: clean("ignoredWidgets"),
  };
}

function workspaceRoot(): string {
  const root = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  if (!root) {
    throw new Error("No workspace folder is open.");
  }
  return root;
}

function ensureNoDirtyDartDocuments(root: string): void {
  const absoluteRoot = path.resolve(root);
  const dirty = vscode.workspace.textDocuments.find((document) =>
    document.isDirty && document.uri.scheme === "file" && document.languageId === "dart" &&
    (document.uri.fsPath === absoluteRoot || document.uri.fsPath.startsWith(`${absoluteRoot}${path.sep}`)),
  );
  if (dirty) {
    throw new Error(`Save ${path.relative(root, dirty.uri.fsPath)} before scanning or applying semantics fixes.`);
  }
}

function ensureIdentifierCompatibility(root: string): Promise<void> {
  return new Promise((resolve, reject) => {
    execWithEnv(`${getFlutterCommand()} --version --machine`, { cwd: root }, (error, stdout) => {
      if (error) {
        reject(new Error("Flutter 3.19 or newer is required for Semantics.identifier fixes, but the project Flutter SDK version could not be verified."));
        return;
      }
      try {
        const version = String((JSON.parse(stdout) as { frameworkVersion?: string }).frameworkVersion ?? "");
        const [major, minor] = version.split(".").map(Number);
        if (!Number.isFinite(major) || !Number.isFinite(minor) || major < 3 || (major === 3 && minor < 19)) {
          reject(new Error(`Flutter 3.19 or newer is required for Semantics.identifier fixes; detected ${version || "unknown"}.`));
          return;
        }
        resolve();
      } catch {
        reject(new Error("Flutter 3.19 or newer is required for Semantics.identifier fixes, but flutter --version returned an unreadable result."));
      }
    });
  });
}

export async function scanWorkspaceInteractives(): Promise<InteractiveScanResult> {
  const root = workspaceRoot();
  ensureNoDirtyDartDocuments(root);
  return scanInteractives(root, getInteractiveScannerOptions());
}

export async function copyWorkspaceSemanticsPrompt(): Promise<InteractiveScanResult> {
  const result = await scanWorkspaceInteractives();
  await vscode.env.clipboard.writeText(buildSemanticsImplementationPrompt(result));
  return result;
}

export async function previewWorkspaceSemanticsFixes(requests: SemanticsFixRequest[]): Promise<SemanticsFixPreview> {
  const root = workspaceRoot();
  ensureNoDirtyDartDocuments(root);
  await ensureIdentifierCompatibility(root);
  return previewSemanticsFixes(root, requests, getInteractiveScannerOptions());
}

export async function applyWorkspaceSemanticsPreview(previewId: string): Promise<ApplySemanticsResult> {
  const root = workspaceRoot();
  ensureNoDirtyDartDocuments(root);
  const preview = getValidatedSemanticsPreview(root, previewId);
  const contents = getPreviewContents(preview);
  const edit = new vscode.WorkspaceEdit();
  for (const change of preview.changes) {
    const uri = vscode.Uri.file(path.resolve(root, change.path));
    const document = await vscode.workspace.openTextDocument(uri);
    const proposed = contents.get(change.path)?.proposedContent;
    if (proposed === undefined) {
      throw new Error(`Preview content is missing for ${change.path}.`);
    }
    edit.replace(uri, new vscode.Range(document.positionAt(0), document.positionAt(document.getText().length)), proposed);
  }
  const applied = await vscode.workspace.applyEdit(edit);
  if (!applied) {
    throw new Error("VS Code rejected the semantics workspace edit.");
  }
  await Promise.all(preview.changes.map(async (change) => {
    const document = await vscode.workspace.openTextDocument(vscode.Uri.file(path.resolve(root, change.path)));
    await document.save();
  }));
  consumeSemanticsPreview(previewId);
  return {
    ok: true,
    changedFiles: preview.changes.map((change) => change.path),
    message: `Applied semantics fixes to ${preview.changes.length} file(s).`,
  };
}

export async function revealWorkspaceSource(relativePath: string, line = 1, column = 1): Promise<void> {
  const root = workspaceRoot();
  const absoluteRoot = path.resolve(root);
  const absolute = path.resolve(absoluteRoot, relativePath);
  if (absolute === absoluteRoot || !absolute.startsWith(`${absoluteRoot}${path.sep}`)) {
    throw new Error(`Cannot open a source path outside the workspace: ${relativePath}`);
  }
  const document = await vscode.workspace.openTextDocument(vscode.Uri.file(absolute));
  const editor = await vscode.window.showTextDocument(document, { preview: true });
  const position = new vscode.Position(Math.max(0, line - 1), Math.max(0, column - 1));
  editor.selection = new vscode.Selection(position, position);
  editor.revealRange(new vscode.Range(position, position), vscode.TextEditorRevealType.InCenter);
}
