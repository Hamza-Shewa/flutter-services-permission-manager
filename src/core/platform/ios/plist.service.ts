/**
 * iOS Info.plist parsing and updating service
 */

import type { IOSPermissionEntry, ServiceEntry, ServiceConfig } from '../../types/index.js';
import { detectPlistIndent } from '../../shared/plist-parser.js';
import { escapePlistText, parsePlistTopLevel, type PlistTopLevelEntry } from '../../shared/plist-entries.js';

type ArrayBounds = { openEnd: number; closeStart: number };

function findMatchingArrayBounds(xml: string, arrayStart: number): ArrayBounds | null {
    let depth = 1;
    let position = arrayStart + '<array>'.length;
    while (position < xml.length) {
        const nextOpen = xml.indexOf('<array>', position);
        const nextClose = xml.indexOf('</array>', position);
        if (nextClose === -1) {return null;}
        if (nextOpen !== -1 && nextOpen < nextClose) {
            depth++;
            position = nextOpen + '<array>'.length;
        } else if (--depth === 0) {
            return { openEnd: arrayStart + '<array>'.length, closeStart: nextClose };
        } else {
            position = nextClose + '</array>'.length;
        }
    }
    return null;
}

function stripApplinksBlock(plistContent: string): string {
    const blockRegex = /<!-- start applinks configuration -->[\s\S]*?<!-- end applinks configuration -->/gi;
    return plistContent
        .replace(blockRegex, '')
        .replace(/\s*<key>CFBundleURLTypes<\/key>\s*<array>\s*<\/array>/gi, '');
}

function escapeRegExp(value: string): string {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function plistArrayItemExists(arrayContent: string, value: unknown): boolean {
    if (typeof value === 'string') {
        return new RegExp(`<string>\\s*${escapeRegExp(value)}\\s*<\\/string>`, 'i').test(arrayContent);
    }
    if (value && typeof value === 'object') {
        return Object.entries(value).every(([key, itemValue]) => new RegExp(
            `<key>${escapeRegExp(key)}<\\/key>\\s*<string>${escapeRegExp(String(itemValue))}<\\/string>`,
            'i'
        ).test(arrayContent));
    }
    return false;
}

function serializePlistArrayItem(value: unknown, indent: string): string {
    if (typeof value === 'string') {
        return `${indent}<string>${value}</string>`;
    }
    if (value && typeof value === 'object') {
        const entries = Object.entries(value)
            .map(([key, itemValue]) => `${indent}\t<key>${key}</key>\n${indent}\t<string>${itemValue}</string>`)
            .join('\n');
        return `${indent}<dict>\n${entries}\n${indent}</dict>`;
    }
    return '';
}

/** Merge service-owned values into a shared plist array without discarding existing entries. */
function mergePlistArray(plistContent: string, key: string, values: unknown[], baseIndent: string): string {
    const escapedKey = escapeRegExp(key);
    const arrayRegex = new RegExp(`(<key>${escapedKey}<\\/key>\\s*<array>)([\\s\\S]*?)(<\\/array>)`, 'i');
    const match = plistContent.match(arrayRegex);
    const itemIndent = `${baseIndent}${baseIndent}`;

    if (match) {
        const additions = values
            .filter(value => !plistArrayItemExists(match[2], value))
            .map(value => serializePlistArrayItem(value, itemIndent))
            .filter(Boolean);
        if (additions.length === 0) {return plistContent;}
        const existing = match[2].trimEnd();
        const body = `${existing}${existing.trim() ? '\n' : ''}${additions.join('\n')}\n${baseIndent}`;
        return plistContent.replace(arrayRegex, `$1${body}$3`);
    }

    const items = values
        .map(value => serializePlistArrayItem(value, itemIndent))
        .filter(Boolean)
        .join('\n');
    if (!items) {return plistContent;}
    const entryXml = `${baseIndent}<key>${key}</key>\n${baseIndent}<array>\n${items}\n${baseIndent}</array>\n`;
    const dictEnd = plistContent.lastIndexOf('</dict>');
    return dictEnd === -1
        ? plistContent
        : plistContent.slice(0, dictEnd) + entryXml + plistContent.slice(dictEnd);
}

/** Remove only this service's values from a shared plist array. */
function removePlistArrayItems(plistContent: string, key: string, values: unknown[]): string {
    const escapedKey = escapeRegExp(key);
    const arrayRegex = new RegExp(`(<key>${escapedKey}<\\/key>\\s*<array>)([\\s\\S]*?)(<\\/array>)`, 'i');
    const match = plistContent.match(arrayRegex);
    if (!match) {return plistContent;}

    let body = match[2];
    for (const value of values) {
        if (typeof value === 'string') {
            body = body.replace(
                new RegExp(`\\s*<string>\\s*${escapeRegExp(value)}\\s*<\\/string>`, 'gi'),
                '',
            );
            continue;
        }
        if (value && typeof value === 'object') {
            const entries = Object.entries(value);
            body = body.replace(/\s*<dict>[\s\S]*?<\/dict>/gi, block => (
                entries.every(([itemKey, itemValue]) => new RegExp(
                    `<key>${escapeRegExp(itemKey)}<\\/key>\\s*<string>\\s*${escapeRegExp(String(itemValue))}\\s*<\\/string>`,
                    'i',
                ).test(block)) ? '' : block
            ));
        }
    }

    if (!/<(?:string|dict|array|data|date|integer|real|true|false)\b/i.test(body)) {
        return plistContent.replace(
            new RegExp(`\\s*<key>${escapedKey}<\\/key>\\s*<array>[\\s\\S]*?<\\/array>`, 'i'),
            '',
        );
    }
    return plistContent.replace(arrayRegex, `$1${body}$3`);
}

function upsertServiceUrlScheme(
    plistContent: string,
    serviceId: string,
    scheme: string,
    urlName: string,
    baseIndent: string,
): string {
    const markerRegex = new RegExp(
        `\\s*<!-- flutter-config-manager service:${escapeRegExp(serviceId)} url-scheme -->[\\s\\S]*?<!-- end flutter-config-manager service:${escapeRegExp(serviceId)} url-scheme -->\\s*`,
        'gi',
    );
    const cleaned = plistContent.replace(markerRegex, '');
    const entryIndent = baseIndent.repeat(2);
    const innerIndent = baseIndent.repeat(3);
    const itemIndent = baseIndent.repeat(4);
    const block = [
        `${entryIndent}<!-- flutter-config-manager service:${serviceId} url-scheme -->`,
        `${entryIndent}<dict>`,
        `${innerIndent}<key>CFBundleTypeRole</key>`,
        `${innerIndent}<string>Editor</string>`,
        `${innerIndent}<key>CFBundleURLName</key>`,
        `${innerIndent}<string>${urlName}</string>`,
        `${innerIndent}<key>CFBundleURLSchemes</key>`,
        `${innerIndent}<array>`,
        `${itemIndent}<string>${scheme}</string>`,
        `${innerIndent}</array>`,
        `${entryIndent}</dict>`,
        `${entryIndent}<!-- end flutter-config-manager service:${serviceId} url-scheme -->`,
    ].join('\n');

    const keyIndex = cleaned.indexOf('<key>CFBundleURLTypes</key>');
    if (keyIndex !== -1) {
        const arrayStart = cleaned.indexOf('<array>', keyIndex);
        const bounds = arrayStart === -1 ? null : findMatchingArrayBounds(cleaned, arrayStart);
        if (bounds) {
            const existing = cleaned.slice(bounds.openEnd, bounds.closeStart).trimEnd();
            const body = `${existing}${existing.trim() ? '\n' : ''}${block}\n${baseIndent}`;
            return cleaned.slice(0, bounds.openEnd) + body + cleaned.slice(bounds.closeStart);
        }
    }

    const dictEnd = cleaned.lastIndexOf('</dict>');
    if (dictEnd === -1) {return cleaned;}
    const urlTypes = `${baseIndent}<key>CFBundleURLTypes</key>\n${baseIndent}<array>\n${block}\n${baseIndent}</array>\n`;
    return cleaned.slice(0, dictEnd) + urlTypes + cleaned.slice(dictEnd);
}

/** Keys that look like privacy usage descriptions (managed even when not in the catalog). */
export function isUsageDescriptionKey(key: string): boolean {
    return /UsageDescription(?:Dictionary)?$/.test(key);
}

function serializePlistValue(entry: IOSPermissionEntry, existing: PlistTopLevelEntry | undefined, indent: string): string {
    const type = (entry.type ?? '').toLowerCase() || (existing?.type ?? 'string');
    const value = entry.value;
    if (type === 'boolean') {
        const bool = typeof value === 'boolean'
            ? value
            : typeof value === 'string'
                ? value.trim().toLowerCase() === 'true'
                : existing?.type === 'boolean' ? existing.value === true : false;
        return bool ? '<true/>' : '<false/>';
    }
    if (type === 'array') {
        const items = Array.isArray(value)
            ? value
            : typeof value === 'string'
                ? value.split(/\r?\n/)
                : undefined;
        if (!items) {
            return existing?.type === 'array' ? existing.rawValue : '<array/>';
        }
        const cleaned = items.map(item => String(item).trim()).filter(Boolean);
        if (cleaned.length === 0) {
            return '<array/>';
        }
        return `<array>\n${cleaned.map(item => `${indent}${indent}<string>${escapePlistText(item)}</string>`).join('\n')}\n${indent}</array>`;
    }
    if (type === 'dictionary' || type === 'dict') {
        if (!value || typeof value !== 'object' || Array.isArray(value)) {
            return existing?.type === 'dictionary' ? existing.rawValue : '<dict/>';
        }
        const pairs = Object.entries(value as Record<string, string>).filter(([key]) => key.trim());
        if (pairs.length === 0) {
            return '<dict/>';
        }
        return `<dict>\n${pairs.map(([key, item]) => `${indent}${indent}<key>${escapePlistText(key.trim())}</key>\n${indent}${indent}<string>${escapePlistText(String(item))}</string>`).join('\n')}\n${indent}</dict>`;
    }
    const text = typeof value === 'string' && value.trim().length > 0
        ? value
        : existing?.type === 'string' && typeof existing.value === 'string' && existing.value.trim()
            ? existing.value
            : 'TODO: Provide usage description.';
    return `<string>${escapePlistText(text)}</string>`;
}

/** Whether the serialized value means the same thing as what is already in the file. */
function sameValue(existing: PlistTopLevelEntry, serialized: string): boolean {
    if (existing.rawValue === serialized) {
        return true;
    }
    const parsedNew = parsePlistTopLevel(`<plist><dict><key>k</key>${serialized}</dict></plist>`)?.entries[0];
    return !!parsedNew && parsedNew.type === existing.type && existing.value !== undefined
        && JSON.stringify(parsedNew.value) === JSON.stringify(existing.value);
}

/**
 * Updates Info.plist content with permission entries, in place.
 *
 * - A key in `permissionEntries` that already exists keeps its position; only its value changes.
 * - New keys are appended before the closing root `</dict>`.
 * - A key is removed only when it is managed and missing from the list: managed means it is in
 *   `allKnownKeys` (the catalog) or it is a `*UsageDescription` key. Every other key
 *   (`NSPrincipalClass`, `NSHumanReadableCopyright`, `CFBundle*`...) is never touched.
 * - String, boolean, array (of strings) and dictionary (of strings) values are supported; an
 *   entry without a value keeps the value already in the file.
 */
export function updateIOSPlist(
    plistContent: string,
    permissionEntries: IOSPermissionEntry[],
    allKnownKeys?: Set<string>
): string {
    const uniqueEntries = new Map<string, IOSPermissionEntry>();
    permissionEntries
        .filter(entry => entry.permission?.trim())
        .forEach(entry => uniqueEntries.set(entry.permission.trim(), { ...entry, permission: entry.permission.trim() }));

    const parsed = parsePlistTopLevel(plistContent);
    if (!parsed) {
        return plistContent;
    }
    const newline = plistContent.includes('\r\n') ? '\r\n' : '\n';
    const indent = detectPlistIndent(plistContent);
    const byKey = new Map(parsed.entries.map(entry => [entry.key, entry]));

    type Edit = { start: number; end: number; text: string };
    const edits: Edit[] = [];

    for (const existing of parsed.entries) {
        const entry = uniqueEntries.get(existing.key);
        if (!entry) {
            const managed = allKnownKeys?.has(existing.key) || isUsageDescriptionKey(existing.key);
            if (managed) {
                let start = existing.keyStart;
                while (start > 0 && (plistContent[start - 1] === ' ' || plistContent[start - 1] === '\t')) {
                    start--;
                }
                let end = existing.valueEnd;
                if (plistContent[end] === '\r') {
                    end++;
                }
                if (plistContent[end] === '\n') {
                    end++;
                }
                edits.push({ start, end, text: '' });
            }
            continue;
        }
        const serialized = serializePlistValue(entry, existing, indent).replace(/\n/g, newline);
        if (!sameValue(existing, serialized)) {
            edits.push({ start: existing.valueStart, end: existing.valueEnd, text: serialized });
        }
    }

    const additions = Array.from(uniqueEntries.values())
        .filter(entry => !byKey.has(entry.permission))
        .map(entry => `${indent}<key>${entry.permission}</key>${newline}${indent}${serializePlistValue(entry, undefined, indent).replace(/\n/g, newline)}${newline}`);
    if (additions.length > 0) {
        // Insert at the start of the line holding the root </dict>.
        let insertAt = parsed.rootCloseStart;
        while (insertAt > 0 && (plistContent[insertAt - 1] === ' ' || plistContent[insertAt - 1] === '\t')) {
            insertAt--;
        }
        const atLineStart = insertAt === 0 || plistContent[insertAt - 1] === '\n';
        edits.push({ start: insertAt, end: insertAt, text: `${atLineStart ? '' : newline}${additions.join('')}` });
    }

    edits.sort((a, b) => (b.start - a.start) || (b.end - a.end));
    let result = plistContent;
    for (const edit of edits) {
        result = result.slice(0, edit.start) + edit.text + result.slice(edit.end);
    }
    return result;
}

/**
 * Normalizes whitespace in plist content for consistent formatting
 * Note: This function now does minimal changes to preserve original formatting
 */
export function normalizePlistSpacing(plistContent: string): string {
    // Only clean up excessive blank lines, preserve everything else
    return plistContent.replace(/(\r?\n){3,}/g, '$1$1');
}

/**
 * Updates Info.plist with service configurations (e.g., Facebook SDK)
 */
export function updateIOSPlistWithServices(
    plistContent: string,
    services: ServiceEntry[],
    servicesConfig: ServiceConfig[]
): string {
    let result = plistContent;
    const baseIndent = detectPlistIndent(plistContent);
    
    for (const service of services) {
        const config = servicesConfig.find(c => c.id === service.id);
        if (!config?.ios) {continue;}

        if (service.id === 'firebase') {
            // Older releases disabled swizzling even though FlutterFire relies
            // on it for FCM token handling.
            result = result.replace(
                /\s*<key>FirebaseAppDelegateProxyEnabled<\/key>\s*<(?:true|false)\/>/gi,
                '',
            );
        }
        if (service.id === 'twitter') {
            result = result.replace(/\s*<string>twitterkit-[^<]+<\/string>/gi, '');
        }

        if (service.id === 'applinks') {
            // HTTPS Universal Links are configured through associated-domain
            // entitlements, not by registering http/https as custom schemes.
            result = stripApplinksBlock(result);
            continue;
        }
        
        // Add/update plist entries
        if (config.ios.plistEntries && config.ios.plistEntries.length > 0) {
            for (const entry of config.ios.plistEntries) {
                if (entry.type === 'string' && entry.valueField) {
                    const value = (service.values || {})[entry.valueField];
                    if (!value) {continue;}
                    
                    // Check if key already exists
                    const existingKeyRegex = new RegExp(
                        `<key>${entry.key}</key>\\s*<string>[^<]*</string>`,
                        'i'
                    );
                    
                    if (existingKeyRegex.test(result)) {
                        // Update existing value
                        result = result.replace(
                            existingKeyRegex,
                            `<key>${entry.key}</key>\n\t<string>${value}</string>`
                        );
                    } else {
                        // Add new entry before last </dict>
                        const entryXml = `${baseIndent}<key>${entry.key}</key>\n${baseIndent}<string>${value}</string>\n`;
                        const dictEnd = result.lastIndexOf('</dict>');
                        if (dictEnd !== -1) {
                            result = result.slice(0, dictEnd) + entryXml + result.slice(dictEnd);
                        }
                    }
                } else if (entry.type === 'boolean' && 'staticValue' in entry) {
                    // Skip if already exists
                    if (result.includes(`<key>${entry.key}</key>`)) {continue;}
                    
                    const boolValue = entry.staticValue ? 'true' : 'false';
                    const entryXml = `${baseIndent}<key>${entry.key}</key>\n${baseIndent}<${boolValue}/>\n`;
                    const dictEnd = result.lastIndexOf('</dict>');
                    if (dictEnd !== -1) {
                        result = result.slice(0, dictEnd) + entryXml + result.slice(dictEnd);
                    }
                } else if (entry.type === 'array' && entry.staticValue) {
                    result = mergePlistArray(result, entry.key, entry.staticValue as unknown[], baseIndent);
                }
            }
        }
        
        // Add/update URL schemes in existing CFBundleURLSchemes array
        if (config.ios.urlSchemes && config.ios.urlSchemes.length > 0) {
            for (const scheme of config.ios.urlSchemes) {
                let value = scheme.staticValue
                    || (scheme.valueField ? (service.values || {})[scheme.valueField] : '')
                    || '';
                if (!value) {continue;}
                
                const newScheme = scheme.prefix ? scheme.prefix + value : value;
                
                result = upsertServiceUrlScheme(
                    result,
                    service.id,
                    newScheme,
                    scheme.urlName || service.id,
                    baseIndent,
                );
            }
        }
    }

    // Remove blocks emitted by older releases; Universal Links never require a
    // CFBundleURLTypes entry for the http/https schemes.
    result = stripApplinksBlock(result);
    
    return result;
}

/**
 * Removes service entries from Info.plist
 */
export function removeServicesFromIOSPlist(
    plistContent: string,
    removedServiceIds: string[],
    servicesConfig: ServiceConfig[]
): string {
    let result = plistContent;
    
    // Keys that should NOT be removed as they may be shared across services
    const protectedKeys = ['LSApplicationQueriesSchemes', 'SKAdNetworkItems'];
    
    for (const serviceId of removedServiceIds) {
        if (serviceId === 'applinks') {
            const applinksRegex = /\s*<!-- start applinks configuration -->[\s\S]*?<!-- end applinks configuration -->\s*/i;
            result = result.replace(applinksRegex, '');
            continue;
        }

        const config = servicesConfig.find(c => c.id === serviceId);
        if (!config?.ios) {continue;}

        const markerRegex = new RegExp(
            `\\s*<!-- flutter-config-manager service:${escapeRegExp(serviceId)} url-scheme -->[\\s\\S]*?<!-- end flutter-config-manager service:${escapeRegExp(serviceId)} url-scheme -->\\s*`,
            'gi',
        );
        result = result.replace(markerRegex, '');
        
        // Remove plist entries
        if (config.ios.plistEntries) {
            for (const entry of config.ios.plistEntries) {
                // Shared arrays are edited item-by-item so removing one service
                // cannot discard entries owned by the app or another service.
                if (protectedKeys.includes(entry.key)) {
                    if (entry.type === 'array' && Array.isArray(entry.staticValue)) {
                        result = removePlistArrayItems(result, entry.key, entry.staticValue);
                    }
                    continue;
                }
                
                // Remove string entries: <key>xxx</key>\n\t<string>yyy</string>
                if (entry.type === 'string') {
                    const stringRegex = new RegExp(
                        `\\s*<key>${entry.key}</key>\\s*<string>[^<]*</string>`,
                        'gi'
                    );
                    result = result.replace(stringRegex, '');
                }
                // Remove boolean entries: <key>xxx</key>\n\t<true/> or <false/>
                else if (entry.type === 'boolean') {
                    const boolRegex = new RegExp(
                        `\\s*<key>${entry.key}</key>\\s*<(?:true|false)/>`,
                        'gi'
                    );
                    result = result.replace(boolRegex, '');
                }
                // Remove array entries (but not protected ones)
                else if (entry.type === 'array') {
                    const arrayRegex = new RegExp(
                        `\\s*<key>${entry.key}</key>\\s*<array>[\\s\\S]*?</array>`,
                        'gi'
                    );
                    result = result.replace(arrayRegex, '');
                }
            }
        }
        
        // Remove URL schemes with prefixes
        if (config.ios.urlSchemes) {
            for (const scheme of config.ios.urlSchemes) {
                if (scheme.prefix) {
                    // Remove schemes that start with this prefix
                    const schemeRegex = new RegExp(
                        `\\s*<string>${scheme.prefix}[^<]+</string>`,
                        'gi'
                    );
                    result = result.replace(schemeRegex, '');
                } else if (scheme.staticValue) {
                    const schemeRegex = new RegExp(
                        `\\s*<string>${escapeRegExp(scheme.staticValue)}<\\/string>`,
                        'gi'
                    );
                    result = result.replace(schemeRegex, '');
                }
            }
        }
    }
    
    // Clean up multiple blank lines
    result = result.replace(/(\r?\n){3,}/g, '$1$1');
    
    return result;
}


export function validateIOSPermissionEntries(entries: IOSPermissionEntry[]): void {
    for (const entry of entries) {
        if (!entry.permission || entry.permission.trim().length === 0) {
            throw new Error('iOS permission key cannot be empty');
        }
        if (typeof entry.value === 'string' && /[<>&]/.test(entry.value)) {
            if (!/&(lt|gt|amp|quot|apos);/.test(entry.value)) {
                throw new Error(`iOS usage description for ${entry.permission} contains unescaped illegal characters (<, >, or &)`);
            }
        }
    }
}
