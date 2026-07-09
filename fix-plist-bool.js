const fs = require('fs');

const file = 'src/test/ios/plist.test.ts';
let content = fs.readFileSync(file, 'utf8');

// Fix value: 'false' to value: false
content = content.replace(
  /value: 'false', type: 'boolean'/g,
  "value: false, type: 'boolean'"
);

fs.writeFileSync(file, content, 'utf8');
console.log('Fixed plist.test.ts value type');
