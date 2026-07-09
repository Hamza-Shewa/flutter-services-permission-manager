import * as assert from 'assert';
import {
    flattenAndroidPermissions,
    flattenIOSPermissions,
    enrichAndroidPermissionsWithEquivalents,
    enrichIOSPermissionsWithEquivalents
} from '../../utils/extractors.js';

suite('Extractors Utils Test Suite', () => {
    suite('flattenAndroidPermissions', () => {
        test('flattens array', () => {
            const data = [{ permission: 'A' }, { permission: 'B' }];
            const result = flattenAndroidPermissions(data as any);
            assert.strictEqual(result.length, 2);
            assert.strictEqual(result[0].permission, 'A');
        });

        test('flattens object', () => {
            const data = { cat1: [{ permission: 'A' }], cat2: [{ permission: 'B' }] };
            const result = flattenAndroidPermissions(data as any);
            assert.strictEqual(result.length, 2);
        });

        test('returns empty array for invalid input', () => {
            const result = flattenAndroidPermissions(null as any);
            assert.strictEqual(result.length, 0);
        });
    });

    suite('flattenIOSPermissions', () => {
        test('flattens array', () => {
            const data = [{ permission: 'A' }, { permission: 'B' }];
            const result = flattenIOSPermissions(data as any);
            assert.strictEqual(result.length, 2);
            assert.strictEqual(result[0].permission, 'A');
        });

        test('flattens object', () => {
            const data = { cat1: [{ permission: 'A' }], cat2: [{ permission: 'B' }] };
            const result = flattenIOSPermissions(data as any);
            assert.strictEqual(result.length, 2);
        });
    });

    suite('enrichAndroidPermissionsWithEquivalents', () => {
        test('enriches using mappings', () => {
            const perms = [{ permission: 'Camera', constantValue: 'android.permission.CAMERA' }];
            const mappings = {
                iosToAndroid: {},
                androidToIos: { 'android.permission.CAMERA': ['NSCameraUsageDescription'] }
            };
            
            const result = enrichAndroidPermissionsWithEquivalents(perms as any, mappings as any);
            assert.strictEqual(result.length, 1);
            assert.strictEqual(result[0].constantValue, 'android.permission.CAMERA');
            assert.deepStrictEqual(result[0].equivalentIosPermissions, ['NSCameraUsageDescription']);
        });

        test('handles unknown permissions', () => {
            const perms = [{ permission: 'Unknown', constantValue: 'android.permission.UNKNOWN' }];
            const result = enrichAndroidPermissionsWithEquivalents(perms as any, { androidToIos: {}, iosToAndroid: {} });
            assert.strictEqual(result.length, 1);
            assert.deepStrictEqual(result[0].equivalentIosPermissions, []);
        });
    });

    suite('enrichIOSPermissionsWithEquivalents', () => {
        test('enriches using mappings', () => {
            const perms = [{ permission: 'NSCameraUsageDescription', value: 'Needs camera', type: 'string' }];
            const mappings = {
                androidToIos: {},
                iosToAndroid: { 'NSCameraUsageDescription': ['android.permission.CAMERA'] }
            };
            
            const result = enrichIOSPermissionsWithEquivalents(perms as any, mappings as any);
            assert.strictEqual(result.length, 1);
            assert.strictEqual(result[0].permission, 'NSCameraUsageDescription');
            assert.deepStrictEqual(result[0].equivalentAndroidPermissions, ['android.permission.CAMERA']);
        });

        test('handles unknown permissions', () => {
            const perms = [{ permission: 'Unknown', value: 'Value', type: 'string' }];
            const result = enrichIOSPermissionsWithEquivalents(perms as any, { androidToIos: {}, iosToAndroid: {} });
            assert.strictEqual(result.length, 1);
            assert.deepStrictEqual(result[0].equivalentAndroidPermissions, []);
        });
    });
});
