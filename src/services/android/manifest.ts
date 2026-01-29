/**
 * Android manifest permission operations
 */

import { ANDROID_PERMISSION_PREFIX } from '../../constants/index.js';

/**
 * Normalizes permission names to full Android format
 */
export function normalizePermissionNames(permissionNames: string[]): string[] {
    const seen = new Set<string>();
    const result: string[] = [];

    for (const entry of permissionNames) {
        const trimmed = entry?.trim();
        if (!trimmed) {
            continue;
        }
        const normalized = trimmed.startsWith(ANDROID_PERMISSION_PREFIX)
            ? trimmed
            : `${ANDROID_PERMISSION_PREFIX}${trimmed}`;

        if (!seen.has(normalized)) {
            seen.add(normalized);
            result.push(normalized);
        }
    }
    return result;
}

/**
 * Updates AndroidManifest.xml content with new permissions
 * Preserves existing structure including <queries> blocks
 */
export function updateAndroidManifest(manifestContent: string, permissionNames: string[]): string {
    const normalized = normalizePermissionNames(permissionNames);
    const usesPermissionsXml = normalized
        .map(permission => `    <uses-permission android:name="${permission}" />`)
        .join('\n');

    // Extract and preserve <queries> block before cleaning
    const queriesMatch = manifestContent.match(/(\s*<queries>[\s\S]*?<\/queries>\s*)/);

    // Remove all uses-permission tags with their surrounding whitespace
    let cleaned = manifestContent.replace(
        /[ \t]*<uses-permission\b[^>]*android:name="[^"]+"[^>]*\/?>(?:\s*<\/uses-permission>)?[ \t]*\r?\n?/g,
        ''
    );

    // Clean up multiple consecutive blank lines
    cleaned = cleaned.replace(/\n{3,}/g, '\n\n');

    const manifestMatch = cleaned.match(/<manifest[^>]*>/);
    if (!manifestMatch) {
        return manifestContent;
    }

    const insertIndex = manifestMatch.index! + manifestMatch[0].length;
    const prefix = cleaned.slice(0, insertIndex);
    let suffix = cleaned.slice(insertIndex);

    // Trim leading whitespace from suffix but keep one newline
    suffix = suffix.replace(/^\n+/, '\n');

    // Restore <queries> block if it was accidentally removed
    if (queriesMatch && !suffix.includes('<queries>')) {
        const manifestCloseIndex = suffix.lastIndexOf('</manifest>');
        if (manifestCloseIndex !== -1) {
            suffix = suffix.slice(0, manifestCloseIndex) + queriesMatch[1] + suffix.slice(manifestCloseIndex);
        } else {
            suffix = `${suffix}${queriesMatch[1]}`;
        }
    }

    if (!usesPermissionsXml) {
        return `${prefix}${suffix}`;
    }

    const insertBlock = `\n${usesPermissionsXml}`;
    return `${prefix}${insertBlock}${suffix}`;
}
