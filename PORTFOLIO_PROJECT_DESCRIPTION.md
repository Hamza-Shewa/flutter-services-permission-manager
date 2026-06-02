# Flutter Config Manager - Portfolio Project Description

## Project Summary
Flutter Config Manager is a Visual Studio Code extension designed to simplify one of the most repetitive and error-prone parts of Flutter development: configuring platform-specific permissions and third-party service integrations across Android, iOS, and macOS.

Instead of manually editing multiple native files, developers can manage everything from a single visual interface inside VS Code. The extension automatically discovers relevant platform files, extracts existing configurations, and safely applies updates while preserving structure and readability.

## The Problem
When building production Flutter apps, developers often need to configure:

- Platform permissions (camera, location, notifications, contacts, etc.)
- Native service setups (Firebase, Google Maps, Facebook SDK, OneSignal, AdMob, Stripe, deep links, and more)
- Platform-specific metadata and resource files

This process usually requires manually editing files like AndroidManifest.xml, Info.plist, Podfile, AppDelegate.swift, and entitlement files. Common issues include:

- Missing or inconsistent keys between platforms
- Syntax mistakes in XML/plist/Swift files
- Accidental overwrite of existing custom configurations
- Time lost switching context between docs and native files

## Solution
Flutter Config Manager solves this by providing a guided, unified configuration workflow directly in the editor.

### Core Capabilities
- Unified Package Configuration for Android Application ID and iOS Bundle Identifier
- Visual permission management for Android, iOS, and macOS
- Service integration setup through declarative service definitions
- Automatic extraction of existing project configuration
- Safe write operations that preserve existing structure/comments where possible
- Cross-platform permission mapping support
- Platform build metadata detection for Android and iOS
- Sidebar + command palette entry for quick access

## Philosophy
This extension isn't just a tool; it was **vibe coded in the most fashionable way**, ensuring that developer experience and aesthetic flow are prioritized alongside technical correctness.

## Architecture and Technical Design
The extension follows a modular architecture with clear separation between discovery, extraction, UI messaging, and file update services.

### 1) Extension Entry and Activation
- Registers commands and sidebar provider
- Activates when a Flutter workspace is detected (via pubspec.yaml)
- Opens webview panel with preloaded project configuration

### 2) Workspace Discovery Layer
A dedicated workspace service scans the Flutter project and locates key files:

- AndroidManifest.xml
- strings.xml
- Gradle wrapper and Android build files
- Info.plist
- Podfile
- AppDelegate.swift
- entitlements files
- project.pbxproj

### 3) Extraction Pipeline
Extractor services parse current platform files to detect existing permissions and configured services. This allows the UI to reflect the real project state before any edits are made.

### 4) Webview Frontend + Backend Messaging
- Webview provides a focused configuration UI
- Backend handlers process incoming UI actions
- State layer caches project data and sends updates back to the webview

### 5) Document Update Pipeline
A central document service orchestrates platform updates and delegates to dedicated services:

- Android services update manifest entries, metadata, and localized string resources
- iOS/macOS services update plist keys, Podfile flags, AppDelegate integrations, and entitlement capabilities

This separation makes the code easier to extend, test, and maintain.

### 6) Platform Build Metadata
The extension now detects major native build details and surfaces them in dedicated Android and iOS sections:

- Android Gradle wrapper version
- Android Gradle Plugin version
- Kotlin version
- compileSdk, minSdk, targetSdk
- applicationId, namespace, version name, and version code
- **Gradle Standardization**: Always forces `versionName` to `"flutterVersionName"` to ensure the Android build stays in sync with Flutter's own version management.
- iOS deployment target
- Swift version
- bundle identifier
- Xcode project format version

## Notable Engineering Decisions

### Declarative Service Configuration
Service integrations are defined through configuration JSON files rather than hardcoded logic. This makes adding new services faster and reduces code churn.

### Platform-Specific Service Modules
Each platform operation is isolated in focused services, which lowers regression risk and keeps implementation details encapsulated.

### Safe, Non-Destructive File Edits
The extension favors targeted updates over full-file rewrites. This helps preserve existing formatting and custom developer edits.

### Typed Message Contracts
TypeScript interfaces are used for webview messages and service models, improving reliability and maintainability in a multi-module extension.

## Key Features Implemented
- Multi-platform permission catalog integration
- Permission cross-mapping between Android and iOS
- Third-party service setup workflows for common mobile SDKs
- Localization-aware app name/resource handling
- Android and iOS build metadata extraction with dedicated UI sections
- Reusable XML/plist update helpers
- Logging and structured error handling for safer troubleshooting

## Technology Stack
- TypeScript (strict typing)
- Node.js runtime for extension host
- VS Code Extension API
- Webview HTML/CSS/JavaScript UI
- ESLint + TypeScript tooling
- Mocha-based extension test setup

## Testing and Quality Approach
- Linting and compile checks integrated into workflow
- Unit-style tests for utility logic and extension behavior
- Service-oriented design supports focused testing of file transformation logic
- Defensive parsing and update strategies to reduce accidental misconfiguration

## Impact and Value
This project improves developer productivity by reducing native-configuration overhead in Flutter projects. It lowers setup friction, shortens onboarding for multi-platform teams, and minimizes manual errors in production-critical configuration files.

From an engineering perspective, the project demonstrates:

- Practical VS Code extension development
- Real-world cross-platform tooling design
- Clean modular architecture for maintainability
- Safe automation of complex configuration workflows

## My Role and Contributions
- Designed and implemented core extension architecture
- Built platform discovery, extraction, and update services
- Implemented webview-driven configuration flow
- Structured service definitions for scalable integrations
- Added testing and lint/compile quality workflow
- Focused on safe edits, compatibility, and developer experience

## Future Enhancements
- Guided validation/warnings for incomplete service configuration
- Diff preview before applying file updates
- Expanded service templates and auto-detection heuristics
- More granular test coverage for platform-specific edge cases
- Optional project-level export/import of configuration presets

## Why This Project Stands Out in a Portfolio
Flutter Config Manager is a strong portfolio project because it combines product thinking and technical depth:

- Solves a tangible pain point for real developers
- Integrates frontend UX, backend logic, and platform file automation
- Demonstrates architecture, maintainability, and safety tradeoffs
- Shows ability to build tools that improve developer workflows at scale
