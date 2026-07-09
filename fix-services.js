const fs = require('fs');

const file = 'src/types/services.ts';
let content = fs.readFileSync(file, 'utf8');

content = content.replace(
  /type\?: 'text' \| 'list' \| 'toggle';/g,
  "type?: 'text' | 'list' | 'toggle';\n    validationPattern?: string;\n    validationMessage?: string;"
);

content = content.replace(
  /appDelegate\?: IOSAppDelegateConfig;/g,
  "appDelegate?: IOSAppDelegateConfig & { import?: string; code?: string; };"
);

fs.writeFileSync(file, content, 'utf8');
console.log('Fixed services.ts');
