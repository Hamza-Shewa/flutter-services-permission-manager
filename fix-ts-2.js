const fs = require('fs');

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
        if (entry.usageDescription && /[<>&]/.test(entry.usageDescription)) {
            if (!/&(lt|gt|amp|quot|apos);/.test(entry.usageDescription)) {
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

{
  const file = 'src/services/services-extractor.service.ts';
  let content = fs.readFileSync(file, 'utf8');

  content = content.replace(
    /logger\.error\(([^,]+), error\)/g,
    "logger.error($1, error instanceof Error ? error : new Error(String(error)))"
  );
  content = content.replace(
    /logger\.error\(([^,]+), err\)/g,
    "logger.error($1, err instanceof Error ? err : new Error(String(err)))"
  );

  fs.writeFileSync(file, content, 'utf8');
}
