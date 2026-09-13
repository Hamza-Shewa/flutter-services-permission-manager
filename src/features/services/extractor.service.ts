/**
 * Service for extracting configured services from AndroidManifest.xml and Info.plist
 */

import * as vscode from 'vscode';
import * as path from 'path';
import type { ServiceEntry, ServiceConfig } from '../../core/types/index.js';
import { extractAndroidAppNameLocalizations, extractAppNameFromManifest } from '../localization/android.localization.service.js';
import { extractIOSAppNameLocalizations, extractAppNameFromInfoPlist } from '../localization/ios.localization.service.js';
import { extractApplinkIntents } from './intent-parser.js';
import { resolveStringReference } from '../localization/string-resolver.js';
import { GENERATED_SERVICES_DART_PATH, extractDartServiceConfig } from './dart-config.service.js';

function joinDomains(domains: string[]): string {
    return Array.from(new Set(domains)).join(', ');
}

function joinUnique(values: string[]): string {
    return Array.from(new Set(values)).join(', ');
}

/**
 * Extracts configured services from AndroidManifest.xml
 */
export async function extractServicesFromAndroid(
    androidManifestUri: vscode.Uri | undefined,
    servicesConfig: ServiceConfig[]
): Promise<ServiceEntry[]> {
    if (!androidManifestUri) {
        console.log('[Services Extractor] No Android manifest URI provided');
        return [];
    }

    try {
        const doc = await vscode.workspace.openTextDocument(androidManifestUri);
        const content = doc.getText();
        const services: ServiceEntry[] = [];
        
        for (const serviceConfig of servicesConfig) {
            const extractedValues: Record<string, string> = {};
            let foundService = false;
            
            if (serviceConfig.id === 'applinks') {
                const applinksRegex = /<!-- start applinks configuration -->[\s\S]*?<!-- end applinks configuration -->/i;
                const applinksBlock = content.match(applinksRegex)?.[0] ?? '';

                let hosts: string[] = [];
                let schemes: string[] = [];

                if (applinksBlock) {
                    const schemeMatches = Array.from(applinksBlock.matchAll(/android:scheme=["']([^"']+)["']/gi));
                    const hostMatches = Array.from(applinksBlock.matchAll(/android:host=["']([^"']+)["']/gi));
                    const flutterMatch = applinksBlock.match(/android:name=["']flutter_deeplinking_enabled["'][^>]*android:value=["']([^"']+)["']/i);

                    hosts = hostMatches.map(match => match[1]).filter(Boolean);
                    if (hosts.length > 0) {
                        foundService = true;
                        extractedValues['domains'] = joinDomains(hosts);
                    }

                    schemes = schemeMatches.map(match => match[1]).filter(Boolean);
                    if (schemes.length > 0) {
                        foundService = true;
                        extractedValues['scheme'] = joinUnique(schemes);
                    }

                    if (flutterMatch?.[1]) {
                        foundService = true;
                        extractedValues['flutterDeepLinkingEnabled'] = flutterMatch[1];
                    }
                }

                // Fallback: derive hosts/schemes from any VIEW/DEFAULT/BROWSABLE intent-filter (non-authorize)
                if (hosts.length === 0 || schemes.length === 0) {
                    const fallback = extractApplinkIntents(content);
                    if (fallback.hosts.length > 0) {
                        foundService = true;
                        extractedValues['domains'] = joinDomains(fallback.hosts);
                    }
                    if (fallback.schemes.length > 0) {
                        foundService = true;
                        extractedValues['scheme'] = joinUnique(fallback.schemes);
                    }
                }

                // Fallback: capture flutter_deeplinking_enabled meta-data even if block markers are missing
                if (!extractedValues['flutterDeepLinkingEnabled']) {
                    const fallbackFlutterMatch = content.match(/<meta-data[^>]*android:name=["']flutter_deeplinking_enabled["'][^>]*android:value=["']([^"']+)["']/i);
                    if (fallbackFlutterMatch?.[1]) {
                        foundService = true;
                        extractedValues['flutterDeepLinkingEnabled'] = fallbackFlutterMatch[1];
                    }
                }

                const packageMatch = content.match(/<manifest[^>]*\bpackage=["']([^"']+)["']/i);
                if (packageMatch?.[1]) {
                    extractedValues['packageName'] = packageMatch[1];
                    foundService = true;
                }
            }

            // Check meta-data entries - handle attributes in any order
            for (const metaDataConfig of serviceConfig.android.metaData) {
                const escapedName = metaDataConfig.name.replace(/\./g, '\\.');
                // Match meta-data with name attribute, then find the value
                const metaDataRegex = new RegExp(
                    `<meta-data[^>]*android:name=["']${escapedName}["'][^>]*>`,
                    'is'
                );
                const tagMatch = content.match(metaDataRegex);
                
                if (tagMatch) {
                    // Now extract the value from the matched tag
                    const valueRegex = /android:value=["']([^"']*)["']/i;
                    const valueMatch = tagMatch[0].match(valueRegex);
                    
                    if (valueMatch) {
                        foundService = true;
                        let value = valueMatch[1];
                        // Resolve string references
                        if (value.startsWith('@')) {
                            const resolved = await resolveStringReference(value, androidManifestUri);
                            if (resolved) {
                                value = resolved;
                            }
                        }
                        
                        // Remove prefix if defined (e.g., "fb" prefix for Facebook App ID)
                        if (metaDataConfig.prefix && value.startsWith(metaDataConfig.prefix)) {
                            value = value.substring(metaDataConfig.prefix.length);
                        }
                        
                        extractedValues[metaDataConfig.valueField] = value;
                    }
                }
            }

            // Check for activities specific to the service
            for (const appData of serviceConfig.android.applicationData) {
                if (appData.tag === 'activity' && appData.attributes['android:name']) {
                    const activityName = appData.attributes['android:name'].replace(/\./g, '\\.');
                    const activityRegex = new RegExp(`<activity[^>]*android:name="${activityName}"`, 'i');
                    
                    if (activityRegex.test(content)) {
                        foundService = true;
                        
                        // For activities with schemes (like CustomTabActivity), extract the scheme
                        if (appData.children) {
                            for (const child of appData.children as { tag: string; children?: { tag: string; attributes: Record<string, string> }[] }[]) {
                                if (child.tag === 'intent-filter' && child.children) {
                                    for (const intentChild of child.children) {
                                        if (intentChild.tag === 'data' && intentChild.attributes['android:scheme']) {
                                            const schemePattern = intentChild.attributes['android:scheme'];
                                            // Check if it has a placeholder like {appId}
                                            const placeholderMatch = schemePattern.match(/\{(\w+)\}/);
                                            if (placeholderMatch) {
                                                const fieldName = placeholderMatch[1];
                                                const prefix = schemePattern.substring(0, schemePattern.indexOf('{'));
                                                
                                                // Find the actual scheme in manifest
                                                const schemeRegex = new RegExp(
                                                    `<data[^>]*android:scheme="([^"]*)"[^>]*android:host="authorize"`,
                                                    'i'
                                                );
                                                const schemeMatch = content.match(schemeRegex);
                                                
                                                if (schemeMatch) {
                                                    let schemeValue = schemeMatch[1];
                                                    
                                                    // Resolve string reference
                                                    if (schemeValue.startsWith('@')) {
                                                        const resolved = await resolveStringReference(schemeValue, androidManifestUri);
                                                        if (resolved) {
                                                            schemeValue = resolved;
                                                        }
                                                    }
                                                    
                                                    // Remove prefix to get the actual value
                                                    if (prefix && schemeValue.startsWith(prefix)) {
                                                        const valueWithoutPrefix = schemeValue.substring(prefix.length);
                                                        // Only set if not already set from meta-data
                                                        if (!extractedValues[fieldName]) {
                                                            extractedValues[fieldName] = valueWithoutPrefix;
                                                        }
                                                    }
                                                }
                                            }
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
            }

            // Check queries for service-specific providers
            for (const queryConfig of serviceConfig.android.queries) {
                const identifyingAttribute = queryConfig.attributes['android:authorities']
                    ? ['android:authorities', queryConfig.attributes['android:authorities']]
                    : queryConfig.attributes['android:name']
                        ? ['android:name', queryConfig.attributes['android:name']]
                        : undefined;
                if (identifyingAttribute) {
                    const [attribute, rawValue] = identifyingAttribute;
                    const value = rawValue.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
                    const queryRegex = new RegExp(
                        `<${queryConfig.tag}[^>]*${attribute.replace(':', '\\:')}=["']${value}["']`,
                        'i',
                    );
                    if (queryRegex.test(content)) {foundService = true;}
                }
            }

            for (const intentFilter of serviceConfig.android.mainActivityIntentFilters ?? []) {
                const markerRegex = new RegExp(
                    `<!-- flutter-config-manager service:${serviceConfig.id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')} -->[\\s\\S]*?<!-- end flutter-config-manager service:${serviceConfig.id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')} -->`,
                    'i',
                );
                const markedBlock = content.match(markerRegex)?.[0];
                const source = markedBlock || content;
                const dataConfigs = intentFilter.children?.filter(child => child.tag === 'data') ?? [];
                for (const dataConfig of dataConfigs) {
                    const dataTags = Array.from(source.matchAll(/<data\b[^>]*>/gi)).map(match => match[0]);
                    for (const dataTag of dataTags) {
                        let matches = true;
                        const captured: Record<string, string> = {};
                        for (const [attribute, template] of Object.entries(dataConfig.attributes)) {
                            const actual = dataTag.match(new RegExp(`${attribute.replace(':', '\\:')}=["']([^"']*)["']`, 'i'))?.[1];
                            const placeholder = template.match(/^\{(\w+)\}$/)?.[1];
                            if (placeholder) {
                                if (actual) {captured[placeholder] = actual;} else if (serviceConfig.fields.some(field => field.id === placeholder && field.required)) {matches = false;}
                            } else if (actual !== template) {
                                matches = false;
                            }
                        }
                        if (matches) {
                            foundService = true;
                            Object.assign(extractedValues, captured);
                            break;
                        }
                    }
                }
            }

            // If we found indicators of this service, try to get display name from strings.xml
            if (foundService) {
                // For Facebook, try to get display name from app_name or a facebook-specific string
                if (serviceConfig.id === 'facebook' && !extractedValues['displayName']) {
                    const appName = await resolveStringReference('@string/app_name', androidManifestUri);
                    if (appName) {
                        extractedValues['displayName'] = appName;
                    }
                }
                
                services.push({
                    id: serviceConfig.id,
                    values: extractedValues
                });
            }
        }

        return services;
    } catch (error) {
        console.error('[Services Extractor] Error extracting services from Android:', error);
        return [];
    }
}

/**
 * Extracts configured services from Info.plist
 */
export async function extractServicesFromIOS(
    iosPlistUri: vscode.Uri | undefined,
    servicesConfig: ServiceConfig[]
): Promise<ServiceEntry[]> {
    if (!iosPlistUri) {
        return [];
    }

    try {
        const doc = await vscode.workspace.openTextDocument(iosPlistUri);
        const content = doc.getText();
        const services: ServiceEntry[] = [];

        for (const serviceConfig of servicesConfig) {
            const extractedValues: Record<string, string> = {};
            let foundService = false;

            if (serviceConfig.id === 'applinks') {
                const applinksRegex = /<!-- start applinks configuration -->[\s\S]*?<!-- end applinks configuration -->/i;
                const applinksBlock = content.match(applinksRegex)?.[0] ?? '';
                if (applinksBlock) {
                    const bundleMatch = applinksBlock.match(/<key>CFBundleURLName<\/key>\s*<string>([^<]+)<\/string>/i);
                    const schemeMatch = applinksBlock.match(/<key>CFBundleURLSchemes<\/key>[\s\S]*?<string>([^<]+)<\/string>/i);
                    if (bundleMatch?.[1]) {
                        extractedValues['bundleId'] = bundleMatch[1].trim();
                        foundService = true;
                    }
                    if (schemeMatch?.[1]) {
                        extractedValues['scheme'] = schemeMatch[1].trim();
                        foundService = true;
                    }
                }
            }

            // Check plist entries
            for (const plistEntry of serviceConfig.ios.plistEntries) {
                if (plistEntry.type === 'string' && plistEntry.valueField) {
                    // Look for: <key>FacebookAppID</key>\n<string>value</string>
                    const escapedKey = plistEntry.key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
                    const keyRegex = new RegExp(
                        `<key>${escapedKey}</key>\\s*<string>([^<]+)</string>`,
                        'i'
                    );
                    const match = content.match(keyRegex);
                    
                    if (match && match[1].trim()) {
                        foundService = true;
                        let value = match[1].trim();
                        
                        // Remove prefix if defined
                        if (plistEntry.prefix && value.startsWith(plistEntry.prefix)) {
                            value = value.substring(plistEntry.prefix.length);
                        }
                        
                        extractedValues[plistEntry.valueField] = value;
                    }
                } else if (plistEntry.type === 'boolean') {
                    // Check for boolean entries: <key>xxx</key>\s*<true/> or <false/>
                    const escapedKey = plistEntry.key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
                    const boolRegex = new RegExp(
                        `<key>${escapedKey}</key>\\s*<(true|false)/>`,
                        'i'
                    );
                    if (boolRegex.test(content)) {
                        foundService = true;
                    }
                }
            }

            // Check URL schemes - look for schemes in all CFBundleURLSchemes arrays
            if (serviceConfig.ios.urlSchemes) {
                for (const urlScheme of serviceConfig.ios.urlSchemes) {
                    const prefix = urlScheme.prefix || '';
                    const markerRegex = new RegExp(
                        `<!-- flutter-config-manager service:${serviceConfig.id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')} url-scheme -->[\\s\\S]*?<key>CFBundleURLSchemes<\\/key>\\s*<array>[\\s\\S]*?<string>([^<]+)<\\/string>[\\s\\S]*?<!-- end flutter-config-manager service:${serviceConfig.id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')} url-scheme -->`,
                        'i',
                    );
                    const ownedScheme = content.match(markerRegex)?.[1]?.trim();
                    if (ownedScheme) {
                        foundService = true;
                        if (urlScheme.valueField) {
                            extractedValues[urlScheme.valueField] = prefix && ownedScheme.startsWith(prefix)
                                ? ownedScheme.slice(prefix.length)
                                : ownedScheme;
                        }
                        continue;
                    }
                    
                    // Find all CFBundleURLSchemes arrays and extract all strings
                    const urlSchemesBlockRegex = /<key>CFBundleURLSchemes<\/key>\s*<array>([\s\S]*?)<\/array>/gi;
                    let blockMatch;
                    
                    while ((blockMatch = urlSchemesBlockRegex.exec(content)) !== null) {
                        const arrayContent = blockMatch[1];
                        // Extract all <string>xxx</string> values
                        const stringRegex = /<string>([^<]+)<\/string>/g;
                        let stringMatch;
                        
                        while ((stringMatch = stringRegex.exec(arrayContent)) !== null) {
                            const schemeValue = stringMatch[1].trim();
                            if (!schemeValue) {continue;}

                            if (urlScheme.staticValue && schemeValue === urlScheme.staticValue) {
                                foundService = true;
                                continue;
                            }
                            
                            if (prefix && urlScheme.valueField && schemeValue.startsWith(prefix)) {
                                foundService = true;
                                const valueWithoutPrefix = schemeValue.substring(prefix.length);
                                
                                // Only set if not already extracted
                                if (!extractedValues[urlScheme.valueField]) {
                                    extractedValues[urlScheme.valueField] = valueWithoutPrefix;
                                }
                            } else if (!prefix && urlScheme.valueField && schemeValue.includes('.googleusercontent.apps.')) {
                                // Google reversed client ID
                                foundService = true;
                                if (!extractedValues[urlScheme.valueField]) {
                                    extractedValues[urlScheme.valueField] = schemeValue;
                                }
                            }
                        }
                    }
                }
            }

            if (foundService) {
                services.push({
                    id: serviceConfig.id,
                    values: extractedValues
                });
            }
        }

        return services;
    } catch (error) {
        console.error('[Services Extractor] Error extracting services from iOS:', error);
        return [];
    }
}

/**
 * Extracts configured services from iOS entitlements (e.g., applinks associated domains)
 */
export async function extractServicesFromIOSEntitlements(
    iosEntitlementsUri: vscode.Uri | undefined,
    servicesConfig: ServiceConfig[]
): Promise<ServiceEntry[]> {
    if (!iosEntitlementsUri) {
        return [];
    }

    try {
        const doc = await vscode.workspace.openTextDocument(iosEntitlementsUri);
        const content = doc.getText();
        const services: ServiceEntry[] = [];

        for (const serviceConfig of servicesConfig) {
            const extractedValues: Record<string, string> = {};
            let foundService = false;

            if (serviceConfig.id === 'applinks') {
                const associatedDomains = content.match(
                    /<key>com\.apple\.developer\.associated-domains<\/key>\s*<array>([\s\S]*?)<\/array>/i,
                )?.[1] ?? '';
                const domains = Array.from(associatedDomains.matchAll(/<string>applinks:([^<]+)<\/string>/gi))
                    .map(match => match[1].trim())
                    .filter(Boolean);
                if (domains.length > 0) {
                    extractedValues['domains'] = joinDomains(domains);
                    foundService = true;
                }
            } else {
                for (const entitlement of serviceConfig.ios.entitlements ?? []) {
                    const escapedKey = entitlement.key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
                    const arrayContent = content.match(
                        new RegExp(`<key>${escapedKey}<\\/key>\\s*<array>([\\s\\S]*?)<\\/array>`, 'i'),
                    )?.[1];
                    if (!arrayContent) {continue;}
                    foundService = true;
                    if (entitlement.valueField) {
                        const values = Array.from(arrayContent.matchAll(/<string>([^<]+)<\/string>/gi))
                            .map(match => match[1].trim())
                            .filter(Boolean);
                        if (values[0]) {extractedValues[entitlement.valueField] = values[0];}
                    }
                }
            }

            if (foundService) {
                services.push({
                    id: serviceConfig.id,
                    values: extractedValues
                });
            }
        }

        return services;
    } catch (error) {
        console.error('[Services Extractor] Error extracting services from entitlements:', error);
        return [];
    }
}

/**
 * Extracts configured services from AppDelegate.swift (e.g., Google Maps API key)
 */
export async function extractServicesFromAppDelegate(
    appDelegateUri: vscode.Uri | undefined,
    servicesConfig: ServiceConfig[]
): Promise<ServiceEntry[]> {
    if (!appDelegateUri) {
        return [];
    }

    try {
        const doc = await vscode.workspace.openTextDocument(appDelegateUri);
        const content = doc.getText();
        const services: ServiceEntry[] = [];
        
        for (const serviceConfig of servicesConfig) {
            const extractedValues: Record<string, string> = {};
            let foundService = false;

            // Check for appDelegate config
            const appDelegateConfig = (serviceConfig.ios as { appDelegate?: { import?: string; code?: string } }).appDelegate;
            if (!appDelegateConfig) {continue;}
            
            // Check if import exists
            if (appDelegateConfig.import && content.includes(`import ${appDelegateConfig.import}`)) {
                foundService = true;
            }
            
            // Extract values based on code pattern
            if (appDelegateConfig.code) {
                // Special handling for known patterns
                if (appDelegateConfig.code.includes('GMSServices.provideAPIKey')) {
                    // Match: GMSServices.provideAPIKey("xxx") or GMSServices.provideAPIKey('xxx')
                    const gmsRegex = /GMSServices\.provideAPIKey\(["']([^"']+)["']\)/;
                    const match = content.match(gmsRegex);
                    if (match && match[1]) {
                        foundService = true;
                        extractedValues['iosApiKey'] = match[1];
                    }
                } else if (appDelegateConfig.code.includes('FirebaseApp.configure')) {
                    // Firebase detection - just check if the call exists
                    if (content.includes('FirebaseApp.configure()')) {
                        foundService = true;
                    }
                } else if (appDelegateConfig.code.includes('ApplicationDelegate.shared.application')) {
                    // Facebook SDK detection
                    if (content.includes('ApplicationDelegate.shared.application')) {
                        foundService = true;
                    }
                } else {
                    // Generic pattern matching for other services
                    const placeholderMatch = appDelegateConfig.code.match(/\{(\w+)\}/);
                    if (placeholderMatch) {
                        const fieldId = placeholderMatch[1];
                        // Extract the function/method name before the placeholder
                        const codeBeforePlaceholder = appDelegateConfig.code.split('{')[0];
                        const methodMatch = codeBeforePlaceholder.match(/(\w+)\(["']?$/);
                        
                        if (methodMatch) {
                            // Build a simple regex to find the value
                            const methodName = codeBeforePlaceholder.replace(/["']$/, '');
                            const escapedMethod = methodName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
                            const valueRegex = new RegExp(escapedMethod + '["\'"]([^"\']+)["\'"]');
                            const valueMatch = content.match(valueRegex);
                            
                            if (valueMatch && valueMatch[1]) {
                                foundService = true;
                                extractedValues[fieldId] = valueMatch[1];
                            }
                        }
                    }
                }
            }

            if (foundService && Object.keys(extractedValues).length > 0) {
                services.push({
                    id: serviceConfig.id,
                    values: extractedValues
                });
            }
        }

        return services;
    } catch (error) {
        console.error('[Services Extractor] Error extracting services from AppDelegate:', error);
        return [];
    }
}

function findPlatformRoot(filePath: string, platformDirName: string): string | undefined {
    const segments = filePath.split(path.sep);
    const index = segments.lastIndexOf(platformDirName);
    if (index === -1) {return undefined;}
    return segments.slice(0, index + 1).join(path.sep);
}

async function extractAssociatedApplinksFiles(
    workspaceRoot: vscode.Uri | undefined,
    androidManifestUri: vscode.Uri | undefined,
    iosPlistUri: vscode.Uri | undefined,
    androidMainActivityUri: vscode.Uri | undefined,
    iosPbxprojUri: vscode.Uri | undefined
): Promise<Record<string, string>> {
    const values: Record<string, string> = {};

    if (workspaceRoot) {
        try {
            const outputRoot = vscode.Uri.joinPath(workspaceRoot, '.flutter-config-manager', 'app-links-hosting');
            const entries = await vscode.workspace.fs.readDirectory(outputRoot);
            const domains = entries.filter(([, type]) => type === vscode.FileType.Directory).map(([name]) => name);
            if (domains.length > 0) {values['domains'] = joinDomains(domains);}

            for (const domain of domains) {
                const wellKnown = vscode.Uri.joinPath(outputRoot, domain, '.well-known');
                if (!values['packageName']) {
                    try {
                        const bytes = await vscode.workspace.fs.readFile(vscode.Uri.joinPath(wellKnown, 'assetlinks.json'));
                        const json = JSON.parse(Buffer.from(bytes).toString('utf8')) as Array<{ target?: { package_name?: string; sha256_cert_fingerprints?: string[] } }>;
                        const target = json[0]?.target;
                        if (target?.package_name) {values['packageName'] = target.package_name;}
                        if (target?.sha256_cert_fingerprints?.length) {
                            values['sha256CertFingerprints'] = target.sha256_cert_fingerprints.join(', ');
                        }
                    } catch { /* Android hosting artifact is optional. */ }
                }
                if (!values['teamId']) {
                    try {
                        const bytes = await vscode.workspace.fs.readFile(vscode.Uri.joinPath(wellKnown, 'apple-app-site-association'));
                        const json = JSON.parse(Buffer.from(bytes).toString('utf8')) as { applinks?: { details?: Array<{ appIDs?: string[]; appID?: string }> } };
                        const appId = json.applinks?.details?.[0]?.appIDs?.[0] || json.applinks?.details?.[0]?.appID;
                        if (appId?.includes('.')) {
                            const [teamId, ...bundleParts] = appId.split('.');
                            values['teamId'] = teamId;
                            values['bundleId'] = bundleParts.join('.');
                        }
                    } catch { /* Apple hosting artifact is optional. */ }
                }
            }
        } catch {
            // Generated hosting output has not been created yet.
        }
    }

    try {
        let androidRoot: string | undefined;
        if (androidManifestUri) {
            androidRoot = findPlatformRoot(androidManifestUri.fsPath, 'android');
        }
        if (!androidRoot && androidMainActivityUri) {
            androidRoot = findPlatformRoot(androidMainActivityUri.fsPath, 'android');
        }

        if (androidRoot) {
            const assetlinksPath = path.join(androidRoot, 'assetlinks.json');
            const assetlinksUri = vscode.Uri.file(assetlinksPath);
            const assetlinksBytes = await vscode.workspace.fs.readFile(assetlinksUri);
            const assetlinksContent = Buffer.from(assetlinksBytes).toString('utf-8');
            const assetlinksJson = JSON.parse(assetlinksContent) as Array<{ target?: { package_name?: string; sha256_cert_fingerprints?: string[] } }>;

            const firstTarget = assetlinksJson?.[0]?.target;
            if (firstTarget?.package_name) {
                values['packageName'] = firstTarget.package_name;
            }
            if (firstTarget?.sha256_cert_fingerprints?.length) {
                values['sha256CertFingerprints'] = firstTarget.sha256_cert_fingerprints.join(', ');
            }
        }
    } catch (error: any) {
        if (error?.code !== 'FileNotFound') {
            console.log('[Services Extractor] assetlinks.json unreadable:', error);
        }
    }

    try {
        if (androidMainActivityUri) {
            const doc = await vscode.workspace.openTextDocument(androidMainActivityUri);
            const content = doc.getText();
            const packageMatch = content.match(/^\s*package\s+([a-zA-Z0-9_.]+)\s*;?/m);
            if (packageMatch?.[1]) {
                values['packageName'] = packageMatch[1];
            }
        }
    } catch (error) {
        console.log('[Services Extractor] MainActivity package not found:', error);
    }

    try {
        if (iosPlistUri) {
            const iosRoot = findPlatformRoot(iosPlistUri.fsPath, 'ios');
            if (iosRoot) {
                const associationPath = path.join(iosRoot, 'apple-app-site-association');
                const associationUri = vscode.Uri.file(associationPath);
                const associationBytes = await vscode.workspace.fs.readFile(associationUri);
                const associationContent = Buffer.from(associationBytes).toString('utf-8');
                const associationJson = JSON.parse(associationContent) as { applinks?: { details?: Array<{ appID?: string }> } };
                const appId = associationJson?.applinks?.details?.[0]?.appID;
                if (appId && appId.includes('.')) {
                    const [teamId, ...bundleParts] = appId.split('.');
                    values['teamId'] = teamId;
                    values['bundleId'] = bundleParts.join('.');
                }
            }
        }
    } catch (error: any) {
        if (error?.code !== 'FileNotFound') {
            console.log('[Services Extractor] apple-app-site-association unreadable:', error);
        }
    }

    try {
        if (iosPbxprojUri) {
            const doc = await vscode.workspace.openTextDocument(iosPbxprojUri);
            const content = doc.getText();
            const teamMatch = content.match(/\bDEVELOPMENT_TEAM\s*=\s*([A-Z0-9]+);/);
            if (teamMatch?.[1]) {
                values['teamId'] = teamMatch[1];
            }
            const bundleMatch = content.match(/\bPRODUCT_BUNDLE_IDENTIFIER\s*=\s*([^;\n]+);/);
            if (bundleMatch?.[1]) {
                const bundleId = bundleMatch[1].trim().replace(/^"|"$/g, '');
                values['bundleId'] = bundleId;
            }
        }
    } catch (error) {
        console.log('[Services Extractor] project.pbxproj values not found:', error);
    }

    return values;
}

/**
 * Extracts app name localization from Android and iOS
 */
async function extractAppNameService(
    workspaceRoot: vscode.Uri | undefined,
    androidManifestUri: vscode.Uri | undefined,
    iosPlistUri: vscode.Uri | undefined
): Promise<ServiceEntry | undefined> {
    if (!workspaceRoot) {return undefined;}
    
    let defaultName: string | undefined;
    const allLocalizations: Record<string, string> = {};
    
    // Try Android first
    if (androidManifestUri) {
        try {
            const manifestDoc = await vscode.workspace.openTextDocument(androidManifestUri);
            const manifestContent = manifestDoc.getText();
            defaultName = extractAppNameFromManifest(manifestContent);
            
            // If using @string/app_name, read from strings.xml
            if (!defaultName) {
                const androidLocalizations = await extractAndroidAppNameLocalizations(workspaceRoot);
                if (androidLocalizations) {
                    defaultName = androidLocalizations.defaultName;
                    Object.assign(allLocalizations, androidLocalizations.localizations);
                }
            }
        } catch (error) {
            console.log('[Services Extractor] Could not extract Android app name:', error);
        }
    }
    
    // Try iOS
    if (iosPlistUri) {
        try {
            const plistDoc = await vscode.workspace.openTextDocument(iosPlistUri);
            const plistContent = plistDoc.getText();
            const iosAppNames = extractAppNameFromInfoPlist(plistContent);
            
            if (!defaultName && iosAppNames.displayName) {
                defaultName = iosAppNames.displayName;
            }
            
            // Extract from InfoPlist.strings if available
            const iosLocalizations = await extractIOSAppNameLocalizations(workspaceRoot);
            if (iosLocalizations) {
                if (!defaultName) {
                    defaultName = iosLocalizations.defaultName;
                }
                // Merge iOS localizations (prefer Android if both exist)
                for (const [lang, name] of Object.entries(iosLocalizations.localizations)) {
                    if (!allLocalizations[lang]) {
                        allLocalizations[lang] = name;
                    }
                }
            }
        } catch (error) {
            console.log('[Services Extractor] Could not extract iOS app name:', error);
        }
    }
    
    if (!defaultName) {return undefined;}
    
    return {
        id: 'appName',
        values: {
            defaultName,
            localizations: Object.keys(allLocalizations).length > 0 
                ? JSON.stringify(allLocalizations) 
                : ''
        }
    };
}

/**
 * Extracts services from Android, iOS plist, and AppDelegate, merging the results
 */
export async function extractServices(
    workspaceRoot: vscode.Uri | undefined,
    androidManifestUri: vscode.Uri | undefined,
    androidMainActivityUri: vscode.Uri | undefined,
    iosPlistUri: vscode.Uri | undefined,
    iosAppDelegateUri: vscode.Uri | undefined,
    iosEntitlementsUri: vscode.Uri | undefined,
    iosPbxprojUri: vscode.Uri | undefined,
    servicesConfig: ServiceConfig[]
): Promise<ServiceEntry[]> {
    let dartServices: ServiceEntry[] = [];
    if (workspaceRoot) {
        try {
            const uri = vscode.Uri.joinPath(workspaceRoot, ...GENERATED_SERVICES_DART_PATH.split('/'));
            const content = Buffer.from(await vscode.workspace.fs.readFile(uri)).toString('utf8');
            dartServices = extractDartServiceConfig(content, servicesConfig);
        } catch {
            // Runtime constants have not been generated for this project.
        }
    }

    const [androidServices, iosServices, appDelegateServices, entitlementsServices, appNameService] = await Promise.all([
        extractServicesFromAndroid(androidManifestUri, servicesConfig),
        extractServicesFromIOS(iosPlistUri, servicesConfig),
        extractServicesFromAppDelegate(iosAppDelegateUri, servicesConfig),
        extractServicesFromIOSEntitlements(iosEntitlementsUri, servicesConfig),
        extractAppNameService(workspaceRoot, androidManifestUri, iosPlistUri)
    ]);

    // Merge services, preferring values from all sources
    const mergedServices: Map<string, ServiceEntry> = new Map();

    for (const service of dartServices) {
        mergedServices.set(service.id, service);
    }

    // Add Android services
    for (const service of androidServices) {
        const existing = mergedServices.get(service.id);
        mergedServices.set(service.id, {
            id: service.id,
            values: { ...existing?.values, ...service.values },
        });
    }

    // Merge iOS plist services
    for (const service of iosServices) {
        const existing = mergedServices.get(service.id);
        if (existing) {
            existing.values = { ...service.values, ...existing.values };
        } else {
            mergedServices.set(service.id, service);
        }
    }

    // Merge AppDelegate services
    for (const service of appDelegateServices) {
        const existing = mergedServices.get(service.id);
        if (existing) {
            existing.values = { ...service.values, ...existing.values };
        } else {
            mergedServices.set(service.id, service);
        }
    }

    // Merge entitlements services
    for (const service of entitlementsServices) {
        const existing = mergedServices.get(service.id);
        if (existing) {
            existing.values = { ...service.values, ...existing.values };
        } else {
            mergedServices.set(service.id, service);
        }
    }

    const applinksAssociatedValues = await extractAssociatedApplinksFiles(
        workspaceRoot,
        androidManifestUri,
        iosPlistUri,
        androidMainActivityUri,
        iosPbxprojUri
    );
    if (Object.keys(applinksAssociatedValues).length > 0) {
        const existing = mergedServices.get('applinks');
        if (existing) {
            existing.values = { ...applinksAssociatedValues, ...existing.values };
        } else {
            mergedServices.set('applinks', { id: 'applinks', values: applinksAssociatedValues });
        }
    }

    // Add appName service if found
    if (appNameService) {
        mergedServices.set('appName', appNameService);
    }

    return Array.from(mergedServices.values());
}
