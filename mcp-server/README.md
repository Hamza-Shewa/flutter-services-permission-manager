# Flutter Config Manager MCP Server

A [Model Context Protocol](https://modelcontextprotocol.io) server that lets AI
agents inspect and edit a Flutter project the same way the **Flutter Config
Manager** VS Code extension does — permissions, service integrations,
ARB/JSON translations, Flutter semantics audits, and optional Android UI
automation.

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
| `scan_interactives` | Inventory interactive Flutter widgets with confidence, accessibility/automation status, opaque-surface warnings, and exact source references. |
| `preview_semantics_fixes` | Build a non-mutating, short-lived preview for reviewed dotted `Semantics.identifier` values. |
| `apply_semantics_fixes` | Apply a single-use preview only while all source hashes still match. |
| `check_android_automation` | Check Android SDK, adb/emulator, Appium, UiAutomator2, devices, and server reachability without installing anything. |
| `start_android_session` / `end_android_session` | Manage a session on an existing Appium UiAutomator2 server. |
| `inspect_runtime_ui` | Read native accessibility identifiers, duplicates, and matching Dart source references. |
| `tap_interactive`, `enter_interactive_text`, `select_interactive_option` | Operate exact identifiers; ambiguous targets fail and consequential actions require confirmation. |
| `scroll_interactive`, `android_back`, `wait_for_interactive`, `assert_interactive_state` | Typed navigation, waiting, and assertion primitives. |
| `capture_android_screenshot` | Return the current screenshot as PNG without persisting it. |

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

The easiest Codex setup is the **Install MCP for Codex** button in the
extension's top navigation. It checks for a matching existing registration
before enabling installation, then registers the server in the user's Codex config
on Windows, macOS, and Linux and binds the entry to the current Flutter
workspace. It uses the editor's bundled Node-compatible runtime, so this path
does not need a separately installed `node` executable. No `.vscode/mcp.json`
or other project configuration is written.

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
- Semantics scanning covers `lib/**/*.dart`, excludes generated sources by
  default, and deliberately reports confidence rather than claiming runtime
  completeness. Configure custom widgets/callbacks through tool arguments or
  the environment passed by the VS Code extension.
- Identifier fixes require Flutter 3.19+ and cannot be applied without a fresh
  preview. Literal identifiers must be unique and use a dotted lower-case
  hierarchy such as `auth.login.submit`.
- Android automation is opt-in and connects to an existing Appium server. It
  does not install global tools, start an emulator, or use coordinate fallback.
- Text entered through runtime tools is redacted from tool results. Taps or
  selections whose identifiers imply submit, purchase, payment, transfer,
  deletion, permissions, confirmation, or sending require a one-use token tied
  to the current screen.
- File-editing tools only write inside the resolved project directory.
