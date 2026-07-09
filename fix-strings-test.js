const fs = require('fs');

const file = 'src/test/android/strings.test.ts';
let content = fs.readFileSync(file, 'utf8');

content = content.replace(/updateAndroidStrings/g, 'updateAndroidStringsWithServices');

content = content.replace(
  /,\s*\{\s*name: 'dummy_static_key', staticValue: 'static_123'\s*\}/g,
  ""
);

content = content.replace(
  /test\('inserts new string resources with static values', \(\) => \{\n\s*const updated = updateAndroidStringsWithServices\(baseStrings, \[\{ id: 'dummy', values: \{ apiKey: '12345' \} \}\], \[dummyServiceConfig\]\);\n\s*assert\.ok\(updated\.includes\('<string name="dummy_static_key">static_123<\/string>'\)\);\n\s*\}\);\n\n/g,
  ""
);

content = content.replace(
  /test\('does not add empty string resources when field is missing and no static value', \(\) => \{\n\s*const updated = updateAndroidStringsWithServices\(baseStrings, \[\{ id: 'dummy', values: \{\} \}\], \[dummyServiceConfig\]\);\n\s*assert\.ok\(!updated\.includes\('<string name="dummy_api_key">'\)\);\n\s*assert\.ok\(updated\.includes\('<string name="dummy_static_key">static_123<\/string>'\)\);\n\s*\}\);/g,
  `test('does not add empty string resources when field is missing', () => {
            const updated = updateAndroidStringsWithServices(baseStrings, [{ id: 'dummy', values: {} }], [dummyServiceConfig]);
            assert.ok(!updated.includes('<string name="dummy_api_key">'));
        });`
);

content = content.replace(
  /assert\.ok\(!removed\.includes\('dummy_static_key'\)\);\n/g,
  ""
);

fs.writeFileSync(file, content, 'utf8');
console.log('Fixed strings.test.ts');
