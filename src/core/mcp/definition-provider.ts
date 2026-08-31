/**
 * MCP server definition provider for Flutter Config Manager.
 *
 * Exposes the bundled MCP server (mcp-server/out/index.js) to VS Code's
 * Copilot / AI agents via the stable `vscode.lm.registerMcpServerDefinitionProvider`
 * API (VS Code 1.93+). The server is spawned with the editor's Node and runs
 * in the current workspace folder, so it can discover and edit the Flutter
 * project's platform files. Older VS Code versions simply skip registration.
 */

import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';

/** Provider id declared in `contributes.mcpServerDefinitionProviders`. */
export const MCP_PROVIDER_ID = 'flutter-config-manager';

/** Server label shown to the language model / user. */
export const MCP_SERVER_LABEL = 'flutter-config-manager';

/** Server version — bump to force a tool refresh. */
const MCP_SERVER_VERSION = '1.0.0';

/**
 * Register the MCP server definition provider, if supported by the running
 * VS Code version. Safe no-op on VS Code < 1.93.
 */
export function registerMcpServerDefinitionProvider(
  context: vscode.ExtensionContext,
): void {
  const register = (vscode.lm as Partial<typeof vscode.lm>).registerMcpServerDefinitionProvider;
  if (typeof register !== 'function') {
    return; // MCP not supported on this VS Code version.
  }

  // Absolute path to the compiled server inside the packaged extension.
  const serverEntry = path.join(context.extensionPath, 'mcp-server', 'out', 'index.js');
  if (!fs.existsSync(serverEntry)) {
    return; // Server not built (e.g. dev tree without compile) — skip quietly.
  }

  const provider: vscode.McpServerDefinitionProvider<vscode.McpStdioServerDefinition> = {
    provideMcpServerDefinitions(): vscode.McpStdioServerDefinition[] {
      return [
        new vscode.McpStdioServerDefinition(
          MCP_SERVER_LABEL,
          process.execPath,
          [serverEntry],
          {},
          MCP_SERVER_VERSION,
        ),
      ];
    },

    resolveMcpServerDefinition(server): vscode.McpStdioServerDefinition {
      // Run in the first workspace folder so the server resolves the project.
      const folder = vscode.workspace.workspaceFolders?.[0];
      if (folder) {
        server.cwd = folder.uri;
        server.env = {
          ...server.env,
          FCM_MCP_PROJECT: folder.uri.fsPath,
        };
      }
      return server;
    },
  };

  context.subscriptions.push(register(MCP_PROVIDER_ID, provider));
}
