/**
 * iOS Podfile manipulation service
 */

import * as vscode from 'vscode';
import type { IOSPermissionEntry } from '../../types/index.js';

/**
 * Extract existing permission macros from Podfile content
 */
export function extractPodfileMacros(content: string): string[] {
    const macros: string[] = [];
    const macroRegex = /'PERMISSION_[A-Z_]+=1'/g;
    let match;
    while ((match = macroRegex.exec(content)) !== null) {
        const macroName = match[0].replace(/'/g, '').replace('=1', '');
        macros.push(macroName);
    }
    return macros;
}

/**
 * Find the GCC_PREPROCESSOR_DEFINITIONS block boundaries
 * Returns start and end indices, or null if not found
 */
function findGccBlock(content: string): { start: number; end: number } | null {
    const searchStr = "config.build_settings['GCC_PREPROCESSOR_DEFINITIONS']";
    const gccStart = content.indexOf(searchStr);
    
    if (gccStart === -1) {
        return null;
    }
    
    // Find the ||= [ pattern AFTER the property accessor
    const afterAccessor = gccStart + searchStr.length;
    const assignPattern = content.indexOf('[', afterAccessor);
    
    if (assignPattern === -1) {
        return null;
    }
    
    // Now find the matching closing bracket
    // Since we're looking at a Ruby array of strings, we need to handle quotes properly
    let pos = assignPattern + 1;
    let depth = 1;
    
    while (pos < content.length && depth > 0) {
        const char = content[pos];
        
        // Count quotes to determine if we're in a string
        let inString = false;
        let quoteCount = 0;
        for (let i = assignPattern + 1; i < pos; i++) {
            if (content[i] === "'" && (i === 0 || content[i-1] !== '\\')) {
                quoteCount++;
            }
        }
        inString = quoteCount % 2 === 1;
        
        if (!inString) {
            if (char === '[') {
                depth++;
            } else if (char === ']') {
                depth--;
            }
        }
        pos++;
    }
    
    if (depth !== 0) {
        return null;
    }
    
    return { start: gccStart, end: pos };
}

/**
 * Update Podfile with new iOS permission macros.
 */
export async function updateIOSPodfile(
    document: vscode.TextDocument,
    iosPermissions: IOSPermissionEntry[],
    categorizedPermissions: Record<string, { permission: string; podfileMacro?: string }[]>
): Promise<vscode.WorkspaceEdit | null> {
    const content = document.getText();
    
    // Collect unique macros from the permissions being saved
    const macrosToAdd = new Set<string>();
    for (const perm of iosPermissions) {
        let macro = perm.podfileMacro;
        if (!macro) {
            for (const category of Object.values(categorizedPermissions)) {
                const found = category.find(p => p.permission === perm.permission);
                if (found?.podfileMacro) {
                    macro = found.podfileMacro;
                    break;
                }
            }
        }
        if (macro) {
            macrosToAdd.add(macro);
        }
    }
    
    if (macrosToAdd.size === 0) {
        return null;
    }
    
    const edit = new vscode.WorkspaceEdit();
    const macrosList = Array.from(macrosToAdd).sort();
    
    // Build the new block content
    const indent = '              ';
    const macroEntries = macrosList.map(m => `${indent}'${m}=1',`).join('\n');
    const gccBlockContent = `config.build_settings['GCC_PREPROCESSOR_DEFINITIONS'] ||= [
              '$(inherited)',
${macroEntries}
            ]`;
    
    // Deployment target to use in post_install
    const deploymentTarget = "16.6"; // Fallback to 16.6 as per how_pod_should_be

    // Check if GCC_PREPROCESSOR_DEFINITIONS block exists
    const gccBlock = findGccBlock(content);
    
    if (gccBlock) {
        // Replace existing block entirely
        const startPos = document.positionAt(gccBlock.start);
        const endPos = document.positionAt(gccBlock.end);
        edit.replace(document.uri, new vscode.Range(startPos, endPos), gccBlockContent);
    } else {
        // Check if target.build_configurations block exists
        const buildConfigRegex = /target\.build_configurations\.each\s+do\s+\|config\|/;
        const buildConfigMatch = buildConfigRegex.exec(content);
        
        if (buildConfigMatch) {
            const insertIndex = buildConfigMatch.index + buildConfigMatch[0].length;
            const insertBlock = `\n            ${gccBlockContent}`;
            const insertPos = document.positionAt(insertIndex);
            edit.insert(document.uri, insertPos, insertBlock);
        } else {
            // Look for post_install block
            const postInstallRegex = /post_install\s+do\s+\|installer\|/;
            const postInstallMatch = postInstallRegex.exec(content);
            
            if (postInstallMatch) {
                const insertIndex = postInstallMatch.index + postInstallMatch[0].length;
                const insertBlock = `
  installer.pods_project.targets.each do |target|
    flutter_additional_ios_build_settings(target)
    target.build_configurations.each do |config|
      config.build_settings['IPHONEOS_DEPLOYMENT_TARGET'] = '${deploymentTarget}'
      ${gccBlockContent}
    end
  end`;
                const insertPos = document.positionAt(insertIndex);
                edit.insert(document.uri, insertPos, insertBlock);
            } else {
                // Add complete post_install block at end of file
                const insertBlock = `

post_install do |installer|
  installer.pods_project.targets.each do |target|
    flutter_additional_ios_build_settings(target)
    target.build_configurations.each do |config|
      config.build_settings['IPHONEOS_DEPLOYMENT_TARGET'] = '${deploymentTarget}'
      ${gccBlockContent}
    end
  end

  # Additional project-level settings for all targets
  installer.pods_project.build_configurations.each do |config|
    config.build_settings['SWIFT_ENABLE_EXPLICIT_MODULES'] = 'NO'
  end

  # Copy TweetNacl header into pod root so ctweetnacl.c can include it
  require 'fileutils'
  tweetnacl_pod = File.join(__dir__, 'Pods', 'TweetNacl', 'Sources', 'CTweetNacl')
  src = File.join(tweetnacl_pod, 'include', 'ctweetnacl.h')
  dst = File.join(tweetnacl_pod, 'ctweetnacl.h')
  if File.exist?(src)
    begin
      FileUtils.cp(src, dst)
    rescue => e
      puts "[post_install] Failed copying ctweetnacl.h: #{e}"
    end
  end
end
`;
                const endPos = document.positionAt(content.length);
                edit.insert(document.uri, endPos, insertBlock);
            }
        }
    }
    
    return edit;
}
