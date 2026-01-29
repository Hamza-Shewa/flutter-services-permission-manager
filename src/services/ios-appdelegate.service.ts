/**
 * Service for updating AppDelegate.swift with service configurations
 */

import type { ServiceEntry, ServiceConfig } from '../types/index.js';

interface AppDelegateConfig {
    import?: string;
    code?: string;
}

/**
 * Updates AppDelegate.swift with service configurations (e.g., Google Maps API key)
 */
export function updateAppDelegateWithServices(
    content: string,
    services: ServiceEntry[],
    servicesConfig: ServiceConfig[]
): string {
    let result = content;

    for (const service of services) {
        const config = servicesConfig.find(c => c.id === service.id);
        if (!config) continue;

        // Check for appDelegate config
        const appDelegateConfig = (config.ios as { appDelegate?: AppDelegateConfig }).appDelegate;
        if (!appDelegateConfig) continue;

        // Add import if needed
        if (appDelegateConfig.import) {
            const importStatement = `import ${appDelegateConfig.import}`;
            if (!result.includes(importStatement)) {
                // Find the last import statement and add after it
                const importRegex = /^import\s+\w+\s*$/gm;
                let lastImportEnd = 0;
                let match;
                while ((match = importRegex.exec(result)) !== null) {
                    lastImportEnd = match.index + match[0].length;
                }
                
                if (lastImportEnd > 0) {
                    result = result.slice(0, lastImportEnd) + '\n' + importStatement + result.slice(lastImportEnd);
                } else {
                    // No imports found, add at beginning
                    result = importStatement + '\n' + result;
                }
            }
        }

        // Add/update code if needed
        if (appDelegateConfig.code) {
            // Replace placeholders with actual values
            let codeToInsert = appDelegateConfig.code;
            for (const [fieldId, fieldValue] of Object.entries(service.values)) {
                codeToInsert = codeToInsert.replace(`{${fieldId}}`, fieldValue);
            }

            // Check if the code pattern already exists (without the specific value)
            const codePattern = appDelegateConfig.code.replace(/\{(\w+)\}/g, '.*?');
            const existingCodeRegex = new RegExp(codePattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\\\.\\\*\\\?/g, '[^)]+'));
            
            if (existingCodeRegex.test(result)) {
                // Update existing code
                const updateRegex = new RegExp(
                    appDelegateConfig.code
                        .replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
                        .replace(/\\\{\\w+\\\}/g, '[^"\']+')
                        .replace(/\\"/g, '["\'"]')
                );
                result = result.replace(updateRegex, codeToInsert);
            } else {
                // Find where to insert - typically after GeneratedPluginRegistrant.register or at start of didFinishLaunchingWithOptions
                const registerPattern = /GeneratedPluginRegistrant\.register\(with:\s*self\)/;
                const registerMatch = result.match(registerPattern);
                
                if (registerMatch && registerMatch.index !== undefined) {
                    // Insert before GeneratedPluginRegistrant
                    const insertPos = registerMatch.index;
                    result = result.slice(0, insertPos) + codeToInsert + '\n    ' + result.slice(insertPos);
                } else {
                    // Find didFinishLaunchingWithOptions and insert after the opening brace
                    const didFinishPattern = /didFinishLaunchingWithOptions[^{]*\{/;
                    const didFinishMatch = result.match(didFinishPattern);
                    
                    if (didFinishMatch && didFinishMatch.index !== undefined) {
                        const insertPos = didFinishMatch.index + didFinishMatch[0].length;
                        result = result.slice(0, insertPos) + '\n    ' + codeToInsert + result.slice(insertPos);
                    }
                }
            }
        }
    }

    return result;
}

/**
 * Removes service entries from AppDelegate.swift
 */
export function removeServicesFromAppDelegate(
    content: string,
    removedServiceIds: string[],
    servicesConfig: ServiceConfig[]
): string {
    let result = content;
    
    for (const serviceId of removedServiceIds) {
        const config = servicesConfig.find(c => c.id === serviceId);
        if (!config) continue;
        
        const appDelegateConfig = (config.ios as { appDelegate?: AppDelegateConfig }).appDelegate;
        if (!appDelegateConfig) continue;
        
        // Remove the code line
        if (appDelegateConfig.code) {
            // Build a regex that matches the code with any value
            // e.g., GMSServices.provideAPIKey("{iosApiKey}") -> GMSServices.provideAPIKey("...")
            
            // First replace placeholders with a marker, then escape, then replace marker with pattern
            let codePattern = appDelegateConfig.code.replace(/\{(\w+)\}/g, '___PLACEHOLDER___');
            codePattern = codePattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');  // Escape regex chars
            codePattern = codePattern.replace(/___PLACEHOLDER___/g, '[^"\']*');  // Replace marker with pattern
            
            const codeRegex = new RegExp(`[ \\t]*${codePattern}[ \\t]*\\n?`, 'g');
            result = result.replace(codeRegex, '');
        }
        
        // Remove the import if no longer needed
        if (appDelegateConfig.import) {
            // Only remove if the import's functionality is no longer used in the file
            // Check if any code from this import is still present
            const importUsagePattern = new RegExp(`${appDelegateConfig.import}\\.\\w+`, 'i');
            if (!importUsagePattern.test(result)) {
                const importRegex = new RegExp(`\\n?import ${appDelegateConfig.import}[ \\t]*\\n?`, 'g');
                result = result.replace(importRegex, '\n');
            }
        }
    }
    
    // Clean up multiple blank lines
    result = result.replace(/\n{3,}/g, '\n\n');
    
    return result;
}
