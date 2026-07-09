const fs = require('fs');

const file = 'src/test/ios/plist.test.ts';
let content = fs.readFileSync(file, 'utf8');

// Replace usageDescription with value
content = content.replace(/usageDescription:/g, 'value:');
// Replace isBoolean with type: 'boolean'
content = content.replace(/isBoolean: true/g, "type: 'boolean'");

// Rewrite the validateIOSPermissionEntries suite
content = content.replace(
  /suite\('validateIOSPermissionEntries'[\s\S]*?\}\);/g,
  `suite('validateIOSPermissionEntries', () => {
        test('throws on missing permission key', () => {
            const entries = [{ permission: '' }] as IOSPermissionEntry[];
            assert.throws(() => validateIOSPermissionEntries(entries), /iOS permission key cannot be empty/);
        });

        test('throws on unescaped illegal characters in value', () => {
            const entries = [{ permission: 'valid', value: 'this & that' }] as IOSPermissionEntry[];
            assert.throws(() => validateIOSPermissionEntries(entries), /contains unescaped illegal characters/);
        });

        test('passes on valid entries', () => {
            const entries = [{ permission: 'valid', value: 'this &amp; that' }] as IOSPermissionEntry[];
            assert.doesNotThrow(() => validateIOSPermissionEntries(entries));
        });
    });`
);

fs.writeFileSync(file, content, 'utf8');
console.log('Fixed plist.test.ts');
