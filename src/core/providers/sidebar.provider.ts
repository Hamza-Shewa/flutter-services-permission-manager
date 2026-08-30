/**
 * Flutter Config Manager Sidebar View Provider
 * Handles the webview in VS Code's sidebar
 */

import * as vscode from "vscode";
import { discoverProjectFilesWithContent } from "../workspace.service.js";
import {
  getUsedAndroidPermissions,
  getUsedIOSPermissions,
} from "../../features/permissions/extractor.js";
import { initializePermissionWebview } from "../../webview/initializer.js";

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
      localResourceRoots: [
        vscode.Uri.joinPath(this._extensionUri, "src"),
        vscode.Uri.joinPath(this._extensionUri, "images"),
      ],
    };

    try {
      await this.initializeView(webviewView);
    } catch (error) {
      console.error("[FlutterConfigSidebar] Error initializing sidebar view:", error);
      webviewView.webview.html = `<!DOCTYPE html>
        <html><body style="color: #e0e0e0; padding: 16px; font-family: sans-serif;">
          <h3>⚠️ Error loading Flutter Config Manager</h3>
          <p>${error instanceof Error ? error.message : String(error)}</p>
          <p>Try reopening the sidebar or running the command from the palette.</p>
        </body></html>`;
    }
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
