# Flutter Config Manager

Streamline your Flutter project configuration with the **Flutter Config Manager** for VS Code. This extension removes the headache of manually editing Android manifests and iOS/macOS property lists, providing a unified, visual interface to manage permissions and third-party service integrations.

## 🚀 Key Features

- **Unified Permission Management**: Easily add, remove, and configure permissions for **Android**, **iOS**, and **macOS** from a single view. Permissions are categorized for fast search and filtering — filter the tables by category or search by name, description, constant value, or category, and browse the Add Permission dialog with category tabs. No more context switching between messy XML and plist files.
- **Smart Extraction**: The extension intelligently scans your project workspace. It automatically detects which platforms you are targeting (Android, iOS, macOS) and only shows the relevant configuration sections. Existing permissions are automatically imported, so you never lose your place.
- **Service Integrations**: Quickly configure popular third-party services without diving into documentation for platform-specific setup. Supported services include:
  - Facebook SDK, Firebase Cloud Messaging, OneSignal, Google Maps, and AdMob
  - App Links / Universal Links, Twitter/X OAuth callbacks, Apple Sign-In, and Stripe
  - Each integration shows the remaining provider-console, Dart initialization, hosting, or Xcode steps that cannot be safely automated.
- **App Name Localization**: Easily manage app display names for multiple languages using native `InfoPlist.strings` (iOS) and `strings.xml` (Android). Includes support for localizing `FacebookDisplayName` on iOS.
- **Translation Files Manager**: Manage your app's `ARB`/`JSON` translation files (easy_localization, flutter_localizations, or plain i18n) from a dedicated **Localization** tab. Point it at your translation folder (default `assets/translations`), pick a reference locale, and translate everything with free keyless machine translation.
  - **Locale grid & burger menus**: One row per locale with a burger menu (`Translate all`, `Translate missing only`, `Remove`); stable key → translation columns (key 30%, each translation 35%).
  - **Searchable language dropdown**: Add new locales from a searchable list — the file is created next to the reference with all keys pre-filled as empty.
  - **One-click translation**: Batch translate all locales (or only the missing gaps) and auto-add any reference keys missing elsewhere. Values are translated via a free provider chain (Google → MyMemory → LibreTranslate) with batched requests for speed.
  - **Round-trip safe**: Nested easy_localization JSON (objects/arrays) is flattened for editing and re-nested exactly on save, while flat keys that merely contain dots (sentences ending in `.`/`...`, e.g. `input_field.context_menu.cut`) are preserved verbatim.
- **MCP Server for AI Agents**: Ship the extension's capabilities to AI agents through a bundled [Model Context Protocol](https://modelcontextprotocol.io) server. Copilot (and other MCP clients) can inspect and edit your Flutter project's permissions, service integrations, and ARB/JSON translations programmatically — reusing the exact same safe, structure-preserving edits the UI makes. See [mcp-server/README.md](mcp-server/README.md).
- **Robust Executable Resolution**: Integrates seamlessly with the VS Code Dart extension to dynamically resolve the correct `flutter` and `dart` executables without relying on the system PATH.
- **Gradle Declarative Migration & 16 KB Support**: **Run Full Migration** moves an Android project to the AGP 9 declarative Flutter setup for both `build.gradle` and `build.gradle.kts`: `plugins {}` in settings (AGP, Kotlin and the Firebase plugins your app uses; pre-3.16 imperative settings are rewritten), Gradle wrapper, Java 17, raised `compileSdk`/`targetSdk`/NDK, and the `android.builtInKotlin=false` / `android.newDsl=false` flags Flutter needs. Versions are only ever raised (a newer AGP or Gradle is kept), Flutter-managed values stay Flutter-managed, and `minSdk` is never changed. **Enable 16 KB Page Size** is a lighter option that only pins the NDK to r28+ when it is older (and packages native libraries compressed on AGP older than 8.5.1). Neither writes `android:extractNativeLibs` to the manifest - AGP 9 fails the build on it - and both remove it if present. The output is verified with real Gradle builds of Kotlin DSL and Groovy Flutter apps, including `zipalign -P 16` on the built APKs.
- **Dependency Management**: Fully-featured Flutter dependencies table showing direct, dev, and transitive packages.
  - **Search & Add**: Integrated pub.dev API search with typeahead and live package details preview.
  - **Dependency Validator**: Built-in integration with `dependency_validator` to safely analyze unused packages and automatically downgrade them or remove them.
  - **Unused Assets**: Detect asset files that are no longer referenced from your Dart/JSON source (inspired by `unused_assets_removal`) and delete them to reduce app size. The scanner also understands **dynamic references** — interpolated paths like `assets/icon/$icon`, string concatenation, and dynamic loaders like `Image.asset(path)` — so assets that may still be in use are moved to a **Maybe used** bucket instead of being flagged as unused. Each maybe-used row lists the Dart files that reference it, with buttons that jump straight to the exact line. You can **ignore** custom wrapper widgets (e.g. `my_image.dart`) or whole directories — either fully, or just their dynamic patterns — from the Unused Assets UI or workspace settings, and `easy_localization` translation folders are excluded automatically. Use the **Unused Assets** section in the Flutter Config view (sidebar or panel) to scan, review, and delete per file or all at once — or run the **`Flutter Config Manager: Check Unused Assets`** command from the palette.
- **Semantics & AI Automation**: The **Semantics** tab scans production Dart sources with a pinned, checksum-verified Tree-sitter WASM grammar. It groups interactive widgets by file, opens exact source locations, and reports separate ready/missing/uncertain accessibility counts plus present/missing/dynamic/duplicate automation-ID counts. It resolves project-owned widgets through imports and export barrels, so it knows which controls are shared, how often they are used, and whether they already expose a semantics parameter. **Copy AI prompt** turns that into a phased brief: shared widgets first (a required `semanticsIdentifier`, plus a required `semanticsLabel` only when the widget shows no text of its own, so the compiler flags every call site left to update), then each shared widget's call sites, then everything else (reused multi-control widgets take a required `semanticsIdentifierPrefix`; every remaining finding carries a `remediation` such as `pass-contract`, `builtin-label` or `wrap`), then verification. Rescans and the guarded fixer understand the pattern: a call site that passes the widget's own parameter counts as done, and the fixer adds the named argument instead of a second `Semantics` wrapper. **Dump current UI to YAML** reads the connected Android device through `adb`, merges Flutter identifier wrappers with their actionable children, and preserves unlabeled controls as audit failures. Missing `Semantics.identifier` values can also be selected, reviewed in a content-hashed preview, and applied as one guarded workspace edit. Flutter 3.19+ is required for identifier fixes.
- **App Icons**: The **Icons** tab generates Android and/or iOS app icons from a single PNG, JPEG, or SVG source, with a resize slider (40%–200%, padding below 100% and zoom-and-crop above), a background color picker, and a live preview of every icon shape (iOS rounded square, Android legacy square, Android adaptive circle/rounded) before anything is written. A "Current icons" panel shows what's already there so you can decide not to change it. Android generates the launcher icon, a 512×512 Play Store listing icon, and notification icons (a default white-silhouette icon plus OneSignal's small/large icons — picked up automatically, no manifest edits needed) — each independently toggleable; iOS re-renders every slot already declared in `AppIcon.appiconset`.
- **Splash Screen**: The **Splash** tab generates the native Android/iOS launch screen — the screen shown while the Flutter engine starts, before your app's first frame — using the same resize/background/live-preview controls as App Icons. The background is written as a native platform color rather than baked into the image, so it fills the screen seamlessly on any device aspect ratio. Only projects still on the standard Flutter-generated splash layout are supported; a hand-customized one is left untouched with a clear error.
- **Trail (AI-assisted user journeys)**: The **Trail** tab maps how users move through the app. A Tree-sitter scan builds the route graph from `lib/**/*.dart` for the routing packages Flutter apps actually use: go_router (nested, shell/tabs, redirects, typed routes), auto_route, Fluro, GetX, flutter_modular (with module prefixes), Beamer, Routemaster, VRouter, Qlevar, Sailor, and the built-in Navigator (named route maps, `onGenerateRoute` written as `switch`/`if`/Dart 3 switch expressions, `MaterialPageRoute`). It also follows bottom-navigation tabs, redirects, bottom sheets/dialogs, and helper methods such as `AppNavigator.toHome()` or `context.pushNavigation(AppRoute.x)`, whose edge is drawn from wherever they are called. The tab and the MCP result say which packages the project uses and whether each is fully, partly or not read, and warn when a router is not understood rather than showing a thin graph. Navigation helpers (your own `context.pushNavigation(AppRoute.x)`-style methods) are detected because they forward a route to the router, so no configuration is needed. Every edge records its call site, what triggers it (a tap, a state listener, a redirect), the `if`/`switch`/ternary conditions around it, and how sure the scan is about the screen it starts from (`class`, `file`, `composition`, `folder`, `shared`, `unresolved`). The scan cannot see first-launch logic, Bloc outcomes such as success vs. failure, or screens that do not exist in code, so turning it into a real journey is done by an AI agent through MCP (`find_route_paths`, then `save_trail`); the tab is locked until an agent is connected (Claude, Codex, Gemini, Cursor, or Copilot agent mode). **Copy AI prompt** hands the agent the scan results and the gaps it should check. Finished trails are shown as numbered steps with conditions, optional steps and failure branches, and are stored in `.flutter-config-manager/trails.json` so they can be committed and shared; steps whose route or file no longer exists are flagged. The tab also finds candidate paths between any two screens and copies Mermaid flowcharts.
- **Android AI Control (optional)**: The MCP server can connect to an existing Appium UiAutomator2 session and inspect, tap, type, select, scroll, wait, assert, and capture screenshots using exact `Semantics.identifier` matches. It never installs Appium or silently falls back to coordinates; consequential actions require a short-lived confirmation token.
- **Universal MCP setup**: The top navigation connects the bundled server to Codex, Claude Code, Gemini CLI, or Cursor at user scope on Windows, macOS, and Linux. It registers one user-level server (`flutter-config-manager`) that is not tied to a project: the client starts it in the folder you work in and it serves that Flutter project, so a single entry covers every project. It detects existing registrations before enabling installation, replaces the per-project entries earlier versions created, shows the client's own error text when a registration fails, and provides standard `mcpServers` JSON for other compatible clients.
- **Package Configuration Management**: A dedicated dashboard at the top of the UI to view and update your Android Application ID and iOS Bundle Identifier with a single click.
- **Safe & Automated Updates**: With a single click, the extension updates all necessary files (`AndroidManifest.xml`, `Info.plist`, `Podfile`, `AppDelegate.swift`, etc.) while preserving your existing project structure and comments.
- **Vibe Coded**: This extension was vibe coded in the most fashionable way, because your development workflow deserves to look and feel as good as your apps.

## 🛠️ Usage

1.  **Open your Flutter project** in VS Code.
2.  Click the **Flutter Config icon** in the Activity Bar (left sidebar).
3.  Alternatively, run the command **`Flutter Config Manager: Edit Permissions & Services`** from the command palette.
4.  **Manage Permissions**: Browse categorized lists, search for specific permissions, and toggle them on/off.
5.  **Configure Services**: Select services to integrate and fill in the required API keys or IDs.
    - Runtime-only public values for OneSignal, Stripe, and Apple Sign-In are written to `lib/flutter_config_manager_services.dart`; import that file where the service SDK is initialized.
    - App Links verification files are generated under `.flutter-config-manager/app-links-hosting/<domain>/.well-known/`; deploy them to the matching HTTPS hosts rather than bundling them in the app.
    - Provider-console and manual Xcode requirements remain visible in each service’s setup notes.
6.  **App Name Localizations**: Add or edit localized app names so the correct name appears on each device locale.
7.  **Manage Translation Files**: In the **Localization** tab, set the folder that holds your translation files (default `assets/translations`), choose a reference locale, and use **Translate All** / **Translate Missing Only** / **Auto-Add Missing Keys** to fill every locale. Add new languages from the searchable dropdown, and use each locale's burger menu for per-file actions.
8.  **Save**: Use section-level Save buttons or Save All Changes to apply updates across platform files instantly.
9.  **Check Unused Assets**: Run the **`Flutter Config Manager: Check Unused Assets`** command from the command palette to list assets split into **Unused** (safe to delete) and **Maybe used** (referenced via dynamic paths — click a file button to jump to the exact line). You can also use the bundled standalone script directly:

    ```bash
    node scripts/check-unused-assets.js --path /path/to/flutter/project              # dry-run
    node scripts/check-unused-assets.js --path /path/to/flutter/project --delete
    node scripts/check-unused-assets.js --path . --ignore-files my_image.dart        # skip files entirely
    node scripts/check-unused-assets.js --path . --ignore-dynamic-files icons.dart   # skip only dynamic patterns
    ```

    **Convert images to WebP**: in the same **Assets** tab, **Convert images to WebP** re-encodes the PNG/JPG/JPEG files declared in `pubspec.yaml` (typically 40–70% smaller with almost no visible change), deletes the originals and rewrites the references in your Dart, JSON and YAML files. **Preview savings** first; nothing is touched until you convert. Images that are referenced by a path built at runtime (`'assets/img/$name.png'`), by a bare file name or by tool configuration such as `flutter_launcher_icons` are skipped, and each result is checked (decoded again, PSNR 35 dB or better) before it replaces the original. Also available as a script:

    ```bash
    node scripts/convert-images-to-webp.js --path /path/to/flutter/project            # dry-run: report the savings
    node scripts/convert-images-to-webp.js --path . --apply                           # convert, delete originals, update references
    node scripts/convert-images-to-webp.js --path . --apply --keep-originals          # only write the .webp files
    node scripts/convert-images-to-webp.js --path . --apply --lossless                # exact pixels
    node scripts/convert-images-to-webp.js --path . --assets-path assets/images --quality 90
    ```

10. **Audit Semantics**: Open the **Semantics** tab. Expand a file row for exact widget references, edit the suggested dotted identifiers, select the desired fixes, review the combined preview, and apply. The standalone scanner is also available after compilation:

    ```bash
    node scripts/scan-interactives.js --path /path/to/flutter/project --pretty
    node scripts/scan-interactives.js --path . --custom-widget AppButton --callback onActivate
    ```

    Use **Copy AI prompt** for a deeper repository-wide pass. The copied prompt embeds the active project, current statistics and the shared-widget table (fix order, call-site counts, the parameters to add), and directs the agent through the four phases. Tune what counts as a shared widget with `flutter-config-manager.interactives.sharedWidgetMinCallSites` and `sharedWidgetDirs`.

    Use the **Dump current UI…** dropdown while an Android emulator or authorized device is connected, then choose **Export YAML to file** or **Copy YAML to clipboard**. The extension invokes `adb` directly—no `dumpui` shell function, Bash, or PowerShell setup is needed. If `adb` is outside the Android SDK's standard Windows, macOS, or Linux locations, set `flutter-config-manager.android.adbPath`.

11. **Map a user journey**: Connect an AI client (next step), open the **Trail** tab, type the journey you care about (for example "pay a beneficiary and get a receipt"), click **Copy AI prompt** and paste it into the agent. It reads the code, confirms each hop and conditions, and saves the trail, which then appears in the tab. **Find a path** shows the raw candidate chains between two screens without an agent run.

12. **Connect an AI client**: In the top navigation, click **Connect MCP**. Choose Codex, Claude Code, Gemini CLI, or Cursor. Every adapter checks the client's user configuration first and disables already-connected entries. The dialog also exposes standard `mcpServers` JSON for another MCP client. No project-level MCP configuration or separate Node.js installation is required. Restart the selected client or open a new task afterward. Gemini CLI turns user-level MCP servers off in folders it does not trust, so trust your project folder in Gemini (the dialog tells you when it is not trusted).
12. **Generate App Icons or a Splash Screen**: Open the **Icons** or **Splash** tab, choose a source image, adjust the resize slider and background color while watching the live preview, pick Android / iOS / Both, and click **Generate**. On Android, uncheck any of the icon-type toggles (App icon, Play Store icon, Notification icons) to skip that family — e.g. regenerate notification icons only.

> **Note for iOS/macOS**: Some permissions require a usage description string (e.g., "We need camera access to scan QR codes"). The extension will prompt you to enter these descriptions directly in the UI.

### SDK-gated permission variants

Whether a permission declaration does anything depends on the device's API level and on the app's `targetSdk`, so the Permissions tab reads `minSdk`, `targetSdk` and `compileSdk` from `android/app/build.gradle` or `build.gradle.kts` (literal values, `flutter.minSdkVersion` & co. resolved from the Flutter SDK, `maxOf(...)`) and the iOS deployment target from the `Podfile` or `project.pbxproj`, and shows them above the tables. Each permission then gets an **Applies** badge (ok / info / warning / error, details in the tooltip and in the Advice list):

| Declaration | When | Recommended variant |
| :--- | :--- | :--- |
| `READ_EXTERNAL_STORAGE` | targetSdk 33+ | `android:maxSdkVersion="32"` plus `READ_MEDIA_IMAGES` / `READ_MEDIA_VIDEO` / `READ_MEDIA_AUDIO` (and `READ_MEDIA_VISUAL_USER_SELECTED` at 34+) |
| `WRITE_EXTERNAL_STORAGE` | targetSdk 30+ | `maxSdkVersion="28"` (29 with `requestLegacyExternalStorage`); removed when minSdk is 30+ |
| `BLUETOOTH`, `BLUETOOTH_ADMIN` | targetSdk 31+ | `maxSdkVersion="30"` plus `BLUETOOTH_SCAN` (`usesPermissionFlags="neverForLocation"` unless you derive location) and `BLUETOOTH_CONNECT` |
| `ACCESS_FINE_LOCATION` alone | targetSdk 31+ | add `ACCESS_COARSE_LOCATION` (error otherwise) |
| `BODY_SENSORS` / `_BACKGROUND` | targetSdk 36+ | `maxSdkVersion="35"` plus `android.permission.health.READ_HEART_RATE` (`READ_HEALTH_DATA_IN_BACKGROUND`) |
| `FOREGROUND_SERVICE` | targetSdk 34+ | a matching `FOREGROUND_SERVICE_<TYPE>` |
| `SCHEDULE_EXACT_ALARM` + `USE_EXACT_ALARM` | always | `SCHEDULE_EXACT_ALARM` with `maxSdkVersion="32"` |
| `INTERNET` without `ACCESS_LOCAL_NETWORK` | targetSdk 37 | info: LAN / mDNS access needs `ACCESS_LOCAL_NETWORK` |

Deprecated (`USE_FINGERPRINT` -> `USE_BIOMETRIC`), removed, system-only and newer-than-`compileSdk` permissions are flagged, and restricted permissions carry their Google Play policy note. On iOS the advice covers deprecated keys and their successors, keys newer than the deployment target (harmless), `NSLocalNetworkUsageDescription` without `NSBonjourServices`, Always location without When-In-Use, AccessorySetupKit Bluetooth keys and permission_handler Podfile macros.

**Apply recommended variants** collects every suggested change, shows the exact line diff of `AndroidManifest.xml` and `Info.plist`, and writes only when you confirm. The **Variant** column edits `maxSdkVersion`, `usesPermissionFlags` and `<uses-permission-sdk-23>` per permission. Elements with `tools:node="remove"` (for example `com.google.android.gms.permission.AD_ID` in an ad-free app) are listed under **Removed by manifest merger**: they are never counted as used and are always kept. Variants are keyed by SDK level, not by Gradle: `tools:` attributes work with every AGP version and `<uses-permission-sdk-23>` needs AGP 2.0+. The same advice is available to AI agents through the MCP tools `list_permissions` and `audit_permissions`.

The permission catalogs are generated: `npm run catalog:build` rebuilds `src/categorized-*-permissions.json` from `src/permission-sources/` (Android SDK `api-versions.xml`, the AOSP core manifest, Apple's documentation data and the curated overlays). Edit `src/permission-sources/android-overlay.json` or `ios-overlay.json`, never the catalogs.

## 📦 Supported Platforms

| Feature               | Android | iOS | macOS |
| :-------------------- | :-----: | :-: | :---: |
| Permission Management |   ✅    | ✅  |  ✅   |
| Service Configuration |   ✅    | ✅  |  🚧   |
| Smart Extraction      |   ✅    | ✅  |  ✅   |
| Translation Files     |   ✅    | ✅  |  ✅   |
| App Icons             |   ✅    | ✅  |  🚧   |
| Splash Screen         |   ✅    | ✅  |  🚧   |

_macOS service configuration, app icon, and splash screen support are coming soon!_

## 🤖 MCP Server for AI Agents

The extension bundles a Model Context Protocol server (`mcp-server/`) that lets
AI agents work with the same Flutter configuration you manage in the UI. On
VS Code 1.93+ it is registered automatically via
`contributes.mcpServerDefinitionProviders`, so Copilot can call its tools with
no setup:

| Tool | What it does |
|------|--------------|
| `get_project_info` | Project root, name, and discovered platform files. |
| `list_permissions` | Permissions currently in the Android manifest and iOS/macOS plists. |
| `add_permission` / `remove_permission` | Edit permissions safely across platforms. |
| `list_services` | Available service integrations. |
| `list_translations` | ARB/JSON translation files + locales + key counts. |
| `translate_locale` / `add_translation_locale` | Machine-translate a locale or add a new one. |
| `scan_interactives` | Confidence-based interactive-widget and semantics inventory with exact source references. |
| `preview_semantics_fixes` / `apply_semantics_fixes` | Preview and apply reviewed, hash-guarded automation identifiers. |
| `scan_routes` | Route graph: screens, sheets/dialogs, edges with call sites, triggers, conditions and attribution; `route` returns one route's edges. |
| `find_route_paths` | Candidate chains of screens from the app start (or `from`) to a target, with the edges behind each hop. |
| `list_trails` / `save_trail` | Read and save validated user-journey trails in `.flutter-config-manager/trails.json`. |
| `check_android_automation` / `start_android_session` | Validate explicit Appium prerequisites and start Android automation. |
| Runtime interaction tools | Inspect, tap, type, select, scroll, wait, assert, screenshot, and end a session by exact identifier. |

The **Connect MCP** dialog follows each client's documented user/global setup:
[Codex MCP](https://developers.openai.com/codex/mcp/),
[Claude Code MCP](https://code.claude.com/docs/en/mcp),
[Gemini CLI MCP](https://geminicli.com/docs/tools/mcp-server/), and
[Cursor MCP](https://cursor.com/docs/mcp).

To register it with other MCP clients (Claude Desktop, Cursor, …) or run it
standalone, see the dedicated [mcp-server/README.md](mcp-server/README.md).

## 🔧 Requirements

- VS Code 1.80.0 or higher.
- A Flutter project structure (standard `android/`, `ios/`, or `macos/` directories).
- MCP server / AI-agent integration requires VS Code 1.93+ (ignored on older versions).
- Semantics inventory is read-only on older Flutter projects; automatic identifiers and native automation require Flutter 3.19+.
- Trail reads go_router and Fluro as fully supported (checked against real apps), and auto_route, GetX, flutter_modular, Beamer, Routemaster, VRouter, Qlevar and Sailor as partly supported (checked against small projects built from each package's documented API; guards and middlewares are not read). A custom `RouterDelegate`/`Router` setup, `yeet` and `routefly` are not parsed: use `flutter-config-manager.trail.navigationCallees` for project navigation helpers, or let the agent read the router setup. Navigation whose destination is computed at runtime is reported as unresolved rather than guessed.
- Android UI YAML export requires Android SDK Platform-Tools (`adb`) and an authorized connected device or emulator; Appium is not required for the export.
- Android runtime automation additionally requires an already-installed Appium server, UiAutomator2 driver, Android SDK, and connected emulator/device.

## 📝 Release Notes

For a complete and detailed history of all changes, features, and fixes, please refer to the [CHANGELOG.md](CHANGELOG.md) file.

---

**Happy Coding!** 💙 built for the Flutter community.
