import type { SemanticsFixRequest } from "../../features/semantics/index.js";
import {
  captureAndroidUiDump,
  listAndroidDevices,
} from "../../features/semantics/android-ui-dump.js";
import * as path from "path";
import * as vscode from "vscode";
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

export async function handleDumpAndroidUi(ref: WebviewRef, mode: "export" | "clipboard"): Promise<void> {
  try {
    ref.webview.postMessage({ type: "semanticsDumpLoading", loading: true });
    const configuredAdbPath = vscode.workspace
      .getConfiguration("flutter-config-manager.android")
      .get<string>("adbPath", "")
      .trim();
    const { adbPath, devices } = await listAndroidDevices(configuredAdbPath || undefined);
    const connected = devices.filter((device) => device.state === "device");
    if (!connected.length) {
      const unavailable = devices.length
        ? ` Found: ${devices.map((device) => `${device.id} (${device.state})`).join(", ")}.`
        : "";
      throw new Error(`No authorized Android device or emulator is connected.${unavailable}`);
    }

    let deviceId = connected[0].id;
    if (connected.length > 1) {
      const selected = await vscode.window.showQuickPick(
        connected.map((device) => ({
          label: device.id,
          description: device.description || "Android device",
          deviceId: device.id,
        })),
        { title: "Select the Android device whose current UI should be dumped", placeHolder: "Android device or emulator" },
      );
      if (!selected) {
        ref.webview.postMessage({ type: "semanticsDumpCancelled" });
        return;
      }
      deviceId = selected.deviceId;
    }

    const capture = await captureAndroidUiDump(adbPath, deviceId);
    if (mode === "clipboard") {
      await vscode.env.clipboard.writeText(capture.yaml);
      ref.webview.postMessage({
        type: "semanticsDumpCopied",
        deviceId,
        summary: capture.result.summary,
      });
      return;
    }
    const workspaceUri = vscode.workspace.workspaceFolders?.[0]?.uri;
    const defaultUri = workspaceUri
      ? vscode.Uri.joinPath(workspaceUri, "current-screen-semantics.yaml")
      : vscode.Uri.file(path.join(process.cwd(), "current-screen-semantics.yaml"));
    const destination = await vscode.window.showSaveDialog({
      title: "Export current Android UI semantics",
      defaultUri,
      filters: { YAML: ["yaml", "yml"] },
      saveLabel: "Export semantics",
    });
    if (!destination) {
      ref.webview.postMessage({ type: "semanticsDumpCancelled" });
      return;
    }
    await vscode.workspace.fs.writeFile(destination, Buffer.from(capture.yaml, "utf8"));
    const document = await vscode.workspace.openTextDocument(destination);
    await vscode.window.showTextDocument(document, { preview: true });
    ref.webview.postMessage({
      type: "semanticsDumpSaved",
      path: destination.fsPath,
      deviceId,
      summary: capture.result.summary,
    });
  } catch (error) {
    ref.webview.postMessage({ type: "semanticsDumpError", message: toErrorMessage(error) });
  } finally {
    ref.webview.postMessage({ type: "semanticsDumpLoading", loading: false });
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
