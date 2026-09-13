import * as assert from 'assert';
import {
    updateIOSEntitlementsWithServices,
    removeServicesFromIOSEntitlements
} from '../../core/platform/ios/entitlements.service.js';
import { ServiceConfig } from '../../core/types/index.js';
import { loadServicesConfig } from '../helpers.js';

suite('iOS Entitlements Service Test Suite', () => {
    const dummyServiceConfig: ServiceConfig = {
        id: 'dummy',
        name: 'Dummy',
        description: 'Dummy Service',
        icon: 'dummy.png',
        fields: [],
        ios: { plistEntries: [], urlSchemes: [],
            entitlements: [
                {
                    key: 'com.apple.developer.applesignin',
                    type: 'array',
                    staticValue: ['Default']
                }
            ]
        },
        android: { metaData: [], queries: [], applicationData: [] }
    };

    const emptyEntitlements = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
</dict>
</plist>`;

    suite('updateIOSEntitlementsWithServices', () => {
        test('inserts applinks domains', () => {
            const updated = updateIOSEntitlementsWithServices(
                emptyEntitlements,
                [{ id: 'applinks', values: { domains: 'example.com, https://app.example.com' } }],
                []
            );
            assert.ok(updated.includes('<string>applinks:example.com</string>'));
            assert.ok(updated.includes('<string>applinks:app.example.com</string>'));
        });

        test('replaces existing applinks block', () => {
            const withApplinks = updateIOSEntitlementsWithServices(
                emptyEntitlements,
                [{ id: 'applinks', values: { domains: 'old.com' } }],
                []
            );
            const updated = updateIOSEntitlementsWithServices(
                withApplinks,
                [{ id: 'applinks', values: { domains: 'new.com' } }],
                []
            );
            assert.ok(updated.includes('applinks:new.com'));
            assert.ok(!updated.includes('applinks:old.com'));
        });

        test('preserves non-App-Links associated domains', () => {
            const existing = emptyEntitlements.replace(
                '</dict>',
                '\t<key>com.apple.developer.associated-domains</key>\n' +
                '\t<array><string>webcredentials:example.com</string><string>applinks:old.com</string></array>\n</dict>',
            );
            const updated = updateIOSEntitlementsWithServices(
                existing,
                [{ id: 'applinks', values: { domains: 'new.com' } }],
                [],
            );
            assert.ok(updated.includes('webcredentials:example.com'));
            assert.ok(updated.includes('applinks:new.com'));
            assert.ok(!updated.includes('applinks:old.com'));
        });

        test('writes a Stripe merchant identifier from the reviewed value', () => {
            const updated = updateIOSEntitlementsWithServices(
                emptyEntitlements,
                [{ id: 'stripe', values: { merchantId: 'merchant.com.example' } }],
                loadServicesConfig(),
            );
            assert.ok(updated.includes('<key>com.apple.developer.in-app-payments</key>'));
            assert.ok(updated.includes('<string>merchant.com.example</string>'));
        });

        test('inserts service entitlements', () => {
            const updated = updateIOSEntitlementsWithServices(
                emptyEntitlements,
                [{ id: 'dummy', values: {} }],
                [dummyServiceConfig]
            );
            assert.ok(updated.includes('<key>com.apple.developer.applesignin</key>'));
            assert.ok(updated.includes('<string>Default</string>'));
        });
    });

    suite('removeServicesFromIOSEntitlements', () => {
        test('removes applinks completely', () => {
            const withApplinks = updateIOSEntitlementsWithServices(
                emptyEntitlements,
                [{ id: 'applinks', values: { domains: 'example.com' } }],
                []
            );
            const removed = removeServicesFromIOSEntitlements(withApplinks, ['applinks'], []);
            assert.ok(!removed.includes('applinks:example.com'));
            assert.ok(!removed.includes('com.apple.developer.associated-domains'));
        });

        test('removes service entitlements', () => {
            const withDummy = updateIOSEntitlementsWithServices(
                emptyEntitlements,
                [{ id: 'dummy', values: {} }],
                [dummyServiceConfig]
            );
            const removed = removeServicesFromIOSEntitlements(withDummy, ['dummy'], [dummyServiceConfig]);
            assert.ok(!removed.includes('com.apple.developer.applesignin'));
        });
    });
});
