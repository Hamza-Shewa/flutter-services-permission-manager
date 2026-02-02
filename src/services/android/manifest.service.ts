/**
 * Android Manifest parsing and updating service
 */

import type { ServiceEntry, ServiceConfig } from '../../types/index.js';

const APPLINKS_START = '<!-- start applinks configuration -->';
const APPLINKS_END = '<!-- end applinks configuration -->';

function normalizeDomains(raw?: string): string[] {
    if (!raw) return [];
    return raw
        .split(/[,;\n]+/)
        .map(value => value.trim())
        .filter(Boolean)
        .map(value => value.replace(/^applinks:/i, ''))
        .map(value => value.replace(/^https?:\/\//i, ''))
        .map(value => value.split('/')[0].trim())
        .filter(Boolean);
}

function normalizeSchemes(raw?: string): string[] {
    if (!raw) return [];
    return raw
        .split(/[,;\n]+/)
        .map(value => value.trim())
        .filter(Boolean);
}

function normalizeBoolean(raw?: string, fallback = false): boolean {
    if (raw === undefined || raw === null || raw.trim() === '') return fallback;
    return raw.trim().toLowerCase() === 'true';
}

function buildApplinksAndroidBlock(domains: string[], schemes: string[], flutterDeepLinkingEnabled: boolean): string {
    const uniqueDomains = Array.from(new Set(domains));
    const uniqueSchemes = schemes.length > 0 ? Array.from(new Set(schemes)) : ['https'];
    const dataLines = uniqueSchemes
        .flatMap(scheme => uniqueDomains.map(domain => `            <data android:scheme="${scheme}" android:host="${domain}" />`))
        .join('\n');

    return [
        `            ${APPLINKS_START}`,
        `            <meta-data android:name="flutter_deeplinking_enabled" android:value="${flutterDeepLinkingEnabled ? 'true' : 'false'}" />`,
        `            <intent-filter android:autoVerify="true">`,
        `                <action android:name="android.intent.action.VIEW" />`,
        `                <category android:name="android.intent.category.DEFAULT" />`,
        `                <category android:name="android.intent.category.BROWSABLE" />`,
        dataLines,
        `            </intent-filter>`,
        `            ${APPLINKS_END}`
    ].join('\n');
}

function replaceOrInsertApplinksBlock(manifestContent: string, block: string): string {
    const blockRegex = /<!-- start applinks configuration -->[\s\S]*?<!-- end applinks configuration -->/i;
    // Strip any previous applinks block so we always rewrite cleanly
    let cleaned = manifestContent.replace(blockRegex, '');

    // Also strip legacy deep link blocks that contain flutter_deeplinking_enabled meta-data followed by an intent-filter
    const legacyRegex = /[ \t]*<meta-data[^>]*android:name="flutter_deeplinking_enabled"[^>]*>\s*<intent-filter[\s\S]*?<\/intent-filter>\s*/gi;
    cleaned = cleaned.replace(legacyRegex, '');

    const mainActivityRegex = /<activity[^>]*android:name="[^"]*MainActivity"[^>]*>/i;
    const activityMatch = cleaned.match(mainActivityRegex);
    if (activityMatch && activityMatch.index !== undefined) {
        const activityStart = activityMatch.index + activityMatch[0].length;
        const activityEnd = cleaned.indexOf('</activity>', activityStart);
        if (activityEnd !== -1) {
            return cleaned.slice(0, activityEnd) + '\n' + block + '\n' + cleaned.slice(activityEnd);
        }
    }

    return cleaned;
}

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
        const normalized = trimmed.startsWith('android.permission.')
            ? trimmed
            : `android.permission.${trimmed}`;
        
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

    // Clean up multiple consecutive blank lines (more than one newline in a row)
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

/**
 * Updates AndroidManifest.xml with service configurations (e.g., Facebook SDK)
 */
export function updateAndroidManifestWithServices(
    manifestContent: string,
    services: ServiceEntry[],
    servicesConfig: ServiceConfig[]
): string {
    let result = manifestContent;
    
    for (const service of services) {
        const config = servicesConfig.find(c => c.id === service.id);
        if (!config?.android) continue;

        if (service.id === 'applinks') {
            const domains = normalizeDomains((service.values || {}).domains);
            const schemes = normalizeSchemes((service.values || {}).scheme);
            if (domains.length > 0) {
                const flutterEnabled = normalizeBoolean((service.values || {}).flutterDeepLinkingEnabled, false);
                const applinksBlock = buildApplinksAndroidBlock(domains, schemes, flutterEnabled);
                result = replaceOrInsertApplinksBlock(result, applinksBlock);
            }
            continue;
        }
        
        // Add/update meta-data in application tag
        if (config.android.metaData && config.android.metaData.length > 0) {
            for (const meta of config.android.metaData) {
                let value = (service.values || {})[meta.valueField] || meta.defaultValue || '';
                if (!value) continue;
                
                // Use @string reference if stringResource is defined
                const androidValue = meta.stringResource 
                    ? `@string/${meta.stringResource}`
                    : (meta.prefix ? meta.prefix + value : value);
                
                // Check if meta-data already exists
                const existingMetaRegex = new RegExp(
                    `<meta-data[^>]*android:name="${meta.name.replace(/\./g, '\\.')}"[^>]*/?>`,
                    'i'
                );
                const existingMatch = result.match(existingMetaRegex);
                
                if (existingMatch) {
                    // Update existing meta-data value
                    const updatedMeta = `<meta-data android:name="${meta.name}" android:value="${androidValue}" />`;
                    result = result.replace(existingMetaRegex, updatedMeta);
                } else {
                    // Insert after <application ...>
                    const metaDataXml = `\n        <meta-data android:name="${meta.name}" android:value="${androidValue}" />`;
                    const appMatch = result.match(/<application[^>]*>/);
                    if (appMatch) {
                        const insertPos = appMatch.index! + appMatch[0].length;
                        result = result.slice(0, insertPos) + metaDataXml + result.slice(insertPos);
                    }
                }
            }
        }
        
        // Add queries entries
        if (config.android.queries && config.android.queries.length > 0) {
            for (const q of config.android.queries) {
                const attrs = Object.entries(q.attributes || {})
                    .map(([k, v]) => `${k}="${v}"`)
                    .join(' ');
                const queryXml = `<${q.tag} ${attrs} />`;
                
                // Check if this query already exists
                const attrToCheck = q.attributes['android:authorities'] || q.attributes['android:name'] || '';
                if (attrToCheck && result.includes(attrToCheck)) {
                    continue;
                }
                
                // Check if queries block exists
                const queriesMatch = result.match(/<queries>([\s\S]*?)<\/queries>/);
                if (queriesMatch) {
                    // Add to existing queries block
                    const queriesEnd = result.indexOf('</queries>');
                    result = result.slice(0, queriesEnd) + `        ${queryXml}\n    ` + result.slice(queriesEnd);
                } else {
                    // Create queries block after permissions, before application
                    const appStart = result.indexOf('<application');
                    if (appStart !== -1) {
                        const queriesBlock = `\n    <queries>\n        ${queryXml}\n    </queries>\n`;
                        result = result.slice(0, appStart) + queriesBlock + result.slice(appStart);
                    }
                }
            }
        }
        
        // Add application data (activities, etc.)
        if (config.android.applicationData && config.android.applicationData.length > 0) {
            for (const appData of config.android.applicationData) {
                // Check if activity already exists
                const activityName = appData.attributes['android:name'];
                if (activityName && result.includes(`android:name="${activityName}"`)) {
                    continue;
                }
                
                let elementXml = buildXmlElement(appData, service.values, 2);
                
                // Insert before </application>
                const appEndMatch = result.match(/<\/application>/);
                if (appEndMatch) {
                    const insertPos = appEndMatch.index!;
                    result = result.slice(0, insertPos) + elementXml + '\n    ' + result.slice(insertPos);
                }
            }
        }
    }
    
    return result;
}

/**
 * Removes service entries from AndroidManifest.xml
 */
export function removeServicesFromAndroidManifest(
    manifestContent: string,
    removedServiceIds: string[],
    servicesConfig: ServiceConfig[]
): string {
    let result = manifestContent;
    
    for (const serviceId of removedServiceIds) {
        if (serviceId === 'applinks') {
            const applinksRegex = /\s*<!-- start applinks configuration -->[\s\S]*?<!-- end applinks configuration -->\s*/i;
            result = result.replace(applinksRegex, '');
            continue;
        }

        const config = servicesConfig.find(c => c.id === serviceId);
        if (!config?.android) continue;
        
        // Remove meta-data entries
        if (config.android.metaData) {
            for (const meta of config.android.metaData) {
                const metaRegex = new RegExp(
                    `\\s*<meta-data[^>]*android:name="${meta.name.replace(/\./g, '\\.')}"[^>]*/?>`,
                    'gi'
                );
                result = result.replace(metaRegex, '');
            }
        }
        
        // Remove queries entries
        if (config.android.queries) {
            for (const q of config.android.queries) {
                const attrToCheck = q.attributes['android:authorities'] || q.attributes['android:name'] || '';
                if (attrToCheck) {
                    const queryRegex = new RegExp(
                        `\\s*<${q.tag}[^>]*${attrToCheck.replace(/\./g, '\\.')}[^>]*/?>`,
                        'gi'
                    );
                    result = result.replace(queryRegex, '');
                }
            }
        }
        
        // Remove application data (activities)
        if (config.android.applicationData) {
            for (const appData of config.android.applicationData) {
                const activityName = appData.attributes['android:name'];
                if (activityName) {
                    // Find the element by searching for the tag with the specific android:name
                    const searchPattern = `android:name="${activityName}"`;
                    let searchPos = 0;
                    
                    while (searchPos < result.length) {
                        const namePos = result.indexOf(searchPattern, searchPos);
                        if (namePos === -1) break;
                        
                        // Find the start of this tag (go backwards to find <activity or <tag)
                        let tagStart = namePos;
                        while (tagStart > 0 && result[tagStart] !== '<') {
                            tagStart--;
                        }
                        
                        // Verify this is the right tag type
                        const tagCheck = result.slice(tagStart, tagStart + appData.tag.length + 2);
                        if (!tagCheck.startsWith(`<${appData.tag}`)) {
                            searchPos = namePos + 1;
                            continue;
                        }
                        
                        // Find the end of this element
                        // First check if it's self-closing by finding > or />
                        let pos = namePos + searchPattern.length;
                        let foundSelfClose = false;
                        let tagEnd = -1;
                        
                        while (pos < result.length) {
                            if (result[pos] === '>' && result[pos - 1] === '/') {
                                // Self-closing tag
                                tagEnd = pos + 1;
                                foundSelfClose = true;
                                break;
                            } else if (result[pos] === '>' && result[pos - 1] !== '/') {
                                // Opening tag - need to find closing tag
                                break;
                            }
                            pos++;
                        }
                        
                        if (!foundSelfClose && pos < result.length) {
                            // Find matching closing tag
                            const closingTag = `</${appData.tag}>`;
                            let depth = 1;
                            pos++; // Move past the >
                            
                            while (pos < result.length && depth > 0) {
                                const nextOpen = result.indexOf(`<${appData.tag}`, pos);
                                const nextClose = result.indexOf(closingTag, pos);
                                
                                if (nextClose === -1) break;
                                
                                if (nextOpen !== -1 && nextOpen < nextClose) {
                                    // Check if it's a self-closing nested tag
                                    const closeAngle = result.indexOf('>', nextOpen);
                                    if (closeAngle !== -1 && result[closeAngle - 1] !== '/') {
                                        depth++;
                                    }
                                    pos = closeAngle + 1;
                                } else {
                                    depth--;
                                    if (depth === 0) {
                                        tagEnd = nextClose + closingTag.length;
                                    }
                                    pos = nextClose + closingTag.length;
                                }
                            }
                        }
                        
                        if (tagEnd !== -1) {
                            // Also remove leading whitespace
                            while (tagStart > 0 && (result[tagStart - 1] === ' ' || result[tagStart - 1] === '\t')) {
                                tagStart--;
                            }
                            if (tagStart > 0 && result[tagStart - 1] === '\n') {
                                tagStart--;
                            }
                            
                            result = result.slice(0, tagStart) + result.slice(tagEnd);
                            // Don't increment searchPos since we removed content
                        } else {
                            searchPos = namePos + 1;
                        }
                    }
                }
            }
        }
    }
    
    // Clean up empty queries block
    result = result.replace(/<queries>\s*<\/queries>/gi, '');
    
    // Clean up multiple blank lines
    result = result.replace(/\n{3,}/g, '\n\n');
    
    return result;
}

/**
 * Builds an XML element string from config
 */
function buildXmlElement(
    element: { tag: string; attributes: Record<string, string>; children?: unknown[] },
    values: Record<string, string>,
    indent: number
): string {
    const spaces = '    '.repeat(indent);
    const attrs = Object.entries(element.attributes || {})
        .map(([k, v]) => {
            // Replace {fieldId} placeholders with actual values
            let value = v;
            const match = v.match(/\{(\w+)\}/);
            if (match) {
                const fieldId = match[1];
                value = v.replace(`{${fieldId}}`, (values || {})[fieldId] || '');
            }
            return `${k}="${value}"`;
        })
        .join(' ');
    
    if (!element.children || element.children.length === 0) {
        return `${spaces}<${element.tag} ${attrs} />`;
    }
    
    const childrenXml = (element.children as { tag: string; attributes: Record<string, string>; children?: unknown[] }[])
        .map(child => buildXmlElement(child, values, indent + 1))
        .join('\n');
    
    return `${spaces}<${element.tag} ${attrs}>\n${childrenXml}\n${spaces}</${element.tag}>`;
}
