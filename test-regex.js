const appDelegateConfig = { code: 'DummySDK.provideAPIKey("{apiKey}")' };
let result = 'DummySDK.provideAPIKey("old")';
const codeToInsert = 'DummySDK.provideAPIKey("new")';

const codePattern = appDelegateConfig.code.replace(/\{(\w+)\}/g, '.*?');
const existingCodeRegex = new RegExp(codePattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\\\.\\\*\\\?/g, '[^)]+'));

console.log('existingCodeRegex:', existingCodeRegex);
console.log('existingCodeRegex.test(result):', existingCodeRegex.test(result));

if (existingCodeRegex.test(result)) {
    // Update existing code
    const updateRegex = new RegExp(
        appDelegateConfig.code
            .replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
            .replace(/\\\{\\w+\\\}/g, '[^"\']+')
            .replace(/\\"/g, '["\'"]')
    );
    console.log('updateRegex:', updateRegex);
    result = result.replace(updateRegex, codeToInsert);
}
console.log('Result:', result);
