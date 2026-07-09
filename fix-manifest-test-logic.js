const fs = require('fs');

const file = 'src/test/android/manifest.test.ts';
let content = fs.readFileSync(file, 'utf8');

// Fix dummy config for intent-filters
content = content.replace(
  /mainActivityIntentFilters: \[\n\s*\{\s*tag: 'action', attributes: \{\s*'android:name': 'android\.intent\.action\.VIEW'\s*\}\s*\}\n\s*\]/g,
  `mainActivityIntentFilters: [
                    { 
                        tag: 'intent-filter', 
                        children: [
                            { tag: 'action', attributes: { 'android:name': 'android.intent.action.VIEW' } }
                        ] 
                    }
                ]`
);

// Fix "preserves existing permissions" to "replaces all permissions with the new list"
content = content.replace(
  /test\('preserves existing permissions while adding new ones', async \(\) => \{\n\s*const withCamera = await updateAndroidManifest\(baseManifest, \['android\.permission\.CAMERA'\]\);\n\s*const updated = await updateAndroidManifest\(withCamera, \['android\.permission\.INTERNET'\]\);\n\s*assert\.ok\(updated\.includes\('<uses-permission android:name="android\.permission\.CAMERA" \/>'\)\);\n\s*assert\.ok\(updated\.includes\('<uses-permission android:name="android\.permission\.INTERNET" \/>'\)\);\n\s*\}\);/g,
  `test('replaces all permissions with the new list', async () => {
            const withCamera = await updateAndroidManifest(baseManifest, ['android.permission.CAMERA']);
            const updated = await updateAndroidManifest(withCamera, ['android.permission.INTERNET', 'android.permission.LOCATION']);
            assert.ok(!updated.includes('<uses-permission android:name="android.permission.CAMERA" />'));
            assert.ok(updated.includes('<uses-permission android:name="android.permission.INTERNET" />'));
            assert.ok(updated.includes('<uses-permission android:name="android.permission.LOCATION" />'));
        });`
);

// Fix "returns original string if empty permission list"
content = content.replace(
  /test\('returns original string if empty permission list', async \(\) => \{\n\s*const updated = await updateAndroidManifest\(baseManifest, \[\]\);\n\s*assert\.strictEqual\(updated, baseManifest\);\n\s*\}\);/g,
  `test('removes all permissions if empty list is provided', async () => {
            const withCamera = await updateAndroidManifest(baseManifest, ['android.permission.CAMERA']);
            const updated = await updateAndroidManifest(withCamera, []);
            assert.ok(!updated.includes('<uses-permission'));
        });`
);

fs.writeFileSync(file, content, 'utf8');
console.log('Fixed test logic');
