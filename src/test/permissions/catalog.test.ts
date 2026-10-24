import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import { PERMISSION_HANDLER_MACROS } from '../../core/platform/ios/podfile-macros.js';
import type { AndroidPermission, IOSPermission, PermissionMapping } from '../../core/types/index.js';

const ROOT = path.resolve(__dirname, '..', '..', '..');
const readJson = <T>(relative: string): T => JSON.parse(fs.readFileSync(path.join(ROOT, relative), 'utf8')) as T;

interface SdkField { name: string; since: string; deprecated: string | null; removed: string | null }
interface CatalogBuilder {
    loadSources(): Record<string, unknown>;
    buildAndroidCatalog(sources: Record<string, unknown>): Record<string, AndroidPermission[]>;
    buildIosCatalog(sources: Record<string, unknown>): Record<string, IOSPermission[]>;
    serialize(value: unknown): string;
}

const builder = require(path.join(ROOT, 'scripts', 'build-permission-catalog.js')) as CatalogBuilder;

suite('Permission catalogs', () => {
    const androidCatalog = readJson<Record<string, AndroidPermission[]>>('src/categorized-android-permissions.json');
    const iosCatalog = readJson<Record<string, IOSPermission[]>>('src/categorized-ios-permissions.json');
    const android = Object.values(androidCatalog).flat();
    const ios = Object.values(iosCatalog).flat();
    const sdk = readJson<{ manifest: SdkField[]; health: SdkField[] }>('src/permission-sources/android-sdk-permissions.json');
    const androidOverlay = readJson<{ categories: string[] }>('src/permission-sources/android-overlay.json');
    const iosOverlay = readJson<{ categories: string[] }>('src/permission-sources/ios-overlay.json');
    const appleKeys = readJson<Record<string, unknown>>('src/permission-sources/ios-apple-keys.json');
    const mapping = readJson<PermissionMapping>('src/permission-mapping.json');

    test('the committed catalogs are exactly what the generator produces (run npm run catalog:build)', () => {
        const sources = builder.loadSources();
        const normalize = (text: string) => text.replace(/\r\n/g, '\n');
        assert.strictEqual(
            normalize(fs.readFileSync(path.join(ROOT, 'src/categorized-android-permissions.json'), 'utf8')),
            builder.serialize(builder.buildAndroidCatalog(sources)),
        );
        assert.strictEqual(
            normalize(fs.readFileSync(path.join(ROOT, 'src/categorized-ios-permissions.json'), 'utf8')),
            builder.serialize(builder.buildIosCatalog(sources)),
        );
    });

    test('every public SDK permission is in the catalog with the SDK API levels', () => {
        const byName = new Map(android.filter(p => p.source === 'android').map(p => [p.permission, p]));
        for (const field of sdk.manifest) {
            const entry = byName.get(field.name);
            assert.ok(entry, `missing ${field.name}`);
            assert.strictEqual(entry!.apiLevel, Math.floor(parseFloat(field.since)), `${field.name} apiLevel`);
            assert.strictEqual(entry!.deprecatedIn ?? null, field.deprecated ? Math.floor(parseFloat(field.deprecated)) : null, `${field.name} deprecatedIn`);
            assert.strictEqual(entry!.removedIn ?? null, field.removed ? Math.floor(parseFloat(field.removed)) : null, `${field.name} removedIn`);
        }
        assert.strictEqual(byName.size, sdk.manifest.length);
    });

    test('spot checks against the SDK (the values the old catalog had wrong)', () => {
        const get = (name: string) => android.find(p => p.permission === name)!;
        assert.strictEqual(get('ACCESS_FINE_LOCATION').apiLevel, 1);
        assert.strictEqual(get('CAMERA').apiLevel, 1);
        assert.strictEqual(get('BLUETOOTH_SCAN').apiLevel, 31);
        assert.strictEqual(get('POST_NOTIFICATIONS').apiLevel, 33);
        assert.strictEqual(get('READ_EXTERNAL_STORAGE').apiLevel, 16);
        assert.strictEqual(get('ACCESS_LOCAL_NETWORK').apiLevel, 37);
        assert.strictEqual(get('USE_FINGERPRINT').deprecatedIn, 28);
        assert.strictEqual(get('FLASHLIGHT').removedIn, 24);
        assert.strictEqual(get('USE_FINGERPRINT').category, 'Biometrics');
        assert.strictEqual(get('BODY_SENSORS_BACKGROUND').category, 'Sensors');
        assert.strictEqual(get('READ_MEDIA_AUDIO').category, 'Media');
        assert.notStrictEqual(get('NEARBY_WIFI_DEVICES').category, 'Bluetooth');
        assert.strictEqual(get('INSTALL_SHORTCUT').constantValue, 'com.android.launcher.permission.INSTALL_SHORTCUT');
    });

    test('Health Connect and vendor permissions are present', () => {
        const heart = android.find(p => p.constantValue === 'android.permission.health.READ_HEART_RATE');
        assert.ok(heart && heart.source === 'health' && heart.apiLevel === 34 && heart.category === 'Health Connect');
        const background = android.find(p => p.constantValue === 'android.permission.health.READ_HEALTH_DATA_IN_BACKGROUND');
        assert.strictEqual(background?.apiLevel, 35);
        assert.strictEqual(android.filter(p => p.source === 'health').length, sdk.health.length);
        for (const vendor of ['com.google.android.gms.permission.AD_ID', 'com.android.vending.BILLING', 'com.google.android.c2dm.permission.RECEIVE']) {
            assert.ok(android.some(p => p.constantValue === vendor && p.source === 'vendor'), vendor);
        }
    });

    test('every entry has a protection level, an audience, a description and an allowed category; no duplicates', () => {
        const allowed = new Set(androidOverlay.categories);
        const seen = new Set<string>();
        for (const permission of android) {
            assert.ok(permission.protectionLevel, `${permission.permission} protectionLevel`);
            assert.ok(permission.audience === 'app' || permission.audience === 'system', `${permission.permission} audience`);
            assert.ok(permission.description, `${permission.permission} description`);
            assert.ok(allowed.has(permission.category), `${permission.permission} category ${permission.category}`);
            assert.ok(!seen.has(permission.constantValue), `duplicate ${permission.constantValue}`);
            seen.add(permission.constantValue);
        }
        for (const permission of android) {
            for (const reference of [...(permission.replacedBy ?? []), ...(permission.pairsWith ?? [])]) {
                assert.ok(seen.has(reference), `${permission.permission} references unknown ${reference}`);
            }
        }
    });

    test('iOS keys are documented by Apple, typed, and use real permission_handler macros', () => {
        const allowed = new Set(iosOverlay.categories);
        const macros = new Set<string>(PERMISSION_HANDLER_MACROS);
        const keys = new Set(ios.map(p => p.permission));
        assert.strictEqual(keys.size, ios.length, 'duplicate iOS key');
        assert.ok(!keys.has('NSUserNotificationsUsageDescription'), 'invented key is back');
        assert.ok(!keys.has('NSWiFiAwareUsageDescription'), 'Wi-Fi Aware has no usage-description key');
        for (const permission of ios) {
            assert.ok(appleKeys[permission.permission], `${permission.permission} not in Apple documentation data`);
            assert.ok(['string', 'boolean', 'array', 'dictionary'].includes(permission.type), `${permission.permission} type`);
            assert.ok(allowed.has(permission.category), `${permission.permission} category`);
            if (permission.podfileMacro) {
                assert.ok(macros.has(permission.podfileMacro), `${permission.permission} macro ${permission.podfileMacro}`);
            }
            for (const reference of [...(permission.replacedBy ?? []), ...(permission.pairsWith ?? [])]) {
                assert.ok(keys.has(reference), `${permission.permission} references unknown ${reference}`);
            }
        }
        const byKey = new Map(ios.map(p => [p.permission, p]));
        assert.strictEqual(byKey.get('NSCalendarsFullAccessUsageDescription')?.podfileMacro, 'PERMISSION_EVENTS_FULL_ACCESS');
        assert.strictEqual(byKey.get('NSPhotoLibraryAddUsageDescription')?.podfileMacro, 'PERMISSION_PHOTOS_ADD_ONLY');
        assert.strictEqual(byKey.get('NSSiriUsageDescription')?.podfileMacro, 'PERMISSION_ASSISTANT');
        assert.strictEqual(byKey.get('NSCameraUsageDescription')?.minOS, '7.0');
        assert.strictEqual(byKey.get('NSBonjourServices')?.type, 'array');
        assert.strictEqual(byKey.get('NSBluetoothPeripheralUsageDescription')?.deprecatedInOS, '13.0');
        assert.ok(byKey.has('NSAlarmKitUsageDescription') && byKey.has('NSAccessorySetupKitSupports'));
    });

    test('the cross-platform mapping only references catalog entries', () => {
        const androidNames = new Set(android.map(p => p.constantValue));
        const iosKeys = new Set(ios.map(p => p.permission));
        for (const [androidName, keys] of Object.entries(mapping.androidToIos)) {
            assert.ok(androidNames.has(androidName), androidName);
            keys.forEach(key => assert.ok(iosKeys.has(key), `${androidName} -> ${key}`));
        }
        for (const [key, names] of Object.entries(mapping.iosToAndroid)) {
            assert.ok(iosKeys.has(key), key);
            names.forEach(name => assert.ok(androidNames.has(name), `${key} -> ${name}`));
        }
        for (const [androidName, macro] of Object.entries(mapping.androidToIosPodfileMacros ?? {})) {
            assert.ok(androidNames.has(androidName), androidName);
            assert.ok((PERMISSION_HANDLER_MACROS as readonly string[]).includes(macro.podfileMacro));
        }
    });
});
