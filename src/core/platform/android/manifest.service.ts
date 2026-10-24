/**
 * Android Manifest parsing and updating service
 */

import type { ServiceEntry, ServiceConfig } from '../../types/index.js';
import { findXmlElementBounds } from '../../shared/xml.js';
import { normalizeAndroidPermissionName } from './manifest-permissions.js';

const APPLINKS_START = '<!-- start applinks configuration -->';
const APPLINKS_END = '<!-- end applinks configuration -->';

function escapeRegExp(value: string): string {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function normalizeDomains(raw?: string): string[] {
    if (!raw) {return [];}
    return raw
        .split(/[,;\n]+/)
        .map(value => value.trim())
        .filter(Boolean)
        .map(value => value.replace(/^applinks:/i, ''))
        .map(value => value.replace(/^https?:\/\//i, ''))
        .map(value => value.split('/')[0].trim())
        .filter(value => {
            // Only include valid domain names (must contain a dot, not be just a hostname like 'safepay')
            return value.includes('.') && !value.includes(' ');
        });
}

function normalizeSchemes(raw?: string): string[] {
    if (!raw) {return [];}
    return raw
        .split(/[,;\n]+/)
        .map(value => value.trim())
        .filter(Boolean);
}

function normalizeBoolean(raw?: string, fallback = false): boolean {
    if (raw === undefined || raw === null || raw.trim() === '') {return fallback;}
    return raw.trim().toLowerCase() === 'true';
}

function buildApplinksAndroidBlock(domains: string[], schemes: string[], flutterDeepLinkingEnabled: boolean): string {
    const uniqueDomains = Array.from(new Set(domains));
    // Only use http/https schemes for applinks - other schemes are handled separately by their services
    const inputSchemes = schemes.length > 0 ? Array.from(new Set(schemes)) : ['https'];
    const uniqueSchemes = inputSchemes.filter(s => s === 'https' || s === 'http');
    
    // If no valid schemes, default to https
    if (uniqueSchemes.length === 0) {
        uniqueSchemes.push('https');
    }
    
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
 * Normalizes permission names to their full form. Names without a dot get the
 * `android.permission.` prefix; vendor names (`com.google.android.gms.permission.AD_ID`)
 * are kept as-is.
 */
export function normalizePermissionNames(permissionNames: string[]): string[] {
    const seen = new Set<string>();
    const result: string[] = [];
    for (const entry of permissionNames) {
        const normalized = normalizeAndroidPermissionName(entry ?? '');
        if (normalized && !seen.has(normalized)) {
            seen.add(normalized);
            result.push(normalized);
        }
    }
    return result;
}

export {
    updateAndroidManifest,
    parseManifestPermissions,
    permissionEntryFromElement,
    extractAndroidPermissionEntries,
    normalizeAndroidPermissionName,
} from './manifest-permissions.js';
export type { ManifestPermissionElement, AndroidPermissionEntryInput } from './manifest-permissions.js';

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
        if (!config?.android) {continue;}

        if (service.id === 'onesignal') {
            result = result.replace(
                /\s*<meta-data[^>]*android:name=["'](?:onesignal_app_id|onesignal_google_project_number)["'][^>]*\/?>/gi,
                '',
            );
        }

        if (service.id === 'stripe') {
            // Migrate the callback emitted by older releases to the host used
            // by current flutter_stripe PaymentSheet return URLs.
            result = result.replace(
                /(android:scheme=["']flutterstripe["'][^>]*android:host=["'])safepay(["'])/gi,
                '$1redirect$2',
            );
        }

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
                if (!value) {continue;}
                
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
        
        // Add MainActivity intent-filters (for URL schemes like Stripe)
        if (config.android.mainActivityIntentFilters && config.android.mainActivityIntentFilters.length > 0) {
            for (const intentFilter of config.android.mainActivityIntentFilters) {
                const intentFilterXml = buildIntentFilterElement(intentFilter, service.values, service.id);
                
                // Find MainActivity and insert intent-filter before </activity>
                const mainActivityRegex = /<activity[^>]*android:name="[^"]*\.MainActivity"[^>]*>[\s\S]*?<\/activity>/i;
                const activityMatch = result.match(mainActivityRegex);
                
                if (activityMatch) {
                    const activityContent = activityMatch[0];
                    // Check if this specific intent-filter already exists (by scheme)
                    const schemeMatch = intentFilterXml.match(/android:scheme="([^"]+)"/);
                    const scheme = schemeMatch?.[1];
                    if (scheme && activityContent.includes(`android:scheme="${scheme}"`)) {
                        continue; // Already exists
                    }
                    
                    // Insert before </activity>
                    const updatedActivity = activityContent.replace(
                        /<\/activity>/,
                        `${intentFilterXml}        </activity>`
                    );
                    result = result.replace(activityMatch[0], updatedActivity);
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
        if (!config?.android) {continue;}

        if (serviceId === 'onesignal') {
            result = result.replace(
                /\s*<meta-data[^>]*android:name=["'](?:onesignal_app_id|onesignal_google_project_number)["'][^>]*\/?>/gi,
                '',
            );
        }

        const markedFilterRegex = new RegExp(
            `\\s*<!-- flutter-config-manager service:${escapeRegExp(serviceId)} -->[\\s\\S]*?<!-- end flutter-config-manager service:${escapeRegExp(serviceId)} -->\\s*`,
            'gi'
        );
        result = result.replace(markedFilterRegex, '');
        
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
        
        // Remove MainActivity intent-filters
        if (config.android.mainActivityIntentFilters) {
            for (const intentFilter of config.android.mainActivityIntentFilters) {
                // Find the scheme and host to identify the intent-filter
                const dataChild = intentFilter.children?.find((c: { tag: string; attributes: Record<string, string> }) => c.tag === 'data');
                const scheme = dataChild?.attributes['android:scheme'];
                if (scheme) {
                    // Find and remove the specific intent-filter by scheme
                    // Match intent-filter that contains the specific data scheme
                    const filterRegex = new RegExp(
                        `<intent-filter[^>]*>[\\s\\S]*?<data[^>]*android:scheme="${scheme.replace(/\./g, '\\.')}"[^/]*/?>[\\s\\S]*?<\\/intent-filter>`,
                        'gi'
                    );
                    result = result.replace(filterRegex, '');
                }
            }
        }
        
        // Remove application data (activities)
        if (config.android.applicationData) {
            for (const appData of config.android.applicationData) {
                const activityName = appData.attributes['android:name'];
                if (activityName) {
                    const bounds = findXmlElementBounds(result, appData.tag, { name: 'android:name', value: activityName });
                    if (bounds) {
                        // Also strip leading whitespace and newline
                        let removeStart = bounds.start;
                        while (removeStart > 0 && (result[removeStart - 1] === ' ' || result[removeStart - 1] === '\t')) {
                            removeStart--;
                        }
                        if (removeStart > 0 && result[removeStart - 1] === '\n') {
                            removeStart--;
                        }
                        result = result.slice(0, removeStart) + result.slice(bounds.end);
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
 * Builds an intent-filter element string from config
 */
function buildIntentFilterElement(
    intentFilter: { tag: string; attributes?: Record<string, string>; children?: { tag: string; attributes: Record<string, string> }[] },
    values: Record<string, string>,
    serviceId: string,
): string {
    const spaces = '        ';
    
    if (!intentFilter.children || intentFilter.children.length === 0) {
        return '';
    }
    
    const childrenXml = intentFilter.children
        .map(child => {
            const attrs = Object.entries(child.attributes || {})
                .flatMap(([k, template]) => {
                    const fields = Array.from(template.matchAll(/\{(\w+)\}/g)).map(match => match[1]);
                    if (fields.some(field => !(values || {})[field]?.trim())) {return [];}
                    const value = fields.reduce(
                        (current, field) => current.replaceAll(`{${field}}`, (values || {})[field]),
                        template,
                    );
                    return [`${k}="${value}"`];
                })
                .join(' ');
            return `${spaces}    <${child.tag}${attrs ? ` ${attrs}` : ''} />`;
        })
        .join('\n');
    
    return `${spaces}<!-- flutter-config-manager service:${serviceId} -->\n${spaces}<intent-filter>\n${childrenXml}\n${spaces}</intent-filter>\n${spaces}<!-- end flutter-config-manager service:${serviceId} -->\n`;
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
        .flatMap(([k, template]) => {
            const fields = Array.from(template.matchAll(/\{(\w+)\}/g)).map(match => match[1]);
            if (fields.some(field => !(values || {})[field]?.trim())) {return [];}
            const value = fields.reduce(
                (current, field) => current.replaceAll(`{${field}}`, (values || {})[field]),
                template,
            );
            return [`${k}="${value}"`];
        })
        .join(' ');
    
    if (!element.children || element.children.length === 0) {
        return `${spaces}<${element.tag}${attrs ? ` ${attrs}` : ''} />`;
    }
    
    const childrenXml = (element.children as { tag: string; attributes: Record<string, string>; children?: unknown[] }[])
        .map(child => buildXmlElement(child, values, indent + 1))
        .join('\n');
    
    return `${spaces}<${element.tag}${attrs ? ` ${attrs}` : ''}>\n${childrenXml}\n${spaces}</${element.tag}>`;
}
