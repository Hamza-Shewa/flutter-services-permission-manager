import * as vscode from 'vscode';
import type { WebviewRef } from './index.js';
import { toErrorMessage } from '../../core/shared/index.js';
import { generateSourcePreview, type ImageComposeOptions } from '../../core/shared/image-compose.js';
import { detectSplashSourceKind, generateSplash, getCurrentSplashPreviews } from '../../features/splash/splash.service.js';
import type { SplashPlatformTarget } from '../../features/splash/types.js';
import { type ProjectFiles } from '../../core/workspace.service.js';

/**
 * Reads whatever splash files already exist for this project, as-is, so the
 * webview can show a "current splash" baseline next to the live preview of a
 * newly-picked source - the user may decide not to change it.
 */
export async function handleRequestCurrentSplashPreview(ref: WebviewRef, files: ProjectFiles): Promise<void> {
    try {
        const previews = await getCurrentSplashPreviews({
            androidManifestUri: files.androidManifestUri,
            iosPlistUri: files.iosPlistUri,
        });
        ref.webview.postMessage({ type: 'currentSplashPreview', previews });
    } catch (error) {
        console.warn('Current splash preview read failed:', toErrorMessage(error));
    }
}

/**
 * Opens a native file picker restricted to PNG/JPEG/SVG images and sends the
 * webview one downscaled copy of the pick; the phone mockup is drawn in the
 * webview itself, so adjusting the controls never round-trips here.
 */
export async function handleBrowseSplashSource(ref: WebviewRef): Promise<void> {
    try {
        const picked = await vscode.window.showOpenDialog({
            canSelectMany: false,
            openLabel: 'Use as splash source',
            filters: { 'Images': ['png', 'jpg', 'jpeg', 'svg'] },
        });
        const file = picked?.[0];
        if (!file) {
            return;
        }
        const kind = detectSplashSourceKind(file.fsPath);
        if (!kind) {
            ref.webview.postMessage({ type: 'saveResult', success: false, message: 'Unsupported file type. Choose a PNG, JPEG, or SVG image.' });
            return;
        }
        const preview = await generateSourcePreview(file.fsPath);
        ref.webview.postMessage({
            type: 'splashSourceSelected',
            path: file.fsPath,
            fileName: file.fsPath.split(/[\\/]/).pop() ?? file.fsPath,
            kind,
            preview,
        });
    } catch (error) {
        ref.webview.postMessage({ type: 'saveResult', success: false, message: `Failed to load the source image: ${toErrorMessage(error)}` });
    }
}

/**
 * Renders the previously-selected source image into the splash screen files
 * for the requested platform(s) and reports the result.
 */
export async function handleGenerateSplash(
    ref: WebviewRef,
    payload: { sourcePath: string; platforms: SplashPlatformTarget; logoSize?: number } & ImageComposeOptions,
    files: ProjectFiles,
): Promise<void> {
    ref.webview.postMessage({ type: 'splashGenerating', generating: true });
    try {
        const result = await generateSplash({
            sourcePath: payload.sourcePath,
            platforms: payload.platforms,
            androidManifestUri: files.androidManifestUri,
            iosPlistUri: files.iosPlistUri,
            scalePercent: payload.scalePercent,
            backgroundColor: payload.backgroundColor,
            trimMargins: payload.trimMargins,
            logoSize: payload.logoSize,
        });
        ref.webview.postMessage({ type: 'splashGenerated', result });
        if (result.success) {
            // The splash just written is now the "current" one - refresh that baseline preview too.
            await handleRequestCurrentSplashPreview(ref, files);
        }
    } catch (error) {
        ref.webview.postMessage({
            type: 'splashGenerated',
            result: { success: false, message: `Failed to generate splash screen: ${toErrorMessage(error)}`, androidFiles: [], iosFiles: [] },
        });
    }
}
