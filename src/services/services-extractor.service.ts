/**
 * Service for extracting configured services from AndroidManifest.xml and Info.plist
 */

import * as vscode from 'vscode';
import * as path from 'path';
import type { ServiceEntry, ServiceConfig } from '../types/index.js';

/**
 * Resolves @string/xxx or @values/xxx references by loading the appropriate XML resource file
 */
async function resolveStringReference(
    reference: string,
    androidManifestUri: vscode.Uri
): Promise<string | null> {
    // Check if it's a resource reference
    const match = reference.match(/^@(\w+)\/(\w+)$/);
    if (!match) {
        return reference; // Not a reference, return as-is
    }

    const [, resourceType, resourceName] = match;
    
    // Get workspace folder from manifest path using path module for cross-platform support
    // AndroidManifest is typically at: android/app/src/main/AndroidManifest.xml
    // strings.xml is at: android/app/src/main/res/values/strings.xml
    const manifestDir = path.dirname(androidManifestUri.fsPath);
    
    // Determine the resource file name based on type
    let resourceFileName: string;
    switch (resourceType) {
        case 'string':
            resourceFileName = 'strings.xml';
            break;
        case 'values':
            resourceFileName = 'values.xml';
            break;
        case 'color':
            resourceFileName = 'colors.xml';
            break;
        case 'dimen':
            resourceFileName = 'dimens.xml';
            break;
        default:
            resourceFileName = `${resourceType}s.xml`;
    }

    const resourcePath = path.join(manifestDir, 'res', 'values', resourceFileName);
    console.log(`[Services Extractor] Looking for resource ${resourceName} in ${resourcePath}`);
    
    try {
        const resourceUri = vscode.Uri.file(resourcePath);
        const doc = await vscode.workspace.openTextDocument(resourceUri);
        const content = doc.getText();
        
        // Parse the XML to find the string value
        // Looking for: <string name="xxx">value</string>
        const regex = new RegExp(`<string\\s+name="${resourceName}"[^>]*>([^<]*)</string>`, 'i');
        const valueMatch = content.match(regex);
        
        if (valueMatch) {
            console.log(`[Services Extractor] Resolved ${reference} to ${valueMatch[1]}`);
            return valueMatch[1];
        }
        
        console.log(`[Services Extractor] Could not find ${resourceName} in ${resourceFileName}`);
        return null;
    } catch (err) {
        console.log(`[Services Extractor] Error reading resource file: ${err}`);
        return null;
    }
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
        
        console.log('[Services Extractor] Extracting services from Android manifest');
        console.log('[Services Extractor] Services config count:', servicesConfig.length);

        for (const serviceConfig of servicesConfig) {
            const extractedValues: Record<string, string> = {};
            let foundService = false;
            
            console.log(`[Services Extractor] Checking for service: ${serviceConfig.id}`);

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
                        console.log(`[Services Extractor] Found meta-data ${metaDataConfig.name} = ${value}`);
                        
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
                if (queryConfig.tag === 'provider' && queryConfig.attributes['android:authorities']) {
                    const authority = queryConfig.attributes['android:authorities'].replace(/\./g, '\\.');
                    const providerRegex = new RegExp(`<provider[^>]*android:authorities="${authority}"`, 'i');
                    
                    if (providerRegex.test(content)) {
                        foundService = true;
                    }
                }
            }

            // If we found indicators of this service, try to get display name from strings.xml
            if (foundService) {
                console.log(`[Services Extractor] Found service ${serviceConfig.id}`);
                
                // For Facebook, try to get display name from app_name or a facebook-specific string
                if (serviceConfig.id === 'facebook' && !extractedValues['displayName']) {
                    const appName = await resolveStringReference('@string/app_name', androidManifestUri);
                    if (appName) {
                        extractedValues['displayName'] = appName;
                    }
                }
                
                // Only add if we have at least one value
                if (Object.keys(extractedValues).length > 0) {
                    console.log(`[Services Extractor] Adding service ${serviceConfig.id} with values:`, extractedValues);
                    services.push({
                        id: serviceConfig.id,
                        values: extractedValues
                    });
                }
            }
        }

        console.log(`[Services Extractor] Found ${services.length} services`);
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

            // Check plist entries
            for (const plistEntry of serviceConfig.ios.plistEntries) {
                if (plistEntry.type === 'string' && plistEntry.valueField) {
                    // Look for: <key>FacebookAppID</key>\n<string>value</string>
                    const keyRegex = new RegExp(
                        `<key>${plistEntry.key}</key>\\s*<string>([^<]+)</string>`,
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
                }
            }

            // Check URL schemes - look for schemes in all CFBundleURLSchemes arrays
            if (serviceConfig.ios.urlSchemes) {
                for (const urlScheme of serviceConfig.ios.urlSchemes) {
                    const prefix = urlScheme.prefix || '';
                    
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
                            if (!schemeValue) continue;
                            
                            if (prefix && schemeValue.startsWith(prefix)) {
                                foundService = true;
                                const valueWithoutPrefix = schemeValue.substring(prefix.length);
                                
                                // Only set if not already extracted
                                if (!extractedValues[urlScheme.valueField]) {
                                    extractedValues[urlScheme.valueField] = valueWithoutPrefix;
                                }
                            } else if (!prefix && schemeValue.includes('.googleusercontent.apps.')) {
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

            // Only add service if we found actual values (not empty strings)
            const hasValidValues = Object.values(extractedValues).some(v => v && v.trim());
            if (foundService && hasValidValues) {
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
        
        console.log('[Services Extractor] Extracting from AppDelegate.swift');

        for (const serviceConfig of servicesConfig) {
            const extractedValues: Record<string, string> = {};
            let foundService = false;

            // Check for appDelegate config
            const appDelegateConfig = (serviceConfig.ios as { appDelegate?: { import?: string; code?: string } }).appDelegate;
            if (!appDelegateConfig) continue;
            
            // Check if import exists
            if (appDelegateConfig.import && content.includes(`import ${appDelegateConfig.import}`)) {
                foundService = true;
                console.log(`[Services Extractor] Found import: ${appDelegateConfig.import}`);
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
                        console.log(`[Services Extractor] Found Google Maps API key: ${match[1]}`);
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
                            const valueRegex = new RegExp(methodName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '["\'"]([^"\']+)["\'"]');
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
                console.log(`[Services Extractor] Adding service ${serviceConfig.id} from AppDelegate`);
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

/**
 * Extracts services from Android, iOS plist, and AppDelegate, merging the results
 */
export async function extractServices(
    androidManifestUri: vscode.Uri | undefined,
    iosPlistUri: vscode.Uri | undefined,
    iosAppDelegateUri: vscode.Uri | undefined,
    servicesConfig: ServiceConfig[]
): Promise<ServiceEntry[]> {
    const [androidServices, iosServices, appDelegateServices] = await Promise.all([
        extractServicesFromAndroid(androidManifestUri, servicesConfig),
        extractServicesFromIOS(iosPlistUri, servicesConfig),
        extractServicesFromAppDelegate(iosAppDelegateUri, servicesConfig)
    ]);

    // Merge services, preferring values from all sources
    const mergedServices: Map<string, ServiceEntry> = new Map();

    // Add Android services
    for (const service of androidServices) {
        mergedServices.set(service.id, service);
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

    return Array.from(mergedServices.values());
}
