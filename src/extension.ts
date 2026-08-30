/**
 * Flutter Config Manager VS Code Extension
 * Entry point - handles extension activation and command registration
 */

import * as vscode from "vscode";
import * as fs from "fs";
import * as path from "path";
import { setExtensionBaseUri } from "./core/utils/file.js";
import {
  getUsedAndroidPermissions,
  getUsedIOSPermissions,
} from "./features/permissions/extractor.js";
import { createPermissionPanel } from "./webview/index.js";
import { discoverProjectFilesWithContent } from "./core/workspace.service.js";
import {
  analyzeUnusedAssets,
  deleteUnusedAssets,
} from "./features/assets/assets.service.js";
import { FlutterConfigSidebarProvider } from "./core/providers/sidebar.provider.js";
import { enableDebug, disableDebug, toErrorMessage } from "./core/shared/index.js";

// Re-export for backward compatibility and testing
export {
  updateAndroidManifest,
  updateIOSPlist,
  normalizePermissionNames,
  normalizePlistSpacing,
} from "./features/index.js";

export {
  flattenAndroidPermissions,
  flattenIOSPermissions,
} from "./features/permissions/extractor.js";

export { getExtensionBaseUri as extensionBaseUri } from "./core/utils/file.js";

/**
 * Extension activation - called when extension is first used
 */
export function activate(context: vscode.ExtensionContext): void {
  setExtensionBaseUri(context.extensionUri);

  // Apply debug logging preference
  const applyDebugConfig = (): void => {
    const cfg = vscode.workspace.getConfiguration("flutterConfigManager");
    if (cfg.get<boolean>("enableDebug")) {
      enableDebug();
    } else {
      disableDebug();
    }
  };
  applyDebugConfig();

  // React to settings changes at runtime
  const configChangeDisposable = vscode.workspace.onDidChangeConfiguration((e) => {
    if (e.affectsConfiguration("flutterConfigManager.enableDebug")) {
      applyDebugConfig();
    }
  });

  // Register edit command
  const editDisposable = vscode.commands.registerCommand(
    "flutter-config-manager.edit",
    () => handleEditCommand(context),
  );

  // Register sidebar view provider
  const sidebarProvider = new FlutterConfigSidebarProvider(
    context.extensionUri,
  );
  const sidebarDisposable = vscode.window.registerWebviewViewProvider(
    FlutterConfigSidebarProvider.viewType,
    sidebarProvider,
    { webviewOptions: { retainContextWhenHidden: true } }
  );

  // Register unused assets command
  const checkAssetsDisposable = vscode.commands.registerCommand(
    "flutter-config-manager.checkUnusedAssets",
    () => handleCheckUnusedAssets(),
  );

  context.subscriptions.push(
    editDisposable,
    sidebarDisposable,
    configChangeDisposable,
    checkAssetsDisposable,
  );
}

/**
 * Handles the main edit command - opens the Flutter Config Manager panel
 */
async function handleEditCommand(
  context: vscode.ExtensionContext,
): Promise<void> {
  const files = await discoverProjectFilesWithContent();

  // Warn if no platform files were detected
  if (!files.androidManifestUri && !files.iosPlistUri && !files.macosPlistUri) {
    vscode.window.showWarningMessage(
      "Flutter Config Manager: No AndroidManifest.xml, Info.plist, or macOS Info.plist found. " +
      "Make sure this workspace contains a Flutter project with Android and/or iOS folders.",
    );
    return;
  }

  const [usedAndroidPermissions, usedIOSPermissions, usedMacOSPermissions] =
    await Promise.all([
      getUsedAndroidPermissions(files.androidManifestContent ?? ""),
      getUsedIOSPermissions(files.iosPlistContent ?? ""),
      getUsedIOSPermissions(files.macosPlistContent ?? ""),
    ]);

  await createPermissionPanel(
    context.extensionUri,
    usedAndroidPermissions,
    usedIOSPermissions,
    usedMacOSPermissions,
    files,
  );

  vscode.window.showInformationMessage("Flutter Config Manager opened!");
}

/**
 * Handles the "Check Unused Assets" command - scans the Flutter project for
 * unused asset files and lets the user review and delete them.
 */
async function handleCheckUnusedAssets(): Promise<void> {
  const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  if (!workspaceRoot) {
    vscode.window.showWarningMessage(
      "Flutter Config Manager: No workspace folder is open.",
    );
    return;
  }

  if (!fs.existsSync(path.join(workspaceRoot, "pubspec.yaml"))) {
    vscode.window.showWarningMessage(
      "Flutter Config Manager: The current workspace is not a Flutter project (no pubspec.yaml found).",
    );
    return;
  }

  let result;
  try {
    result = await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: "Scanning for unused assets...",
      },
      () => analyzeUnusedAssets(workspaceRoot),
    );
  } catch (error) {
    vscode.window.showErrorMessage(
      `Failed to analyze unused assets: ${toErrorMessage(error)}`,
    );
    return;
  }

  const { assets, maybeUsedAssets } = result;
  const maybeUsed = maybeUsedAssets || [];

  if (assets.length === 0) {
    const message =
      maybeUsed.length > 0
        ? `No unused assets found (${result.totalAssets} scanned; ${maybeUsed.length} may be used via dynamic references and were left untouched).`
        : `No unused assets found (${result.totalAssets} assets scanned). 🎉`;
    vscode.window.showInformationMessage(message);
    return;
  }

  if (maybeUsed.length > 0) {
    vscode.window.showInformationMessage(
      `${maybeUsed.length} asset(s) may be used via dynamic references (e.g. assets/icon/$icon) and are excluded from this list.`,
    );
  }

  type AssetQuickPickItem = vscode.QuickPickItem & {
    deleteAll?: boolean;
    assetPath?: string;
  };

  const deleteAllItem: AssetQuickPickItem = {
    label: "$(trash) Delete all unused assets",
    description: `${assets.length} files`,
    deleteAll: true,
  };

  const items: AssetQuickPickItem[] = [
    deleteAllItem,
    ...assets.map((asset) => ({
      label: "$(file-media) " + asset.path,
      description:
        asset.size != null ? `${(asset.size / 1024).toFixed(1)} KB` : "",
      assetPath: asset.path,
    })),
  ];

  const selection = await vscode.window.showQuickPick(items, {
    placeHolder: `Found ${assets.length} unused assets. Select files to delete (or pick "Delete all").`,
    canPickMany: true,
    ignoreFocusOut: true,
  });

  if (!selection || selection.length === 0) {
    vscode.window.showInformationMessage("No unused assets were deleted.");
    return;
  }

  const toDelete = selection.some((item) => item.deleteAll)
    ? assets.map((asset) => asset.path)
    : selection
      .map((item) => item.assetPath)
      .filter((p): p is string => Boolean(p));

  if (toDelete.length === 0) {
    return;
  }

  const answer = await vscode.window.showWarningMessage(
    `Delete ${toDelete.length} unused asset file(s)? This cannot be undone.`,
    { modal: true },
    "Delete",
  );
  if (answer !== "Delete") {
    return;
  }

  try {
    const deleted = await deleteUnusedAssets(workspaceRoot, toDelete);
    vscode.window.showInformationMessage(
      `Deleted ${deleted} unused asset file(s).`,
    );
  } catch (error) {
    vscode.window.showErrorMessage(
      `Failed to delete unused assets: ${toErrorMessage(error)}`,
    );
  }
}

/**
 * Extension deactivation - cleanup if needed
 */
export function deactivate(): void {
  // Cleanup resources if needed
}
