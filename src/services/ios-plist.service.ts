/**
 * iOS Info.plist parsing and updating service
 */

import type { IOSPermissionEntry, ServiceEntry, ServiceConfig } from '../types/index.js';

/**
 * Updates Info.plist content with new permission entries
 * Preserves existing structure and closing tags
 */
export function updateIOSPlist(plistContent: string, permissionEntries: IOSPermissionEntry[]): string {
    const uniqueEntries = new Map<string, IOSPermissionEntry>();
    permissionEntries
        .filter(entry => entry.permission?.trim())
        .forEach(entry => uniqueEntries.set(entry.permission.trim(), entry));

    // Build a set of permission keys we're managing
    const permissionKeys = new Set(Array.from(uniqueEntries.keys()));
    
    const existingStringPairs = new Map<string, string>();
    const existingBooleanPairs = new Map<string, boolean>();

    // Work only on the content before the final </dict> so we never drop closing tags
    const dictCloseIndex = plistContent.lastIndexOf('</dict>');
    if (dictCloseIndex === -1) {
        return plistContent;
    }

    const prefix = plistContent.slice(0, dictCloseIndex);
    const suffix = plistContent.slice(dictCloseIndex); // contains </dict></plist>

    // Only match and extract permission keys (those ending with UsageDescription or in our set)
    const stringRegex = /<key>(NS\w*UsageDescription)<\/key>\s*<string>([^<]*)<\/string>/g;
    const boolRegex = /<key>(NS\w*UsageDescription)<\/key>\s*<(true|false)\/>/g;
    
    let match;
    while ((match = stringRegex.exec(prefix)) !== null) {
        existingStringPairs.set(match[1], match[2]);
    }
    while ((match = boolRegex.exec(prefix)) !== null) {
        existingBooleanPairs.set(match[1], match[2] === 'true');
    }

    // Only remove the permission entries we're managing, not other NS* keys
    let cleanedPrefix = prefix;
    for (const key of permissionKeys) {
        // Remove existing string entry for this permission
        const keyStringRegex = new RegExp(
            `\\s*<key>${key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}</key>\\s*<string>[^<]*</string>`,
            'g'
        );
        cleanedPrefix = cleanedPrefix.replace(keyStringRegex, '');
        
        // Remove existing boolean entry for this permission
        const keyBoolRegex = new RegExp(
            `\\s*<key>${key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}</key>\\s*<(?:true|false)/>`,
            'g'
        );
        cleanedPrefix = cleanedPrefix.replace(keyBoolRegex, '');
    }

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
        return cleanedPrefix + suffix;
    }

    // Insert entries before the closing </dict>, maintaining proper formatting
    const trimmedPrefix = cleanedPrefix.replace(/\s+$/, '');
    const merged = `${trimmedPrefix}\n${entries}\n${suffix}`;
    return merged;
}

/**
 * Normalizes whitespace in plist content for consistent formatting
 * Note: This function now does minimal changes to preserve original formatting
 */
export function normalizePlistSpacing(plistContent: string): string {
    // Only clean up excessive blank lines, preserve everything else
    return plistContent.replace(/\n{3,}/g, '\n\n');
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
    
    for (const service of services) {
        const config = servicesConfig.find(c => c.id === service.id);
        if (!config?.ios) continue;
        
        // Add/update plist entries
        if (config.ios.plistEntries && config.ios.plistEntries.length > 0) {
            for (const entry of config.ios.plistEntries) {
                if (entry.type === 'string' && entry.valueField) {
                    const value = (service.values || {})[entry.valueField];
                    if (!value) continue;
                    
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
                        const entryXml = `\t<key>${entry.key}</key>\n\t<string>${value}</string>\n`;
                        const dictEnd = result.lastIndexOf('</dict>');
                        if (dictEnd !== -1) {
                            result = result.slice(0, dictEnd) + entryXml + result.slice(dictEnd);
                        }
                    }
                } else if (entry.type === 'boolean' && 'staticValue' in entry) {
                    // Skip if already exists
                    if (result.includes(`<key>${entry.key}</key>`)) continue;
                    
                    const boolValue = entry.staticValue ? 'true' : 'false';
                    const entryXml = `\t<key>${entry.key}</key>\n\t<${boolValue}/>\n`;
                    const dictEnd = result.lastIndexOf('</dict>');
                    if (dictEnd !== -1) {
                        result = result.slice(0, dictEnd) + entryXml + result.slice(dictEnd);
                    }
                } else if (entry.type === 'array' && entry.staticValue) {
                    // Skip if already exists
                    if (result.includes(`<key>${entry.key}</key>`)) continue;
                    
                    const arrayItems = (entry.staticValue as unknown[]).map(v => {
                        if (typeof v === 'string') {
                            return `\t\t<string>${v}</string>`;
                        } else if (typeof v === 'object' && v !== null) {
                            const dictEntries = Object.entries(v).map(([key, val]) => 
                                `\t\t\t<key>${key}</key>\n\t\t\t<string>${val}</string>`
                            ).join('\n');
                            return `\t\t<dict>\n${dictEntries}\n\t\t</dict>`;
                        }
                        return '';
                    }).join('\n');
                    const entryXml = `\t<key>${entry.key}</key>\n\t<array>\n${arrayItems}\n\t</array>\n`;
                    const dictEnd = result.lastIndexOf('</dict>');
                    if (dictEnd !== -1) {
                        result = result.slice(0, dictEnd) + entryXml + result.slice(dictEnd);
                    }
                }
            }
        }
        
        // Add/update URL schemes in existing CFBundleURLSchemes array
        if (config.ios.urlSchemes && config.ios.urlSchemes.length > 0) {
            for (const scheme of config.ios.urlSchemes) {
                let value = (service.values || {})[scheme.valueField] || '';
                if (!value) continue;
                
                const newScheme = scheme.prefix ? scheme.prefix + value : value;
                
                // Find existing CFBundleURLSchemes array
                const urlSchemesRegex = /<key>CFBundleURLSchemes<\/key>\s*<array>([\s\S]*?)<\/array>/;
                const urlSchemesMatch = result.match(urlSchemesRegex);
                
                if (urlSchemesMatch) {
                    const existingSchemes = urlSchemesMatch[1];
                    
                    // Check if this exact scheme already exists
                    if (existingSchemes.includes(`<string>${newScheme}</string>`)) {
                        continue; // Already exists with same value
                    }
                    
                    // Check if there's an existing scheme with this prefix that needs updating
                    if (scheme.prefix) {
                        const prefixPattern = new RegExp(
                            `<string>${scheme.prefix}[^<]+</string>`,
                            'g'
                        );
                        const prefixMatch = existingSchemes.match(prefixPattern);
                        
                        if (prefixMatch && prefixMatch.length > 0) {
                            // Replace the first matching scheme with the new value
                            result = result.replace(
                                prefixMatch[0],
                                `<string>${newScheme}</string>`
                            );
                            continue;
                        }
                    }
                    
                    // No existing scheme with prefix - add new scheme
                    const schemasArrayEnd = result.indexOf('</array>', urlSchemesMatch.index!);
                    const schemeToAdd = `\t\t\t\t<string>${newScheme}</string>\n\t\t\t`;
                    result = result.slice(0, schemasArrayEnd) + schemeToAdd + result.slice(schemasArrayEnd);
                } else if (result.includes('<key>CFBundleURLTypes</key>')) {
                    // CFBundleURLTypes exists but no CFBundleURLSchemes found - look for first dict
                    const urlTypesMatch = result.match(/<key>CFBundleURLTypes<\/key>\s*<array>\s*<dict>/);
                    if (urlTypesMatch) {
                        const firstDictEnd = result.indexOf('</dict>', urlTypesMatch.index! + urlTypesMatch[0].length);
                        const schemesXml = `\t\t\t<key>CFBundleURLSchemes</key>\n\t\t\t<array>\n\t\t\t\t<string>${newScheme}</string>\n\t\t\t</array>\n\t\t`;
                        result = result.slice(0, firstDictEnd) + schemesXml + result.slice(firstDictEnd);
                    }
                } else {
                    // No CFBundleURLTypes - create it
                    const urlTypesXml = `\t<key>CFBundleURLTypes</key>\n\t<array>\n\t\t<dict>\n\t\t\t<key>CFBundleTypeRole</key>\n\t\t\t<string>Editor</string>\n\t\t\t<key>CFBundleURLSchemes</key>\n\t\t\t<array>\n\t\t\t\t<string>${newScheme}</string>\n\t\t\t</array>\n\t\t</dict>\n\t</array>\n`;
                    const dictEnd = result.lastIndexOf('</dict>');
                    if (dictEnd !== -1) {
                        result = result.slice(0, dictEnd) + urlTypesXml + result.slice(dictEnd);
                    }
                }
            }
        }
    }
    
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
    const protectedKeys = ['LSApplicationQueriesSchemes'];
    
    for (const serviceId of removedServiceIds) {
        const config = servicesConfig.find(c => c.id === serviceId);
        if (!config?.ios) continue;
        
        // Remove plist entries
        if (config.ios.plistEntries) {
            for (const entry of config.ios.plistEntries) {
                // Skip protected keys
                if (protectedKeys.includes(entry.key)) continue;
                
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
                }
            }
        }
    }
    
    // Clean up multiple blank lines
    result = result.replace(/\n{3,}/g, '\n\n');
    
    return result;
}
