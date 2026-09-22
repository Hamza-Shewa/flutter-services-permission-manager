import * as vscode from 'vscode';
import type { WebviewRef } from './index.js';
import { toErrorMessage } from '../../core/shared/index.js';
import { generateSourcePreview } from '../../core/shared/image-compose.js';
import { detectIconSourceKind, generateIcons, getCurrentIconPreviews } from '../../features/icons/icons.service.js';
import type { AndroidIconFamilySelection, IconComposeOptions, IconPlatformTarget } from '../../features/icons/types.js';
import { readFileContent, type ProjectFiles } from '../../core/workspace.service.js';

/**
 * Reads whatever launcher/AppIcon files already exist for this project, as-is,
 * so the webview can show a "current icons" baseline next to the live
 * preview of a newly-picked source - the user may decide not to change it.
 */
export async function handleRequestCurrentIconPreview(ref: WebviewRef, files: ProjectFiles): Promise<void> {
    try {
        const androidManifestContent = await readFileContent(files.androidManifestUri);
        const previews = await getCurrentIconPreviews({
            androidManifestUri: files.androidManifestUri,
            androidManifestContent,
            iosPlistUri: files.iosPlistUri,
        });
        ref.webview.postMessage({ type: 'currentIconPreview', previews });
    } catch (error) {
        console.warn('Current icon preview read failed:', toErrorMessage(error));
    }
}

/**
 * Opens a native file picker restricted to PNG/JPEG/SVG images and sends the
 * webview one downscaled copy of the pick; every preview after that is drawn
 * in the webview itself, so adjusting the controls never round-trips here.
 */
export async function handleBrowseIconSource(ref: WebviewRef): Promise<void> {
    try {
        const picked = await vscode.window.showOpenDialog({
            canSelectMany: false,
            openLabel: 'Use as source icon',
            filters: { 'Images': ['png', 'jpg', 'jpeg', 'svg'] },
        });
        const file = picked?.[0];
        if (!file) {
            return;
        }
        const kind = detectIconSourceKind(file.fsPath);
        if (!kind) {
            ref.webview.postMessage({ type: 'saveResult', success: false, message: 'Unsupported file type. Choose a PNG, JPEG, or SVG image.' });
            return;
        }
        const preview = await generateSourcePreview(file.fsPath);
        ref.webview.postMessage({
            type: 'iconSourceSelected',
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
 * Renders the previously-selected source image into the launcher icon slots
 * for the requested platform(s) and reports the result.
 */
export async function handleGenerateIcons(
    ref: WebviewRef,
    payload: { sourcePath: string; platforms: IconPlatformTarget; androidFamilies?: AndroidIconFamilySelection } & IconComposeOptions,
    files: ProjectFiles,
): Promise<void> {
    ref.webview.postMessage({ type: 'iconsGenerating', generating: true });
    try {
        const androidManifestContent = await readFileContent(files.androidManifestUri);
        const result = await generateIcons({
            sourcePath: payload.sourcePath,
            platforms: payload.platforms,
            androidManifestUri: files.androidManifestUri,
            androidManifestContent,
            iosPlistUri: files.iosPlistUri,
            scalePercent: payload.scalePercent,
            backgroundColor: payload.backgroundColor,
            trimMargins: payload.trimMargins,
            androidFamilies: payload.androidFamilies,
        });
        ref.webview.postMessage({ type: 'iconsGenerated', result });
        if (result.success) {
            // The icons just written are now the "current" ones - refresh that baseline preview too.
            await handleRequestCurrentIconPreview(ref, files);
        }
    } catch (error) {
        ref.webview.postMessage({
            type: 'iconsGenerated',
            result: { success: false, message: `Failed to generate icons: ${toErrorMessage(error)}`, androidFiles: [], iosFiles: [] },
        });
    }
}
