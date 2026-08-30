import * as assert from 'assert';
import {
    extractAppNameFromInfoPlistStrings,
    updateAppNameInInfoPlistStrings
} from '../../features/localization/ios.localization.service.js';

suite('iOS Localization Service Test Suite', () => {
    suite('extractAppNameFromInfoPlistStrings', () => {
        test('extracts CFBundleDisplayName', () => {
            const content = `
"CFBundleDisplayName" = "My App";
"CFBundleName" = "My App";
            `;
            const appName = extractAppNameFromInfoPlistStrings(content);
            assert.strictEqual(appName, 'My App');
        });

        test('returns undefined if CFBundleDisplayName is missing', () => {
            const content = `
"CFBundleName" = "My App";
            `;
            const appName = extractAppNameFromInfoPlistStrings(content);
            assert.strictEqual(appName, undefined);
        });
    });

    suite('updateAppNameInInfoPlistStrings', () => {
        test('updates CFBundleDisplayName', () => {
            const content = `"CFBundleDisplayName" = "Old App";\n"CFBundleName" = "Old App";`;
            const updated = updateAppNameInInfoPlistStrings(content, 'New App');
            assert.ok(updated.includes('"CFBundleDisplayName" = "New App";'));
        });

        test('syncs CFBundleName if it exists', () => {
            const content = `"CFBundleDisplayName" = "Old App";\n"CFBundleName" = "Old App";`;
            const updated = updateAppNameInInfoPlistStrings(content, 'New App');
            assert.ok(updated.includes('"CFBundleName" = "New App";'));
        });

        test('adds missing CFBundleDisplayName', () => {
            const content = `"CFBundleName" = "Old App";`;
            const updated = updateAppNameInInfoPlistStrings(content, 'New App');
            assert.ok(updated.includes('"CFBundleDisplayName" = "New App";'));
            assert.ok(updated.includes('"CFBundleName" = "New App";'));
        });
    });
});
