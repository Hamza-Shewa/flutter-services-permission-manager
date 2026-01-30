# Flutter Config Manager

Streamline your Flutter project configuration with the **Flutter Config Manager** for VS Code. This extension removes the headache of manually editing Android manifests and iOS/macOS property lists, providing a unified, visual interface to manage permissions and third-party service integrations.

## 🚀 Key Features

- **Unified Permission Management**: Easily add, remove, and configure permissions for **Android**, **iOS**, and **macOS** from a single view. No more context switching between messy XML and plist files.
- **Smart Extraction**: The extension intelligently scans your project workspace. It automatically detects which platforms you are targeting (Android, iOS, macOS) and only shows the relevant configuration sections. Existing permissions are automatically imported, so you never lose your place.
- **Service Integrations**: Quickly configure popular third-party services without diving into documentation for platform-specific setup. Supported services include:
  - Faceboook SDK
  - Google Sign-In & Google Maps
  - Firebase Cloud Messaging
  - Google AdMob & OneSignal
  - Twitter/X Login & Apple Sign-In
  - Stripe Payments
  - Deep Linking
- **Safe & Automated Updates**: With a single click, the extension updates all necessary files (`AndroidManifest.xml`, `Info.plist`, `Podfile`, `AppDelegate.swift`, etc.) while preserving your existing project structure and comments.

## 🛠️ Usage

1.  **Open your Flutter project** in VS Code.
2.  Click the **Flutter Config icon** in the Activity Bar (left sidebar).
3.  Alternatively, run the command **`Flutter Config Manager: Edit Permissions & Services`** from the command palette.
4.  **Manage Permissions**: Browse categorized lists, search for specific permissions, and toggle them on/off.
5.  **Configure Services**: Select services to integrate and fill in the required API keys or IDs.
6.  **Save**: Hit the Save button to apply changes across all platform files instantly.

> **Note for iOS/macOS**: Some permissions require a usage description string (e.g., "We need camera access to scan QR codes"). The extension will prompt you to enter these descriptions directly in the UI.

## 📦 Supported Platforms

| Feature               | Android | iOS | macOS |
| :-------------------- | :-----: | :-: | :---: |
| Permission Management |   ✅    | ✅  |  ✅   |
| Service Configuration |   ✅    | ✅  |  🚧   |
| Smart Extraction      |   ✅    | ✅  |  ✅   |

_macOS service configuration support is coming soon!_

## 🔧 Requirements

- VS Code 1.60.0 or higher.
- A Flutter project structure (standard `android/`, `ios/`, or `macos/` directories).

## 📝 Release Notes

### 0.0.1

- Initial release.
- Support for Android and iOS permission management.
- Integration for 10+ popular services.

### 0.0.2 (Latest)

- **New**: Added full support for **macOS** permission management.
- **New**: **Smart Extraction** feature that conditionally displays platform sections based on project files.
- Improved UI with clearer visual feedback and platform-specific theming.

---

**Happy Coding!** 💙 built for the Flutter community.
