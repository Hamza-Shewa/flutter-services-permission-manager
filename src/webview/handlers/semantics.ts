import type { SemanticsFixRequest } from "../../features/semantics/index.js";
import {
  applyWorkspaceSemanticsPreview,
  copyWorkspaceSemanticsPrompt,
  previewWorkspaceSemanticsFixes,
  revealWorkspaceSource,
  scanWorkspaceInteractives,
} from "../../features/semantics/semantics.service.js";
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

export async function handleCopySemanticsPrompt(ref: WebviewRef): Promise<void> {
  try {
    ref.webview.postMessage({ type: "semanticsPromptCopying", copying: true });
    const result = await copyWorkspaceSemanticsPrompt();
    ref.webview.postMessage({ type: "interactivesResult", result });
    ref.webview.postMessage({ type: "semanticsPromptCopying", copying: false });
    ref.webview.postMessage({ type: "semanticsPromptCopied" });
  } catch (error) {
    ref.webview.postMessage({ type: "interactivesError", message: toErrorMessage(error) });
    ref.webview.postMessage({ type: "semanticsPromptCopying", copying: false });
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
