const fs = require('fs');

const file = 'src/test/android/manifest.test.ts';
let content = fs.readFileSync(file, 'utf8');

// Fix dummy config for intent-filters missing attributes
content = content.replace(
  /tag: 'intent-filter',/g,
  "tag: 'intent-filter', attributes: {},"
);

fs.writeFileSync(file, content, 'utf8');
console.log('Added attributes: {} to intent-filter');
