# Flutter Config Manager - Gemini Context

This project is a VS Code extension designed to simplify the management of permissions, third-party services, and app name localizations for Flutter projects across Android, iOS, and macOS platforms.

## Project Overview

- **Purpose**: Provides a unified UI in VS Code to edit `AndroidManifest.xml`, `Info.plist`, `Podfile`, and `AppDelegate.swift` without manual file editing.
- **Main Technologies**:
  - **Backend**: TypeScript, VS Code Extension API.
  - **Frontend (Webview)**: HTML, Vanilla CSS, Vanilla JavaScript.
  - **Data**: JSON-based permission mappings and service definitions.
- **Architecture**:
  - `src/extension.ts`: Entry point for activation and command registration.
  - `src/services/`: Platform-specific business logic (parsing and updating manifest/plist/podfiles).
  - `src/webview/`: Backend handlers for the Webview UI.
  - `src/providers/`: Sidebar and view providers.
  - `src/utils/`: Extractors and file system helpers.
  - `src/webview.js`: Main client-side script for the Webview UI.

## Building and Running

The project uses standard npm scripts for development:

- **Build**: `npm run compile` - Compiles TypeScript to JavaScript.
- **Watch**: `npm run watch` - Automatically recompiles on file changes.
- **Lint**: `npm run lint` - Runs ESLint to check code quality.
- **Test**: `npm test` - Executes the test suite using `vscode-test`.
- **Package**: `vsce package` - Packages the extension for distribution.

## Development Conventions

- **Separation of Concerns**: Keep platform-specific logic within their respective folders in `src/services/android` or `src/services/ios`.
- **Type Safety**: Use interfaces defined in `src/types/` for all cross-component data structures.
- **Webview Communication**: Communication between the backend and the webview is handled via `vscode.postMessage` and monitored in `src/webview/handlers/`.
- **Resource Management**: Permission and service data are centralized in `.json` files within `src/` (e.g., `permission-mapping.json`, `services-config.json`).
- **Safety**: File updates should preserve existing comments and structure where possible, using specific service methods for targeted injections.
- **Gradle Versioning**: `versionName` in Android `build.gradle` is always forced to `"flutterVersionName"` to align with Flutter's version management.
- **Podfile Standardization**: Ensures `COCOAPODS_DISABLE_STATS`, `project 'Runner'`, and a comprehensive `post_install` block (including deployment targets and permission macros) are present in the iOS `Podfile`.
- **Package Configuration**: A dedicated section for managing Android Application ID and iOS Bundle Identifier is available at the top of the dashboard.
