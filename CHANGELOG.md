# Changelog

All notable changes to the "Flutter Config Manager" extension will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
