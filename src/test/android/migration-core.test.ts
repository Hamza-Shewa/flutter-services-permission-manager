import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { run16kbMigration, runFullMigration } from '../../features/migration/migration-core.js';
import type { MigrationVersions } from '../../features/migration/migration-transforms.js';
import { LEGACY_GROOVY, MASAKEN_GROOVY, MISHKAT_KTS, TEMPLATE_KTS, type AndroidFixture } from './migration-fixtures.js';

const VERSIONS: MigrationVersions = {
    agp: '9.3.1',
    kotlin: '2.4.10',
    googleServices: '4.5.0',
    firebasePerf: '2.0.2',
    crashlytics: '3.0.7',
    compileSdk: '37',
    targetSdk: '37',
    minSdk: '24',
    gradle: '9.5.1',
    ndk: '29.0.14206865'
};
const NDK = '29.0.14206865';

function materialize(fixture: AndroidFixture, flutterNdk?: string): string {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fcm-migration-'));
    for (const [relative, content] of Object.entries(fixture)) {
        const target = path.join(dir, relative);
        fs.mkdirSync(path.dirname(target), { recursive: true });
        fs.writeFileSync(target, content);
    }
    if (flutterNdk) {
        // A fake Flutter SDK exposing `flutter.ndkVersion`.
        const sdk = path.join(dir, 'flutter-sdk');
        const extension = path.join(sdk, 'packages', 'flutter_tools', 'gradle', 'src', 'main', 'kotlin');
        fs.mkdirSync(extension, { recursive: true });
        fs.writeFileSync(path.join(extension, 'FlutterExtension.kt'), `class FlutterExtension {\n    val ndkVersion: String = "${flutterNdk}"\n}\n`);
        fs.writeFileSync(path.join(dir, 'local.properties'), `flutter.sdk=${sdk.replace(/\\/g, '\\\\')}\n`);
    }
    return dir;
}

const read = (dir: string, relative: string) => fs.readFileSync(path.join(dir, relative), 'utf8');

suite('Android Migration end-to-end', () => {
    suite('full migration', () => {
        test('legacy Groovy project: declarative, buildscript-free, Firebase kept, extractNativeLibs moved to the build script', () => {
            const dir = materialize(LEGACY_GROOVY);
            const report = runFullMigration(dir, VERSIONS);
            assert.ok(report.changed);

            const settings = read(dir, 'settings.gradle');
            assert.ok(!settings.includes('app_plugin_loader'));
            assert.ok(settings.includes('id "com.google.gms.google-services" version "4.5.0" apply false'));
            assert.ok(/flutter-plugin-loader" version "1.0.0"\n/.test(settings));

            const project = read(dir, 'build.gradle');
            assert.ok(!project.includes('buildscript'));
            assert.ok(project.includes('private.example.com'));

            const app = read(dir, 'app/build.gradle');
            assert.ok(app.startsWith('plugins {'));
            assert.ok(app.includes('id "com.google.gms.google-services"'));
            assert.ok(app.includes('minSdkVersion 31'), 'minSdk is never touched');
            assert.ok(app.includes('compileSdkVersion 37'));
            assert.ok(app.includes('useLegacyPackaging = true'), 'manifest extractNativeLibs="true" becomes useLegacyPackaging');

            assert.ok(!read(dir, 'app/src/main/AndroidManifest.xml').includes('extractNativeLibs'));
            assert.ok(read(dir, 'gradle/wrapper/gradle-wrapper.properties').includes('gradle-9.5.1-all.zip'));

            const properties = read(dir, 'gradle.properties');
            assert.ok(properties.includes('android.builtInKotlin=false') && properties.includes('android.newDsl=false'));
            assert.ok(properties.includes('android.enableJetifier=true'), 'user lines are kept');
        });

        test('Kotlin DSL projects keep their Flutter-managed values and newer AGP/Gradle', () => {
            const dir = materialize(MISHKAT_KTS, '28.2.13676358');
            runFullMigration(dir, VERSIONS);

            const settings = read(dir, 'settings.gradle.kts');
            assert.ok(settings.includes('id("com.android.application") version "9.4.0-alpha06" apply false'));
            assert.ok(/id\("dev\.flutter\.flutter-plugin-loader"\) version "1\.0\.0"\n/.test(settings));

            const app = read(dir, 'app/build.gradle.kts');
            assert.ok(app.includes('compileSdk = maxOf(flutter.compileSdkVersion, 37)'));
            assert.ok(app.includes('ndkVersion = flutter.ndkVersion'), 'a 16 KB capable Flutter NDK stays Flutter-managed');
            assert.ok(app.includes('minSdk = flutter.minSdkVersion'));

            assert.ok(read(dir, 'gradle/wrapper/gradle-wrapper.properties').includes('gradle-9.6.0-bin.zip'), 'Gradle 9.6.0 must not be downgraded');
        });

        test('an older Flutter SDK NDK is pinned to the reference', () => {
            const dir = materialize(TEMPLATE_KTS, '26.3.11579264');
            runFullMigration(dir, VERSIONS);
            assert.ok(read(dir, 'app/build.gradle.kts').includes(`ndkVersion = "${NDK}"`));
        });

        test('is idempotent on every fixture and reports nothing to change the second time', () => {
            for (const fixture of [LEGACY_GROOVY, TEMPLATE_KTS, MISHKAT_KTS, MASAKEN_GROOVY]) {
                const dir = materialize(fixture, '28.2.13676358');
                runFullMigration(dir, VERSIONS);
                const snapshot = Object.keys(fixture).map((f) => read(dir, f));
                const second = runFullMigration(dir, VERSIONS);
                assert.strictEqual(second.changed, false, second.details.join('; '));
                assert.deepStrictEqual(Object.keys(fixture).map((f) => read(dir, f)), snapshot);
            }
        });

        test('an already-migrated masaken-style project is left byte-for-byte alone', () => {
            const dir = materialize(MASAKEN_GROOVY, '28.2.13676358');
            const report = runFullMigration(dir, VERSIONS);
            assert.strictEqual(report.changed, false);
            for (const [file, content] of Object.entries(MASAKEN_GROOVY)) {
                assert.strictEqual(read(dir, file), content, file);
            }
        });

        test('keeps CRLF line endings', () => {
            const crlf: AndroidFixture = { ...TEMPLATE_KTS };
            for (const key of Object.keys(crlf) as Array<keyof AndroidFixture>) {
                crlf[key] = crlf[key]!.replace(/\n/g, '\r\n');
            }
            const dir = materialize(crlf);
            runFullMigration(dir, VERSIONS);
            for (const file of ['settings.gradle.kts', 'build.gradle.kts', 'gradle.properties']) {
                assert.ok(!/[^\r]\n/.test(read(dir, file)), `${file} must stay CRLF`);
            }
        });

        test('creates gradle.properties when the project has none', () => {
            const { ['gradle.properties']: _dropped, ...withoutProperties } = TEMPLATE_KTS;
            const dir = materialize(withoutProperties as AndroidFixture);
            runFullMigration(dir, VERSIONS);
            assert.ok(read(dir, 'gradle.properties').includes('android.builtInKotlin=false'));
        });
    });

    suite('16 KB migration', () => {
        test('pins an old NDK, leaves the rest of the build files alone', () => {
            const dir = materialize(TEMPLATE_KTS, '26.3.11579264');
            const before = ['settings.gradle.kts', 'build.gradle.kts', 'gradle.properties'].map((f) => read(dir, f));
            const report = run16kbMigration(dir, NDK);
            assert.ok(report.changed);
            assert.ok(read(dir, 'app/build.gradle.kts').includes(`ndkVersion = "${NDK}"`));
            assert.deepStrictEqual(['settings.gradle.kts', 'build.gradle.kts', 'gradle.properties'].map((f) => read(dir, f)), before);
            assert.ok(!read(dir, 'app/build.gradle.kts').includes('useLegacyPackaging'), 'AGP 9 aligns uncompressed libs itself');
        });

        test('does something for the standard flutter.ndkVersion layout instead of silently doing nothing', () => {
            const dir = materialize(MISHKAT_KTS, '27.0.12077973');
            const report = run16kbMigration(dir, NDK);
            assert.ok(report.changed, 'flutter.ndkVersion on an NDK 27 SDK is not 16 KB capable');
            assert.ok(read(dir, 'app/build.gradle.kts').includes(`ndkVersion = "${NDK}"`));
        });

        test('reports "nothing to change" when the Flutter SDK already provides NDK 28+', () => {
            const dir = materialize(MISHKAT_KTS, '28.2.13676358');
            const report = run16kbMigration(dir, NDK);
            assert.strictEqual(report.changed, false);
            assert.ok(/nothing to change/i.test(report.message));
        });

        test('packages libraries compressed on AGP older than 8.5.1 and tells the user to upgrade', () => {
            const oldAgp: AndroidFixture = {
                ...TEMPLATE_KTS,
                'settings.gradle.kts': TEMPLATE_KTS['settings.gradle.kts']!.replace('9.0.1', '8.3.0')
            };
            const dir = materialize(oldAgp, '28.2.13676358');
            const report = run16kbMigration(dir, NDK);
            assert.ok(report.changed);
            assert.ok(read(dir, 'app/build.gradle.kts').includes('useLegacyPackaging = true'));
            assert.ok(report.warnings.some((w) => /8\.5\.1/.test(w)));
        });

        test('removes a manifest extractNativeLibs attribute (AGP 9 fails the build on it)', () => {
            const dir = materialize(LEGACY_GROOVY, '28.2.13676358');
            run16kbMigration(dir, NDK);
            assert.ok(!read(dir, 'app/src/main/AndroidManifest.xml').includes('extractNativeLibs'));
            assert.ok(read(dir, 'app/build.gradle').includes('useLegacyPackaging = true'));
        });

        test('bumps the NDK in the masaken-style flutter map only when it is below 28', () => {
            const dir = materialize(MASAKEN_GROOVY, '28.2.13676358');
            const before = read(dir, 'build.gradle');
            run16kbMigration(dir, NDK);
            assert.strictEqual(read(dir, 'build.gradle'), before);

            const low = materialize({ ...MASAKEN_GROOVY, 'build.gradle': MASAKEN_GROOVY['build.gradle']!.replace('29.0.14206865', '26.1.10909125') }, '28.2.13676358');
            run16kbMigration(low, NDK);
            assert.ok(read(low, 'build.gradle').includes(`ndkVersion: "${NDK}"`));
        });

        test('is idempotent', () => {
            const dir = materialize(TEMPLATE_KTS, '26.3.11579264');
            run16kbMigration(dir, NDK);
            assert.strictEqual(run16kbMigration(dir, NDK).changed, false);
        });
    });
});
