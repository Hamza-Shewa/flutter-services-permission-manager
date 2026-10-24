import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import {
    adviseAndroidPermissions,
    adviseIOSPermissions,
    applyAndroidAdviceFixes,
    worstAdviceLevel,
    type PermissionAdvice,
} from '../../features/permissions/advice.js';
import { flattenCatalog } from '../../features/permissions/catalog.js';
import type { ProjectPermissionFacts } from '../../features/permissions/project-facts.js';
import type { AndroidPermission, AndroidPermissionEntry, IOSPermission, IOSPermissionEntry } from '../../core/types/index.js';

const ROOT = path.resolve(__dirname, '..', '..', '..');
const androidCatalog = flattenCatalog(JSON.parse(fs.readFileSync(path.join(ROOT, 'src/categorized-android-permissions.json'), 'utf8')) as Record<string, AndroidPermission[]>);
const iosCatalog = flattenCatalog(JSON.parse(fs.readFileSync(path.join(ROOT, 'src/categorized-ios-permissions.json'), 'utf8')) as Record<string, IOSPermission[]>);

function sdk(minSdk?: number, targetSdk?: number, compileSdk?: number, extra: Partial<NonNullable<ProjectPermissionFacts['android']>> = {}): ProjectPermissionFacts {
    return { android: { minSdk: { value: minSdk }, targetSdk: { value: targetSdk }, compileSdk: { value: compileSdk }, ...extra } };
}
function ios(deploymentTarget: string, podfileMacros?: string[]): ProjectPermissionFacts {
    return { ios: { deploymentTarget, hasPodfile: podfileMacros !== undefined, podfileMacros: podfileMacros ?? [] } };
}
const A = (...names: Array<string | AndroidPermissionEntry>): AndroidPermissionEntry[] =>
    names.map(name => (typeof name === 'string' ? { name: name.includes('.') ? name : `android.permission.${name}` } : name));
const find = (advice: PermissionAdvice[], code: string, permission?: string) =>
    advice.find(item => item.code === code && (!permission || item.permission === permission || item.permission === `android.permission.${permission}`));
const android = (entries: AndroidPermissionEntry[], facts: ProjectPermissionFacts) => adviseAndroidPermissions(entries, androidCatalog, facts);
const apple = (entries: IOSPermissionEntry[], facts: ProjectPermissionFacts, platform: 'ios' | 'macos' = 'ios') => adviseIOSPermissions(entries, iosCatalog, facts, platform);

suite('Permission advice: Android', () => {
    test('READ_EXTERNAL_STORAGE gets maxSdkVersion 32 at targetSdk 33+, and the partial-access note at 34+', () => {
        const advice = android(A('READ_EXTERNAL_STORAGE'), sdk(24, 34, 34));
        const item = find(advice, 'max-sdk', 'READ_EXTERNAL_STORAGE')!;
        assert.strictEqual(item.level, 'warning');
        assert.deepStrictEqual(item.fix, [{ name: 'android.permission.READ_EXTERNAL_STORAGE', maxSdkVersion: 32 }]);
        assert.ok(item.message.includes('READ_MEDIA_IMAGES') && item.message.includes('READ_MEDIA_VISUAL_USER_SELECTED'));
        assert.ok(!find(android(A({ name: 'android.permission.READ_EXTERNAL_STORAGE', maxSdkVersion: 32 }), sdk(24, 34, 34)), 'max-sdk'));
        assert.ok(!find(android(A('READ_EXTERNAL_STORAGE'), sdk(24, 32, 32)), 'max-sdk'));
        assert.strictEqual(find(android(A('READ_EXTERNAL_STORAGE'), sdk(33, 35, 35)), 'no-effect')?.fix?.[0].remove, true);
    });

    test('READ_EXTERNAL_STORAGE capped at 32 without any READ_MEDIA_* warns that Android 13+ has no media access', () => {
        const capped = { name: 'android.permission.READ_EXTERNAL_STORAGE', maxSdkVersion: 32 };
        const item = find(android(A(capped), sdk(26, 37, 37)), 'media-missing', 'READ_EXTERNAL_STORAGE')!;
        assert.strictEqual(item.level, 'warning');
        assert.ok(item.message.includes('READ_MEDIA_IMAGES'));
        assert.strictEqual(item.fix, undefined);
        assert.ok(!find(android(A(capped, 'READ_MEDIA_IMAGES'), sdk(26, 37, 37)), 'media-missing'));
        assert.ok(!find(android(A(capped), sdk(26, 32, 32)), 'media-missing'));
        assert.ok(!find(android(A('READ_EXTERNAL_STORAGE'), sdk(26, 37, 37)), 'media-missing'));
    });

    test('READ_MEDIA_IMAGES at targetSdk 34+ suggests READ_MEDIA_VISUAL_USER_SELECTED', () => {
        assert.ok(find(android(A('READ_MEDIA_IMAGES'), sdk(24, 34, 34)), 'partial-media-access'));
        assert.ok(!find(android(A('READ_MEDIA_IMAGES', 'READ_MEDIA_VISUAL_USER_SELECTED'), sdk(24, 34, 34)), 'partial-media-access'));
    });

    test('WRITE_EXTERNAL_STORAGE: maxSdkVersion 28 (29 with requestLegacyExternalStorage), removed when minSdk >= 30', () => {
        assert.strictEqual(find(android(A('WRITE_EXTERNAL_STORAGE'), sdk(24, 34, 34)), 'max-sdk')?.fix?.[0].maxSdkVersion, 28);
        assert.strictEqual(find(android(A('WRITE_EXTERNAL_STORAGE'), sdk(24, 34, 34, { requestLegacyExternalStorage: true })), 'max-sdk')?.fix?.[0].maxSdkVersion, 29);
        assert.strictEqual(find(android(A('WRITE_EXTERNAL_STORAGE'), sdk(30, 34, 34)), 'no-effect')?.fix?.[0].remove, true);
    });

    test('legacy Bluetooth gets maxSdkVersion 30 and the API 31 runtime permissions', () => {
        const advice = android(A('BLUETOOTH', 'BLUETOOTH_ADMIN'), sdk(24, 34, 34));
        assert.strictEqual(find(advice, 'max-sdk', 'BLUETOOTH')?.fix?.[0].maxSdkVersion, 30);
        assert.strictEqual(find(advice, 'max-sdk', 'BLUETOOTH_ADMIN')?.fix?.[0].maxSdkVersion, 30);
        const runtime = find(advice, 'bluetooth-runtime')!;
        assert.deepStrictEqual(runtime.fix, [
            { name: 'android.permission.BLUETOOTH_SCAN', usesPermissionFlags: 'neverForLocation' },
            { name: 'android.permission.BLUETOOTH_CONNECT' },
        ]);
        const withLocation = find(android(A('BLUETOOTH', 'ACCESS_FINE_LOCATION', 'ACCESS_COARSE_LOCATION'), sdk(24, 34, 34)), 'bluetooth-runtime')!;
        assert.deepStrictEqual(withLocation.fix?.[0], { name: 'android.permission.BLUETOOTH_SCAN' });
        assert.ok(find(android(A('BLUETOOTH'), sdk(31, 34, 34)), 'no-effect'));
    });

    test('BLUETOOTH_SCAN without neverForLocation and without location gets the flag', () => {
        assert.strictEqual(find(android(A('BLUETOOTH_SCAN', 'BLUETOOTH_CONNECT'), sdk(31, 34, 34)), 'never-for-location')?.fix?.[0].usesPermissionFlags, 'neverForLocation');
        assert.ok(!find(android(A({ name: 'android.permission.BLUETOOTH_SCAN', usesPermissionFlags: 'neverForLocation' }), sdk(31, 34, 34)), 'never-for-location'));
    });

    test('ACCESS_FINE_LOCATION without ACCESS_COARSE_LOCATION is an error at targetSdk 31+', () => {
        const item = find(android(A('ACCESS_FINE_LOCATION'), sdk(24, 31, 34)), 'fine-without-coarse')!;
        assert.strictEqual(item.level, 'error');
        assert.deepStrictEqual(item.fix, [{ name: 'android.permission.ACCESS_COARSE_LOCATION' }]);
        assert.ok(!find(android(A('ACCESS_FINE_LOCATION'), sdk(24, 30, 34)), 'fine-without-coarse'));
    });

    test('ACCESS_BACKGROUND_LOCATION: API 29 note, Play policy, and needs foreground location', () => {
        const advice = android(A('ACCESS_BACKGROUND_LOCATION'), sdk(24, 34, 34));
        assert.strictEqual(find(advice, 'background-without-foreground')?.level, 'error');
        assert.ok(find(advice, 'api-level', 'ACCESS_BACKGROUND_LOCATION')?.message.includes('API 29'));
        assert.strictEqual(find(advice, 'play-policy', 'ACCESS_BACKGROUND_LOCATION')?.level, 'warning');
    });

    test('BODY_SENSORS at targetSdk 36+ moves to Health Connect', () => {
        const item = find(android(A('BODY_SENSORS_BACKGROUND', 'BODY_SENSORS'), sdk(26, 36, 36)), 'health-connect', 'BODY_SENSORS_BACKGROUND')!;
        assert.deepStrictEqual(item.fix, [
            { name: 'android.permission.BODY_SENSORS_BACKGROUND', maxSdkVersion: 35 },
            { name: 'android.permission.health.READ_HEART_RATE' },
            { name: 'android.permission.health.READ_HEALTH_DATA_IN_BACKGROUND' },
        ]);
        assert.ok(item.message.includes('privacy policy'));
        assert.ok(!find(android(A('BODY_SENSORS'), sdk(26, 35, 35)), 'health-connect'));
    });

    test('FOREGROUND_SERVICE without a type at targetSdk 34+, and a type without FOREGROUND_SERVICE', () => {
        assert.strictEqual(find(android(A('FOREGROUND_SERVICE'), sdk(24, 34, 34)), 'foreground-service-type')?.level, 'warning');
        assert.ok(!find(android(A('FOREGROUND_SERVICE', 'FOREGROUND_SERVICE_DATA_SYNC'), sdk(24, 34, 34)), 'foreground-service-type'));
        assert.strictEqual(find(android(A('FOREGROUND_SERVICE_LOCATION'), sdk(24, 34, 34)), 'foreground-service-missing')?.level, 'error');
    });

    test('POST_NOTIFICATIONS below targetSdk 33 is harmless; the iOS macro is pointed out', () => {
        assert.strictEqual(find(android(A('POST_NOTIFICATIONS'), sdk(21, 32, 33)), 'api-level')?.level, 'info');
        assert.ok(!find(android(A('POST_NOTIFICATIONS'), sdk(21, 33, 33)), 'api-level'));
        const facts = { ...sdk(21, 34, 34), ...ios('13.0', ['PERMISSION_CAMERA']) };
        assert.ok(find(android(A('POST_NOTIFICATIONS'), facts), 'ios-equivalent')?.message.includes('PERMISSION_NOTIFICATIONS'));
    });

    test('exact alarms: SCHEDULE_EXACT_ALARM note, maxSdkVersion 32 next to USE_EXACT_ALARM, Play policy', () => {
        assert.ok(find(android(A('SCHEDULE_EXACT_ALARM'), sdk(24, 34, 34)), 'exact-alarm'));
        const both = android(A('SCHEDULE_EXACT_ALARM', 'USE_EXACT_ALARM'), sdk(24, 34, 34));
        assert.strictEqual(find(both, 'max-sdk', 'SCHEDULE_EXACT_ALARM')?.fix?.[0].maxSdkVersion, 32);
        assert.strictEqual(find(both, 'play-policy', 'USE_EXACT_ALARM')?.level, 'warning');
    });

    test('deprecated, removed and newer-than-compileSdk permissions', () => {
        const fingerprint = find(android(A('USE_FINGERPRINT'), sdk(26, 34, 34)), 'deprecated')!;
        assert.strictEqual(fingerprint.level, 'info');
        assert.deepStrictEqual(fingerprint.fix, [{ name: 'android.permission.USE_BIOMETRIC' }]);
        assert.strictEqual(find(android(A('USE_FINGERPRINT', 'USE_BIOMETRIC'), sdk(28, 34, 34)), 'deprecated')?.level, 'warning');
        assert.strictEqual(find(android(A('FLASHLIGHT'), sdk(26, 34, 34)), 'removed')?.level, 'error');
        assert.strictEqual(find(android(A('ACCESS_LOCAL_NETWORK'), sdk(26, 36, 36)), 'above-compile-sdk')?.level, 'error');
        assert.ok(!find(android(A('ACCESS_LOCAL_NETWORK'), sdk(26, 37, 37)), 'above-compile-sdk'));
    });

    test('NEARBY_WIFI_DEVICES flag and ACCESS_LOCAL_NETWORK info at targetSdk 37', () => {
        assert.ok(find(android(A('NEARBY_WIFI_DEVICES'), sdk(26, 34, 34)), 'never-for-location'));
        const lan = find(android(A('INTERNET', 'USE_BIOMETRIC'), sdk(26, 37, 37)), 'local-network')!;
        assert.strictEqual(lan.level, 'info');
        assert.ok(!find(android(A('INTERNET'), sdk(26, 36, 36)), 'local-network'));
        assert.ok(!find(android(A('INTERNET', 'ACCESS_LOCAL_NETWORK'), sdk(26, 37, 37)), 'local-network'));
    });

    test('READ_PHONE_STATE suggests READ_BASIC_PHONE_STATE at targetSdk 33+', () => {
        assert.ok(find(android(A('READ_PHONE_STATE'), sdk(24, 33, 33)), 'basic-phone-state'));
        assert.ok(!find(android(A('READ_PHONE_STATE'), sdk(24, 32, 33)), 'basic-phone-state'));
    });

    test('Play policy warnings for restricted permissions', () => {
        for (const name of ['QUERY_ALL_PACKAGES', 'MANAGE_EXTERNAL_STORAGE', 'REQUEST_INSTALL_PACKAGES', 'READ_SMS', 'READ_CALL_LOG']) {
            assert.strictEqual(find(android(A(name), sdk(24, 34, 34)), 'play-policy', name)?.level, 'warning', name);
        }
    });

    test('tools:node="remove" entries are reported, never counted as used', () => {
        const advice = android(A('INTERNET', { name: 'com.google.android.gms.permission.AD_ID', toolsNode: 'remove' }, { name: 'android.permission.ACCESS_ADSERVICES_AD_ID', toolsNode: 'remove' }), sdk(26, 37, 37));
        assert.strictEqual(advice.filter(item => item.code === 'merger-removed').length, 2);
        assert.ok(!advice.some(item => item.code === 'system-only'), 'merger-removed entries are not audited as declarations');
    });

    test('system-only and unknown permissions', () => {
        assert.ok(find(android(A('INSTALL_PACKAGES'), sdk(24, 34, 34)), 'system-only'));
        assert.ok(find(android(A('com.example.permission.CUSTOM'), sdk(24, 34, 34)), 'unknown'));
    });

    test('USE_BIOMETRIC on a modern project needs no advice', () => {
        assert.deepStrictEqual(android(A('USE_BIOMETRIC'), sdk(26, 37, 37)), []);
        assert.strictEqual(worstAdviceLevel(android(A('USE_BIOMETRIC'), sdk(26, 37, 37)), 'android.permission.USE_BIOMETRIC'), undefined);
    });

    test('applyAndroidAdviceFixes merges attributes, adds, removes and leaves merger removals alone', () => {
        const entries = A('READ_EXTERNAL_STORAGE', 'WRITE_EXTERNAL_STORAGE', { name: 'com.google.android.gms.permission.AD_ID', toolsNode: 'remove' });
        const result = applyAndroidAdviceFixes(entries, [
            { name: 'android.permission.READ_EXTERNAL_STORAGE', maxSdkVersion: 32 },
            { name: 'android.permission.WRITE_EXTERNAL_STORAGE', remove: true },
            { name: 'READ_MEDIA_IMAGES' },
            { name: 'com.google.android.gms.permission.AD_ID', remove: true },
        ]);
        assert.deepStrictEqual(result, [
            { name: 'android.permission.READ_EXTERNAL_STORAGE', maxSdkVersion: 32 },
            { name: 'com.google.android.gms.permission.AD_ID', toolsNode: 'remove' },
            { name: 'android.permission.READ_MEDIA_IMAGES' },
        ]);
    });
});

suite('Permission advice: iOS', () => {
    test('deprecated key at or above the deployment target is a warning with its successor', () => {
        const item = find(apple([{ permission: 'NSBluetoothPeripheralUsageDescription', value: 'Connect to the scale', type: 'string' }], ios('13.0')), 'deprecated')!;
        assert.strictEqual(item.level, 'warning');
        assert.deepStrictEqual(item.iosFix, [{ permission: 'NSBluetoothAlwaysUsageDescription', type: 'string', value: 'Connect to the scale' }]);
        assert.strictEqual(find(apple([{ permission: 'NSCalendarsUsageDescription', value: 'x' }], ios('16.0')), 'deprecated')?.level, 'info');
    });

    test('a key newer than the deployment target is harmless info', () => {
        const item = find(apple([{ permission: 'NSAlarmKitUsageDescription', value: 'Wake you up' }], ios('15.0')), 'newer-than-target')!;
        assert.strictEqual(item.level, 'info');
        assert.ok(item.message.includes('26.0'));
    });

    test('NSLocalNetworkUsageDescription needs NSBonjourServices (and the reverse)', () => {
        assert.strictEqual(find(apple([{ permission: 'NSLocalNetworkUsageDescription', value: 'Find printers' }], ios('14.0')), 'bonjour-missing')?.level, 'warning');
        assert.ok(find(apple([{ permission: 'NSBonjourServices', value: ['_ipp._tcp'], type: 'array' }], ios('14.0')), 'local-network-missing'));
        const pair = apple([{ permission: 'NSLocalNetworkUsageDescription', value: 'Find printers' }, { permission: 'NSBonjourServices', value: ['_ipp._tcp'], type: 'array' }], ios('14.0'));
        assert.ok(!find(pair, 'bonjour-missing') && !find(pair, 'local-network-missing'));
    });

    test('NSLocationAlwaysAndWhenInUseUsageDescription without NSLocationWhenInUseUsageDescription is an error', () => {
        const item = find(apple([{ permission: 'NSLocationAlwaysAndWhenInUseUsageDescription', value: 'Track runs' }], ios('13.0')), 'when-in-use-missing')!;
        assert.strictEqual(item.level, 'error');
        assert.deepStrictEqual(item.iosFix, [{ permission: 'NSLocationWhenInUseUsageDescription', type: 'string', value: 'Track runs' }]);
    });

    test('AccessorySetupKit with Bluetooth needs the three Bluetooth arrays', () => {
        const item = find(apple([{ permission: 'NSAccessorySetupKitSupports', value: ['Bluetooth'], type: 'array' }], ios('18.0')), 'accessory-bluetooth')!;
        assert.strictEqual(item.level, 'error');
        assert.strictEqual(item.iosFix?.length, 3);
        assert.ok(!find(apple([{ permission: 'NSAccessorySetupKitSupports', value: ['WiFi'], type: 'array' }], ios('18.0')), 'accessory-bluetooth'));
    });

    test('Podfile macro mismatches: missing macro and legacy PERMISSION_CALENDARS', () => {
        const advice = apple([
            { permission: 'NSCameraUsageDescription', value: 'Scan' },
            { permission: 'NSCalendarsFullAccessUsageDescription', value: 'Events' },
        ], ios('13.0', ['PERMISSION_CALENDARS']));
        assert.ok(find(advice, 'legacy-macro')?.message.includes('PERMISSION_EVENTS_FULL_ACCESS'));
        assert.ok(find(advice, 'podfile-macro-missing', 'NSCameraUsageDescription')?.message.includes('PERMISSION_CAMERA'));
    });

    test('the invented NSUserNotificationsUsageDescription key is flagged for removal', () => {
        const item = find(apple([{ permission: 'NSUserNotificationsUsageDescription', value: 'x' }], ios('13.0')), 'invalid-key')!;
        assert.strictEqual(item.level, 'warning');
        assert.ok(item.message.includes('PERMISSION_NOTIFICATIONS'));
    });

    test('placeholder usage descriptions and macOS-only keys', () => {
        assert.ok(find(apple([{ permission: 'NSCameraUsageDescription', value: 'TODO: Provide usage description.' }], ios('13.0')), 'empty-description'));
        assert.ok(find(apple([{ permission: 'NSDesktopFolderUsageDescription', value: 'Export' }], ios('13.0')), 'macos-only'));
        assert.ok(!find(apple([{ permission: 'NSDesktopFolderUsageDescription', value: 'Export' }], ios('13.0'), 'macos'), 'macos-only'));
    });
});
