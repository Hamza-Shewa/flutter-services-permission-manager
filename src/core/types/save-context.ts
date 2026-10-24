import type * as vscode from 'vscode';
import type { AndroidPermissionEntry, IOSPermissionEntry, ServiceEntry, ServiceConfig, AppNameLocalization } from './index.js';

export interface AndroidSaveContext {
  manifestUri?: vscode.Uri;
  /** Writer entries; plain names keep the existing attributes of an element. */
  permissions: Array<AndroidPermissionEntry | string>;
  services?: ServiceEntry[];
}

export interface IOSSaveContext {
  plistUri?: vscode.Uri;
  permissions: IOSPermissionEntry[];
  podfileUri?: vscode.Uri;
  appDelegateUri?: vscode.Uri;
  entitlementsUri?: vscode.Uri;
  services?: ServiceEntry[];
}

export interface MacOSSaveContext {
  plistUri?: vscode.Uri;
  permissions: IOSPermissionEntry[];
}

export interface SaveContext {
  android?: AndroidSaveContext;
  ios?: IOSSaveContext;
  macos?: MacOSSaveContext;
  appName?: AppNameLocalization;
  servicesConfig?: ServiceConfig[];
  previousServices?: ServiceEntry[];
  categorizedIosPermissions?: Record<string, { permission: string; podfileMacro?: string }[]>;
}
