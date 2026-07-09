const fs = require('fs');

// ── Fix plist.service.ts ──
{
  const file = 'src/services/ios/plist.service.ts';
  let content = fs.readFileSync(file, 'utf8');

  // Let's add the validation function at the end of the file instead of trying to replace
  if (!content.includes('function validateIOSPermissionEntries')) {
    const validationFn = `\n
export function validateIOSPermissionEntries(entries: IOSPermissionEntry[]): void {
    for (const entry of entries) {
        if (!entry.permission || entry.permission.trim().length === 0) {
            throw new Error('iOS permission key cannot be empty');
        }
        if (typeof entry.value === 'string' && /[<>&]/.test(entry.value)) {
            if (!/&(lt|gt|amp|quot|apos);/.test(entry.value)) {
                throw new Error(\`iOS usage description for \${entry.permission} contains unescaped illegal characters (<, >, or &)\`);
            }
        }
    }
}
`;
    content += validationFn;
    
    // Also we need to actually call it in updateIOSPlist!
    content = content.replace(
      /const uniqueEntries = new Map<string, IOSPermissionEntry>\(\);/,
      "validateIOSPermissionEntries(permissionEntries);\n    const uniqueEntries = new Map<string, IOSPermissionEntry>();"
    );
    
    fs.writeFileSync(file, content, 'utf8');
  }
}

// ── Fix services-extractor.service.ts ──
{
  const file = 'src/services/services-extractor.service.ts';
  let content = fs.readFileSync(file, 'utf8');

  content = content.replace(
    /return serviceValues\.size > 0 \? serviceValues : undefined;/g,
    "return Object.keys(serviceValues).length > 0 ? (serviceValues as Record<string, string>) : undefined;"
  );

  content = content.replace(/extractAndroidMetaData\(manifest\)/g, 'extractAndroidMetaData(manifest) as Record<string, string>');
  content = content.replace(/extractAndroidStringResources\(stringsXml\)/g, 'extractAndroidStringResources(stringsXml) as Record<string, string>');
  content = content.replace(/extractIOSUrlSchemes\(plist\)/g, 'extractIOSUrlSchemes(plist) as Record<string, string>');
  content = content.replace(/extractIOSAppDelegate\(appDelegate\)/g, 'extractIOSAppDelegate(appDelegate) as Record<string, string>');
  content = content.replace(/extractIOSPlistEntries\(plist\)/g, 'extractIOSPlistEntries(plist) as Record<string, string>');

  // And the logger issues with error parameter being passed directly
  // Fix logger.error passing 'unknown' error parameter
content = content.replace(
  /logger\.error\(`Failed to parse google-services\.json`, error\);/g,
  "logger.error(`Failed to parse google-services.json`, error instanceof Error ? error : new Error(String(error)));"
);
content = content.replace(
  /logger\.error\('\[Services Extractor\] Error extracting services from Android manifest:', error\);/g,
  "logger.error('[Services Extractor] Error extracting services from Android manifest:', error instanceof Error ? error : new Error(String(error)));"
);
content = content.replace(
  /logger\.error\('\[Services Extractor\] Error extracting services from iOS plist:', error\);/g,
  "logger.error('[Services Extractor] Error extracting services from iOS plist:', error instanceof Error ? error : new Error(String(error)));"
);
content = content.replace(
  /logger\.error\('\[Services Extractor\] Error extracting services from Podfile:', error\);/g,
  "logger.error('[Services Extractor] Error extracting services from Podfile:', error instanceof Error ? error : new Error(String(error)));"
);
content = content.replace(
  /logger\.error\('\[Services Extractor\] Error extracting services from AppDelegate:', error\);/g,
  "logger.error('[Services Extractor] Error extracting services from AppDelegate:', error instanceof Error ? error : new Error(String(error)));"
);
content = content.replace(
  /logger\.error\('\[Services Extractor\] Error extracting services from Entitlements:', error\);/g,
  "logger.error('[Services Extractor] Error extracting services from Entitlements:', error instanceof Error ? error : new Error(String(error)));"
);
content = content.replace(
  /logger\.error\('\[Services Extractor\] Error resolving string reference:', error\);/g,
  "logger.error('[Services Extractor] Error resolving string reference:', error instanceof Error ? error : new Error(String(error)));"
);


  fs.writeFileSync(file, content, 'utf8');
}
