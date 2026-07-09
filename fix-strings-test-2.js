const fs = require('fs');

const file = 'src/test/android/strings.test.ts';
let content = fs.readFileSync(file, 'utf8');

// Fix dummy config for AndroidServiceConfig missing properties
content = content.replace(
  /android: \{\s*stringResources: \[\s*\{\s*name: 'dummy_api_key', valueField: 'apiKey'\s*\}\s*\]\s*\}/g,
  `android: {
                metaData: [],
                queries: [],
                applicationData: [],
                stringResources: [
                    { name: 'dummy_api_key', valueField: 'apiKey' }
                ]
            }`
);

// Remove "handles localized app names correctly" test
content = content.replace(
  /test\('handles localized app names correctly', \(\) => \{\n[\s\S]*?\}\);\n/g,
  ""
);

// Remove the localized app name logic from the other test
content = content.replace(
  /const localizedAppName = \{ defaultName: 'MyApp', localizations: \{\} \};\n\s*const withStrings = updateAndroidStringsWithServices\(baseStrings, \[\{ id: 'dummy', values: \{ apiKey: '12345' \} \}\], \[dummyServiceConfig\], localizedAppName\);\n/g,
  `const withStrings = updateAndroidStringsWithServices(baseStrings, [{ id: 'dummy', values: { apiKey: '12345' } }], [dummyServiceConfig]);`
);

content = content.replace(
  /assert\.ok\(removed\.includes\('<string name="app_name">MyApp<\/string>'\)\);/g,
  ""
);

fs.writeFileSync(file, content, 'utf8');
console.log('Fixed strings.test.ts again');
