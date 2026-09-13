import * as vscode from "vscode";
import {
  checkMcpClients,
  createUniversalMcpConfig,
  installMcpClient,
  type CodexMcpInstallerOptions,
  type McpClientId,
} from "../../features/semantics/codex-mcp-installer.js";
import { toErrorMessage } from "../../core/shared/index.js";
import type { WebviewRef } from "./index.js";

function installerOptions(extensionRoot: string): CodexMcpInstallerOptions {
  const folder = vscode.workspace.workspaceFolders?.[0];
  if (!folder) {
    throw new Error("Open a Flutter workspace before connecting its MCP server.");
  }
  const configuration = vscode.workspace.getConfiguration("flutter-config-manager.mcp");
  return {
    projectRoot: folder.uri.fsPath,
    extensionRoot,
    configuredCodexExecutable: configuration.get<string>("codexExecutable"),
    configuredClaudeExecutable: configuration.get<string>("claudeExecutable"),
    configuredGeminiExecutable: configuration.get<string>("geminiExecutable"),
  };
}

export async function handleCheckMcpClients(ref: WebviewRef, extensionRoot: string): Promise<void> {
  ref.webview.postMessage({ type: "mcpClientsStatus", clients: [], manualConfig: "", loading: true });
  try {
    const status = await checkMcpClients(installerOptions(extensionRoot));
    ref.webview.postMessage({ type: "mcpClientsStatus", ...status });
  } catch (error) {
    ref.webview.postMessage({
      type: "mcpClientsStatus",
      clients: [],
      manualConfig: "",
      error: toErrorMessage(error),
    });
  }
}

export async function handleInstallMcpClient(
  ref: WebviewRef,
  extensionRoot: string,
  client: McpClientId,
): Promise<void> {
  if (!["codex", "claude", "gemini", "cursor"].includes(client)) {
    ref.webview.postMessage({
      type: "mcpClientsStatus",
      clients: [],
      manualConfig: "",
      error: "Unsupported MCP client.",
    });
    return;
  }
  ref.webview.postMessage({ type: "mcpClientInstalling", client });
  let options: CodexMcpInstallerOptions | undefined;
  try {
    options = installerOptions(extensionRoot);
    const result = await installMcpClient(client, options);
    const status = await checkMcpClients(options);
    ref.webview.postMessage({ type: "mcpClientsStatus", ...status });
    void vscode.window.showInformationMessage(
      `${result.label} MCP connected at user scope. Restart or open a new task in that client to load the tools.`,
    );
  } catch (error) {
    const message = toErrorMessage(error);
    if (options) {
      const status = await checkMcpClients(options);
      const clients = status.clients.map((item) => item.id === client
        ? { ...item, state: "error" as const, message }
        : item);
      ref.webview.postMessage({ type: "mcpClientsStatus", ...status, clients });
    } else {
      ref.webview.postMessage({ type: "mcpClientsStatus", clients: [], manualConfig: "", error: message });
    }
  }
}

export async function handleCopyMcpConfig(ref: WebviewRef, extensionRoot: string): Promise<void> {
  try {
    const config = createUniversalMcpConfig(installerOptions(extensionRoot));
    await vscode.env.clipboard.writeText(config);
    ref.webview.postMessage({ type: "mcpConfigCopied" });
  } catch (error) {
    ref.webview.postMessage({
      type: "mcpClientsStatus",
      clients: [],
      manualConfig: "",
      error: toErrorMessage(error),
    });
  }
}
