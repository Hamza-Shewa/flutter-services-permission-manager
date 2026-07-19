import * as vscode from 'vscode';
import type { WebviewMessage } from '../types/webview.js';
import { logger } from '../shared/index.js';

type Handler<T extends WebviewMessage> = (msg: T) => Promise<void> | void;

export class MessageBus {
  private readonly _handlers = new Map<string, Handler<WebviewMessage>>();

  constructor(private readonly webview: vscode.Webview) {
    this.webview.onDidReceiveMessage(this.dispatch.bind(this));
  }

  register<T extends WebviewMessage['type']>(
    type: T,
    handler: Handler<Extract<WebviewMessage, { type: T }>>
  ): this {
    this._handlers.set(type, handler as Handler<WebviewMessage>);
    return this;
  }

  private async dispatch(message: unknown): Promise<void> {
    if (!this._isValid(message)) {
      logger.warn('Invalid webview message', { message });
      return;
    }
    const handler = this._handlers.get(message.type);
    if (!handler) {
      logger.warn('Unhandled webview message type', { type: message.type });
      return;
    }
    try {
      await handler(message);
    } catch (e) {
      logger.error('Handler threw', e instanceof Error ? e : new Error(String(e)));
    }
  }

  private _isValid(msg: unknown): msg is WebviewMessage {
    return typeof msg === 'object' && msg !== null &&
           typeof (msg as Record<string, unknown>).type === 'string';
  }
}
