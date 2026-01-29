/**
 * Webview HTML content loading and template processing
 */

import * as vscode from 'vscode';

/**
 * Loads and processes the webview HTML content with proper URIs
 */
export async function getWebviewContent(
    webview: vscode.Webview,
    extensionUri: vscode.Uri
): Promise<string> {
    const htmlPath = vscode.Uri.joinPath(extensionUri, 'src', 'permission-manager.html');
    const rawData = await vscode.workspace.fs.readFile(htmlPath);
    const html = rawData.toString();

    const scriptUri = webview.asWebviewUri(
        vscode.Uri.joinPath(extensionUri, 'src', 'webview.js')
    );
    const utilsUri = webview.asWebviewUri(
        vscode.Uri.joinPath(extensionUri, 'src', 'webview-utils.js')
    );
    const cspSource = webview.cspSource;

    return html
        .replace(/\{\{cspSource\}\}/g, cspSource)
        .replace(/\{\{scriptUri\}\}/g, scriptUri.toString())
        .replace(/\{\{utilsUri\}\}/g, utilsUri.toString());
}
