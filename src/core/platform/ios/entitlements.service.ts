/**
 * iOS Entitlements parsing and updating service
 */

import type { ServiceEntry, ServiceConfig } from '../../types/index.js';

const APPLINKS_MARKERS = /\s*<!-- start applinks configuration -->|<!-- end applinks configuration -->\s*/gi;

function normalizeDomains(raw?: string): string[] {
    if (!raw) {return [];}
    return raw
        .split(/[,;\n]+/)
        .map(value => value.trim())
        .filter(Boolean)
        .map(value => value.replace(/^applinks:/i, ''))
        .map(value => value.replace(/^https?:\/\//i, ''))
        .map(value => value.split('/')[0].trim())
        .filter(Boolean);
}

function escapeRegExp(value: string): string {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function setStringArray(
    content: string,
    key: string,
    values: string[],
    replacePrefix?: string,
): string {
    const keyRegex = new RegExp(`(<key>${escapeRegExp(key)}<\\/key>\\s*<array>)([\\s\\S]*?)(<\\/array>)`, 'i');
    const match = content.match(keyRegex);
    const desired = Array.from(new Set(values.filter(Boolean)));
    if (match) {
        const existing = Array.from(match[2].matchAll(/<string>([^<]*)<\/string>/gi))
            .map(item => item[1].trim())
            .filter(value => !replacePrefix || !value.startsWith(replacePrefix));
        const merged = replacePrefix ? [...existing, ...desired] : desired;
        if (merged.length === 0) {
            return content.replace(new RegExp(`\\s*<key>${escapeRegExp(key)}<\\/key>\\s*<array>[\\s\\S]*?<\\/array>`, 'i'), '');
        }
        const body = `\n${merged.map(value => `\t\t<string>${value}</string>`).join('\n')}\n\t`;
        return content.replace(keyRegex, `$1${body}$3`);
    }

    if (desired.length === 0) {return content;}
    const entry = `\t<key>${key}</key>\n\t<array>\n${desired.map(value => `\t\t<string>${value}</string>`).join('\n')}\n\t</array>\n`;
    const dictEnd = content.lastIndexOf('</dict>');
    if (dictEnd === -1) {
        return content;
    }
    return content.slice(0, dictEnd) + entry + content.slice(dictEnd);
}

export function updateIOSEntitlementsWithServices(
    entitlementsContent: string,
    services: ServiceEntry[],
    servicesConfig: ServiceConfig[]
): string {
    let result = entitlementsContent;
    result = result.replace(APPLINKS_MARKERS, '');

    for (const service of services) {
        if (service.id === 'applinks') {
            const domains = normalizeDomains(service.values?.domains);
            if (domains.length === 0) {
                continue;
            }
            result = setStringArray(
                result,
                'com.apple.developer.associated-domains',
                domains.map(domain => `applinks:${domain}`),
                'applinks:',
            );
            continue;
        }

        const config = servicesConfig.find(c => c.id === service.id);
        if (!config?.ios?.entitlements || config.ios.entitlements.length === 0) {continue;}

        for (const entitlement of config.ios.entitlements) {
            if (entitlement.type !== 'array') {continue;}
            const staticValues = Array.isArray(entitlement.staticValue)
                ? entitlement.staticValue.map(value => String(value))
                : [];
            const dynamicValue = entitlement.valueField
                ? service.values?.[entitlement.valueField]?.trim()
                : undefined;
            result = setStringArray(result, entitlement.key, [
                ...staticValues,
                ...(dynamicValue ? [dynamicValue] : []),
            ]);
        }
    }

    return result;
}

export function removeServicesFromIOSEntitlements(
    entitlementsContent: string,
    removedServiceIds: string[],
    servicesConfig: ServiceConfig[]
): string {
    let result = entitlementsContent;

    if (removedServiceIds.includes('applinks')) {
        result = result.replace(APPLINKS_MARKERS, '');
        result = setStringArray(result, 'com.apple.developer.associated-domains', [], 'applinks:');
    }

    for (const serviceId of removedServiceIds) {
        const config = servicesConfig.find(c => c.id === serviceId);
        if (!config?.ios?.entitlements) {continue;}

        for (const entitlement of config.ios.entitlements) {
            const arrayRegex = new RegExp(
                `\\s*<key>${entitlement.key}</key>\\s*<array>[\\s\\S]*?</array>`,
                'gi'
            );
            result = result.replace(arrayRegex, '');
        }
    }

    result = result.replace(/\n{3,}/g, '\n\n');
    return result;
}
