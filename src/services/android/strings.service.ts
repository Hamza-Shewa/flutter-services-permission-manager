/**
 * Android strings.xml resource management service
 */

import * as vscode from 'vscode';
import type { ServiceEntry, ServiceConfig } from '../../types/index.js';

/**
 * Gets or creates the strings.xml file URI
 */
export async function getOrCreateStringsFile(workspaceRoot: vscode.Uri): Promise<vscode.Uri | undefined> {
    const valuesPath = vscode.Uri.joinPath(workspaceRoot, 'android', 'app', 'src', 'main', 'res', 'values');
    const stringsPath = vscode.Uri.joinPath(valuesPath, 'strings.xml');
    
    try {
        await vscode.workspace.fs.stat(stringsPath);
        return stringsPath;
    } catch {
        // File doesn't exist, try to create it
        try {
            // Ensure the values directory exists
            try {
                await vscode.workspace.fs.stat(valuesPath);
            } catch {
                // Create the directory if it doesn't exist
                await vscode.workspace.fs.createDirectory(valuesPath);
            }
            
            const defaultContent = `<?xml version="1.0" encoding="utf-8"?>
<resources>
    <string name="app_name">App</string>
</resources>
`;
            await vscode.workspace.fs.writeFile(stringsPath, Buffer.from(defaultContent, 'utf-8'));
            return stringsPath;
        } catch (createError) {
            console.error('Failed to create strings.xml:', createError);
            return undefined;
        }
    }
}

/**
 * Updates strings.xml with service string resources
 */
export function updateAndroidStringsWithServices(
    stringsContent: string,
    services: ServiceEntry[],
    servicesConfig: ServiceConfig[]
): string {
    let result = stringsContent;
    
    for (const service of services) {
        const config = servicesConfig.find(c => c.id === service.id);
        if (!config?.android?.stringResources) continue;
        
        for (const stringRes of config.android.stringResources) {
            let value = (service.values || {})[stringRes.valueField] || '';
            if (!value) continue;
            
            // Apply prefix if defined
            if (stringRes.prefix) {
                value = stringRes.prefix + value;
            }
            
            const stringName = stringRes.name;
            
            // Check if string already exists
            const existingRegex = new RegExp(
                `<string\\s+name="${stringName}"[^>]*>([^<]*)</string>`,
                'i'
            );
            const existingMatch = result.match(existingRegex);
            
            if (existingMatch) {
                // Update existing string value
                result = result.replace(
                    existingRegex,
                    `<string name="${stringName}">${value}</string>`
                );
            } else {
                // Add new string before </resources>
                const resourcesEndMatch = result.match(/(\s*)<\/resources>/);
                if (resourcesEndMatch) {
                    const indent = resourcesEndMatch[1] || '\n';
                    const newString = `    <string name="${stringName}">${value}</string>${indent}`;
                    result = result.replace(
                        /(\s*)<\/resources>/,
                        `\n${newString}</resources>`
                    );
                }
            }
        }
    }
    
    return result;
}

/**
 * Removes service string resources from strings.xml
 */
export function removeServicesFromAndroidStrings(
    stringsContent: string,
    removedServiceIds: string[],
    servicesConfig: ServiceConfig[]
): string {
    let result = stringsContent;
    
    for (const serviceId of removedServiceIds) {
        const config = servicesConfig.find(c => c.id === serviceId);
        if (!config?.android?.stringResources) continue;
        
        for (const stringRes of config.android.stringResources) {
            const stringRegex = new RegExp(
                `\\s*<string\\s+name="${stringRes.name}"[^>]*>[^<]*</string>`,
                'gi'
            );
            result = result.replace(stringRegex, '');
        }
    }
    
    // Clean up multiple blank lines
    result = result.replace(/\n{3,}/g, '\n\n');
    
    return result;
}

/**
 * Reads a string value from strings.xml
 */
export function getStringFromResources(stringsContent: string, stringName: string): string | undefined {
    const regex = new RegExp(`<string\\s+name="${stringName}"[^>]*>([^<]*)</string>`, 'i');
    const match = stringsContent.match(regex);
    return match ? match[1] : undefined;
}

/**
 * Checks if strings.xml has a specific string resource
 */
export function hasStringResource(stringsContent: string, stringName: string): boolean {
    const regex = new RegExp(`<string\\s+name="${stringName}"`, 'i');
    return regex.test(stringsContent);
}
