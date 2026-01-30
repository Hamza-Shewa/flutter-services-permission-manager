/**
 * Flutter Config Manager Sidebar View Provider
 * Handles the webview in VS Code's sidebar
 */

import * as vscode from "vscode";
import { discoverProjectFilesWithContent } from "../services/workspace.js";
import {
  getUsedAndroidPermissions,
  getUsedIOSPermissions,
} from "../utils/extractors.js";
import { initializePermissionWebview } from "../webview/initializer.js";

export class FlutterConfigSidebarProvider
  implements vscode.WebviewViewProvider
{
  public static readonly viewType = "flutterConfigView";

  private _view?: vscode.WebviewView;

  constructor(private readonly _extensionUri: vscode.Uri) {}

  public async resolveWebviewView(
    webviewView: vscode.WebviewView,
    _context: vscode.WebviewViewResolveContext,
    _token: vscode.CancellationToken,
  ): Promise<void> {
    this._view = webviewView;

    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [vscode.Uri.joinPath(this._extensionUri, "src")],
    };

    await this.initializeView(webviewView);
  }

  private async initializeView(webviewView: vscode.WebviewView): Promise<void> {
    const files = await discoverProjectFilesWithContent();

    const [usedAndroidPermissions, usedIOSPermissions, usedMacOSPermissions] =
      await Promise.all([
        getUsedAndroidPermissions(files.androidManifestContent ?? ""),
        getUsedIOSPermissions(files.iosPlistContent ?? ""),
        getUsedIOSPermissions(files.macosPlistContent ?? ""),
      ]);

    await initializePermissionWebview(
      { type: "view", view: webviewView },
      this._extensionUri,
      usedAndroidPermissions,
      usedIOSPermissions,
      usedMacOSPermissions,
      files,
    );
  }

  public getView(): vscode.WebviewView | undefined {
    return this._view;
  }
}
