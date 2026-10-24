/**
 * Webview diagnostics: a tap on every message the extension host receives from
 * a webview, and a way to post into the most recently created webview.
 *
 * The extension's `activate` exposes this so the extension-host tests can open
 * the real panel, wait for the frontend's `ready`, feed it messages and assert
 * that no `webviewError` came back. It is not part of the user-facing API.
 */

import * as vscode from 'vscode';

const received = new vscode.EventEmitter<unknown>();
let currentWebview: vscode.Webview | undefined;

export const webviewDiagnostics = {
  /** Fires for every message a webview sends, before validation and dispatch. */
  onDidReceiveMessage: received.event,

  /** Called by the message bus for each incoming message. */
  fire(message: unknown): void {
    received.fire(message);
  },

  /** Remember the webview a message bus was attached to (the last one wins). */
  attach(webview: vscode.Webview): void {
    currentWebview = webview;
  },

  /** Post a message into the current webview; false when no webview exists. */
  async post(message: unknown): Promise<boolean> {
    if (!currentWebview) {
      return false;
    }
    return currentWebview.postMessage(message);
  },
};

/** What `activate` returns; stable for the tests, not a public contract. */
export interface FlutterConfigManagerApi {
  onDidReceiveWebviewMessage: vscode.Event<unknown>;
  postMessageToWebview(message: unknown): Promise<boolean>;
}

export function createExtensionApi(): FlutterConfigManagerApi {
  return {
    onDidReceiveWebviewMessage: webviewDiagnostics.onDidReceiveMessage,
    postMessageToWebview: (message) => webviewDiagnostics.post(message),
  };
}
