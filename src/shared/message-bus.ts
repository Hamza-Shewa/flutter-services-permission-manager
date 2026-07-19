import * as vscode from 'vscode';
import { WebviewMessage } from '../types/index.js';

export type MessageHandler<T = any> = (message: T) => any;

export class MessageBus {
  private handlers = new Map<string, MessageHandler<any>[]>();

  constructor(private webview: vscode.Webview) {
    this.webview.onDidReceiveMessage(async (message: WebviewMessage) => {
      const handlers = this.handlers.get(message.type);
      if (handlers) {
        for (const handler of handlers) {
          try {
            await handler(message);
          } catch (err) {
            console.error(`[MessageBus] Error in handler for ${message.type}:`, err);
          }
        }
      }
    });
  }

  on(type: string, handler: MessageHandler<any>) {
    const existing = this.handlers.get(type) || [];
    existing.push(handler);
    this.handlers.set(type, existing);
    return this;
  }

  send(message: any) {
    this.webview.postMessage(message);
  }
}
