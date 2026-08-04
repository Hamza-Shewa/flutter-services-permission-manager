# Flutter Config Manager

Streamline your Flutter project configuration with the **Flutter Config Manager** for VS Code. This extension removes the headache of manually editing Android manifests and iOS/macOS property lists, providing a unified, visual interface to manage permissions and third-party service integrations.

## 🚀 Key Features

- **Unified Permission Management**: Easily add, remove, and configure permissions for **Android**, **iOS**, and **macOS** from a single view. Permissions are categorized for fast search and filtering — filter the tables by category or search by name, description, constant value, or category, and browse the Add Permission dialog with category tabs. No more context switching between messy XML and plist files.
- **Smart Extraction**: The extension intelligently scans your project workspace. It automatically detects which platforms you are targeting (Android, iOS, macOS) and only shows the relevant configuration sections. Existing permissions are automatically imported, so you never lose your place.
- **Service Integrations**: Quickly configure popular third-party services without diving into documentation for platform-specific setup. Supported services include:
  - Facebook SDK
  - Google Sign-In & Google Maps
  - **App Name Localization**: Easily manage app display names for multiple languages using native `InfoPlist.strings` (iOS) and `strings.xml` (Android). Includes support for localizing `FacebookDisplayName` on iOS.
- **Robust Executable Resolution**: Integrates seamlessly with the VS Code Dart extension to dynamically resolve the correct `flutter` and `dart` executables without relying on the system PATH.
- **Gradle Declarative Migration & 16 KB Support**: **Run Full Migration** upgrades Android projects to the latest declarative Flutter Gradle setup (replacing hardcoded paths with `flutter.compileSdkVersion`, `flutter.minSdkVersion`, `flutter.targetSdkVersion`, and `flutter.ndkVersion`). A separate **Enable 16 KB Page Size** button is a safe fallback for projects with outdated packages — it applies only the minimal changes required for Android 15+ 16 KB page-size compatibility (AGP 8.5.1+, targetSdk 35+, NDK r28, `android:extractNativeLibs="true"`) while leaving legacy buildscript setups untouched. The migration is non-destructive: it never forces newer AGP/Kotlin versions onto a project that already builds, never lowers your `minSdk`, and supports both `build.gradle` and `build.gradle.kts`.
- **Dependency Management**: Fully-featured Flutter dependencies table showing direct, dev, and transitive packages.
  - **Search & Add**: Integrated pub.dev API search with typeahead and live package details preview.
  - **Dependency Validator**: Built-in integration with `dependency_validator` to safely analyze unused packages and automatically downgrade them or remove them.
  - **Unused Assets**: Detect asset files that are no longer referenced from your Dart/JSON source (inspired by `unused_assets_removal`) and delete them to reduce app size. Use the **Unused Assets** section in the Flutter Config view (sidebar or panel) to scan, review, and delete per file or all at once — or run the **`Flutter Config Manager: Check Unused Assets`** command from the palette.
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
7.  **Save**: Use section-level Save buttons or Save All Changes to apply updates across platform files instantly.
8.  **Check Unused Assets**: Run the **`Flutter Config Manager: Check Unused Assets`** command from the command palette to list unused assets and delete them. You can also use the bundled standalone script directly:

    ```bash
    node scripts/check-unused-assets.js --path /path/to/flutter/project   # dry-run
    node scripts/check-unused-assets.js --path /path/to/flutter/project --delete
    ```

> **Note for iOS/macOS**: Some permissions require a usage description string (e.g., "We need camera access to scan QR codes"). The extension will prompt you to enter these descriptions directly in the UI.

## 📦 Supported Platforms

| Feature               | Android | iOS | macOS |
| :-------------------- | :-----: | :-: | :---: |
| Permission Management |   ✅    | ✅  |  ✅   |
| Service Configuration |   ✅    | ✅  |  🚧   |
| Smart Extraction      |   ✅    | ✅  |  ✅   |

_macOS service configuration support is coming soon!_

## 🔧 Requirements

- VS Code 1.80.0 or higher.
- A Flutter project structure (standard `android/`, `ios/`, or `macos/` directories).

## 📝 Release Notes

For a complete and detailed history of all changes, features, and fixes, please refer to the [CHANGELOG.md](CHANGELOG.md) file.

---

**Happy Coding!** 💙 built for the Flutter community.
