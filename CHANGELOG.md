# Changelog

All notable changes to the "Flutter Config Manager" extension will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Fixed

- **Package analysis failed with "The system cannot find the path specified".** A `dart.flutterSdkPath` that does not exist on this machine (for example `~/devtools/flutter` copied into a workspace's `.vscode/settings.json`) was trusted blindly. It is now checked, and when it has no `flutter` the extension says so in the log and looks in `FLUTTER_ROOT`, `FCM_FLUTTER_EXECUTABLE`, `.fvm`, `android/local.properties` (`flutter.sdk`), `PATH` and the usual install folders. If nothing is found, the error lists what was tried. On Windows `flutter.bat` is now started through an encoded PowerShell command instead of a `cmd.exe` command line, so apostrophes and spaces in user-folder paths work.
- **Dependency Update did nothing for new major versions.** `pub upgrade <package>` only moves inside the version range already in `pubspec.yaml`. The button now reads `current/upgradable/resolvable/latest` from `pub outdated`: it updates inside the range, offers `Update to x.y.z` (runs `--major-versions`) when a new major is installable, and shows "Held back" when other dependencies block the latest version.
- **Security: package names were passed through a shell.** Add, remove, downgrade and update built command lines from the webview's package name (`http & calc` would have run `calc`). Names are now validated against pub's rules and every process is started with an argument list and no shell.
- **Security: path traversal in translations.** A locale such as `../../x` or a folder such as `../outside` (from the webview or from MCP tools) could create or overwrite `.arb`/`.json` files outside the project. Locale codes, folders and file names are validated in `arb-core.ts`, and both writers refuse anything that leaves the project.
- **Security: Appium URL.** `start_android_session` and `android_automation_health` accept only `localhost`, `127.0.0.1` or `[::1]` over http(s) without credentials (set `FCM_APPIUM_ALLOW_REMOTE=1` when starting the server to allow others), no longer echo raw response bodies, and require `appPath` to be an `.apk`. `mcp-server` dependencies were updated (`npm audit`: 0 vulnerabilities).
- **Saves could silently lose changes.** Gradle, Podfile and `project.pbxproj` edits ran in parallel, each reading a file and replacing it whole, so one could overwrite another while still reporting success. Edits to one file are now serialized, re-read inside the lock, checked (`applyEdit` / `save` failures throw) and covered by a regression test.
- **Kotlin DSL `build.gradle.kts` saves.** Saving wrote `versionName = flutterVersionName.toString()` (a Groovy-only variable) and rewrote the `compileSdkVersion` line when setting `compileSdk`. `versionName` now keeps `flutter.versionName` unless the file defines `flutterVersionName`, `minSdk`/`targetSdk`/`compileSdk` are updated by their modern names too, assignments always use `=` in `.kts`, and `applicationId` no longer matches `applicationIdSuffix`.
- CI now also runs on `master`, builds and smoke-tests the MCP server, and audits runtime dependencies.

- **Connect MCP is now genuinely user-level.** Each client got one registration per project (`flutter-config-manager-<project>-<hash>` with `--project <path>` baked in). It now registers a single `flutter-config-manager` server without a project: the client starts it in the folder you work in, and the server resolves the Flutter project from there (including from a subfolder such as `lib/`). Cursor, which has no such guarantee for its global config, passes `${workspaceFolder}`. Per-project entries from earlier versions are detected as "Update available" and replaced. The Connect MCP dialog no longer needs an open workspace.
- **Gemini CLI install problems.** Failures showed PowerShell's `#< CLIXML ... Preparing modules for first use` (or the whole encoded command) instead of Gemini's message; the wrapper now uses plain-text output and the real error is shown, with colour codes stripped. `~/.gemini/settings.json` with comments or trailing commas (which Gemini allows) no longer breaks the status check. The 40-character per-project server name pushed fully qualified tool names past Gemini's 63-character limit; the short name avoids that. Because Gemini silently disables user-level MCP servers in folders it does not trust, the dialog now says so when the open workspace is not trusted.

- **Connect MCP on macOS and Linux.** An editor started from the macOS Dock or a Linux launcher has a minimal `PATH`, so a Gemini/Codex/Claude CLI installed through nvm, fnm, volta, asdf, mise, pnpm, bun or Homebrew was either not found or could not start (`env: node: No such file or directory`). Discovery now searches those locations (newest Node version first), the CLI runs with its own directory and the version-manager directories in front of `PATH`, and that Node error gets a clear explanation. Commands may take 60s instead of 20s (a cold `gemini mcp add` is slow), and a timeout says so. Gemini's `~/.gemini` is read from `GEMINI_CLI_HOME` when that variable is set, which previously made a successful registration look unverifiable. The Gemini command now puts `-e ELECTRON_RUN_AS_NODE=1` last, so a Gemini whose array option keeps consuming words cannot swallow the server name and command.

### Added

- **Semantics: shared-widget-first workflow.** The scanner now builds a project widget index (definitions, constructor parameters, imports and `export` barrels) and reports `widgets`: shared interactive controls in fix order (base widgets before the widgets that wrap them) with call-site counts, whether they show their own text, their semantics contract (`complete`, `declaredNotForwarded`, `missing`) and the parameters to add. Findings gain `role`, `owner` and the resolved definition; screens and multi-control composites are never treated as shared controls, and ambiguous names are listed instead of guessed. New settings: `interactives.sharedWidgetMinCallSites`, `interactives.sharedWidgetDirs`.
- **Copy AI prompt v2**: four ordered phases (shared widgets, their call sites, everything else, verify) with the shared-widget table embedded. Shared widgets get `required semanticsIdentifier`, plus `required semanticsLabel` only when they have no visible text, so an un-updated call site is a compile error; each rule is stated once, and the phases are skipped when a project has no shared widgets.
- **Semantics Phase 3 (everything outside shared controls).** Every finding now has a `remediation` - `shared-widget`, `pass-contract`, `composite-prefix`, `reuse-wrapper`, `builtin-label`, `wrap` or `manual` - and reused widgets with several controls are reported as `composites`. A composite takes a required `semanticsIdentifierPrefix` and derives each inner identifier from it (`'$semanticsIdentifierPrefix.undo'`), so call sites are checked by the compiler like shared controls. Screens (`...Screen`, `...Page`, and `...View` under views/screens/pages) are never composites, and one-off widgets keep literal identifiers. The prompt's Phase 3 lists the composites, the remediation counts and the items that need a person. The fixer passes the prefix through the widget's own parameter, names icon-only `IconButton`/`FloatingActionButton`/`PopupMenuButton` through `tooltip` before adding one `Semantics`, and refuses to hardcode an identifier inside a composite.
- The prompt no longer allows optional semantics parameters for widgets in a published package: parameters stay required everywhere.
- Semantics tab: a **Shared widgets** panel, role/contract notes on findings, and two new summary counters.

### Changed

- Rescans recognise the pattern the prompt asks for: `semanticsIdentifier:` (or the widget's own parameter) at a call site counts as an identifier, and a shared widget's own root that forwards its parameter counts as delegated. Previously only a wrapping `Semantics` was recognised, so progress never showed.
- `preview_semantics_fixes` accepts a `labelExpression` that already exists anywhere in the project's Dart code (generated localization accessors included), not only inside the widget being fixed.
- `preview_semantics_fixes` passes the identifier through a widget's own parameter (appending a named argument) instead of adding a second `Semantics` wrapper, and refuses to hardcode one inside a shared widget's definition.
- Suggested identifiers follow the file path (`lib/features/auth/login_screen.dart` -> `auth.login.<action>`) and use caption arguments such as `text:`.

### Fixed

- **Full Migration produced projects that did not build** (checked with real Gradle builds of Kotlin DSL and Groovy apps):
  - `build.gradle.kts` was replaced by a Groovy-derived template that does not compile (`extra { }`, an unsafe `namespace` smart cast); the project script is now edited in place and the subproject defaults are valid in both DSLs.
  - `android:extractNativeLibs="true"` was added to the manifest, which AGP 9 rejects (`Avoid setting android:extractNativeLibs="true" explicitly`). It is no longer written, and an existing one is removed and carried over to `useLegacyPackaging`.
  - The Flutter plugin loader was written with `apply false`, an existing newer AGP (for example 9.4 pre-releases) or Gradle wrapper was downgraded, and `flutter.compileSdkVersion` was replaced by fixed numbers. Versions are now raise-only and Flutter-managed values get a floor (`maxOf(flutter.compileSdkVersion, 37)`), which plugins built for AGP 9 need.
  - `minSdk` was rewritten to a fixed number (raising or lowering it); it is now left alone.
  - Firebase plugins declared with `apply plugin:` were dropped when the app script was converted; they now move into the `plugins {}` block. `$kotlin_version` dependencies left behind by the removed `buildscript` block are removed.
  - `gradle.properties` received the reference project's machine-specific flags (`org.gradle.daemon=false`, `kotlin.incremental=false`, notes about JDK 25 and the `C:`/`E:` drives); only the AGP 9 flags are written now.
  - The Kotlin DSL `useLibrary` line used Groovy syntax.
- **16 KB button did nothing for standard projects**: it only edited quoted `ndkVersion` literals, so `ndkVersion = flutter.ndkVersion` (the Flutter default) was never touched while the message still claimed success. It now reads the Flutter SDK's NDK and pins r28+ when needed, reports honestly when nothing needed changing, and warns about AGP older than 8.5.1 and prebuilt libraries.
- The webview never refreshed after either migration (it matched on message text that no longer existed); results now carry an explicit `refresh` flag and list warnings.

### Changed

- **Icons & Splash crop editor**: both tabs now have a real crop editor instead of a centered zoom slider. Drag the artwork to reposition it, scroll or pinch to zoom toward the cursor (with easing), nudge with the arrow keys, and snap to center with visual guides (hold Shift to disable snapping). Artwork that overflows the crop square is shown dimmed so the crop is obvious, and the chosen position is applied to every generated file (`offsetX` / `offsetY`, percent of the canvas).
- App Icons previews are grouped behind a Shapes / Home screen / Play Store / Notification switcher, so the preview column no longer outgrows the window. Wheel-scrolling over previews no longer hijacks page scroll; only the editor zooms.

## [1.2.0] - 2026-09-22

- Added a universal **Connect MCP** dialog to the global top navigation. It detects and installs user-level registrations for Codex, Claude Code, Gemini CLI, and Cursor, provides portable JSON for other clients, handles Windows/macOS/Linux launchers, and prevents duplicate workspace registrations.

### Added

- **App Icons Generator**: A new **Icons** tab generates Android and/or iOS app icons from a single PNG, JPEG, or SVG source.
  - **Resize & background**: A scale slider (40%–200%) pads the foreground with room to spare below 100%, or zooms in and crops above 100%; a background color picker (or transparent) fills whatever isn't covered by the foreground.
  - **Live preview**: See the source rendered in iOS's rounded-square mask and Android's legacy-square, adaptive-circle, and adaptive-rounded masks before anything is written to disk, updating live as you adjust scale or background.
  - **Current vs. new**: A "Current icons" panel shows the largest existing launcher/AppIcon already in the project — so you can decide not to change it — and refreshes automatically after a successful generation.
  - **Full Android icon family, individually toggleable**: the `mipmap-*dpi/ic_launcher.png` launcher icon, a 512×512 Play Store listing icon (written next to `android/app/`, never bundled into the app), and notification icons — a default white-silhouette `ic_notification` plus OneSignal's `ic_stat_onesignal_default` (small) and `ic_onesignal_large_icon_default` (large), picked up automatically by OneSignal's SDK with no manifest edits. Each of these three families (App icon / Play Store icon / Notification icons) can be generated independently, e.g. notification icons only.
  - **iOS**: (re)renders every image slot already declared in `AppIcon.appiconset/Contents.json` at its correct pixel size, synthesizing a filename only for slots that don't have one yet.
- **Splash Screen Generator**: A new **Splash** tab generates the native Android/iOS launch screen — the screen shown while the Flutter engine starts up, before your app's first frame draws.
  - Same resize slider, background color picker, and live preview as App Icons, but the background is written as a native platform color (Android drawable color, iOS storyboard color) rather than baked into the image, so it fills the screen seamlessly regardless of device aspect ratio.
  - Updates Android's `res/drawable/launch_background.xml` and `drawable-v21/launch_background.xml`, and iOS's `Base.lproj/LaunchScreen.storyboard` plus `Assets.xcassets/LaunchImage.imageset`. Only projects still on the standard Flutter-generated splash layout are supported; a hand-customized one is left untouched with a clear error instead of being guessed at.
  - A "Current splash screen" panel mirrors the App Icons tab's before/after comparison.
- **Cross-platform Android semantics YAML export/copy**: The Semantics tab can now dump the currently displayed Android accessibility hierarchy directly through `adb` on Windows, macOS, and Linux without requiring a `dumpui` shell alias. Its dropdown can export YAML to a selected file or copy the same YAML to the clipboard. It discovers standard SDK locations, supports a configured executable, lets users choose among connected devices, merges identifier wrappers with actionable children, reports embedded input actions separately, and keeps missing labels/identifiers visible in the audit.
- **Shared-widget-first Semantics AI prompt**: The Semantics tab now copies a project-specific implementation prompt that resolves custom widget definitions through their import/export paths, extends shared widgets with optional semantic parameters, updates their call sites, reuses existing semantic APIs, and permits leaf wrappers only as a last resort. Label intent is derived from the resolved feature path, owning component name, call-site context, visible/localized copy, and actual role—so a `VisitorArea` button yields the canonical phrase `visitor area button` instead of inheriting a generic `MobileButton` label. The prompt includes current audit counts, requires `Directionality.of(context)` for explicit labels/hints (including custom gesture and dropdown controls), and defines ADB `resource-id`/`content-desc` verification without special QA flags.
- **Semantics Inventory & Reviewed Fixes**: A new **Semantics** tab uses a pinned, checksum-verified Dart Tree-sitter WASM grammar to inventory interactive widgets under `lib/`, group them by source file, open exact references, audit accessibility and stable automation IDs independently, report heuristic confidence, and flag opaque WebView/platform/custom-painted surfaces. Selected dotted `Semantics.identifier` fixes are syntax-checked, previewed, hash-guarded, and applied as one workspace edit.
- **Semantics MCP Tools**: Added `scan_interactives`, `preview_semantics_fixes`, and `apply_semantics_fixes`, backed by the same scanner and guarded patch engine as the VS Code UI.
- **Android Runtime Automation MCP Tools**: Added explicit Appium/UiAutomator2 health and session tools plus exact-identifier inspect, tap, type, select, scroll, back, wait, assert, and screenshot primitives. The adapter refuses ambiguous identifiers, redacts entered text, never falls back to coordinates for element targeting, and requires a screen-bound one-use confirmation token for consequential actions.
- **MCP Server for AI Agents**: A bundled Model Context Protocol server (`mcp-server/`) exposes the extension's capabilities to AI agents — inspect and edit Flutter permissions, service integrations, and ARB/JSON translations programmatically. It reuses the extension's pure compiled modules, so every edit matches the UI exactly. Registered automatically on VS Code 1.93+ via `contributes.mcpServerDefinitionProviders` (older versions are unaffected), and usable standalone with any MCP client (Claude Desktop, Cursor, …) via `scripts/run-mcp-server.mjs` or `FCM_MCP_PROJECT`. See `mcp-server/README.md`.
- **Translation Files Manager**: A new **Localization** tab that manages your app's `ARB`/`JSON` translation files (easy_localization, flutter_localizations, or plain i18n) without editing them by hand.
  - **Directory selection**: Point the manager at the folder that holds your translation files (e.g. `assets/translations`, `lib/l10n`), with `assets/translations` as a convenient default. Existing files and locales are auto-detected and their keys extracted on load.
  - **Reference locale & locale grid**: Pick a reference (source) locale; every locale gets its own row with a burger menu (`Translate all`, `Translate missing only`, `Remove`), and the table keeps a stable key → translation column layout (key 30%, each translation 35%).
  - **Add languages from a searchable dropdown**: Add a new locale from a searchable language list — the manager creates the file next to the reference with all reference keys pre-filled as empty.
  - **Translate all / translate missing only / auto-add missing keys**: One-click batch translation for every locale (or only the gaps), plus a button to add any reference keys missing from the other locales.
  - **Free keyless machine translation**: Values are translated through a free provider chain (Google → MyMemory → LibreTranslate) with newline-batched requests for speed. When a provider is unavailable the UI explains why instead of silently doing nothing.
  - **Nested object support**: easy_localization-style nested JSON (`{ "tabs": { "home": "…" } }`, arrays included) is flattened for editing and re-nested exactly on save, so nested files round-trip without corruption.
  - **Literal dot-keys preserved**: Flat files whose keys merely contain dots — sentence keys ending in `.`/`...`, or flat keys like `input_field.context_menu.cut` — stay top-level and are never treated as nested paths on save.
- **Unused Assets: ignore dynamic loaders (app-wide)**: Calls like `Image.asset(path)` or `SvgPicture.asset(path)` (a variable argument) were treated as dynamic references and flagged _every_ asset as "maybe used". You can now ignore specific loaders — from the Unused Assets UI, workspace setting `flutter-config-manager.unusedAssets.ignoredLoaders`, or the script flag `--ignore-loaders Image.asset,SvgPicture.asset`. Ignored loaders' variable-argument calls are no longer treated as dynamic, while literal calls (e.g. `Image.asset('assets/x.png')`) still count as used. Great when using generated asset accessors (e.g. `flutter_gen`) so dynamic widget calls across the app don't cause false "maybe used" flags.
- **Unused Assets: ignore asset folders from the scan**: You can now exclude whole asset folders (e.g. `assets/vendor`) from the unused-assets scan — their files are never reported as unused, are not counted in the totals, and are never deleted. Configurable from the Unused Assets UI, workspace setting `flutter-config-manager.unusedAssets.ignoredAssetDirectories`, or the script flag `--ignore-asset-dirs`. The script's `--help` also now explains the dynamic-ignore flags (`--ignore-dynamic-dirs` / `--ignore-dynamic-files`) in more detail.
- **Unused Assets Check**: New `Flutter Config Manager: Check Unused Assets` command that scans the Flutter project's `flutter.assets` entries for files not referenced from Dart/JSON source, lists them in a picker, and lets you delete them. Also ships a standalone, dependency-free script at `scripts/check-unused-assets.js` (`--path` to point at a project, dry-run by default, `--delete` to remove, `--json` for machine output). Inspired by `unused_assets_removal`.
- **Unused Assets Panel**: The **Unused Assets** section in the Flutter Config webview (sidebar and panel) scans the project and shows unused assets with per-file **Delete** and **Delete All Unused** actions, following the existing Dependency Validator design.
- **Dynamic Asset References ("Maybe used")**: The unused-assets scanner now understands dynamic references — interpolated paths like `assets/icon/$icon`, string concatenation (`'assets/icon/' + name`), and fully-dynamic loaders (`Image.asset(path)`, `SvgPicture.asset(path)`, `rootBundle.load(...)`, …). Assets that are not statically referenced but match a dynamic pattern move into a separate **Maybe used** bucket instead of being reported as unused. Each maybe-used row lists buttons for every Dart file that references it dynamically — click to jump to the exact line — with anchored patterns (solid) visually distinct from fully-dynamic ones (dashed). Deleting a maybe-used asset warns you with the referencing files, and the bulk **Delete Maybe Used** action requires typing the count to confirm.
- **Ignored Directories & Files**: Configure files/directories to exclude from the asset scan — either skipped entirely or with only their **dynamic patterns** ignored (literal references still count as used). Configurable from the Unused Assets UI, workspace settings (`flutter-config-manager.unusedAssets.ignoredDirectories` / `ignoredFiles` / `ignoredDynamicDirectories` / `ignoredDynamicFiles`), or the script flags `--ignore-dirs`, `--ignore-files`, `--ignore-dynamic-dirs`, `--ignore-dynamic-files`. Ideal for custom wrapper widgets (e.g. `my_image.dart`) or icon maps that mix static constants with a dynamic helper.
- **easy_localization translations**: Files under the `easy_localization` folder (default `assets/translations`, honoring `asset_path`/`path` in `pubspec.yaml`) are treated as used automatically, since they are loaded by language code at runtime.
- **Android 16 KB Page Size Migration**: New **Enable 16 KB Page Size** button (separate from the full migration) that applies only the minimal changes required for Android 15+ 16 KB page-size compatibility per the official Android guide: AGP 8.5.1+, targetSdk 35+, NDK r28, `android:extractNativeLibs="true"`, plus the guide's `useLegacyPackaging` fallback when AGP stays below 8.5.1. Leaves existing legacy buildscript setups untouched so projects with outdated packages can still pass Play Store 16 KB checks.

### Changed

- **Expanded Semantics statistics**: The audit summary now separates accessibility ready/missing/uncertain findings and automation present/missing/dynamic/duplicate identifiers, alongside opaque surfaces and scanned files.
- **Android Gradle Declarative Migration**: The full migration is now non-destructive — it never forces newer AGP/Kotlin versions onto a project that already builds (existing versions at/above the minimums are kept), never lowers the project's `minSdk`, and only normalizes the Java/Kotlin toolchain for genuinely legacy projects. It also guarantees `google()/mavenCentral()` repositories so bumped Kotlin/AGP artifacts (e.g. `kotlin-stdlib`) resolve, and supports both Groovy `build.gradle` and Kotlin DSL `build.gradle.kts`.
- **iOS/macOS Permission Value Fields**: Value textareas now auto-resize to fit their content and the Value column flexes to fill available horizontal space; the **Add equivalent** button moved into the row Actions column for both Android and iOS tables.
- **Categorized Permission Filtering**: Android and iOS catalogs are fully categorized — search by name, description, constant value, or category, filter the tables with category dropdowns, and browse the Add Permission dialog by category tabs.
- **Upgrade Packages action removed from the migration block**: The **Upgrade Packages** button was removed from the Android Project Setup (migration) cards. Package upgrades are still available from the Packages section (**Update All**).

### Fixed

- **Translation actions occasionally hanging ("freezing")**: When the free keyless translation providers (MyMemory, Google, LibreTranslate) were rate-limited or down, every remaining key retried the full 3-provider chain with a 15s timeout each — on a project with several locales, this could compound into many minutes of blocking wait with no feedback, indistinguishable from the whole extension freezing. Added a per-provider circuit breaker that skips a provider instantly (no network call) for a cooldown window after a few consecutive failures instead of retrying it for every remaining key, reduced the per-request timeout, and locales are now translated in parallel instead of one after another.
- **Project files sometimes resolved from the wrong directory**: Workspace-wide file discovery (`AndroidManifest.xml`, `Info.plist`, build files, …) didn't exclude directories that other extensions use to keep a full duplicate copy of the project — e.g. a git-worktree clone under `.kilo/worktrees/<name>/`. Since file search order isn't guaranteed, this could silently redirect reads *and writes* (permissions, services, app icons, splash screens, …) into that duplicate instead of the real project. Workspace file discovery and the translation-file scanner now both exclude `.git`, `.kilo`, `.history`, `.idea`, `node_modules`, `.dart_tool`, `build`, and `.vscode-test`.
- **Service integration hardening**: Corrected Firebase swizzling behavior, App Links hosting output, modern OneSignal setup, Twitter/X callback handling, Apple Sign-In Android routing, Stripe redirect/Apple Pay configuration, and AdMob SKAdNetwork coverage. Service values now round-trip through a generated Dart config without logging credentials, shared iOS arrays preserve unrelated entries, optional Maps iOS setup no longer emits an empty key, and Services-only saves include Podfile updates.
- **Literal dot-keys no longer re-nested on translation save**: A flat translation file whose keys merely contain dots — sentence keys ending in `.`/`...` or flat easy_localization keys like `input_field.context_menu.cut` — was being corrupted on save (the key was split on `.` into nested objects, and trailing dots became empty `""` segments, e.g. `"show full description..."` → `{"show full description": {"": {"": "…"}}}`). The manager now tracks exactly which flat keys came from real nested objects/arrays and only re-nests those, so literal dot-keys round-trip unchanged.
- **Translation buttons doing nothing (Google 429)**: The keyless translation chain used Google's `client=gtx` endpoint, which now returns HTTP 429 and made every "Translate" action return 0 results (appearing as dead buttons). The manager now uses Google's `client=dict-chrome-ex` (with `client=at` fallback), which is live and fast, and reports when a provider is unavailable.
- **Nested translations corrupting files on save**: Nested easy_localization JSON was coerced to `"[object Object]"` strings and translate-missing skipped nested values. Nested objects/arrays are now flattened for editing and re-nested exactly on save.
- **Unused assets scanner failing on large projects**: When a scan produced a big JSON report (many unused assets), the standalone script's `process.exit(0)` could kill the process before stdout was fully flushed (the OS pipe buffer is 64 KB on macOS), truncating the report and causing `Failed to parse unused assets output: Expected ',' or '}' ... at position 65536`. The script now exits naturally so output is fully flushed, and the extension reads the machine-readable report from a temp file instead of parsing (truncation-prone) stdout.
- **Packages analysis / dependency validator hanging**: `pub` commands no longer hang for ~75s per unreachable git host (e.g. VPN-only packages). The extension now pre-checks TCP connectivity to git dependencies declared in `pubspec.yaml` and fails fast with a clear "connect to your VPN" message; a timeout safety net was also added to all `pub` commands.
- **Loading indicators stuck**: The packages/dependency-validator/unused-assets loading spinners are now always dismissed on failure, so the UI never stays stuck on "Installing dependency_validator..." or "Analyzing...".
- **macOS Add-Permission Categories**: Fixed the macOS Add Permission modal showing Android categories — it now uses the iOS (NS\*) catalog, matching the macOS table and search.
- **Migration Save Scope**: Migrations now save/refresh only the files they actually modify instead of re-saving all project files (permissions, services, app name, etc.).

## [1.0.13] - 2026-07-19

### Fixed

- **Sidebar Blank Page Issue**: Fixed an issue where the sidebar webview would show a blank page by enabling `retainContextWhenHidden: true` to persist its context when out of focus.
- **Sidebar Error Handling**: Added a fallback UI with detailed error messages in the sidebar to prevent silent failures during initialization.
- **Sidebar Resource Roots**: Aligned `localResourceRoots` for the sidebar webview to correctly include the `images` directory for parity with the main panel.

## [1.0.12] - 2026-07-19

### Fixed

- **Extension Not Loading in Production**: Fixed a critical packaging bug where the `fast-xml-parser` production dependency was excluded from the `.vsix` package due to a blanket `node_modules/**` rule in `.vscodeignore`. This caused the extension backend to crash on activation, leaving the webview permanently stuck on loading.
- **Stale Packaging Rules**: Removed the obsolete `!src/webview.js` entry from `.vscodeignore` and excluded non-production files (`coverage/`, `test-fast-xml.js`) from the published extension.

## [1.0.11] - 2026-07-19

### Added

- **Dependency Validator UI**: Added a prominent "Run Dependency Analysis" action button when the dependency validator package is installed but has not yet run.
- **Support for ITS Keys**: Added support for extracting, managing, and preserving `ITS` compliance keys (such as `ITSAppUsesNonExemptEncryption` and `ITSEncryptionExportComplianceCode`) in `Info.plist`.

### Fixed

- **Info.plist Truncation**: Fixed a critical regex bug in the Universal Links (`applinks`) setup where matching URL schemes could match from the root `<dict>` tag, leading to file truncation.
- **AppDelegate Preservation**: Prevented the deletion of `import home_widget` from `AppDelegate.swift` if placed inside the App Links marker block.
- **Package Name Population**: Restored the automatic populating of package name configuration inputs on dashboard load.
- **Deep Linking SHA-256**: Made the SHA-256 fingerprint field optional for deep linking configurations, enabling saving of Universal Links alone.
- **Migration Save Triggers**: Automatically save all settings to disk after completing the Android Declarative AGP migration.
- **UX Improvements**: Disabled automatic page scrolling down to the packages list after package analysis completes.

## [1.0.10] - 2026-07-17

### Fixed

- **iOS App Name Localization**: Fixed a bug where `Info.plist` was erroneously modified to use `$(PRODUCT_NAME)`. It now correctly writes the default app name, relying on native iOS behavior where `InfoPlist.strings` automatically overrides the name based on the device locale.
- **Facebook Display Name**: Added support for localizing `FacebookDisplayName` inside `InfoPlist.strings` when configured.
- **Error Handling**: Improved the error message presented when attempting to analyze packages in a directory that is not a Flutter project or is missing a `pubspec.yaml` file.

## [1.0.9] - 2026-07-13

### Changed

- **Robust Executable Resolution**: Integrated with the VS Code Dart extension to resolve the exact paths for `flutter` and `dart` executables (`flutterSdkPath` and `sdkPath`). This prevents errors when Flutter is not globally available in the system PATH.
- **Environment Variables**: Enhanced child process execution (`execWithEnv`) to properly inherit paths across different OS environments (including macOS/Linux brew paths).

## [1.0.8] - 2026-07-09

### Added

- **Flutter Package Management**:
  - Full display of all dependencies categorized into Direct, Dev, and Transitive.
  - Automatically fetches outdated packages using `flutter pub outdated`.
  - In-app pub.dev search with typeahead suggestions and package preview cards.
  - Integration with `dependency_validator` to safely analyze unused dependencies with auto-downgrade and removal tools.
- **Android Gradle Declarative Migration**: Added a button to safely migrate Android projects from hardcoded SDK paths to declarative Gradle setups (e.g., `flutter.minSdkVersion`, `flutter.ndkVersion`).

### Changed

- Replaced the direct VS Code webview script injection with `esbuild`, improving frontend compilation and optimizing the extension payload size.
- Improved and automatically linted the entire TypeScript backend.

## [1.0.7] - 2026-06-02

### Added

- **Package Configuration Dashboard**: A new high-level section to manage Android Application ID and iOS Bundle Identifier.
- **Platform-Specific Controls**: Individual "Save" buttons for Android and iOS build configurations.
- **Vibe Coding**: Officially vibe coded in the most fashionable way for peak developer experience.

### Changed

- **UI Reordering**: Restructured the dashboard flow: Package Configuration -> Android Build Details -> iOS Build Details -> Permissions -> Services.
- **Gradle Standardization**: `versionName` is now forced to `flutterVersionName.toString()` to ensure parity with Flutter's versioning.
- **Podfile Standardization**: Automatically injects `COCOAPODS_DISABLE_STATS`, `project 'Runner'`, and comprehensive `post_install` settings into the iOS Podfile.
- **Android SDK naming**: Switched to explicit `minSdkVersion` and `targetSdkVersion` labels in build files for better compatibility.

### Fixed

- **Conditional Kotlin Management**: The extension now detects if Kotlin is explicitly configured and avoids generating redundant Kotlin setup for newer Flutter versions using embedded Kotlin.
- **Podfile Deployment Target**: Fixed a bug that could corrupt the `platform :ios` line during updates.

## [1.0.6] - 2026-02-03

### Added

- Section-level "Save" buttons so each section can be applied independently.
- App name localization editor so display names match the device locale.

### Fixed

- Moved the "Sync Equivalents" control into the Permissions toolbar for clearer UX.
- Resolved an issue that could cause duplicate applinks entries in `Info.plist` when updating deep link / URL scheme configuration.
- Fixed AppDelegate rewrite logic that could insert duplicate import/handler blocks.
- Minor TypeScript export fix for document service to avoid build errors.

## [1.0.0] - 2026-01-29

### Added

- Initial release of Flutter Config Manager
- **Permission Management**
  - View and manage Android permissions with categories
  - View and manage iOS permissions with usage descriptions
  - Search and filter permissions
  - Automatic extraction of existing permissions from project files
- **Service Configuration**
  - Facebook SDK (Android & iOS)
  - Google Sign-In (Android & iOS)
  - Google Maps (Android & iOS with AppDelegate support)
  - Firebase Cloud Messaging (Android & iOS)
  - Google AdMob (Android & iOS with SKAdNetwork)
  - OneSignal Push Notifications (Android)
  - Twitter/X Login (Android & iOS)
  - Apple Sign-In (iOS)
  - Stripe Payments
  - Deep Linking / Custom URL Schemes
- **Platform File Support**
  - AndroidManifest.xml
  - Info.plist
  - strings.xml (auto-created if needed)
  - Podfile (GCC_PREPROCESSOR_DEFINITIONS)
  - AppDelegate.swift
- **UI Features**
  - Dedicated sidebar with custom icon
  - Tabbed interface for Permissions and Services
  - Real-time permission/service counts
  - Save all changes with one click
  - Refresh to reload from files
