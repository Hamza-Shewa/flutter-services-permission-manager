/**
 * Android localization service for app name management
 */

import * as vscode from 'vscode';
import * as path from 'path';

/**
 * Gets the strings.xml file URI for a specific language
 * @param workspaceRoot - Workspace root URI
 * @param languageCode - Language code (e.g., 'en', 'ar', 'values' for default)
 * @returns URI to the strings.xml file
 */
export async function getStringsFileForLanguage(
    workspaceRoot: vscode.Uri,
    languageCode: string
): Promise<vscode.Uri | undefined> {
    const isDefault = languageCode === 'default' || languageCode === 'values';
    const valuesDir = isDefault ? 'values' : `values-${languageCode}`;
    const valuesPath = vscode.Uri.joinPath(workspaceRoot, 'android', 'app', 'src', 'main', 'res', valuesDir);
    const stringsPath = vscode.Uri.joinPath(valuesPath, 'strings.xml');
    
    try {
        await vscode.workspace.fs.stat(stringsPath);
        return stringsPath;
    } catch {
        return undefined;
    }
}

/**
 * Creates a new strings.xml file for a specific language
 * @param workspaceRoot - Workspace root URI
 * @param languageCode - Language code (e.g., 'en', 'ar')
 * @returns URI to the created strings.xml file
 */
export async function createStringsFileForLanguage(
    workspaceRoot: vscode.Uri,
    languageCode: string
): Promise<vscode.Uri | undefined> {
    const isDefault = languageCode === 'default' || languageCode === 'values';
    const valuesDir = isDefault ? 'values' : `values-${languageCode}`;
    const valuesPath = vscode.Uri.joinPath(workspaceRoot, 'android', 'app', 'src', 'main', 'res', valuesDir);
    const stringsPath = vscode.Uri.joinPath(valuesPath, 'strings.xml');
    
    try {
        // Ensure the values directory exists
        try {
            await vscode.workspace.fs.stat(valuesPath);
        } catch {
            await vscode.workspace.fs.createDirectory(valuesPath);
        }
        
        // Create default content
        const defaultContent = `<?xml version="1.0" encoding="utf-8"?>
<resources>
    <string name="app_name">App</string>
</resources>
`;
        await vscode.workspace.fs.writeFile(stringsPath, Buffer.from(defaultContent, 'utf-8'));
        return stringsPath;
    } catch (error) {
        console.error(`Failed to create strings.xml for ${languageCode}:`, error);
        return undefined;
    }
}

/**
 * Extracts the app name from strings.xml content
 * @param stringsContent - Content of strings.xml
 * @returns The app name value or undefined if not found
 */
export function extractAppNameFromStrings(stringsContent: string): string | undefined {
    const regex = /<string\s+name="app_name"[^>]*>([^<]*)<\/string>/i;
    const match = stringsContent.match(regex);
    return match?.[1];
}

/**
 * Updates the app_name string in strings.xml content
 * @param stringsContent - Content of strings.xml
 * @param appName - New app name value
 * @returns Updated content
 */
export function updateAppNameInStrings(stringsContent: string, appName: string): string {
    const regex = /<string\s+name="app_name"[^>]*>([^<]*)<\/string>/i;
    
    if (regex.test(stringsContent)) {
        // Update existing app_name
        return stringsContent.replace(regex, `<string name="app_name">${appName}</string>`);
    } else {
        // Add app_name before </resources>
        const resourcesEndMatch = stringsContent.match(/(\s*)<\/resources>/);
        if (resourcesEndMatch) {
            const indent = resourcesEndMatch[1] || '\n';
            const newString = `    <string name="app_name">${appName}</string>${indent}`;
            return stringsContent.replace(/(\s*)<\/resources>/, `\n${newString}</resources>`);
        }
    }
    
    return stringsContent;
}

/**
 * Updates AndroidManifest.xml to use @string/app_name for the application label
 * @param manifestContent - Content of AndroidManifest.xml
 * @returns Updated content
 */
export function updateManifestToUseLocalizedAppName(manifestContent: string): string {
    // Check if application tag has android:label with a hardcoded string
    const appLabelRegex = /(<application[^>]*android:label=")([^"@]+)("[^>]*>)/i;
    
    if (appLabelRegex.test(manifestContent)) {
        // Replace hardcoded label with @string/app_name
        return manifestContent.replace(appLabelRegex, '$1@string/app_name$3');
    }
    
    // If no label is set, add @string/app_name
    const appTagWithoutLabel = /(<application)(\s+)(android:name=|android:icon=)/i;
    if (appTagWithoutLabel.test(manifestContent)) {
        return manifestContent.replace(appTagWithoutLabel, '$1$2android:label="@string/app_name" $3');
    }
    
    return manifestContent;
}

/**
 * Checks if AndroidManifest.xml is using @string/app_name
 * @param manifestContent - Content of AndroidManifest.xml
 * @returns true if using localized app name
 */
export function isUsingLocalizedAppName(manifestContent: string): boolean {
    const appLabelRegex = /<application[^>]*android:label="@string\/app_name"[^>]*>/i;
    return appLabelRegex.test(manifestContent);
}

/**
 * Extracts the app name from AndroidManifest.xml (either hardcoded or from @string/app_name)
 * @param manifestContent - Content of AndroidManifest.xml
 * @returns The app name value or undefined if not found
 */
export function extractAppNameFromManifest(manifestContent: string): string | undefined {
    // First check for @string/app_name reference
    const stringRefRegex = /<application[^>]*android:label="@string\/app_name"[^>]*>/i;
    if (stringRefRegex.test(manifestContent)) {
        // It's using string reference, need to read from strings.xml
        return undefined; // Signal to read from strings.xml
    }
    
    // Check for hardcoded label
    const hardcodedRegex = /<application[^>]*android:label="([^"@]+)"[^>]*>/i;
    const match = manifestContent.match(hardcodedRegex);
    if (match?.[1]) {
        return match[1];
    }
    
    return undefined;
}

/**
 * Gets all available language codes from the res directory
 * @param workspaceRoot - Workspace root URI
 * @returns Array of language codes
 */
export async function getAvailableLanguages(
    workspaceRoot: vscode.Uri
): Promise<string[]> {
    const resPath = vscode.Uri.joinPath(workspaceRoot, 'android', 'app', 'src', 'main', 'res');
    const languages: string[] = [];
    
    try {
        const entries = await vscode.workspace.fs.readDirectory(resPath);
        
        for (const [name, type] of entries) {
            if (type === vscode.FileType.Directory) {
                if (name === 'values') {
                    languages.push('default');
                } else if (name.startsWith('values-')) {
                    const langCode = name.replace('values-', '');
                    languages.push(langCode);
                }
            }
        }
    } catch (error) {
        console.error('Failed to read res directory:', error);
    }
    
    return languages;
}

/**
 * Updates app name localizations for Android
 * Creates/modifies strings.xml files for each language
 * @param workspaceRoot - Workspace root URI
 * @param localizations - Record of language code to app name
 * @param defaultName - Default app name for fallback
 */
export async function updateAndroidAppNameLocalizations(
    workspaceRoot: vscode.Uri,
    localizations: Record<string, string>,
    defaultName: string
): Promise<void> {
    // Ensure default values/strings.xml exists
    let defaultStringsUri = await getStringsFileForLanguage(workspaceRoot, 'default');
    if (!defaultStringsUri) {
        defaultStringsUri = await createStringsFileForLanguage(workspaceRoot, 'default');
    }
    
    if (defaultStringsUri) {
        // Update default app name
        const doc = await vscode.workspace.openTextDocument(defaultStringsUri);
        let content = doc.getText();
        content = updateAppNameInStrings(content, defaultName);
        await vscode.workspace.fs.writeFile(defaultStringsUri, Buffer.from(content, 'utf-8'));
    }
    
    // Update/create localized strings.xml files
    for (const [langCode, appName] of Object.entries(localizations)) {
        if (langCode === 'default') { continue; }
        
        let stringsUri = await getStringsFileForLanguage(workspaceRoot, langCode);
        if (!stringsUri) {
            stringsUri = await createStringsFileForLanguage(workspaceRoot, langCode);
        }
        
        if (stringsUri) {
            const doc = await vscode.workspace.openTextDocument(stringsUri);
            let content = doc.getText();
            content = updateAppNameInStrings(content, appName);
            await vscode.workspace.fs.writeFile(stringsUri, Buffer.from(content, 'utf-8'));
        }
    }
}

/**
 * Extracts all localized app names from Android project
 * @param workspaceRoot - Workspace root URI
 * @returns Record of language codes to app names
 */
export async function extractAndroidAppNameLocalizations(
    workspaceRoot: vscode.Uri
): Promise<{ defaultName: string; localizations: Record<string, string> } | undefined> {
    const localizations: Record<string, string> = {};
    let defaultName: string | undefined;
    
    // Get default app name from values/strings.xml
    const defaultStringsUri = await getStringsFileForLanguage(workspaceRoot, 'default');
    if (defaultStringsUri) {
        const doc = await vscode.workspace.openTextDocument(defaultStringsUri);
        defaultName = extractAppNameFromStrings(doc.getText());
    }
    
    // Get all available languages
    const languages = await getAvailableLanguages(workspaceRoot);
    
    // Extract app names for each language
    for (const langCode of languages) {
        if (langCode === 'default') { continue; }
        
        const stringsUri = await getStringsFileForLanguage(workspaceRoot, langCode);
        if (stringsUri) {
            const doc = await vscode.workspace.openTextDocument(stringsUri);
            const appName = extractAppNameFromStrings(doc.getText());
            if (appName) {
                localizations[langCode] = appName;
            }
        }
    }
    
    if (!defaultName) {
        return undefined;
    }
    
    return { defaultName, localizations };
}
