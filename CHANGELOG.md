# Changelog

All notable changes to the "Flutter Config Manager" extension will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
