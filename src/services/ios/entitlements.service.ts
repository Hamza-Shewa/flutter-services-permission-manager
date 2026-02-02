/**
 * iOS Entitlements parsing and updating service
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

function buildApplinksEntitlementsBlock(domains: string[]): string {
    const uniqueDomains = Array.from(new Set(domains));
    const domainStrings = uniqueDomains
        .map(domain => `\t\t<string>applinks:${domain}</string>`)
        .join('\n');

    return [
        `\t${APPLINKS_START}`,
        `\t<key>com.apple.developer.associated-domains</key>`,
        `\t<array>`,
        domainStrings,
        `\t</array>`,
        `\t${APPLINKS_END}`,
    ].join('\n');
}

function replaceOrInsertApplinksBlock(entitlementsContent: string, block: string): string {
    const blockRegex = /<!-- start applinks configuration -->[\s\S]*?<!-- end applinks configuration -->/i;
    let cleaned = entitlementsContent.replace(blockRegex, '');

    const keyRegex = /\s*<key>com\.apple\.developer\.associated-domains<\/key>\s*<array>[\s\S]*?<\/array>/i;
    if (keyRegex.test(cleaned)) {
        return cleaned.replace(keyRegex, `\n${block}`);
    }

    const dictEnd = cleaned.lastIndexOf('</dict>');
    if (dictEnd === -1) {
        return cleaned;
    }

    return cleaned.slice(0, dictEnd) + block + '\n' + cleaned.slice(dictEnd);
}

export function updateIOSEntitlementsWithServices(
    entitlementsContent: string,
    services: ServiceEntry[],
    servicesConfig: ServiceConfig[]
): string {
    let result = entitlementsContent;

    for (const service of services) {
        if (service.id === 'applinks') {
            const domains = normalizeDomains(service.values?.domains);
            if (domains.length === 0) {
                continue;
            }
            const applinksBlock = buildApplinksEntitlementsBlock(domains);
            result = replaceOrInsertApplinksBlock(result, applinksBlock);
            continue;
        }

        const config = servicesConfig.find(c => c.id === service.id);
        if (!config?.ios?.entitlements || config.ios.entitlements.length === 0) continue;

        for (const entitlement of config.ios.entitlements) {
            if (entitlement.type !== 'array' || !('staticValue' in entitlement)) continue;
            if (result.includes(`<key>${entitlement.key}</key>`)) continue;

            const arrayItems = (entitlement.staticValue as unknown[])
                .map(value => `\t\t<string>${value}</string>`)
                .join('\n');
            const entryXml = `\t<key>${entitlement.key}</key>\n\t<array>\n${arrayItems}\n\t</array>\n`;

            const dictEnd = result.lastIndexOf('</dict>');
            if (dictEnd !== -1) {
                result = result.slice(0, dictEnd) + entryXml + result.slice(dictEnd);
            }
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
        const applinksRegex = /\s*<!-- start applinks configuration -->[\s\S]*?<!-- end applinks configuration -->\s*/i;
        result = result.replace(applinksRegex, '');
    }

    for (const serviceId of removedServiceIds) {
        const config = servicesConfig.find(c => c.id === serviceId);
        if (!config?.ios?.entitlements) continue;

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
