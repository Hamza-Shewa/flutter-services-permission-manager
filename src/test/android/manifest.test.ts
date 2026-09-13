import * as assert from 'assert';
import {
    normalizePermissionNames,
    updateAndroidManifest,
    updateAndroidManifestWithServices,
    removeServicesFromAndroidManifest
} from '../../core/platform/android/manifest.service.js';
import { loadFixture, loadServicesConfig } from '../helpers.js';
import { ServiceEntry, ServiceConfig } from '../../core/types/index.js';

suite('Android Manifest Service Test Suite', () => {
    let baseManifest: string;

    setup(() => {
        baseManifest = loadFixture('android/app/src/main/AndroidManifest.xml');
    });

    suite('normalizePermissionNames', () => {
        test('deduplicates permissions', () => {
            const result = normalizePermissionNames(['CAMERA', 'CAMERA', 'LOCATION']);
            assert.deepStrictEqual(result.sort(), ['android.permission.CAMERA', 'android.permission.LOCATION'].sort());
        });

        test('handles android.permission. prefix correctly', () => {
            const result = normalizePermissionNames(['android.permission.CAMERA', 'LOCATION']);
            assert.deepStrictEqual(result.sort(), ['android.permission.CAMERA', 'android.permission.LOCATION'].sort());
        });

        test('trims whitespace and removes empty', () => {
            const result = normalizePermissionNames(['  CAMERA  ', '', '  ']);
            assert.deepStrictEqual(result, ['android.permission.CAMERA']);
        });
    });

    suite('updateAndroidManifest', () => {
        test('inserts new permissions successfully', async () => {
            const updated = await updateAndroidManifest(baseManifest, ['android.permission.CAMERA', 'android.permission.INTERNET']);
            assert.ok(updated.includes('<uses-permission android:name="android.permission.CAMERA" />'));
            assert.ok(updated.includes('<uses-permission android:name="android.permission.INTERNET" />'));
        });

        test('replaces all permissions with the new list', async () => {
            const withCamera = await updateAndroidManifest(baseManifest, ['android.permission.CAMERA']);
            const updated = await updateAndroidManifest(withCamera, ['android.permission.INTERNET', 'android.permission.LOCATION']);
            assert.ok(!updated.includes('<uses-permission android:name="android.permission.CAMERA" />'));
            assert.ok(updated.includes('<uses-permission android:name="android.permission.INTERNET" />'));
            assert.ok(updated.includes('<uses-permission android:name="android.permission.LOCATION" />'));
        });

        test('removes old permissions when replaced', async () => {
            const withCamera = await updateAndroidManifest(baseManifest, ['android.permission.CAMERA']);
            const updated = await updateAndroidManifest(withCamera, ['android.permission.INTERNET']);
            assert.ok(!updated.includes('<uses-permission android:name="android.permission.CAMERA" />'));
            assert.ok(updated.includes('<uses-permission android:name="android.permission.INTERNET" />'));
        });

        test('removes all permissions if empty list is provided', async () => {
            const withCamera = await updateAndroidManifest(baseManifest, ['android.permission.CAMERA']);
            const updated = await updateAndroidManifest(withCamera, []);
            assert.ok(!updated.includes('<uses-permission'));
        });

        test('throws on malformed manifest', async () => {
            try {
                await updateAndroidManifest('<manifest></manifest>', ['android.permission.CAMERA']);
                assert.fail('Should have thrown an error');
            } catch (err) {
                assert.ok(err instanceof Error);
            }
        });
    });

    suite('updateAndroidManifestWithServices', () => {
        const dummyServiceConfig: ServiceConfig = {
            id: 'dummy',
            name: 'Dummy',
            description: 'Dummy service',
            icon: '',
            fields: [{ id: 'apiKey', label: 'API Key' }],
            ios: { plistEntries: [] },
            android: {
                metaData: [
                    { name: 'com.dummy.API_KEY', valueField: 'apiKey' }
                ],
                queries: [
                    { tag: 'package', attributes: { 'android:name': 'com.dummy.app' } }
                ],
                applicationData: [
                    { tag: 'activity', attributes: { 'android:name': 'com.dummy.Activity' } }
                ],
                mainActivityIntentFilters: [
                    { 
                        tag: 'intent-filter', attributes: {}, 
                        children: [
                            { tag: 'action', attributes: { 'android:name': 'android.intent.action.VIEW' } }
                        ] 
                    }
                ]
            }
        };

        test('inserts meta-data correctly', () => {
            const updated = updateAndroidManifestWithServices(baseManifest, [{ id: 'dummy', values: { apiKey: '12345' } }], [dummyServiceConfig]);
            assert.ok(updated.includes('<meta-data android:name="com.dummy.API_KEY" android:value="12345" />'));
        });

        test('creates queries block and inserts data', () => {
            const updated = updateAndroidManifestWithServices(baseManifest, [{ id: 'dummy', values: { apiKey: '12345' } }], [dummyServiceConfig]);
            assert.ok(updated.includes('<queries>'));
            assert.ok(updated.includes('<package android:name="com.dummy.app" />'));
            assert.ok(updated.includes('</queries>'));
        });
        
        test('inserts application data', () => {
            const updated = updateAndroidManifestWithServices(baseManifest, [{ id: 'dummy', values: { apiKey: '12345' } }], [dummyServiceConfig]);
            assert.ok(updated.includes('<activity android:name="com.dummy.Activity" />'));
        });

        test('inserts intent-filter in main activity', () => {
            const updated = updateAndroidManifestWithServices(baseManifest, [{ id: 'dummy', values: { apiKey: '12345' } }], [dummyServiceConfig]);
            assert.ok(updated.includes('<action android:name="android.intent.action.VIEW" />'));
        });

        test('uses current Stripe redirects and migrates the legacy host', () => {
            const configs = loadServicesConfig();
            const legacy = baseManifest.replace(
                '</activity>',
                '<intent-filter><data android:scheme="flutterstripe" android:host="safepay" /></intent-filter></activity>',
            );
            const updated = updateAndroidManifestWithServices(
                legacy,
                [{ id: 'stripe', values: { publishableKey: 'pk_test_example' } }],
                configs,
            );
            assert.ok(updated.includes('android:host="redirect"'));
            assert.ok(!updated.includes('android:host="safepay"'));
        });

        test('adds removable Twitter callback and Apple Sign-In activity', () => {
            const configs = loadServicesConfig();
            const updated = updateAndroidManifestWithServices(baseManifest, [
                { id: 'twitter', values: { callbackScheme: 'myapp', callbackHost: '' } },
                { id: 'apple_signin', values: {} },
            ], configs);
            assert.ok(updated.includes('android:scheme="myapp"'));
            assert.ok(!updated.includes('android:host=""'));
            assert.ok(updated.includes('SignInWithAppleCallback'));

            const removed = removeServicesFromAndroidManifest(updated, ['twitter', 'apple_signin'], configs);
            assert.ok(!removed.includes('android:scheme="myapp"'));
            assert.ok(!removed.includes('SignInWithAppleCallback'));
        });

        test('removes obsolete OneSignal manifest metadata', () => {
            const configs = loadServicesConfig();
            const legacy = baseManifest.replace(
                '<application',
                '<application><meta-data android:name="onesignal_app_id" android:value="old" /></application><application',
            );
            const updated = updateAndroidManifestWithServices(legacy, [{ id: 'onesignal', values: { appId: 'id' } }], configs);
            assert.ok(!updated.includes('onesignal_app_id'));
        });
    });

    suite('removeServicesFromAndroidManifest', () => {
        const dummyServiceConfig: ServiceConfig = {
            id: 'dummy',
            name: 'Dummy',
            description: 'Dummy service',
            icon: '',
            fields: [{ id: 'apiKey', label: 'API Key' }],
            ios: { plistEntries: [] },
            android: {
                metaData: [
                    { name: 'com.dummy.API_KEY', valueField: 'apiKey' }
                ],
                queries: [
                    { tag: 'package', attributes: { 'android:name': 'com.dummy.app' } }
                ],
                applicationData: [
                    { tag: 'activity', attributes: { 'android:name': 'com.dummy.Activity' } }
                ]
            }
        };

        test('removes meta-data, queries and applicationData completely', () => {
            const withService = updateAndroidManifestWithServices(baseManifest, [{ id: 'dummy', values: { apiKey: '12345' } }], [dummyServiceConfig]);
            const removed = removeServicesFromAndroidManifest(withService, ['dummy'], [dummyServiceConfig]);
            
            assert.ok(!removed.includes('com.dummy.API_KEY'));
            assert.ok(!removed.includes('com.dummy.app'));
            assert.ok(!removed.includes('com.dummy.Activity'));
            assert.ok(!removed.includes('<queries>')); // Cleaned up empty queries block
        });
    });
});
