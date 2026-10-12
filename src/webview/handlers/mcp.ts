import * as fs from "fs";
import * as path from "path";
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
  // The registration is user-level and follows whatever project the AI client is started in, so no
  // workspace is required to connect; the open one is only used to explain client-side folder trust.
  const folder = vscode.workspace.workspaceFolders?.[0];
  const configuration = vscode.workspace.getConfiguration("flutter-config-manager.mcp");
  return {
    projectRoot: folder?.uri.fsPath,
    extensionRoot,
    configuredCodexExecutable: configuration.get<string>("codexExecutable"),
    configuredClaudeExecutable: configuration.get<string>("claudeExecutable"),
    configuredGeminiExecutable: configuration.get<string>("geminiExecutable"),
  };
}

/**
 * VS Code's Copilot agent mode lists the server this extension registers through `registerMcpServerDefinitionProvider`,
 * so it needs no separate connection. Only report it when both halves exist.
 */
function builtInAgent(extensionRoot: string): { available: boolean; label: string } {
  const hasProviderApi = typeof (vscode.lm as Partial<typeof vscode.lm>).registerMcpServerDefinitionProvider === "function";
  const hasServer = fs.existsSync(path.join(extensionRoot, "mcp-server", "out", "index.js"));
  const hasCopilot = !!vscode.extensions.getExtension("GitHub.copilot-chat");
  return { available: hasProviderApi && hasServer && hasCopilot, label: "GitHub Copilot (agent mode)" };
}

export async function handleCheckMcpClients(ref: WebviewRef, extensionRoot: string): Promise<void> {
  ref.webview.postMessage({ type: "mcpClientsStatus", clients: [], manualConfig: "", loading: true });
  try {
    const status = await checkMcpClients(installerOptions(extensionRoot));
    ref.webview.postMessage({ type: "mcpClientsStatus", ...status, builtInAgent: builtInAgent(extensionRoot) });
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
    ref.webview.postMessage({ type: "mcpClientsStatus", ...status, builtInAgent: builtInAgent(extensionRoot) });
    void vscode.window.showInformationMessage(
      `${result.label} MCP connected at user level. It serves whichever Flutter project you start ${result.label} in. Restart or open a new task in that client to load the tools.`,
    );
  } catch (error) {
    const message = toErrorMessage(error);
    if (options) {
      const status = await checkMcpClients(options);
      const clients = status.clients.map((item) => item.id === client
        ? { ...item, state: "error" as const, message }
        : item);
      ref.webview.postMessage({ type: "mcpClientsStatus", ...status, clients, builtInAgent: builtInAgent(extensionRoot) });
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
