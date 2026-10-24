import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
    UNKNOWN_CATEGORY,
    buildUsedAndroidPermissions,
    buildUsedIOSPermissions,
    flattenCatalog,
    resolveAndroidPermissionName,
} from '../../features/permissions/catalog.js';
import {
    evaluateSdkExpression,
    readGradleSdkExpressions,
    readProjectPermissionFacts,
} from '../../features/permissions/project-facts.js';
import { updateAndroidManifest } from '../../core/platform/android/manifest.service.js';
import type { AndroidPermission, IOSPermission } from '../../core/types/index.js';

const ROOT = path.resolve(__dirname, '..', '..', '..');
const androidCatalog = flattenCatalog(JSON.parse(fs.readFileSync(path.join(ROOT, 'src/categorized-android-permissions.json'), 'utf8')) as Record<string, AndroidPermission[]>);
const iosCatalog = flattenCatalog(JSON.parse(fs.readFileSync(path.join(ROOT, 'src/categorized-ios-permissions.json'), 'utf8')) as Record<string, IOSPermission[]>);

const MANIFEST = [
    '<manifest xmlns:android="http://schemas.android.com/apk/res/android" xmlns:tools="http://schemas.android.com/tools">',
    '    <uses-permission android:name="android.permission.INTERNET" />',
    '    <uses-permission android:name="android.permission.READ_EXTERNAL_STORAGE" android:maxSdkVersion="32" />',
    '    <uses-permission android:name="android.permission.BLUETOOTH_SCAN" android:usesPermissionFlags="neverForLocation" />',
    '    <uses-permission android:name="com.example.permission.C2D_MESSAGE" />',
    '    <uses-permission android:name="com.google.android.gms.permission.AD_ID" tools:node="remove" />',
    '    <application />',
    '</manifest>',
].join('\n');

suite('Permission extraction', () => {
    test('Android: attributes, merger-removed flag and unknown permissions', () => {
        const used = buildUsedAndroidPermissions(MANIFEST, androidCatalog);
        assert.strictEqual(used.length, 5);
        const byName = new Map(used.map(p => [p.constantValue, p]));
        assert.strictEqual(byName.get('android.permission.READ_EXTERNAL_STORAGE')?.entry.maxSdkVersion, 32);
        assert.strictEqual(byName.get('android.permission.READ_EXTERNAL_STORAGE')?.category, 'Storage');
        assert.strictEqual(byName.get('android.permission.BLUETOOTH_SCAN')?.entry.usesPermissionFlags, 'neverForLocation');
        const adId = byName.get('com.google.android.gms.permission.AD_ID')!;
        assert.strictEqual(adId.mergerRemoved, true);
        assert.strictEqual(adId.source, 'vendor');
        const custom = byName.get('com.example.permission.C2D_MESSAGE')!;
        assert.strictEqual(custom.unknown, true);
        assert.strictEqual(custom.category, UNKNOWN_CATEGORY);
    });

    test('Android: saving what was extracted keeps unknown permissions and the merger block', () => {
        const used = buildUsedAndroidPermissions(MANIFEST, androidCatalog);
        assert.strictEqual(updateAndroidManifest(MANIFEST, used.map(p => p.entry)), MANIFEST);
    });

    test('Android: names resolve through the catalog (health, vendor, short names)', () => {
        assert.strictEqual(resolveAndroidPermissionName(androidCatalog, 'CAMERA'), 'android.permission.CAMERA');
        assert.strictEqual(resolveAndroidPermissionName(androidCatalog, 'health.READ_STEPS'), 'android.permission.health.READ_STEPS');
        assert.strictEqual(resolveAndroidPermissionName(androidCatalog, 'INSTALL_SHORTCUT'), 'com.android.launcher.permission.INSTALL_SHORTCUT');
        assert.strictEqual(resolveAndroidPermissionName(androidCatalog, 'com.example.permission.X'), 'com.example.permission.X');
    });

    test('iOS: strings, booleans, arrays, dictionaries, keys without NS prefix and unknown usage keys', () => {
        const plist = [
            '<plist version="1.0"><dict>',
            '<key>NSCameraUsageDescription</key><string>Scan</string>',
            '<key>NFCReaderUsageDescription</key><string>Read tags</string>',
            '<key>UIRequiresPersistentWiFi</key><true/>',
            '<key>NSBonjourServices</key><array><string>_ipp._tcp</string></array>',
            '<key>NSLocationTemporaryUsageDescriptionDictionary</key><dict><key>Run</key><string>Track</string></dict>',
            '<key>NSFutureUsageDescription</key><string>?</string>',
            '<key>NSPrincipalClass</key><string>NSApplication</string>',
            '</dict></plist>',
        ].join('\n');
        const used = buildUsedIOSPermissions(plist, iosCatalog);
        const byKey = new Map(used.map(p => [p.permission, p]));
        assert.strictEqual(byKey.get('NSCameraUsageDescription')?.value, 'Scan');
        assert.strictEqual(byKey.get('NFCReaderUsageDescription')?.value, 'Read tags');
        assert.strictEqual(byKey.get('UIRequiresPersistentWiFi')?.value, true);
        assert.deepStrictEqual(byKey.get('NSBonjourServices')?.value, ['_ipp._tcp']);
        assert.deepStrictEqual(byKey.get('NSLocationTemporaryUsageDescriptionDictionary')?.value, { Run: 'Track' });
        assert.strictEqual(byKey.get('NSFutureUsageDescription')?.unknown, true);
        assert.ok(!byKey.has('NSPrincipalClass'));
    });
});

suite('Project SDK facts', () => {
    test('reads Kotlin DSL and Groovy SDK expressions', () => {
        assert.deepStrictEqual(readGradleSdkExpressions('android {\n    compileSdk = 37\n    defaultConfig {\n        minSdk = 26\n        targetSdk = 37\n    }\n}'), { minSdk: '26', targetSdk: '37', compileSdk: '37' });
        assert.deepStrictEqual(readGradleSdkExpressions('android {\n    compileSdkVersion 34\n    defaultConfig {\n        minSdkVersion 21 // comment\n        targetSdkVersion flutter.targetSdkVersion\n    }\n}'), { minSdk: '21', targetSdk: 'flutter.targetSdkVersion', compileSdk: '34' });
        assert.strictEqual(readGradleSdkExpressions('defaultConfig { minSdkVersion(23) }\n').minSdk, '23');
        assert.strictEqual(readGradleSdkExpressions('defaultConfig { minSdk = maxOf(flutter.minSdkVersion, 23) }\n').minSdk, 'maxOf(flutter.minSdkVersion, 23)');
    });

    test('evaluates literals, flutter.* defaults and maxOf', () => {
        const defaults = { minSdk: 24, targetSdk: 36, compileSdk: 36 };
        assert.strictEqual(evaluateSdkExpression('26', defaults), 26);
        assert.strictEqual(evaluateSdkExpression('flutter.minSdkVersion', defaults), 24);
        assert.strictEqual(evaluateSdkExpression('maxOf(flutter.compileSdkVersion, 37)', defaults), 37);
        assert.strictEqual(evaluateSdkExpression('Math.max(flutter.compileSdkVersion, 35)', defaults), 36);
        assert.strictEqual(evaluateSdkExpression('maxOf(flutter.compileSdkVersion, 37)', {}), 37);
        assert.strictEqual(evaluateSdkExpression('project.property("x")', defaults), undefined);
    });

    test('reads a project: Groovy build file, wrapper, AGP and the Podfile deployment target', () => {
        const root = fs.mkdtempSync(path.join(os.tmpdir(), 'fcm-facts-'));
        try {
            fs.mkdirSync(path.join(root, 'android', 'app', 'src', 'main'), { recursive: true });
            fs.mkdirSync(path.join(root, 'android', 'gradle', 'wrapper'), { recursive: true });
            fs.mkdirSync(path.join(root, 'ios'), { recursive: true });
            fs.writeFileSync(path.join(root, 'android', 'app', 'build.gradle'), 'android {\n    compileSdk = 37\n    defaultConfig {\n        minSdkVersion 26\n        targetSdkVersion 37\n    }\n}\n');
            fs.writeFileSync(path.join(root, 'android', 'settings.gradle'), 'plugins {\n    id "com.android.application" version "8.7.3" apply false\n}\n');
            fs.writeFileSync(path.join(root, 'android', 'gradle', 'wrapper', 'gradle-wrapper.properties'), 'distributionUrl=https\\://services.gradle.org/distributions/gradle-8.12-all.zip\n');
            fs.writeFileSync(path.join(root, 'android', 'app', 'src', 'main', 'AndroidManifest.xml'), '<manifest><application android:requestLegacyExternalStorage="true" /></manifest>');
            fs.writeFileSync(path.join(root, 'ios', 'Podfile'), "platform :ios, '16.6'\n# 'PERMISSION_CAMERA=1',\n");
            const facts = readProjectPermissionFacts(root);
            assert.strictEqual(facts.android?.minSdk.value, 26);
            assert.strictEqual(facts.android?.targetSdk.value, 37);
            assert.strictEqual(facts.android?.compileSdk.value, 37);
            assert.strictEqual(facts.android?.kotlinDsl, false);
            assert.strictEqual(facts.android?.agpVersion, '8.7.3');
            assert.strictEqual(facts.android?.gradleVersion, '8.12');
            assert.strictEqual(facts.android?.requestLegacyExternalStorage, true);
            assert.strictEqual(facts.ios?.deploymentTarget, '16.6');
            assert.deepStrictEqual(facts.ios?.podfileMacros, ['PERMISSION_CAMERA']);
        } finally {
            fs.rmSync(root, { recursive: true, force: true });
        }
    });

    test('falls back to project.pbxproj for the deployment target', () => {
        const root = fs.mkdtempSync(path.join(os.tmpdir(), 'fcm-facts-'));
        try {
            fs.mkdirSync(path.join(root, 'ios', 'Runner.xcodeproj'), { recursive: true });
            fs.writeFileSync(path.join(root, 'ios', 'Runner.xcodeproj', 'project.pbxproj'), 'IPHONEOS_DEPLOYMENT_TARGET = 12.0;\nIPHONEOS_DEPLOYMENT_TARGET = 13.0;\n');
            const facts = readProjectPermissionFacts(root);
            assert.strictEqual(facts.ios?.deploymentTarget, '13.0');
            assert.strictEqual(facts.ios?.hasPodfile, false);
            assert.strictEqual(facts.android, undefined);
        } finally {
            fs.rmSync(root, { recursive: true, force: true });
        }
    });
});
