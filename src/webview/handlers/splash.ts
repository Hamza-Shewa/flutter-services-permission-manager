import * as vscode from 'vscode';
import type { WebviewRef } from './index.js';
import { toErrorMessage } from '../../core/shared/index.js';
import { detectSplashSourceKind, generateSplashPreview, generateSplash, getCurrentSplashPreviews } from '../../features/splash/splash.service.js';
import type { SplashPlatformTarget } from '../../features/splash/types.js';
import type { ImageComposeOptions } from '../../core/shared/image-compose.js';
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
 * Opens a native file picker restricted to PNG/JPEG/SVG images and reports
 * the selection back to the webview so it can be confirmed before generating.
 * Renders the initial preview using whatever scale/background the webview
 * already has set, so switching source images doesn't reset those controls.
 */
export async function handleBrowseSplashSource(ref: WebviewRef, compose: ImageComposeOptions): Promise<void> {
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
        let preview: { dataUrl: string; width: number; height: number } | undefined;
        try {
            preview = await generateSplashPreview(file.fsPath, compose);
        } catch (previewError) {
            console.warn('Splash preview render failed:', toErrorMessage(previewError));
        }
        ref.webview.postMessage({
            type: 'splashSourceSelected',
            path: file.fsPath,
            fileName: file.fsPath.split(/[\\/]/).pop() ?? file.fsPath,
            kind,
            previewDataUrl: preview?.dataUrl,
        });
    } catch (error) {
        ref.webview.postMessage({ type: 'saveResult', success: false, message: `Failed to open file picker: ${toErrorMessage(error)}` });
    }
}

/**
 * Re-renders the preview for the already-selected source with a new
 * scale/background, without touching any files - used while the user drags
 * the resize slider or changes the background color.
 */
export async function handleRequestSplashPreview(
    ref: WebviewRef,
    payload: { sourcePath: string } & ImageComposeOptions,
): Promise<void> {
    try {
        const preview = await generateSplashPreview(payload.sourcePath, payload);
        ref.webview.postMessage({ type: 'splashPreviewUpdated', previewDataUrl: preview.dataUrl });
    } catch (error) {
        console.warn('Splash preview render failed:', toErrorMessage(error));
    }
}

/**
 * Renders the previously-selected source image into the splash screen files
 * for the requested platform(s) and reports the result.
 */
export async function handleGenerateSplash(
    ref: WebviewRef,
    payload: { sourcePath: string; platforms: SplashPlatformTarget } & ImageComposeOptions,
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
