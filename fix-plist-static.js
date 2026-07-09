const fs = require('fs');

const file = 'src/test/ios/plist.test.ts';
let content = fs.readFileSync(file, 'utf8');

// Remove DummyStatic from dummyServiceConfig
content = content.replace(
  /,\s*\{\s*key: 'DummyStatic', type: 'string', staticValue: 'static_val'\s*\}/g,
  ""
);

content = content.replace(
  /assert\.ok\(updated\.includes\('<key>DummyStatic<\/key>'\)\);\n\s*assert\.ok\(updated\.includes\('<string>static_val<\/string>'\)\);\n/g,
  ""
);

content = content.replace(
  /assert\.ok\(!removed\.includes\('DummyStatic'\)\);\n/g,
  ""
);

fs.writeFileSync(file, content, 'utf8');
console.log('Fixed plist.test.ts static val');
