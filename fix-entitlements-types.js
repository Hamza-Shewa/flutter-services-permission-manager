const fs = require('fs');

const file = 'src/test/ios/entitlements.test.ts';
let content = fs.readFileSync(file, 'utf8');

content = content.replace(
  /ios: \{/g,
  "ios: { plistEntries: [], urlSchemes: [],"
);

content = content.replace(
  /\[\{ id: 'dummy' \}\]/g,
  "[{ id: 'dummy', values: {} }]"
);

fs.writeFileSync(file, content, 'utf8');
console.log('Fixed entitlements.test.ts types');
