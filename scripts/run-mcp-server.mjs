#!/usr/bin/env node
/**
 * Standalone launcher for the Flutter Config Manager MCP server.
 *
 * Resolves the compiled server inside this repo and forwards any CLI args
 * (e.g. `--project /path/to/flutter/project`). Useful for registering the
 * server with Claude Desktop, Cursor, or other MCP clients that don't go
 * through VS Code's `contributes.mcpServerDefinitionProviders`.
 *
 * Examples:
 *   node scripts/run-mcp-server.mjs --project ./my_flutter_app
 *   FCM_MCP_PROJECT=/abs/path node scripts/run-mcp-server.mjs
 */

import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '..');
const serverEntry = pathToFileURL(join(repoRoot, 'mcp-server', 'out', 'index.js')).href;

const { main } = await import(serverEntry);
await main();
