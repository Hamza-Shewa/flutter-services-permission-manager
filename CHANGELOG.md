# Changelog

All notable changes to the "Flutter Config Manager" extension will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
