const fs = require('fs');

const file = 'src/services/ios/plist.service.ts';
let content = fs.readFileSync(file, 'utf8');

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

if (!content.includes('function validateIOSPermissionEntries')) {
  content = content.replace(
      /export async function updateIOSPlist/,
      validationFn + '\nexport async function updateIOSPlist'
  );
  fs.writeFileSync(file, content, 'utf8');
}
