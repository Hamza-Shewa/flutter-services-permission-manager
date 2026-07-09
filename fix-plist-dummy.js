const fs = require('fs');

const file = 'src/test/ios/plist.test.ts';
let content = fs.readFileSync(file, 'utf8');

// Replace empty android object with proper AndroidServiceConfig
content = content.replace(
  /android: \{\}/g,
  `android: { metaData: [], queries: [], applicationData: [] }`
);

fs.writeFileSync(file, content, 'utf8');
console.log('Fixed plist.test.ts dummy config');
