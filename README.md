# Flutter Config Manager

Streamline your Flutter project configuration with the **Flutter Config Manager** for VS Code. This extension removes the headache of manually editing Android manifests and iOS/macOS property lists, providing a unified, visual interface to manage permissions and third-party service integrations.

## 🚀 Key Features

- **Unified Permission Management**: Easily add, remove, and configure permissions for **Android**, **iOS**, and **macOS** from a single view. Permissions are categorized for fast search and filtering — filter the tables by category or search by name, description, constant value, or category, and browse the Add Permission dialog with category tabs. No more context switching between messy XML and plist files.
- **Smart Extraction**: The extension intelligently scans your project workspace. It automatically detects which platforms you are targeting (Android, iOS, macOS) and only shows the relevant configuration sections. Existing permissions are automatically imported, so you never lose your place.
- **Service Integrations**: Quickly configure popular third-party services without diving into documentation for platform-specific setup. Supported services include:
  - Facebook SDK
  - Google Sign-In & Google Maps
  - **App Name Localization**: Easily manage app display names for multiple languages using native `InfoPlist.strings` (iOS) and `strings.xml` (Android). Includes support for localizing `FacebookDisplayName` on iOS.
- **Translation Files Manager**: Manage your app's `ARB`/`JSON` translation files (easy_localization, flutter_localizations, or plain i18n) from a dedicated **Localization** tab. Point it at your translation folder (default `assets/translations`), pick a reference locale, and translate everything with free keyless machine translation.
  - **Locale grid & burger menus**: One row per locale with a burger menu (`Translate all`, `Translate missing only`, `Remove`); stable key → translation columns (key 30%, each translation 35%).
  - **Searchable language dropdown**: Add new locales from a searchable list — the file is created next to the reference with all keys pre-filled as empty.
  - **One-click translation**: Batch translate all locales (or only the missing gaps) and auto-add any reference keys missing elsewhere. Values are translated via a free provider chain (Google → MyMemory → LibreTranslate) with batched requests for speed.
  - **Round-trip safe**: Nested easy_localization JSON (objects/arrays) is flattened for editing and re-nested exactly on save, while flat keys that merely contain dots (sentences ending in `.`/`...`, e.g. `input_field.context_menu.cut`) are preserved verbatim.
- **MCP Server for AI Agents**: Ship the extension's capabilities to AI agents through a bundled [Model Context Protocol](https://modelcontextprotocol.io) server. Copilot (and other MCP clients) can inspect and edit your Flutter project's permissions, service integrations, and ARB/JSON translations programmatically — reusing the exact same safe, structure-preserving edits the UI makes. See [mcp-server/README.md](mcp-server/README.md).
- **Robust Executable Resolution**: Integrates seamlessly with the VS Code Dart extension to dynamically resolve the correct `flutter` and `dart` executables without relying on the system PATH.
- **Gradle Declarative Migration & 16 KB Support**: **Run Full Migration** upgrades Android projects to the latest declarative Flutter Gradle setup (replacing hardcoded paths with `flutter.compileSdkVersion`, `flutter.minSdkVersion`, `flutter.targetSdkVersion`, and `flutter.ndkVersion`). A separate **Enable 16 KB Page Size** button is a safe fallback for projects with outdated packages — it applies only the minimal changes required for Android 15+ 16 KB page-size compatibility (AGP 8.5.1+, targetSdk 35+, NDK r28, `android:extractNativeLibs="true"`) while leaving legacy buildscript setups untouched. The migration is non-destructive: it never forces newer AGP/Kotlin versions onto a project that already builds, never lowers your `minSdk`, and supports both `build.gradle` and `build.gradle.kts`.
- **Dependency Management**: Fully-featured Flutter dependencies table showing direct, dev, and transitive packages.
  - **Search & Add**: Integrated pub.dev API search with typeahead and live package details preview.
  - **Dependency Validator**: Built-in integration with `dependency_validator` to safely analyze unused packages and automatically downgrade them or remove them.
  - **Unused Assets**: Detect asset files that are no longer referenced from your Dart/JSON source (inspired by `unused_assets_removal`) and delete them to reduce app size. The scanner also understands **dynamic references** — interpolated paths like `assets/icon/$icon`, string concatenation, and dynamic loaders like `Image.asset(path)` — so assets that may still be in use are moved to a **Maybe used** bucket instead of being flagged as unused. Each maybe-used row lists the Dart files that reference it, with buttons that jump straight to the exact line. You can **ignore** custom wrapper widgets (e.g. `my_image.dart`) or whole directories — either fully, or just their dynamic patterns — from the Unused Assets UI or workspace settings, and `easy_localization` translation folders are excluded automatically. Use the **Unused Assets** section in the Flutter Config view (sidebar or panel) to scan, review, and delete per file or all at once — or run the **`Flutter Config Manager: Check Unused Assets`** command from the palette.
- **Package Configuration Management**: A dedicated dashboard at the top of the UI to view and update your Android Application ID and iOS Bundle Identifier with a single click.
- **Safe & Automated Updates**: With a single click, the extension updates all necessary files (`AndroidManifest.xml`, `Info.plist`, `Podfile`, `AppDelegate.swift`, etc.) while preserving your existing project structure and comments.
- **Vibe Coded**: This extension was vibe coded in the most fashionable way, because your development workflow deserves to look and feel as good as your apps.

## 🛠️ Usage

1.  **Open your Flutter project** in VS Code.
2.  Click the **Flutter Config icon** in the Activity Bar (left sidebar).
3.  Alternatively, run the command **`Flutter Config Manager: Edit Permissions & Services`** from the command palette.
4.  **Manage Permissions**: Browse categorized lists, search for specific permissions, and toggle them on/off.
5.  **Configure Services**: Select services to integrate and fill in the required API keys or IDs.
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

> **Note for iOS/macOS**: Some permissions require a usage description string (e.g., "We need camera access to scan QR codes"). The extension will prompt you to enter these descriptions directly in the UI.

## 📦 Supported Platforms

| Feature               | Android | iOS | macOS |
| :-------------------- | :-----: | :-: | :---: |
| Permission Management |   ✅    | ✅  |  ✅   |
| Service Configuration |   ✅    | ✅  |  🚧   |
| Smart Extraction      |   ✅    | ✅  |  ✅   |
| Translation Files     |   ✅    | ✅  |  ✅   |

_macOS service configuration support is coming soon!_

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

To register it with other MCP clients (Claude Desktop, Cursor, …) or run it
standalone, see the dedicated [mcp-server/README.md](mcp-server/README.md).

## 🔧 Requirements

- VS Code 1.80.0 or higher.
- A Flutter project structure (standard `android/`, `ios/`, or `macos/` directories).
- MCP server / AI-agent integration requires VS Code 1.93+ (ignored on older versions).

## 📝 Release Notes

For a complete and detailed history of all changes, features, and fixes, please refer to the [CHANGELOG.md](CHANGELOG.md) file.

---

**Happy Coding!** 💙 built for the Flutter community.
