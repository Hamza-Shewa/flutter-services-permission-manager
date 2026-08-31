# Flutter Config Manager MCP Server

A [Model Context Protocol](https://modelcontextprotocol.io) server that lets AI
agents inspect and edit a Flutter project the same way the **Flutter Config
Manager** VS Code extension does — permissions, service integrations, and
ARB/JSON translations — without a human touching the files.

It reuses the extension's **pure, VS Code-free** compiled modules
(`out/core/platform/*`, `out/features/localization/arb-core.js`, …), so any edit
it makes is byte-for-byte identical to what the VS Code UI produces.

## Tools

| Tool | Description |
|------|-------------|
| `get_project_info` | Resolved Flutter project root, project name, and discovered platform files (AndroidManifest.xml, Info.plist, Podfile, …). |
| `list_permissions` | Permissions currently present in the Android manifest and iOS/macOS Info.plist, enriched with catalog metadata. |
| `add_permission` | Add a permission to Android and/or iOS (preserves existing structure/comments). |
| `remove_permission` | Remove a permission from Android and/or iOS. |
| `list_services` | Available third-party service integrations (Facebook, Google Sign-In, Firebase, AdMob, OneSignal, Stripe, …). |
| `list_translations` | ARB/JSON translation files in the project with locale and key counts. |
| `translate_locale` | Machine-translate a locale file from the reference locale (free keyless providers: MyMemory → Google → LibreTranslate). |
| `add_translation_locale` | Create a new locale file inheriting reference keys (empty values). |

## Project resolution

The server targets one Flutter project, resolved in this order:

1. CLI flag: `--project /path/to/project`
2. Env var: `FCM_MCP_PROJECT=/path/to/project`
3. Current working directory

## Running it

### Via VS Code (automatic)

When installed, the **Flutter Config Manager** extension registers this server
through `contributes.mcpServerDefinitionProviders` (VS Code 1.93+). It spawns
the server with the editor's Node and runs it in the current workspace folder —
no setup needed. AI agents (Copilot, etc.) can then call the tools above.

### Standalone (Claude Desktop, Cursor, CLI, …)

Compile first (from the repo root):

```bash
npm install            # extension deps
npm run compile        # extension -> out/
npm run install:mcp    # mcp-server deps
npm run compile:mcp    # mcp-server -> mcp-server/out/
```

Then register the launcher:

```bash
# Claude Desktop / Cursor style config
node <repo-root>/scripts/run-mcp-server.mjs --project /path/to/flutter/app
```

Or use the server entry directly (it resolves `FCM_MCP_PROJECT` / cwd):

```bash
FCM_MCP_PROJECT=/path/to/flutter/app node <repo-root>/mcp-server/out/index.js
```

Example `claude_desktop_config.json` entry:

```json
{
  "mcpServers": {
    "flutter-config-manager": {
      "command": "node",
      "args": [
        "/absolute/path/to/flutter-services-permission-manager/scripts/run-mcp-server.mjs",
        "--project",
        "/absolute/path/to/your/flutter/app"
      ]
    }
  }
}
```

## Development

- Build: `npm run compile:mcp` (from the repo root)
- Smoke test (in-memory client against the fixture project): `npm run test:mcp`
- The server imports pure extension modules from `../out/**`; run `npm run compile`
  at the repo root first.

## Notes

- `translate_locale` makes outbound network calls to free keyless translation
  endpoints (Google `translate_a/single` with a browser client, plus MyMemory
  and LibreTranslate fallbacks). Everything else is fully offline.
- The server only reads/writes files inside the resolved project directory.
