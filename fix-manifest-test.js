const fs = require('fs');

// ── Fix manifest.test.ts ──
{
  const file = 'src/test/android/manifest.test.ts';
  let content = fs.readFileSync(file, 'utf8');

  content = content.replace(
      /removeServicesFromAndroidManifest\(withService, \[\{ id: 'dummy', values: \{ apiKey: '12345' \} \}\], \[dummyServiceConfig\]\)/g,
      "removeServicesFromAndroidManifest(withService, ['dummy'], [dummyServiceConfig])"
  );

  fs.writeFileSync(file, content, 'utf8');
}

console.log('Fixed TS compilation issues for manifest.test.ts.');
