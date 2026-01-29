/**
 * Webview initialization
 * Shared initialization logic for both Panel and View
 */

import * as vscode from 'vscode';
import type { AndroidPermission, IOSPermission, PermissionsPayload, WebviewMessage, ServicesConfigFile } from '../types/index.js';
import { getCategorizedIOSPermissions } from '../utils/extractors.js';
import { extractServices } from '../services/index.js';
import { getWebviewContent } from './content.js';
import { readJsonFile } from '../utils/file.js';
import type { ProjectFiles } from '../services/workspace.js';
import {
    setCategorizedIosPermissionsCache,
    setServicesConfigCache,
    setPreviousServicesCache,
    getServicesConfigCache
} from './state.js';
import {
    handleRefresh,
    handleRequestAllAndroid,
    handleRequestAllIOS,
    handleRequestServices,
    handleSave,
    type WebviewRef
} from './handlers/index.js';

/** Target type for webview initialization */
export type WebviewTarget =
    | { type: 'panel'; panel: vscode.WebviewPanel }
    | { type: 'view'; view: vscode.WebviewView };

/**
 * Initialize a webview (Panel or View) with Flutter config manager content
 */
export async function initializePermissionWebview(
    target: WebviewTarget,
    extensionUri: vscode.Uri,
    androidPermissions: AndroidPermission[],
    iosPermissions: IOSPermission[],
    files: ProjectFiles
): Promise<void> {
    const webview = target.type === 'panel' ? target.panel.webview : target.view.webview;

    // Set webview HTML content
    webview.html = await getWebviewContent(webview, extensionUri);

    // Load and cache data
    const [categorizedPermissions, servicesConfigFile] = await Promise.all([
        getCategorizedIOSPermissions(),
        readJsonFile<ServicesConfigFile>('services-config.json')
    ]);

    setCategorizedIosPermissionsCache(categorizedPermissions);
    setServicesConfigCache(servicesConfigFile?.services ?? null);

    // Extract existing services
    const existingServices = await extractServices(
        files.androidManifestUri,
        files.iosPlistUri,
        files.iosAppDelegateUri,
        servicesConfigFile?.services ?? []
    );

    setPreviousServicesCache(existingServices);

    // Build initial payload
    const payload: PermissionsPayload = {
        type: 'permissions',
        androidPermissions,
        iosPermissions,
        hasAndroidManifest: !!files.androidManifestUri,
        hasIOSPlist: !!files.iosPlistUri,
        hasPodfile: !!files.iosPodfileUri,
        services: existingServices,
        availableServices: servicesConfigFile?.services ?? []
    };

    // Set up message handler
    const ref: WebviewRef = { webview };
    setupMessageHandler(ref, payload, files);

    // Set up visibility change handler
    if (target.type === 'panel') {
        target.panel.onDidChangeViewState(async (e) => {
            if (e.webviewPanel.visible) {
                await handleRefresh(ref, files);
            }
        });
    } else {
        target.view.onDidChangeVisibility(async () => {
            if (target.view.visible) {
                await handleRefresh(ref, files);
            }
        });
    }

    // Send initial payload
    webview.postMessage(payload);
}

/**
 * Sets up the message handler for webview communication
 */
function setupMessageHandler(
    ref: WebviewRef,
    initialPayload: PermissionsPayload,
    files: ProjectFiles
): void {
    ref.webview.onDidReceiveMessage(async (message: WebviewMessage) => {
        switch (message.type) {
            case 'ready':
                ref.webview.postMessage(initialPayload);
                break;

            case 'refresh':
                await handleRefresh(ref, files);
                break;

            case 'requestAllAndroidPermissions':
                await handleRequestAllAndroid(ref);
                break;

            case 'requestAllIOSPermissions':
                await handleRequestAllIOS(ref);
                break;

            case 'requestServices':
                handleRequestServices(ref);
                break;

            case 'savePermissions':
                await handleSave(
                    ref,
                    message.androidPermissions ?? [],
                    message.iosPermissions ?? [],
                    message.services ?? [],
                    files
                );
                break;
        }
    });
}
