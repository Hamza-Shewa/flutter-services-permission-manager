import * as assert from 'assert';
import {
    updateIOSPlist,
    updateIOSPlistWithServices,
    removeServicesFromIOSPlist,
    validateIOSPermissionEntries
} from '../../core/platform/ios/plist.service.js';
import { loadFixture } from '../helpers.js';
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
