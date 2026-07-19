import * as vscode from 'vscode';
import * as path from 'path';

/**
 * Resolves @string/xxx or @values/xxx references by loading the appropriate XML resource file
 */
export async function resolveStringReference(
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
