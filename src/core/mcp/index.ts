/**
 * Model Context Protocol (MCP) integration for Flutter Config Manager.
 *
 * Exposes the extension's capabilities to AI agents through the bundled
 * `mcp-server/` (a standalone stdio MCP server that reuses the extension's
 * pure compiled modules). This barrel re-exports the VS Code side glue.
 */

export {
  MCP_PROVIDER_ID,
  MCP_SERVER_LABEL,
  registerMcpServerDefinitionProvider,
} from './definition-provider.js';
