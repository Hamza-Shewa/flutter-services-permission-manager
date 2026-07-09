const fs = require('fs');

// ── Fix workspace.ts ──
{
  const file = 'src/services/workspace.ts';
  let content = fs.readFileSync(file, 'utf8');

  content = content.replace(
    /iosAppDelegateUri\?: vscode\.Uri;/g,
    "iosAppDelegateUri?: vscode.Uri;\n  androidStringsUri?: vscode.Uri;"
  );

  content = content.replace(
    /const iosAppDelegateUri = await findFirstFile\(\["ios\/Runner\/AppDelegate\.swift"\]\);/g,
    "const iosAppDelegateUri = await findFirstFile([\"ios/Runner/AppDelegate.swift\"]);\n  const androidStringsUri = await findFirstFile([\"android/app/src/main/res/values/strings.xml\"]);"
  );

  content = content.replace(
    /iosAppDelegateUri,/g,
    "iosAppDelegateUri,\n    androidStringsUri,"
  );

  fs.writeFileSync(file, content, 'utf8');
}

// ── Fix services-extractor.service.ts ──
{
  const file = 'src/services/services-extractor.service.ts';
  let content = fs.readFileSync(file, 'utf8');

  // Argument of type 'number' is not assignable to parameter of type 'Record<string, unknown>'
  content = content.replace(
    /return serviceValues\.size > 0 \? serviceValues : undefined;/g,
    "return Object.keys(serviceValues).length > 0 ? serviceValues : undefined;"
  );

  fs.writeFileSync(file, content, 'utf8');
}

// ── Fix webview/handlers/index.ts ──
{
  const file = 'src/webview/handlers/index.ts';
  let content = fs.readFileSync(file, 'utf8');

  content = content.replace(
    /appName: appNameData,/g,
    "appName: appNameData ?? { defaultName: '', localizations: {} },"
  );

  fs.writeFileSync(file, content, 'utf8');
}

// ── Fix webview/initializer.ts ──
{
  const file = 'src/webview/initializer.ts';
  let content = fs.readFileSync(file, 'utf8');

  content = content.replace(
    /appName: appNameData,/g,
    "appName: appNameData ?? { defaultName: '', localizations: {} },"
  );

  fs.writeFileSync(file, content, 'utf8');
}

console.log('Fixed workspace, extractor, handlers, initializer');
