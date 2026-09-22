# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

Flutter Config Manager is a VS Code extension that provides a unified webview UI for managing Flutter Android/iOS/macOS permissions, third-party service integrations (Facebook, Firebase, AdMob, Stripe, etc.), app-name localization, ARB/JSON translation files, dependency/asset cleanup, and accessibility ("Semantics") auditing — all by safely editing `AndroidManifest.xml`, `Info.plist`, `Podfile`, `AppDelegate.swift`, `strings.xml`, build.gradle, and Dart source, instead of requiring manual edits. It also ships a standalone MCP server (`mcp-server/`) so AI agents can perform the same operations.

## Build, lint, test commands

```bash
npm run compile          # tsc -p ./  (compiles src/ -> out/)
npm run watch            # tsc -watch -p ./
npm run compile:mcp      # compiles mcp-server/ (cd mcp-server && npm run compile)
npm run lint             # eslint src
npm run pretest          # compile + lint (runs automatically before `test`)
npm run test             # c8 vscode-test  (compiles+lints via pretest, then runs vscode-test)
npm run test:mcp         # node mcp-server/smoke-test.mjs (in-memory MCP client vs mcp-server/test-fixture/)
npm run coverage:report  # c8 report --reporter=html
npm run package          # compile:mcp + vsce package -> .vsix
npm run vscode:prepublish # compile + compile:mcp (what VS Code runs before packaging)
```

- Tests use `@vscode/test-cli` + Mocha (`tdd` UI, 20s timeout) against compiled output in `out/test/**/*.test.js` — **always `npm run compile` first**, edits to `src/test/*.ts` are not picked up until compiled.
- Test workspace fixture: `src/test/fixtures` (configured in `.vscode-test.mjs`).
- Run a single test file after compiling: `npx vscode-test --label unitTests -g "<test/describe name>"`, or narrow `files` in a local `.vscode-test.mjs` override. There is no separate "run one file" npm script — compile then filter with mocha's `-g` grep via the underlying CLI.
- Coverage thresholds (`.c8rc`): 70% lines/functions/statements, 60% branches, excluding `src/test/**` and `src/webview/frontend/**`.
- `mcp-server/` is its own TypeScript project (own `tsconfig.json`, `package.json`) and is excluded from the root `tsconfig.json` — build it separately with `npm run compile:mcp`.

## Architecture

### Two-process model

The extension host (`src/extension.ts` → `out/`) runs Node/VS Code APIs and owns all file I/O. The webview (`src/flutter-config.html`, `src/webview-utils.js`, `src/webview/frontend/**`) is plain HTML/CSS/vanilla JS served **directly from `src/`, never compiled to `out/`**. The two sides talk only via `vscode.postMessage` — backend send/receive glue lives in `src/webview/message-bus.ts` and `src/webview/handlers/*`; frontend glue lives in `src/webview/frontend/core/{api,bus,state}.js`.

### `src/core/` vs `src/features/`

- `src/core/` — cross-cutting infrastructure, not tied to one UI tab: `constants/`, `shared/` (errors, logging, result, XML/plist parsing), `types/`, `utils/` (debounce, exec, file I/O), `providers/sidebar.provider.ts`, `mcp/` (VS Code MCP definition provider glue), and `platform/{android,ios}/` — the only code that should write to `AndroidManifest.xml`, `strings.xml`, `Info.plist`, `Podfile`, `AppDelegate.swift`, `.entitlements`. `workspace.service.ts` discovers project files; `document.service.ts` is the save orchestrator that coordinates permissions/services/appname/build writes across platforms.
- `src/features/<feature>/` — one folder per UI tab (`permissions`, `services`, `localization`, `build`, `migration`, `packages`, `assets`, `semantics`), each with its own `index.ts` barrel, re-exported from `src/features/index.ts`. Feature code extracts/validates/transforms data and calls into `core/platform/*` to persist it — features should not touch platform files directly.
- `src/features/localization/arb-core.ts` is a deliberately **pure, vscode-free** extraction of ARB/JSON parse-serialize-translate logic, re-exported by the vscode-coupled `arb-translations.service.ts`. New pure translation logic belongs in `arb-core.ts` so the standalone `mcp-server` can import it directly. The same purity constraint applies to anything under `out/core/platform/**` and `out/core/constants/**` that `mcp-server` imports.

### Data flow

1. Workspace opens with `pubspec.yaml` → extension activates, registers `flutter-config-manager.edit` command and the `flutterConfigView` sidebar webview.
2. `core/workspace.service.ts` globs for `AndroidManifest.xml`, `Info.plist`, `Podfile`, `AppDelegate.swift`, etc.
3. `features/permissions/extractor.ts` and `features/services/extractor.service.ts` parse existing permissions/services out of those files.
4. Webview loads with extracted data + config catalogs (`categorized-*-permissions.json`, `permission-mapping.json`, `services-config.json`).
5. User edits in the webview; save actions post messages routed through `src/webview/handlers/*` to `core/document.service.ts`.
6. `core/document.service.ts` calls `core/platform/android/*` and `core/platform/ios/*` to apply non-destructive, structure-preserving edits (regex/marker-based XML and plist manipulation via `core/shared/xml.ts`, not DOM parsing) — comment markers like `<!-- start applinks configuration -->` delimit replaceable sections.

### MCP server (`mcp-server/`)

Standalone Node project that imports the **compiled** pure modules from `../out/**` (no vscode dependency): `out/core/platform/{android,ios}/*`, `out/features/localization/arb-core.js` + `machine-translator.js`, `out/core/constants/index.js`. The root `tsconfig.json` emits `.d.ts` declarations specifically so `mcp-server` gets types on those imports. Project resolution order: `--project` CLI arg > `FCM_MCP_PROJECT` env var > cwd. Inside VS Code 1.93+, `src/core/mcp/definition-provider.ts` auto-registers it via `vscode.lm.registerMcpServerDefinitionProvider` (feature-detected, no-op on older VS Code). `mcp-server/src/semantics.ts` and `android-automation.ts` expose the Semantics scanning/fix and Appium-based Android UI automation tools respectively — automation never falls back to coordinate taps and requires a short-lived confirmation token for consequential actions.

### Config catalogs (edit these, not code, for new permissions/services)

- `src/categorized-android-permissions.json` / `src/categorized-ios-permissions.json` — permission definitions by category.
- `src/permission-mapping.json` — `androidToIos` / `iosToAndroid` cross-platform permission mapping.
- `src/services-config.json` — per-service input fields plus iOS (plist entries, URL schemes, AppDelegate code, entitlements) and Android (metadata, string resources, queries, intent filters) wiring for each of the 11 built-in service integrations.

When adding a service, also check whether `src/core/types/services.ts` needs new fields and whether `src/features/services/extractor.service.ts` needs matching extraction logic.

### Standalone scripts (`scripts/`)

`check-unused-assets.js` and `scan-interactives.js` are also runnable outside VS Code against compiled `out/` for CLI-driven asset cleanup and Semantics/accessibility scanning (see README for flags).

## Conventions

- **Node16 ESM**: all relative imports need explicit `.js` extensions (even though source is `.ts`) — required by `"module": "Node16"` in `tsconfig.json`.
- Never edit `out/` directly; it's regenerated by `npm run compile`.
- Files: kebab-case (`manifest.service.ts`). Types/interfaces: PascalCase. Functions/variables: camelCase. True constants: UPPER_SNAKE_CASE.
- ESLint requires curly braces, `eqeqeq`, semicolons, camelCase/PascalCase import names; warns on `no-throw-literal`.
- All platform file writes must go through `core/platform/android/*` or `core/platform/ios/*` — these preserve existing comments/structure; don't add ad-hoc regex edits elsewhere.
- Use `core/shared/logging.ts` for logging; `logger.enableDebug()` (or the `flutterConfigManager.enableDebug` setting) turns on verbose output.
