/**
 * Webview panel creation and message handling
 */

import * as vscode from 'vscode';
import type { AndroidPermission, IOSPermission, IOSPermissionEntry, PermissionsPayload, WebviewMessage, ServiceEntry, ServiceConfig } from '../types/index.js';
import { getUsedAndroidPermissions, getUsedIOSPermissions, getAndroidPermissions, getIOSPermissions, getCategorizedIOSPermissions } from '../utils/extractors.js';
import { savePermissions, extractServices } from '../services/index.js';
import { getWebviewContent } from './content.js';
import { readJsonFile } from '../utils/file.js';

// Cached categorized iOS permissions for Podfile updates
let categorizedIosPermissionsCache: Record<string, { permission: string; podfileMacro?: string }[]> | null = null;

// Cached services config
let servicesConfigCache: { services: ServiceConfig[] } | null = null;

// Track previously saved services to detect removals
let previousServicesCache: ServiceEntry[] = [];

/**
 * Creates and manages the Permission Manager webview panel
 */
export async function createPermissionPanel(
    extensionUri: vscode.Uri,
    androidPermissions: AndroidPermission[],
    iosPermissions: IOSPermission[],
    androidManifestUri?: vscode.Uri,
    iosPlistUri?: vscode.Uri,
    iosPodfileUri?: vscode.Uri,
    iosAppDelegateUri?: vscode.Uri
): Promise<vscode.WebviewPanel> {
    const panel = vscode.window.createWebviewPanel(
        'permissionManager',
        'Permission Manager',
        vscode.ViewColumn.One,
        {
            enableScripts: true,
            localResourceRoots: [vscode.Uri.joinPath(extensionUri, 'src')],
            retainContextWhenHidden: true  // Keep webview state when tab is hidden
        }
    );

    panel.webview.html = await getWebviewContent(panel.webview, extensionUri);

    // Cache categorized permissions for Podfile updates
    categorizedIosPermissionsCache = await getCategorizedIOSPermissions();
    
    // Load services config
    servicesConfigCache = await readJsonFile<{ services: ServiceConfig[] }>('services-config.json');

    // Extract existing services from manifest/plist/appdelegate
    const existingServices = await extractServices(
        androidManifestUri,
        iosPlistUri,
        iosAppDelegateUri,
        servicesConfigCache?.services || []
    );
    
    // Cache the initial services for tracking removals
    previousServicesCache = [...existingServices];

    const payload: PermissionsPayload = {
        type: 'permissions',
        androidPermissions,
        iosPermissions,
        hasAndroidManifest: !!androidManifestUri,
        hasIOSPlist: !!iosPlistUri,
        hasPodfile: !!iosPodfileUri,
        services: existingServices,
        availableServices: servicesConfigCache?.services || []
    };

    setupMessageHandler(panel, payload, androidManifestUri, iosPlistUri, iosPodfileUri, iosAppDelegateUri);
    
    // Refresh data when panel becomes visible again
    panel.onDidChangeViewState(async (e) => {
        if (e.webviewPanel.visible) {
            await handleRefresh(panel, androidManifestUri, iosPlistUri, iosPodfileUri, iosAppDelegateUri);
        }
    });
    
    // Send initial payload
    panel.webview.postMessage(payload);

    return panel;
}

export async function initializePermissionWebviewView(
    webviewView: vscode.WebviewView,
    extensionUri: vscode.Uri,
    androidPermissions: AndroidPermission[],
    iosPermissions: IOSPermission[],
    androidManifestUri?: vscode.Uri,
    iosPlistUri?: vscode.Uri,
    iosPodfileUri?: vscode.Uri,
    iosAppDelegateUri?: vscode.Uri
): Promise<void> {
    webviewView.webview.options = {
        enableScripts: true,
        localResourceRoots: [vscode.Uri.joinPath(extensionUri, 'src')],
    };

    webviewView.webview.html = await getWebviewContent(webviewView.webview, extensionUri);

    // Cache categorized permissions for Podfile updates
    categorizedIosPermissionsCache = await getCategorizedIOSPermissions();
    
    // Load services config
    servicesConfigCache = await readJsonFile<{ services: ServiceConfig[] }>('services-config.json');

    // Extract existing services from manifest/plist/appdelegate
    const existingServices = await extractServices(
        androidManifestUri,
        iosPlistUri,
        iosAppDelegateUri,
        servicesConfigCache?.services || []
    );
    
    // Cache the initial services for tracking removals
    previousServicesCache = [...existingServices];

    const payload: PermissionsPayload = {
        type: 'permissions',
        androidPermissions,
        iosPermissions,
        hasAndroidManifest: !!androidManifestUri,
        hasIOSPlist: !!iosPlistUri,
        hasPodfile: !!iosPodfileUri,
        services: existingServices,
        availableServices: servicesConfigCache?.services || []
    };

    // Create a panel-like shim so existing handlers can be reused
    const panelLike = { webview: webviewView.webview } as unknown as vscode.WebviewPanel;

    setupMessageHandler(panelLike, payload, androidManifestUri, iosPlistUri, iosPodfileUri, iosAppDelegateUri);
    
    // Refresh data when the sidebar becomes visible
    webviewView.onDidChangeVisibility(async () => {
        if (webviewView.visible) {
            await handleRefresh(panelLike, androidManifestUri, iosPlistUri, iosPodfileUri, iosAppDelegateUri);
        }
    });
    
    // Send initial payload
    webviewView.webview.postMessage(payload);
}

/**
 * Sets up the message handler for webview communication
 */
function setupMessageHandler(
    panel: vscode.WebviewPanel,
    initialPayload: PermissionsPayload,
    androidManifestUri?: vscode.Uri,
    iosPlistUri?: vscode.Uri,
    iosPodfileUri?: vscode.Uri,
    iosAppDelegateUri?: vscode.Uri
): void {
    panel.webview.onDidReceiveMessage(async (message: WebviewMessage) => {
        switch (message.type) {
            case 'ready':
                panel.webview.postMessage(initialPayload);
                break;

            case 'refresh':
                await handleRefresh(panel, androidManifestUri, iosPlistUri, iosPodfileUri, iosAppDelegateUri);
                break;

            case 'requestAllAndroidPermissions':
                await handleRequestAllAndroid(panel);
                break;

            case 'requestAllIOSPermissions':
                await handleRequestAllIOS(panel);
                break;

            case 'requestServices':
                handleRequestServices(panel);
                break;

            case 'savePermissions':
                await handleSave(panel, message, androidManifestUri, iosPlistUri, iosPodfileUri, iosAppDelegateUri);
                break;
        }
    });
}

async function handleRefresh(
    panel: vscode.WebviewPanel,
    androidManifestUri?: vscode.Uri,
    iosPlistUri?: vscode.Uri,
    iosPodfileUri?: vscode.Uri,
    iosAppDelegateUri?: vscode.Uri
): Promise<void> {
    const androidDoc = androidManifestUri
        ? await vscode.workspace.openTextDocument(androidManifestUri)
        : null;
    const iosDoc = iosPlistUri
        ? await vscode.workspace.openTextDocument(iosPlistUri)
        : null;

    const usedAndroidPermissions = await getUsedAndroidPermissions(androidDoc?.getText() || '');
    const usedIOSPermissions = await getUsedIOSPermissions(iosDoc?.getText() || '');

    // Extract existing services
    const existingServices = await extractServices(
        androidManifestUri,
        iosPlistUri,
        iosAppDelegateUri,
        servicesConfigCache?.services || []
    );
    
    // Update the cache on refresh
    previousServicesCache = [...existingServices];

    panel.webview.postMessage({
        type: 'permissions',
        androidPermissions: usedAndroidPermissions,
        iosPermissions: usedIOSPermissions,
        hasAndroidManifest: !!androidManifestUri,
        hasIOSPlist: !!iosPlistUri,
        hasPodfile: !!iosPodfileUri,
        services: existingServices,
        availableServices: servicesConfigCache?.services || []
    });
}

async function handleRequestAllAndroid(panel: vscode.WebviewPanel): Promise<void> {
    const allAndroidPermissions = await getAndroidPermissions();
    panel.webview.postMessage({
        type: 'allAndroidPermissions',
        permissions: allAndroidPermissions
    });
}

async function handleRequestAllIOS(panel: vscode.WebviewPanel): Promise<void> {
    const allIOSPermissions = await getIOSPermissions();
    panel.webview.postMessage({
        type: 'allIOSPermissions',
        permissions: allIOSPermissions
    });
}

function handleRequestServices(panel: vscode.WebviewPanel): void {
    panel.webview.postMessage({
        type: 'servicesConfig',
        services: servicesConfigCache?.services || []
    });
}

async function handleSave(
    panel: vscode.WebviewPanel,
    message: { androidPermissions: string[]; iosPermissions: IOSPermissionEntry[]; services?: ServiceEntry[] },
    androidManifestUri?: vscode.Uri,
    iosPlistUri?: vscode.Uri,
    iosPodfileUri?: vscode.Uri,
    iosAppDelegateUri?: vscode.Uri
): Promise<void> {
    const androidList = Array.isArray(message.androidPermissions) ? message.androidPermissions : [];
    const iosList = Array.isArray(message.iosPermissions) ? message.iosPermissions : [];
    const servicesList = Array.isArray(message.services) ? message.services : [];
    
    const result = await savePermissions(
        androidList, 
        iosList, 
        androidManifestUri, 
        iosPlistUri, 
        iosPodfileUri,
        iosAppDelegateUri,
        categorizedIosPermissionsCache || undefined,
        servicesList,
        servicesConfigCache?.services || [],
        previousServicesCache
    );
    
    // Update the previous services cache after successful save
    if (result.success) {
        previousServicesCache = [...servicesList];
    }
    
    panel.webview.postMessage({ type: 'saveResult', ...result });
}
