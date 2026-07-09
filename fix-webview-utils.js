const fs = require('fs');

const file = 'src/test/webview-utils.test.ts';
let content = fs.readFileSync(file, 'utf8');

content = content.replace(/describe\(/g, 'suite(');
content = content.replace(/it\(/g, 'test(');

fs.writeFileSync(file, content, 'utf8');
console.log('Fixed webview-utils.test.ts');
