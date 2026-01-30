/**
 * Workspace file discovery service
 * Centralizes all VS Code workspace file finding operations
 */

import * as vscode from "vscode";
import { FILE_PATTERNS, MAX_SEARCH_RESULTS } from "../constants/index.js";

/** Discovered project files */
export interface ProjectFiles {
  androidManifestUri?: vscode.Uri;
  androidStringsUri?: vscode.Uri;
  iosPlistUri?: vscode.Uri;
  iosPodfileUri?: vscode.Uri;
  iosAppDelegateUri?: vscode.Uri;
  macosPlistUri?: vscode.Uri;
}

/** Project files with loaded content */
export interface ProjectFilesWithContent extends ProjectFiles {
  androidManifestContent?: string;
  iosPlistContent?: string;
  macosPlistContent?: string;
}

/**
 * Discovers all relevant project files in the workspace
 */
export async function discoverProjectFiles(): Promise<ProjectFiles> {
  const [
    androidManifestUris,
    iosPlistUris,
    iosPodfileUris,
    iosAppDelegateUris,
    macosPlistUris,
  ] = await Promise.all([
    vscode.workspace.findFiles(
      FILE_PATTERNS.ANDROID_MANIFEST,
      undefined,
      MAX_SEARCH_RESULTS,
    ),
    vscode.workspace.findFiles(
      FILE_PATTERNS.IOS_PLIST,
      undefined,
      MAX_SEARCH_RESULTS,
    ),
    vscode.workspace.findFiles(
      FILE_PATTERNS.IOS_PODFILE,
      undefined,
      MAX_SEARCH_RESULTS,
    ),
    vscode.workspace.findFiles(
      FILE_PATTERNS.IOS_APPDELEGATE,
      undefined,
      MAX_SEARCH_RESULTS,
    ),
    vscode.workspace.findFiles(
      FILE_PATTERNS.MACOS_PLIST,
      undefined,
      MAX_SEARCH_RESULTS,
    ),
  ]);

  return {
    androidManifestUri: androidManifestUris[0],
    iosPlistUri: iosPlistUris[0],
    iosPodfileUri: iosPodfileUris[0],
    iosAppDelegateUri: iosAppDelegateUris[0],
    macosPlistUri: macosPlistUris[0],
  };
}

/**
 * Discovers project files and loads their content
 */
export async function discoverProjectFilesWithContent(): Promise<ProjectFilesWithContent> {
  const files = await discoverProjectFiles();

  const [androidDoc, iosDoc, macosDoc] = await Promise.all([
    files.androidManifestUri
      ? vscode.workspace.openTextDocument(files.androidManifestUri)
      : Promise.resolve(null),
    files.iosPlistUri
      ? vscode.workspace.openTextDocument(files.iosPlistUri)
      : Promise.resolve(null),
    files.macosPlistUri
      ? vscode.workspace.openTextDocument(files.macosPlistUri)
      : Promise.resolve(null),
  ]);

  return {
    ...files,
    androidManifestContent: androidDoc?.getText(),
    iosPlistContent: iosDoc?.getText(),
    macosPlistContent: macosDoc?.getText(),
  };
}

/**
 * Reads content from a file URI
 */
export async function readFileContent(
  uri: vscode.Uri | undefined,
): Promise<string | undefined> {
  if (!uri) {
    return undefined;
  }

  try {
    const doc = await vscode.workspace.openTextDocument(uri);
    return doc.getText();
  } catch {
    return undefined;
  }
}

/**
 * Checks if project has Android support
 */
export function hasAndroidSupport(files: ProjectFiles): boolean {
  return !!files.androidManifestUri;
}

/**
 * Checks if project has iOS support
 */
export function hasIOSSupport(files: ProjectFiles): boolean {
  return !!files.iosPlistUri;
}

/**
 * Checks if project has macOS support
 */
export function hasMacOSSupport(files: ProjectFiles): boolean {
  return !!files.macosPlistUri;
}

/**
 * Checks if project has Podfile
 */
export function hasPodfile(files: ProjectFiles): boolean {
  return !!files.iosPodfileUri;
}
