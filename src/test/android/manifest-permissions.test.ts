import * as assert from 'assert';
import {
    extractAndroidPermissionEntries,
    normalizeAndroidPermissionName,
    normalizePermissionNames,
    parseManifestPermissions,
    updateAndroidManifest,
} from '../../core/platform/android/manifest.service.js';

/** Shape of a real app manifest (Moqauily): declared permissions, merger removals, a comment and <queries>. */
const MERGER_MANIFEST = [
    '<manifest xmlns:android="http://schemas.android.com/apk/res/android" xmlns:tools="http://schemas.android.com/tools">',
    '    <uses-permission android:name="android.permission.INTERNET" />',
    '    <uses-permission android:name="android.permission.USE_BIOMETRIC" />',
    '    <!-- Ad-free release: do not inherit advertising-ID access from dependencies. -->',
    '    <uses-permission android:name="com.google.android.gms.permission.AD_ID" tools:node="remove" />',
    '    <uses-permission android:name="android.permission.ACCESS_ADSERVICES_AD_ID" tools:node="remove" />',
    '    <uses-permission android:name="android.permission.ACCESS_ADSERVICES_ATTRIBUTION" tools:node="remove" />',
    '    <application android:label="app">',
    '        <activity android:name=".MainActivity" />',
    '    </application>',
    '    <queries>',
    '        <intent>',
    '            <action android:name="android.intent.action.PROCESS_TEXT"/>',
    '            <data android:mimeType="text/plain"/>',
    '        </intent>',
    '    </queries>',
    '</manifest>',
    '',
].join('\n');

const REMOVE_LINES = MERGER_MANIFEST.split('\n').filter(line => line.includes('tools:node="remove"'));

const ATTRIBUTE_MANIFEST = [
    '<manifest xmlns:android="http://schemas.android.com/apk/res/android">',
    '    <uses-permission android:name="android.permission.READ_EXTERNAL_STORAGE" android:maxSdkVersion="32" />',
    '    <uses-permission android:name="android.permission.BLUETOOTH_SCAN" android:usesPermissionFlags="neverForLocation" />',
    '    <uses-permission android:name="android.permission.WRITE_EXTERNAL_STORAGE" android:minSdkVersion="19" android:maxSdkVersion="28" />',
    '    <uses-permission-sdk-23 android:name="android.permission.ACCESS_COARSE_LOCATION" />',
    '    <application />',
    '</manifest>',
].join('\n');

suite('Android manifest permission writer', () => {
    test('normalizes short names but keeps vendor names', () => {
        assert.strictEqual(normalizeAndroidPermissionName('CAMERA'), 'android.permission.CAMERA');
        assert.strictEqual(normalizeAndroidPermissionName(' android.permission.CAMERA '), 'android.permission.CAMERA');
        assert.strictEqual(
            normalizeAndroidPermissionName('com.google.android.gms.permission.AD_ID'),
            'com.google.android.gms.permission.AD_ID',
        );
        assert.deepStrictEqual(
            normalizePermissionNames(['com.android.vending.BILLING', 'BILLING']),
            ['com.android.vending.BILLING', 'android.permission.BILLING'],
        );
    });

    test('parses both element kinds and ignores commented-out elements', () => {
        const withComment = ATTRIBUTE_MANIFEST.replace(
            '<application />',
            '<!-- <uses-permission android:name="android.permission.CAMERA" /> -->\n    <application />',
        );
        const elements = parseManifestPermissions(withComment);
        assert.deepStrictEqual(elements.map(element => element.name), [
            'android.permission.READ_EXTERNAL_STORAGE',
            'android.permission.BLUETOOTH_SCAN',
            'android.permission.WRITE_EXTERNAL_STORAGE',
            'android.permission.ACCESS_COARSE_LOCATION',
        ]);
        assert.strictEqual(elements[3].tag, 'uses-permission-sdk-23');
    });

    test('extracts attributes, sdk-23 and tools:node', () => {
        const entries = extractAndroidPermissionEntries(ATTRIBUTE_MANIFEST + MERGER_MANIFEST);
        const byName = new Map(entries.map(entry => [entry.name, entry]));
        assert.strictEqual(byName.get('android.permission.READ_EXTERNAL_STORAGE')?.maxSdkVersion, 32);
        assert.strictEqual(byName.get('android.permission.BLUETOOTH_SCAN')?.usesPermissionFlags, 'neverForLocation');
        assert.strictEqual(byName.get('android.permission.WRITE_EXTERNAL_STORAGE')?.minSdkVersion, 19);
        assert.strictEqual(byName.get('android.permission.ACCESS_COARSE_LOCATION')?.sdk23, true);
        assert.strictEqual(byName.get('com.google.android.gms.permission.AD_ID')?.toolsNode, 'remove');
    });

    test('keeps tools:node="remove" lines byte-for-byte when they are not in the list', () => {
        const updated = updateAndroidManifest(MERGER_MANIFEST, ['android.permission.INTERNET', 'android.permission.CAMERA']);
        for (const line of REMOVE_LINES) {
            assert.ok(updated.includes(line), `lost: ${line}`);
        }
        assert.ok(updated.includes('<!-- Ad-free release: do not inherit advertising-ID access from dependencies. -->'));
        assert.ok(!updated.includes('USE_BIOMETRIC'));
        assert.ok(updated.includes('<uses-permission android:name="android.permission.CAMERA" />'));
        assert.ok(updated.includes('<queries>') && updated.includes('android.intent.action.PROCESS_TEXT'));
    });

    test('adding permissions only adds lines (diff is the added lines)', () => {
        const existing = extractAndroidPermissionEntries(MERGER_MANIFEST);
        const updated = updateAndroidManifest(MERGER_MANIFEST, [
            ...existing,
            'CAMERA',
            { name: 'READ_EXTERNAL_STORAGE', maxSdkVersion: 32 },
            { name: 'BLUETOOTH_SCAN', usesPermissionFlags: 'neverForLocation' },
        ]);
        const before = MERGER_MANIFEST.split('\n');
        const after = updated.split('\n');
        const added = after.filter(line => !before.includes(line));
        assert.deepStrictEqual(added, [
            '    <uses-permission android:name="android.permission.CAMERA" />',
            '    <uses-permission android:name="android.permission.READ_EXTERNAL_STORAGE" android:maxSdkVersion="32" />',
            '    <uses-permission android:name="android.permission.BLUETOOTH_SCAN" android:usesPermissionFlags="neverForLocation" />',
        ]);
        assert.deepStrictEqual(before.filter(line => !after.includes(line)), []);
        // New lines go after the last declared permission, above the merger block.
        assert.ok(updated.indexOf('BLUETOOTH_SCAN') < updated.indexOf('Ad-free release'));
    });

    test('string overload preserves maxSdkVersion, usesPermissionFlags and minSdkVersion', () => {
        const names = extractAndroidPermissionEntries(ATTRIBUTE_MANIFEST).map(entry => entry.name);
        assert.strictEqual(updateAndroidManifest(ATTRIBUTE_MANIFEST, names), ATTRIBUTE_MANIFEST);
    });

    test('entries change only the attributes they specify; null removes one', () => {
        const updated = updateAndroidManifest(ATTRIBUTE_MANIFEST, [
            { name: 'android.permission.READ_EXTERNAL_STORAGE', maxSdkVersion: 29 },
            { name: 'android.permission.BLUETOOTH_SCAN', usesPermissionFlags: null },
            { name: 'android.permission.WRITE_EXTERNAL_STORAGE' },
            { name: 'android.permission.ACCESS_COARSE_LOCATION' },
        ]);
        assert.ok(updated.includes('<uses-permission android:name="android.permission.READ_EXTERNAL_STORAGE" android:maxSdkVersion="29" />'));
        assert.ok(updated.includes('<uses-permission android:name="android.permission.BLUETOOTH_SCAN" />'));
        assert.ok(updated.includes('android:minSdkVersion="19" android:maxSdkVersion="28"'));
        assert.ok(updated.includes('<uses-permission-sdk-23 android:name="android.permission.ACCESS_COARSE_LOCATION" />'));
    });

    test('handles <uses-permission-sdk-23> as its own element kind without duplicating it', () => {
        const kept = updateAndroidManifest(ATTRIBUTE_MANIFEST, ['android.permission.ACCESS_COARSE_LOCATION']);
        assert.strictEqual((kept.match(/ACCESS_COARSE_LOCATION/g) || []).length, 1);
        assert.ok(kept.includes('<uses-permission-sdk-23 android:name="android.permission.ACCESS_COARSE_LOCATION" />'));

        const converted = updateAndroidManifest(ATTRIBUTE_MANIFEST, [{ name: 'android.permission.ACCESS_COARSE_LOCATION', sdk23: false }]);
        assert.ok(converted.includes('<uses-permission android:name="android.permission.ACCESS_COARSE_LOCATION" />'));
        assert.ok(!converted.includes('uses-permission-sdk-23'));

        const added = updateAndroidManifest(ATTRIBUTE_MANIFEST, [{ name: 'CAMERA', sdk23: true }]);
        assert.ok(added.includes('<uses-permission-sdk-23 android:name="android.permission.CAMERA" />'));
    });

    test('an explicit entry can turn a merger removal into a declaration and back', () => {
        const declared = updateAndroidManifest(MERGER_MANIFEST, [
            'android.permission.INTERNET',
            { name: 'com.google.android.gms.permission.AD_ID', toolsNode: null },
        ]);
        assert.ok(declared.includes('<uses-permission android:name="com.google.android.gms.permission.AD_ID" />'));
        const removedAgain = updateAndroidManifest(declared, [
            'android.permission.INTERNET',
            { name: 'com.google.android.gms.permission.AD_ID', toolsNode: 'remove' },
        ]);
        assert.ok(removedAgain.includes('<uses-permission android:name="com.google.android.gms.permission.AD_ID" tools:node="remove" />'));
    });

    test('adds xmlns:tools when a tools attribute is written', () => {
        const manifest = '<manifest xmlns:android="http://schemas.android.com/apk/res/android">\n    <application />\n</manifest>\n';
        const updated = updateAndroidManifest(manifest, [{ name: 'com.google.android.gms.permission.AD_ID', toolsNode: 'remove' }]);
        assert.ok(updated.includes('xmlns:tools="http://schemas.android.com/tools"'));
        assert.ok(updated.includes('tools:node="remove"'));
    });

    test('keeps unknown attributes verbatim', () => {
        const manifest = '<manifest xmlns:android="http://schemas.android.com/apk/res/android" xmlns:tools="http://schemas.android.com/tools">\n'
            + '    <uses-permission android:name="android.permission.SCHEDULE_EXACT_ALARM" tools:ignore="ProtectedPermissions" android:required="false" />\n'
            + '</manifest>\n';
        const updated = updateAndroidManifest(manifest, [{ name: 'android.permission.SCHEDULE_EXACT_ALARM', maxSdkVersion: 32 }]);
        assert.ok(updated.includes('tools:ignore="ProtectedPermissions" android:required="false" android:maxSdkVersion="32" />'));
    });

    test('is idempotent and keeps CRLF line endings', () => {
        const crlf = MERGER_MANIFEST.replace(/\n/g, '\r\n');
        const entries = [...extractAndroidPermissionEntries(crlf), 'CAMERA'];
        const once = updateAndroidManifest(crlf, entries);
        assert.strictEqual(updateAndroidManifest(once, entries), once);
        assert.ok(!/[^\r]\n/.test(once), 'mixed line endings');
    });

    test('removing every declared permission keeps the merger block and queries', () => {
        const updated = updateAndroidManifest(MERGER_MANIFEST, []);
        assert.ok(!updated.includes('android.permission.INTERNET'));
        for (const line of REMOVE_LINES) {
            assert.ok(updated.includes(line));
        }
        assert.ok(updated.includes('</queries>'));
    });

    test('returns the content unchanged when there is no <manifest> element', () => {
        assert.strictEqual(updateAndroidManifest('<root/>', ['CAMERA']), '<root/>');
    });
});
