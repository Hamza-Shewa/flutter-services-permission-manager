# Flutter Config Manager VS Code Extension

Flutter Config Manager is a VS Code extension for managing Android and iOS permissions and SDK service configurations in Flutter projects. It features a dedicated sidebar icon for quick access and provides a unified interface for managing both platform permissions and third-party service integrations.

## Features

- **Permission Management**: View and manage Android and iOS permissions with categorized lists
- **Service Configuration**: Configure popular services like Facebook SDK, Google Maps, Firebase, AdMob, and more
- **Platform Support**: Automatically updates AndroidManifest.xml, Info.plist, strings.xml, Podfile, and AppDelegate.swift
- **Smart Extraction**: Reads existing configurations from your project files
- **One-Click Save**: Save all changes to all platform files with a single action

## Supported Services

| Service | Android | iOS |
|---------|---------|-----|
| Facebook SDK | ✅ | ✅ |
| Google Sign-In | ✅ | ✅ |
| Google Maps | ✅ | ✅ |
| Firebase Cloud Messaging | ✅ | ✅ |
| Google AdMob | ✅ | ✅ |
| OneSignal | ✅ | - |
| Twitter/X Login | ✅ | ✅ |
| Apple Sign-In | - | ✅ |
| Stripe Payments | ✅ | ✅ |
| Deep Linking | ✅ | ✅ |

## Usage

1. Open your Flutter project in VS Code
2. Click the **Flutter Config** icon in the Activity Bar (sidebar)
3. Or run the command **Flutter Config Manager: Edit Permissions & Services**
4. Configure permissions and services as needed
5. Click **Save All Changes** to update all platform files

> When saving iOS permissions, missing usage descriptions are inserted as `TODO: Provide usage description.` so you can update them manually.

## Requirements

- VS Code 1.108.1 or higher
- A Flutter project with `android/` and/or `ios/` directories

## Known Issues

- iOS permission updates require you to fill in usage descriptions after saving
- Some services may require additional manual configuration (e.g., adding google-services.json)

## Release Notes

### 0.0.1

- Initial release with permission and service management
- Support for 10 popular Flutter services
- Automatic extraction of existing configurations

---

**Enjoy!**
