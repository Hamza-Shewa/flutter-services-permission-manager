import * as assert from 'assert';
import {
    updateIOSPlist,
    updateIOSPlistWithServices,
    removeServicesFromIOSPlist,
    validateIOSPermissionEntries
} from '../../core/platform/ios/plist.service.js';
import { loadFixture, loadServicesConfig } from '../helpers.js';
import { ServiceConfig, IOSPermissionEntry } from '../../core/types/index.js';

suite('iOS Plist Service Test Suite', () => {
    let basePlist: string;

    setup(() => {
        basePlist = loadFixture('ios/Runner/Info.plist');
    });

    suite('validateIOSPermissionEntries', () => {
        test('throws on missing permission key', () => {
            const entries = [{ permission: '' }] as IOSPermissionEntry[];
            assert.throws(() => validateIOSPermissionEntries(entries), /iOS permission key cannot be empty/);
        });

        test('throws on unescaped illegal characters in value', () => {
            const entries = [{ permission: 'valid', value: 'this & that' }] as IOSPermissionEntry[];
            assert.throws(() => validateIOSPermissionEntries(entries), /contains unescaped illegal characters/);
        });

        test('passes on valid entries', () => {
            const entries = [{ permission: 'valid', value: 'this &amp; that' }] as IOSPermissionEntry[];
            assert.doesNotThrow(() => validateIOSPermissionEntries(entries));
        });
    });

    suite('updateIOSPlist', () => {
        test('updates NS keys', () => {
            const entries: IOSPermissionEntry[] = [
                { permission: 'NSCameraUsageDescription', value: 'Need camera' }
            ];
            const updated = updateIOSPlist(basePlist, entries);
            assert.ok(updated.includes('<key>NSCameraUsageDescription</key>'));
            assert.ok(updated.includes('<string>Need camera</string>'));
        });

        test('supports boolean values', () => {
            const entries: IOSPermissionEntry[] = [
                { permission: 'ITSAppUsesNonExemptEncryption', value: false, type: 'boolean' }
            ];
            const updated = updateIOSPlist(basePlist, entries);
            assert.ok(updated.includes('<key>ITSAppUsesNonExemptEncryption</key>'));
            assert.ok(updated.includes('<false/>'));
            assert.ok(!updated.includes('<string>false</string>'));
        });

        test('removes old permissions', () => {
            const withCamera = updateIOSPlist(basePlist, [{ permission: 'NSCameraUsageDescription', value: 'Need camera' }]);
            const updated = updateIOSPlist(withCamera, [{ permission: 'NSLocationWhenInUseUsageDescription', value: 'Need location' }]);
            assert.ok(!updated.includes('NSCameraUsageDescription'));
            assert.ok(!updated.includes('Need camera'));
            assert.ok(updated.includes('NSLocationWhenInUseUsageDescription'));
        });
    });

    suite('updateIOSPlistWithServices', () => {
        const dummyServiceConfig: ServiceConfig = {
            id: 'dummy',
            name: 'Dummy',
            description: 'Dummy',
            icon: '',
            fields: [{ id: 'apiKey', label: 'API Key' }],
            android: { metaData: [], queries: [], applicationData: [] },
            ios: {
                plistEntries: [
                    { key: 'DummyAPIKey', type: 'string', valueField: 'apiKey' },
                    { key: 'DummyBool', type: 'boolean', staticValue: 'true' }
                ],
                urlSchemes: [
                    { prefix: 'dummy-', valueField: 'apiKey' }
                ]
            }
        };

        test('inserts basic string plist entries', () => {
            const updated = updateIOSPlistWithServices(basePlist, [{ id: 'dummy', values: { apiKey: '12345' } }], [dummyServiceConfig]);
            assert.ok(updated.includes('<key>DummyAPIKey</key>'));
            assert.ok(updated.includes('<string>12345</string>'));
                    });

        test('inserts boolean plist entries', () => {
            const updated = updateIOSPlistWithServices(basePlist, [{ id: 'dummy', values: { apiKey: '12345' } }], [dummyServiceConfig]);
            assert.ok(updated.includes('<key>DummyBool</key>'));
            assert.ok(updated.includes('<true/>'));
        });

        test('inserts CFBundleURLTypes for URL schemes', () => {
            const updated = updateIOSPlistWithServices(basePlist, [{ id: 'dummy', values: { apiKey: '12345' } }], [dummyServiceConfig]);
            assert.ok(updated.includes('<key>CFBundleURLTypes</key>'));
            assert.ok(updated.includes('<string>dummy-12345</string>'));
        });

        test('merges shared query and SKAdNetwork arrays across real services', () => {
            const configs = loadServicesConfig();
            const existing = basePlist.replace(
                '</dict>',
                '<key>LSApplicationQueriesSchemes</key><array><string>existing</string></array>' +
                '<key>SKAdNetworkItems</key><array><dict><key>SKAdNetworkIdentifier</key><string>existing.skadnetwork</string></dict></array></dict>',
            );
            const updated = updateIOSPlistWithServices(existing, [
                { id: 'facebook', values: { appId: '123', clientToken: 'token', displayName: 'App' } },
                { id: 'twitter', values: { callbackScheme: 'myapp' } },
                { id: 'admob', values: { iosAppId: 'ca-app-pub-1~2', androidAppId: 'ca-app-pub-1~3' } },
            ], configs);
            for (const expected of ['existing', 'fbapi', 'twitter', 'existing.skadnetwork', '4fzdc2evr5.skadnetwork']) {
                assert.ok(updated.includes(expected), `missing ${expected}`);
            }
        });

        test('writes Stripe as a static owned URL scheme', () => {
            const configs = loadServicesConfig();
            const updated = updateIOSPlistWithServices(
                basePlist,
                [{ id: 'stripe', values: { publishableKey: 'pk_test_example' } }],
                configs,
            );
            assert.ok(updated.includes('service:stripe url-scheme'));
            assert.ok(updated.includes('<string>flutterstripe</string>'));
            const removed = removeServicesFromIOSPlist(updated, ['stripe'], configs);
            assert.ok(!removed.includes('<string>flutterstripe</string>'));
        });

        test('does not register https as a custom scheme for Universal Links', () => {
            const configs = loadServicesConfig();
            const updated = updateIOSPlistWithServices(
                basePlist,
                [{ id: 'applinks', values: { domains: 'example.com', bundleId: 'com.example.app' } }],
                configs,
            );
            assert.ok(!updated.includes('<string>https</string>'));
        });

        test('removes only the selected service values from shared arrays', () => {
            const configs = loadServicesConfig();
            const withServices = updateIOSPlistWithServices(basePlist, [
                { id: 'facebook', values: { appId: '123', clientToken: 'token', displayName: 'App' } },
                { id: 'twitter', values: { callbackScheme: 'myapp' } },
                { id: 'admob', values: { iosAppId: 'ca-app-pub-1~2', androidAppId: 'ca-app-pub-1~3' } },
            ], configs).replace(
                '<string>fbapi</string>',
                '<string>app-owned</string>\n\t\t<string>fbapi</string>',
            ).replace(
                '<dict>\n\t\t\t<key>SKAdNetworkIdentifier</key>',
                '<dict><key>SKAdNetworkIdentifier</key><string>app-owned.skadnetwork</string></dict>\n\t\t<dict>\n\t\t\t<key>SKAdNetworkIdentifier</key>',
            );

            const withoutFacebook = removeServicesFromIOSPlist(withServices, ['facebook'], configs);
            assert.ok(withoutFacebook.includes('app-owned'));
            assert.ok(withoutFacebook.includes('<string>twitter</string>'));
            assert.ok(!withoutFacebook.includes('<string>fbapi</string>'));

            const withoutAdMob = removeServicesFromIOSPlist(withoutFacebook, ['admob'], configs);
            assert.ok(withoutAdMob.includes('app-owned.skadnetwork'));
            assert.ok(!withoutAdMob.includes('4fzdc2evr5.skadnetwork'));
        });
    });

    suite('removeServicesFromIOSPlist', () => {
        const dummyServiceConfig: ServiceConfig = {
            id: 'dummy',
            name: 'Dummy',
            description: 'Dummy',
            icon: '',
            fields: [{ id: 'apiKey', label: 'API Key' }],
            android: { metaData: [], queries: [], applicationData: [] },
            ios: {
                plistEntries: [
                    { key: 'DummyAPIKey', type: 'string', valueField: 'apiKey' },
                    { key: 'DummyBool', type: 'boolean', staticValue: 'true' }
                ],
                urlSchemes: [
                    { prefix: 'dummy-', valueField: 'apiKey' }
                ]
            }
        };

        test('removes service plist entries completely', () => {
            const withService = updateIOSPlistWithServices(basePlist, [{ id: 'dummy', values: { apiKey: '12345' } }], [dummyServiceConfig]);
            const removed = removeServicesFromIOSPlist(withService, ['dummy'], [dummyServiceConfig]);
            assert.ok(!removed.includes('DummyAPIKey'));
                        assert.ok(!removed.includes('DummyBool'));
        });

        test('removes URL schemes for service', () => {
            const withService = updateIOSPlistWithServices(basePlist, [{ id: 'dummy', values: { apiKey: '12345' } }], [dummyServiceConfig]);
            const removed = removeServicesFromIOSPlist(withService, ['dummy'], [dummyServiceConfig]);
            assert.ok(!removed.includes('dummy-12345'));
        });
    });
});
