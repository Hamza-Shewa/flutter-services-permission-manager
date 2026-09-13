import type { SemanticsFixRequest } from "../../features/semantics/index.js";
import {
  applyWorkspaceSemanticsPreview,
  previewWorkspaceSemanticsFixes,
  revealWorkspaceSource,
  scanWorkspaceInteractives,
} from "../../features/semantics/semantics.service.js";
import {
  checkCodexMcpInstallation,
  installCodexMcp,
} from "../../features/semantics/codex-mcp-installer.js";
import * as vscode from "vscode";
import { toErrorMessage } from "../../core/shared/index.js";
import type { WebviewRef } from "./index.js";

export async function handleScanInteractives(ref: WebviewRef): Promise<void> {
  try {
    ref.webview.postMessage({ type: "interactivesLoading", loading: true });
    const result = await scanWorkspaceInteractives();
    ref.webview.postMessage({ type: "interactivesResult", result });
  } catch (error) {
    ref.webview.postMessage({ type: "interactivesError", message: toErrorMessage(error) });
  } finally {
    ref.webview.postMessage({ type: "interactivesLoading", loading: false });
  }
}

export async function handlePreviewSemanticsFixes(ref: WebviewRef, requests: SemanticsFixRequest[]): Promise<void> {
  try {
    const preview = await previewWorkspaceSemanticsFixes(requests);
    ref.webview.postMessage({ type: "semanticsFixPreview", preview });
  } catch (error) {
    ref.webview.postMessage({ type: "interactivesError", message: toErrorMessage(error) });
  }
}

export async function handleApplySemanticsFixes(ref: WebviewRef, previewId: string): Promise<void> {
  try {
    const result = await applyWorkspaceSemanticsPreview(previewId);
    ref.webview.postMessage({ type: "semanticsFixApplied", result });
    await handleScanInteractives(ref);
  } catch (error) {
    ref.webview.postMessage({ type: "interactivesError", message: toErrorMessage(error) });
  }
}

export async function handleRevealSourceReference(
  ref: WebviewRef,
  payload: { path: string; line?: number; column?: number },
): Promise<void> {
  try {
    await revealWorkspaceSource(payload.path, payload.line, payload.column);
  } catch (error) {
    ref.webview.postMessage({ type: "interactivesError", message: toErrorMessage(error) });
  }
}

function codexInstallerOptions(extensionRoot: string) {
  const folder = vscode.workspace.workspaceFolders?.[0];
  if (!folder) {
    throw new Error("Open a Flutter workspace before installing its MCP server.");
  }
  const configuredCodexExecutable = vscode.workspace
    .getConfiguration("flutter-config-manager.mcp")
    .get<string>("codexExecutable");
  return {
    projectRoot: folder.uri.fsPath,
    extensionRoot,
    configuredCodexExecutable,
  };
}

export async function handleCheckCodexMcp(ref: WebviewRef, extensionRoot: string): Promise<void> {
  ref.webview.postMessage({
    type: "codexMcpStatus",
    state: "checking",
    message: "Checking user-level Codex MCP registration…",
    canInstall: false,
  });
  try {
    const status = await checkCodexMcpInstallation(codexInstallerOptions(extensionRoot));
    ref.webview.postMessage({ type: "codexMcpStatus", ...status });
  } catch (error) {
    ref.webview.postMessage({
      type: "codexMcpStatus",
      state: "error",
      message: toErrorMessage(error),
      canInstall: false,
    });
  }
}

export async function handleInstallCodexMcp(ref: WebviewRef, extensionRoot: string): Promise<void> {
  ref.webview.postMessage({
    type: "codexMcpStatus",
    state: "installing",
    message: "Installing MCP in the user-level Codex configuration…",
    canInstall: false,
  });
  try {
    const status = await installCodexMcp(codexInstallerOptions(extensionRoot));
    ref.webview.postMessage({ type: "codexMcpStatus", ...status });
    void vscode.window.showInformationMessage(status.message);
  } catch (error) {
    ref.webview.postMessage({
      type: "codexMcpStatus",
      state: "error",
      message: toErrorMessage(error),
      canInstall: true,
    });
  }
}
