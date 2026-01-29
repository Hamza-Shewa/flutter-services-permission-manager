/**
 * Android manifest service operations (add/update/remove)
 */

import type { ServiceEntry, ServiceConfig, AndroidXmlElement } from '../../types/index.js';

/**
 * Updates AndroidManifest.xml with service configurations
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

        result = addMetaDataEntries(result, config, service);
        result = addQueriesEntries(result, config, service);
        result = addApplicationDataEntries(result, config, service);
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
        const config = servicesConfig.find(c => c.id === serviceId);
        if (!config?.android) continue;

        result = removeMetaDataEntries(result, config);
        result = removeQueriesEntries(result, config);
        result = removeApplicationDataEntries(result, config);
    }

    // Clean up empty queries block and multiple blank lines
    result = result.replace(/<queries>\s*<\/queries>/gi, '');
    result = result.replace(/\n{3,}/g, '\n\n');

    return result;
}

function addMetaDataEntries(content: string, config: ServiceConfig, service: ServiceEntry): string {
    let result = content;
    const metaData = config.android.metaData;

    if (!metaData?.length) return result;

    for (const meta of metaData) {
        const value = service.values?.[meta.valueField] ?? meta.defaultValue ?? '';
        if (!value) continue;

        const androidValue = meta.stringResource
            ? `@string/${meta.stringResource}`
            : (meta.prefix ? meta.prefix + value : value);

        const existingMetaRegex = new RegExp(
            `<meta-data[^>]*android:name="${escapeRegexChars(meta.name)}"[^>]*/?>`,
            'i'
        );

        if (existingMetaRegex.test(result)) {
            const updatedMeta = `<meta-data android:name="${meta.name}" android:value="${androidValue}" />`;
            result = result.replace(existingMetaRegex, updatedMeta);
        } else {
            const metaDataXml = `\n        <meta-data android:name="${meta.name}" android:value="${androidValue}" />`;
            const appMatch = result.match(/<application[^>]*>/);
            if (appMatch) {
                const insertPos = appMatch.index! + appMatch[0].length;
                result = result.slice(0, insertPos) + metaDataXml + result.slice(insertPos);
            }
        }
    }

    return result;
}

function addQueriesEntries(content: string, config: ServiceConfig, _service: ServiceEntry): string {
    let result = content;
    const queries = config.android.queries;

    if (!queries?.length) return result;

    for (const q of queries) {
        const attrs = Object.entries(q.attributes || {})
            .map(([k, v]) => `${k}="${v}"`)
            .join(' ');
        const queryXml = `<${q.tag} ${attrs} />`;

        const attrToCheck = q.attributes['android:authorities'] || q.attributes['android:name'] || '';
        if (attrToCheck && result.includes(attrToCheck)) {
            continue;
        }

        const queriesMatch = result.match(/<queries>([\s\S]*?)<\/queries>/);
        if (queriesMatch) {
            const queriesEnd = result.indexOf('</queries>');
            result = result.slice(0, queriesEnd) + `        ${queryXml}\n    ` + result.slice(queriesEnd);
        } else {
            const appStart = result.indexOf('<application');
            if (appStart !== -1) {
                const queriesBlock = `\n    <queries>\n        ${queryXml}\n    </queries>\n`;
                result = result.slice(0, appStart) + queriesBlock + result.slice(appStart);
            }
        }
    }

    return result;
}

function addApplicationDataEntries(content: string, config: ServiceConfig, service: ServiceEntry): string {
    let result = content;
    const appData = config.android.applicationData;

    if (!appData?.length) return result;

    for (const data of appData) {
        const activityName = data.attributes['android:name'];
        if (activityName && result.includes(`android:name="${activityName}"`)) {
            continue;
        }

        const elementXml = buildXmlElement(data, service.values, 2);
        const appEndMatch = result.match(/<\/application>/);
        if (appEndMatch) {
            const insertPos = appEndMatch.index!;
            result = result.slice(0, insertPos) + elementXml + '\n    ' + result.slice(insertPos);
        }
    }

    return result;
}

function removeMetaDataEntries(content: string, config: ServiceConfig): string {
    let result = content;

    if (!config.android.metaData) return result;

    for (const meta of config.android.metaData) {
        const metaRegex = new RegExp(
            `\\s*<meta-data[^>]*android:name="${escapeRegexChars(meta.name)}"[^>]*/?>`,
            'gi'
        );
        result = result.replace(metaRegex, '');
    }

    return result;
}

function removeQueriesEntries(content: string, config: ServiceConfig): string {
    let result = content;

    if (!config.android.queries) return result;

    for (const q of config.android.queries) {
        const attrToCheck = q.attributes['android:authorities'] || q.attributes['android:name'] || '';
        if (attrToCheck) {
            const queryRegex = new RegExp(
                `\\s*<${q.tag}[^>]*${escapeRegexChars(attrToCheck)}[^>]*/?>`,
                'gi'
            );
            result = result.replace(queryRegex, '');
        }
    }

    return result;
}

function removeApplicationDataEntries(content: string, config: ServiceConfig): string {
    let result = content;

    if (!config.android.applicationData) return result;

    for (const appData of config.android.applicationData) {
        const activityName = appData.attributes['android:name'];
        if (!activityName) continue;

        result = removeXmlElement(result, appData.tag, activityName);
    }

    return result;
}

/**
 * Removes an XML element by tag and android:name attribute
 */
function removeXmlElement(content: string, tag: string, androidName: string): string {
    let result = content;
    const searchPattern = `android:name="${androidName}"`;
    let searchPos = 0;

    while (searchPos < result.length) {
        const namePos = result.indexOf(searchPattern, searchPos);
        if (namePos === -1) break;

        // Find the start of this tag
        let tagStart = namePos;
        while (tagStart > 0 && result[tagStart] !== '<') {
            tagStart--;
        }

        // Verify this is the right tag type
        const tagCheck = result.slice(tagStart, tagStart + tag.length + 2);
        if (!tagCheck.startsWith(`<${tag}`)) {
            searchPos = namePos + 1;
            continue;
        }

        const tagEnd = findElementEnd(result, tag, namePos + searchPattern.length);

        if (tagEnd !== -1) {
            // Remove leading whitespace
            while (tagStart > 0 && (result[tagStart - 1] === ' ' || result[tagStart - 1] === '\t')) {
                tagStart--;
            }
            if (tagStart > 0 && result[tagStart - 1] === '\n') {
                tagStart--;
            }

            result = result.slice(0, tagStart) + result.slice(tagEnd);
        } else {
            searchPos = namePos + 1;
        }
    }

    return result;
}

/**
 * Finds the end position of an XML element
 */
function findElementEnd(content: string, tag: string, startPos: number): number {
    let pos = startPos;

    // Check for self-closing tag
    while (pos < content.length) {
        if (content[pos] === '>' && content[pos - 1] === '/') {
            return pos + 1;
        } else if (content[pos] === '>' && content[pos - 1] !== '/') {
            break;
        }
        pos++;
    }

    if (pos >= content.length) return -1;

    // Find matching closing tag with depth tracking
    const closingTag = `</${tag}>`;
    let depth = 1;
    pos++; // Move past the >

    while (pos < content.length && depth > 0) {
        const nextOpen = content.indexOf(`<${tag}`, pos);
        const nextClose = content.indexOf(closingTag, pos);

        if (nextClose === -1) break;

        if (nextOpen !== -1 && nextOpen < nextClose) {
            const closeAngle = content.indexOf('>', nextOpen);
            if (closeAngle !== -1 && content[closeAngle - 1] !== '/') {
                depth++;
            }
            pos = closeAngle + 1;
        } else {
            depth--;
            if (depth === 0) {
                return nextClose + closingTag.length;
            }
            pos = nextClose + closingTag.length;
        }
    }

    return -1;
}

/**
 * Builds an XML element string from config
 */
export function buildXmlElement(
    element: AndroidXmlElement,
    values: Record<string, string>,
    indent: number
): string {
    const spaces = '    '.repeat(indent);
    const attrs = Object.entries(element.attributes || {})
        .map(([k, v]) => {
            let value = v;
            const match = v.match(/\{(\w+)\}/);
            if (match) {
                const fieldId = match[1];
                value = v.replace(`{${fieldId}}`, values?.[fieldId] ?? '');
            }
            return `${k}="${value}"`;
        })
        .join(' ');

    if (!element.children?.length) {
        return `${spaces}<${element.tag} ${attrs} />`;
    }

    const childrenXml = element.children
        .map(child => buildXmlElement(child as AndroidXmlElement, values, indent + 1))
        .join('\n');

    return `${spaces}<${element.tag} ${attrs}>\n${childrenXml}\n${spaces}</${element.tag}>`;
}

function escapeRegexChars(str: string): string {
    return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
