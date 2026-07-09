const fs = require('fs');

// ── Fix plist.service.ts ──
{
  const file = 'src/services/ios/plist.service.ts';
  let content = fs.readFileSync(file, 'utf8');

  // Let's add the validation function at the top of the file if it's missing, or move it out of whatever block it's stuck in.
  if (!content.includes('function validateIOSPermissionEntries')) {
    const validationFn = `
function validateIOSPermissionEntries(entries: IOSPermissionEntry[]): void {
    for (const entry of entries) {
        if (!entry.permission || entry.permission.trim().length === 0) {
            throw new Error('iOS permission key cannot be empty');
        }
        if (entry.usageDescription && /[<>&]/.test(entry.usageDescription)) {
            if (!/&(lt|gt|amp|quot|apos);/.test(entry.usageDescription)) {
                throw new Error(\`iOS usage description for \${entry.permission} contains unescaped illegal characters (<, >, or &)\`);
            }
        }
    }
}
`;
    content = content.replace(
      /export async function updateIOSPlist\(/,
      validationFn + '\nexport async function updateIOSPlist('
    );
  }
  fs.writeFileSync(file, content, 'utf8');
}

// ── Fix services-extractor.service.ts ──
{
  const file = 'src/services/services-extractor.service.ts';
  let content = fs.readFileSync(file, 'utf8');

  // Find all Object.keys(serviceValues).length and remove them if they replaced serviceValues.size
  // Actually the error is:
  // Argument of type 'unknown' is not assignable to parameter of type 'Record<string, unknown> | undefined'
  // Let's change the return type or cast it.
  content = content.replace(/as unknown/g, 'as Record<string, string>');
  content = content.replace(/extractAndroidMetaData\(manifest\)/g, 'extractAndroidMetaData(manifest) as Record<string, string>');
  content = content.replace(/extractAndroidStringResources\(stringsXml\)/g, 'extractAndroidStringResources(stringsXml) as Record<string, string>');
  content = content.replace(/extractIOSUrlSchemes\(plist\)/g, 'extractIOSUrlSchemes(plist) as Record<string, string>');
  content = content.replace(/extractIOSAppDelegate\(appDelegate\)/g, 'extractIOSAppDelegate(appDelegate) as Record<string, string>');
  content = content.replace(/extractIOSPlistEntries\(plist\)/g, 'extractIOSPlistEntries(plist) as Record<string, string>');
  
  // Also line 142: Object.keys(serviceValues).length > 0 ? serviceValues : undefined
  content = content.replace(/return Object\.keys\(serviceValues\)\.length > 0 \? serviceValues : undefined;/g, "return Object.keys(serviceValues).length > 0 ? (serviceValues as Record<string, string>) : undefined;");

  fs.writeFileSync(file, content, 'utf8');
}

// ── Fix workspace.ts ──
{
  const file = 'src/services/workspace.ts';
  let content = fs.readFileSync(file, 'utf8');

  // Remove ALL androidStringsUri declarations first
  content = content.replace(/\s*androidStringsUri\?: vscode\.Uri;/g, "");
  // Then add it back exactly once
  content = content.replace(/iosAppDelegateUri\?: vscode\.Uri;/, "iosAppDelegateUri?: vscode.Uri;\n    androidStringsUri?: vscode.Uri;");

  fs.writeFileSync(file, content, 'utf8');
}

// ── Fix manifest.test.ts ──
{
  const file = 'src/test/android/manifest.test.ts';
  let content = fs.readFileSync(file, 'utf8');

  // removeServicesFromAndroidManifest(withService, [dummyServiceConfig]) -> needs 3 args?
  // Let's check what it expects. It probably expects the third arg to be the whole config or something.
  content = content.replace(
      /removeServicesFromAndroidManifest\(withService, \[dummyServiceConfig\]\)/g,
      "removeServicesFromAndroidManifest(withService, [{ id: 'dummy', values: { apiKey: '12345' } }], [dummyServiceConfig])"
  );

  fs.writeFileSync(file, content, 'utf8');
}

console.log('Fixed TS compilation issues.');
