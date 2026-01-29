/**
 * iOS Info.plist parsing and updating service
 */

import type { IOSPermissionEntry } from '../types/index.js';

/**
 * Updates Info.plist content with new permission entries
 * Preserves existing structure and closing tags
 */
export function updateIOSPlist(plistContent: string, permissionEntries: IOSPermissionEntry[]): string {
    const uniqueEntries = new Map<string, IOSPermissionEntry>();
    permissionEntries
        .filter(entry => entry.permission?.trim())
        .forEach(entry => uniqueEntries.set(entry.permission.trim(), entry));

    const existingStringPairs = new Map<string, string>();
    const existingBooleanPairs = new Map<string, boolean>();
    const stringRegex = /\s*<key>(NS[^<]*)<\/key>\s*<string>([^<]*)<\/string>\s*/g;
    const boolRegex = /\s*<key>(NS[^<]*)<\/key>\s*<(true|false)\/>\s*/g;

    // Work only on the content before the final </dict> so we never drop closing tags
    const dictCloseIndex = plistContent.lastIndexOf('</dict>');
    if (dictCloseIndex === -1) {
        return plistContent;
    }

    const prefix = plistContent.slice(0, dictCloseIndex);
    const suffix = plistContent.slice(dictCloseIndex); // contains </dict></plist>

    let match;
    while ((match = stringRegex.exec(prefix)) !== null) {
        existingStringPairs.set(match[1], match[2]);
    }
    while ((match = boolRegex.exec(prefix)) !== null) {
        existingBooleanPairs.set(match[1], match[2] === 'true');
    }

    const cleanedPrefix = prefix.replace(stringRegex, '').replace(boolRegex, '');

    const entries = Array.from(uniqueEntries.values())
        .map(entry => {
            const type = entry.type?.toLowerCase();
            if (type === 'boolean') {
                const value = entry.value ?? existingBooleanPairs.get(entry.permission) ?? false;
                return `\t<key>${entry.permission}</key>\n\t<${value ? 'true' : 'false'}/>`;
            }
            const value = typeof entry.value === 'string' && entry.value.trim().length > 0
                ? entry.value
                : existingStringPairs.get(entry.permission) ?? 'TODO: Provide usage description.';
            return `\t<key>${entry.permission}</key>\n\t<string>${value}</string>`;
        })
        .join('\n');

    if (!entries) {
        return normalizePlistSpacing(cleanedPrefix + suffix);
    }

    const merged = `${cleanedPrefix}\n${entries}\n${suffix}`;
    return normalizePlistSpacing(merged);
}

/**
 * Normalizes whitespace in plist content for consistent formatting
 */
export function normalizePlistSpacing(plistContent: string): string {
    let normalized = plistContent;
    normalized = normalized.replace(/(<true\/>|<false\/>)\s*<key>/g, '$1\n\t<key>');
    normalized = normalized.replace(/<\/string>\s*<key>/g, '</string>\n\t<key>');
    normalized = normalized.replace(/\n{2,}/g, '\n');
    return normalized;
}
