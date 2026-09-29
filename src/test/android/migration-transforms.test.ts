import * as assert from 'assert';
import {
    compareVersions,
    maxVersion,
    isPrerelease,
    ensurePluginManagement,
    isLegacySettings,
    updateSettingsPlugins,
    migrateProjectBuildGradle,
    ensureProjectRepositories,
    ensureDependencyResolutionManagement,
    migrateAppBuildGradle,
    normalizeNdk,
    ndkSupports16Kb,
    readLiteralMinSdk,
    updateGradleWrapper,
    bumpGradleWrapperMinimum,
    bumpAgpVersion,
    bumpSdkVersions,
    bumpNdkVersion,
    removeExtractNativeLibs,
    getAgpVersion,
    ensureUseLegacyPackaging,
    detectFirebaseUsage,
    ensureAgpGradleProperties,
    type MigrationVersions
} from '../../features/migration/migration-transforms.js';
import { LEGACY_GROOVY, MASAKEN_GROOVY, MISHKAT_KTS, TEMPLATE_KTS } from './migration-fixtures.js';

// Reference versions (also the extension defaults).
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

const MINIMUMS = { agp: '9.3.1', kotlin: '2.4.10' };
const NO_FIREBASE = { googleServices: false, firebasePerf: false, crashlytics: false };

suite('Android Migration Transforms Test Suite', () => {
    suite('version helpers', () => {
        test('compareVersions handles major/minor/patch', () => {
            assert.ok(compareVersions('8.5.2', '8.5.1') > 0);
            assert.ok(compareVersions('8.5', '8.5.2') < 0);
            assert.strictEqual(compareVersions('8.5.2', '8.5.2'), 0);
            assert.ok(compareVersions('8.13.2', '8.9.1') > 0);
            assert.ok(compareVersions('9.0.0', '8.13.2') > 0);
        });

        test('compareVersions orders pre-releases below their release but above earlier releases', () => {
            assert.ok(compareVersions('9.4.0-alpha06', '9.3.1') > 0);
            assert.ok(compareVersions('9.4.0-alpha06', '9.4.0') < 0);
            assert.ok(compareVersions('9.4.0-alpha10', '9.4.0-alpha06') > 0);
            assert.ok(isPrerelease('9.5.0-alpha03'));
            assert.ok(!isPrerelease('9.5.0'));
        });

        test('maxVersion returns the newer version', () => {
            assert.strictEqual(maxVersion('8.5.2', '8.4.0'), '8.5.2');
            assert.strictEqual(maxVersion('8.4.0', '8.5.2'), '8.5.2');
            assert.strictEqual(maxVersion('9.4.0-alpha06', '9.3.1'), '9.4.0-alpha06');
        });
    });

    suite('ensurePluginManagement', () => {
        test('adds pluginManagement to a legacy settings.gradle', () => {
            const result = ensurePluginManagement("include ':app'\n", false);
            assert.ok(result.startsWith('pluginManagement {'));
            assert.ok(result.includes('gradlePluginPortal()'));
            assert.ok(result.includes("include ':app'"));
        });

        test('leaves existing pluginManagement untouched', () => {
            const modern = 'pluginManagement {\n    repositories { google() }\n}\nplugins {}\n';
            assert.strictEqual(ensurePluginManagement(modern, true), modern);
        });
    });

    suite('updateSettingsPlugins', () => {
        test('detects the pre-3.16 imperative loader', () => {
            assert.ok(isLegacySettings(LEGACY_GROOVY['settings.gradle']!));
            assert.ok(!isLegacySettings(MASAKEN_GROOVY['settings.gradle']!));
            assert.ok(!isLegacySettings(TEMPLATE_KTS['settings.gradle.kts']!));
        });

        test('rewrites imperative settings to the declarative layout and keeps the includes', () => {
            const result = updateSettingsPlugins(LEGACY_GROOVY['settings.gradle']!, false, VERSIONS, NO_FIREBASE, MINIMUMS);
            assert.ok(!result.includes('app_plugin_loader'));
            assert.ok(result.includes('includeBuild("$flutterSdkPath/packages/flutter_tools/gradle")'));
            assert.ok(result.includes('id "dev.flutter.flutter-plugin-loader" version "1.0.0"\n'));
            assert.ok(result.includes('id "com.android.application" version "9.3.1" apply false'));
            assert.ok(result.includes('id "org.jetbrains.kotlin.android" version "2.4.10" apply false'));
            assert.ok(result.includes("include ':app'"));
            // The plugins block must directly follow pluginManagement (Gradle rejects statements before it).
            assert.ok(result.indexOf('pluginManagement {') < result.indexOf('plugins {'));
        });

        test('never puts "apply false" on the Flutter plugin loader', () => {
            const wrong = 'plugins {\n    id "dev.flutter.flutter-plugin-loader" version "1.0.0" apply false\n}\n';
            const result = updateSettingsPlugins(wrong, false, VERSIONS, NO_FIREBASE, MINIMUMS);
            assert.ok(result.includes('id "dev.flutter.flutter-plugin-loader" version "1.0.0"\n'));
            assert.ok(!/flutter-plugin-loader"[^\n]*apply false/.test(result));
        });

        test('adds firebase plugins only when detected', () => {
            const result = updateSettingsPlugins(LEGACY_GROOVY['settings.gradle']!, false, VERSIONS, {
                googleServices: true,
                firebasePerf: false,
                crashlytics: true
            }, MINIMUMS);
            assert.ok(result.includes('id "com.google.gms.google-services" version "4.5.0" apply false'));
            assert.ok(!result.includes('firebase-perf'));
            assert.ok(result.includes('id "com.google.firebase.crashlytics" version "3.0.7" apply false'));
        });

        test('raises older plugins to the reference versions', () => {
            const kts = [
                'plugins {',
                '    id("dev.flutter.flutter-plugin-loader") version "1.0.0"',
                '    id("com.android.application") version "8.0.0" apply false',
                '    id("org.jetbrains.kotlin.android") version "1.9.22" apply false',
                '}',
                'include(":app")'
            ].join('\n');
            const result = updateSettingsPlugins(kts, true, VERSIONS, NO_FIREBASE, MINIMUMS);
            assert.ok(result.includes('id("com.android.application") version "9.3.1" apply false'));
            assert.ok(result.includes('id("org.jetbrains.kotlin.android") version "2.4.10" apply false'));
        });

        test('never downgrades a newer AGP, Kotlin or google-services (including AGP pre-releases)', () => {
            const result = updateSettingsPlugins(MISHKAT_KTS['settings.gradle.kts']!, true, VERSIONS, NO_FIREBASE, MINIMUMS);
            assert.ok(result.includes('id("com.android.application") version "9.4.0-alpha06" apply false'));

            const groovy = [
                'plugins {',
                '    id "dev.flutter.flutter-plugin-loader" version "1.0.0"',
                '    id "com.android.application" version "9.6.0" apply false',
                '    id "com.google.gms.google-services" version "4.9.0" apply false',
                '    id "org.jetbrains.kotlin.android" version "2.5.0" apply false',
                '}',
                'include ":app"'
            ].join('\n');
            const kept = updateSettingsPlugins(groovy, false, VERSIONS, { ...NO_FIREBASE, googleServices: true }, MINIMUMS);
            assert.ok(kept.includes('"com.android.application" version "9.6.0"'));
            assert.ok(kept.includes('"com.google.gms.google-services" version "4.9.0"'));
            assert.ok(kept.includes('"org.jetbrains.kotlin.android" version "2.5.0"'));
        });

        test('inserts a missing plugin on a clean line inside the plugins block', () => {
            const result = updateSettingsPlugins(MISHKAT_KTS['settings.gradle.kts']!, true, VERSIONS, NO_FIREBASE, MINIMUMS);
            assert.ok(/plugins \{\n    id\("org\.jetbrains\.kotlin\.android"\) version "2\.4\.10" apply false\n/.test(result), result);
            assert.ok(!/plugins \{\n\s*\n/.test(result));
        });

        test('is idempotent', () => {
            for (const [content, kts] of [
                [MASAKEN_GROOVY['settings.gradle']!, false],
                [TEMPLATE_KTS['settings.gradle.kts']!, true]
            ] as Array<[string, boolean]>) {
                const once = updateSettingsPlugins(content, kts, VERSIONS, NO_FIREBASE, MINIMUMS);
                assert.strictEqual(updateSettingsPlugins(once, kts, VERSIONS, NO_FIREBASE, MINIMUMS), once);
            }
        });
    });

    suite('migrateProjectBuildGradle', () => {
        test('removes the legacy buildscript block and keeps custom repositories, buildDir and clean task', () => {
            const result = migrateProjectBuildGradle(LEGACY_GROOVY['build.gradle']!, false, VERSIONS);
            assert.ok(!result.includes('buildscript'));
            assert.ok(!result.includes('classpath'));
            assert.ok(result.includes("maven { url 'https://private.example.com/maven' }"));
            assert.ok(result.includes('mavenCentral()'), 'adds the missing mavenCentral()');
            assert.ok(result.includes("rootProject.buildDir = '../build'"));
            assert.ok(result.includes('tasks.register("clean", Delete)'));
        });

        test('adds the subproject defaults BEFORE evaluationDependsOn (afterEvaluate cannot be registered later)', () => {
            for (const [content, kts] of [
                [LEGACY_GROOVY['build.gradle']!, false],
                [TEMPLATE_KTS['build.gradle.kts']!, true]
            ] as Array<[string, boolean]>) {
                const result = migrateProjectBuildGradle(content, kts, VERSIONS);
                const marker = result.indexOf('// start flutter-config-manager subproject defaults');
                assert.ok(marker >= 0);
                assert.ok(marker < result.indexOf('evaluationDependsOn'), 'defaults must come first');
                assert.ok(result.includes('JavaVersion.VERSION_17'));
                assert.ok(result.includes('29.0.14206865'));
            }
        });

        test('Kotlin DSL output uses valid syntax (extra[...] and BaseExtension, never `extra { }`)', () => {
            const result = migrateProjectBuildGradle(TEMPLATE_KTS['build.gradle.kts']!, true, VERSIONS);
            assert.ok(!/\bextra\s*\{/.test(result));
            assert.ok(result.includes('extra["compileSdkVersion"] = 37'));
            assert.ok(result.includes('extensions.findByType(com.android.build.gradle.BaseExtension::class.java)'));
            assert.ok(result.includes('if (namespace.isNullOrEmpty())'));
            // Flutter's own build-directory wiring is untouched.
            assert.ok(result.includes('.dir("../../build")'));
            assert.ok(!result.includes('rootProject.buildDir'));
        });

        test('leaves the app project alone and does not force minSdk/targetSdk on subprojects', () => {
            const groovy = migrateProjectBuildGradle(LEGACY_GROOVY['build.gradle']!, false, VERSIONS);
            const hook = groovy.slice(groovy.indexOf('subprojects {'));
            assert.ok(hook.includes("name != 'app'"));
            assert.ok(!/defaultConfig/.test(hook));
            assert.ok(!/\bminSdkVersion 2\d\b/.test(hook));
        });

        test('is idempotent and replaces its own block in place', () => {
            for (const [content, kts] of [
                [LEGACY_GROOVY['build.gradle']!, false],
                [TEMPLATE_KTS['build.gradle.kts']!, true]
            ] as Array<[string, boolean]>) {
                const once = migrateProjectBuildGradle(content, kts, VERSIONS);
                const twice = migrateProjectBuildGradle(once, kts, VERSIONS);
                assert.strictEqual(twice, once);
                assert.strictEqual(once.split('// start flutter-config-manager').length, 2);
            }
        });

        test('leaves a hand-written masaken-style hook alone', () => {
            const result = migrateProjectBuildGradle(MASAKEN_GROOVY['build.gradle']!, false, VERSIONS);
            assert.ok(!result.includes('flutter-config-manager subproject defaults'));
            assert.strictEqual(result, MASAKEN_GROOVY['build.gradle']);
        });
    });

    suite('ensureProjectRepositories', () => {
        test('adds mavenCentral when allprojects only has google() and a mirror', () => {
            const content = "allprojects {\n    repositories {\n        google()\n        maven { url 'https://m.example.com' }\n    }\n}\n";
            const result = ensureProjectRepositories(content, false);
            assert.ok(result.includes('mavenCentral()'));
            assert.ok(result.includes("maven { url 'https://m.example.com' }"));
        });

        test('is idempotent when both repositories exist', () => {
            const content = 'allprojects {\n    repositories {\n        google()\n        mavenCentral()\n    }\n}\n';
            assert.strictEqual(ensureProjectRepositories(content, true), content);
        });

        test('appends an allprojects block when missing', () => {
            const result = ensureProjectRepositories("rootProject.buildDir = '../build'\n", false);
            assert.ok(result.includes('allprojects {'));
            assert.ok(result.includes('google()') && result.includes('mavenCentral()'));
        });
    });

    suite('ensureDependencyResolutionManagement', () => {
        test('adds mavenCentral to dependencyResolutionManagement repositories', () => {
            const content = 'dependencyResolutionManagement {\n    repositories {\n        google()\n    }\n}\n';
            assert.ok(ensureDependencyResolutionManagement(content).includes('mavenCentral()'));
        });

        test('is idempotent when both repositories exist', () => {
            const content = 'dependencyResolutionManagement {\n    repositories {\n        google()\n        mavenCentral()\n    }\n}\n';
            assert.strictEqual(ensureDependencyResolutionManagement(content), content);
        });
    });

    suite('gradle.properties', () => {
        test('adds the AGP 9 flags and a memory setting to an empty file', () => {
            const result = ensureAgpGradleProperties('');
            assert.ok(result.includes('android.useAndroidX=true'));
            assert.ok(result.includes('android.builtInKotlin=false'));
            assert.ok(result.includes('android.newDsl=false'));
            assert.ok(result.includes('org.gradle.jvmargs='));
        });

        test('forces the two Flutter flags to false, keeps every other line, and copies no machine-specific flags', () => {
            const result = ensureAgpGradleProperties('org.gradle.jvmargs=-Xmx8G\nandroid.newDsl=true\nandroid.builtInKotlin=true\nmy.custom=1\n');
            assert.ok(result.includes('org.gradle.jvmargs=-Xmx8G'));
            assert.ok(result.includes('android.newDsl=false') && !result.includes('android.newDsl=true'));
            assert.ok(result.includes('android.builtInKotlin=false') && !result.includes('builtInKotlin=true'));
            assert.ok(result.includes('my.custom=1'));
            assert.ok(!result.includes('org.gradle.daemon'));
            assert.ok(!result.includes('kotlin.incremental'));
        });

        test('is idempotent and preserves CRLF', () => {
            const once = ensureAgpGradleProperties('android.useAndroidX=true\r\n');
            assert.ok(once.includes('\r\n') && !/[^\r]\n/.test(once));
            assert.strictEqual(ensureAgpGradleProperties(once), once);
        });
    });

    suite('migrateAppBuildGradle', () => {
        const OPTIONS = { apacheHttpLegacy: false };

        test('converts a legacy Groovy app script: plugins block, Firebase carried over, Flutter plugin last', () => {
            const result = migrateAppBuildGradle(LEGACY_GROOVY['app/build.gradle']!, false, OPTIONS, VERSIONS);
            assert.ok(result.startsWith('plugins {'));
            const block = result.slice(0, result.indexOf('}'));
            assert.ok(block.includes('id "com.android.application"'));
            assert.ok(block.includes('id "kotlin-android"'));
            assert.ok(block.includes('id "com.google.gms.google-services"'), 'firebase plugin must survive apply-plugin removal');
            assert.ok(block.indexOf('flutter-gradle-plugin') > block.indexOf('google-services'), 'Flutter plugin comes last');
            assert.ok(!result.includes('apply plugin:'));
            assert.ok(!result.includes('flutter.gradle'));
            assert.ok(!result.includes('kotlinOptions'));
            assert.ok(!result.includes('$kotlin_version'), 'the removed buildscript ext must not be referenced');
            assert.ok(result.includes("implementation 'com.google.firebase:firebase-analytics'"));
            assert.ok(result.includes('JavaVersion.VERSION_17') && !result.includes('VERSION_1_8'));
            assert.ok(result.includes('org.jetbrains.kotlin.gradle.dsl.JvmTarget.JVM_17'));
        });

        test('raises literal compileSdk/targetSdk but never lowers, and never touches minSdk', () => {
            const result = migrateAppBuildGradle(LEGACY_GROOVY['app/build.gradle']!, false, OPTIONS, VERSIONS);
            assert.ok(result.includes('compileSdkVersion 37'));
            assert.ok(result.includes('targetSdkVersion 37'));
            assert.ok(result.includes('minSdkVersion 31'), 'a project minSdk above the seed must stay');

            const higher = migrateAppBuildGradle('android {\n    compileSdk = 40\n    defaultConfig {\n        targetSdk = 41\n        minSdk = 21\n    }\n}\n', true, OPTIONS, VERSIONS);
            assert.ok(higher.includes('compileSdk = 40') && higher.includes('targetSdk = 41'));
            assert.ok(higher.includes('minSdk = 21'));
        });

        test('puts a floor under flutter.compileSdkVersion and keeps the other Flutter-managed values', () => {
            const result = migrateAppBuildGradle(MISHKAT_KTS['app/build.gradle.kts']!, true, OPTIONS, VERSIONS);
            assert.ok(result.includes('compileSdk = maxOf(flutter.compileSdkVersion, 37)'));
            const groovy = migrateAppBuildGradle('android {\n    compileSdkVersion flutter.compileSdkVersion\n}\n', false, OPTIONS, VERSIONS);
            assert.ok(groovy.includes('compileSdkVersion Math.max(flutter.compileSdkVersion, 37)'));
            assert.ok(result.includes('minSdk = flutter.minSdkVersion'));
            assert.ok(result.includes('targetSdk = flutter.targetSdkVersion'));
        });

        test('uses the Kotlin DSL syntax for useLibrary', () => {
            const kts = migrateAppBuildGradle(TEMPLATE_KTS['app/build.gradle.kts']!, true, { apacheHttpLegacy: true }, VERSIONS);
            assert.ok(kts.includes('useLibrary("org.apache.http.legacy")'));
            assert.ok(!kts.includes("useLibrary 'org.apache.http.legacy'"));
            const groovy = migrateAppBuildGradle(LEGACY_GROOVY['app/build.gradle']!, false, { apacheHttpLegacy: true }, VERSIONS);
            assert.ok(groovy.includes("useLibrary 'org.apache.http.legacy'"));
        });

        test('inserts plugins after Kotlin DSL imports', () => {
            const content = 'import java.util.Properties\n\nandroid {\n    compileSdk = 34\n}\n';
            const result = migrateAppBuildGradle(content, true, OPTIONS, VERSIONS);
            assert.ok(result.startsWith('import java.util.Properties\n'));
            assert.ok(result.indexOf('plugins {') > result.indexOf('import java.util.Properties'));
        });

        test('adds the Flutter plugin last inside an existing plugins block', () => {
            const result = migrateAppBuildGradle('plugins {\n    id("com.android.application")\n}\nandroid {\n}\n', true, OPTIONS, VERSIONS);
            const block = result.slice(0, result.indexOf('}\n'));
            assert.ok(block.indexOf('com.android.application') < block.indexOf('flutter-gradle-plugin'));
        });

        test('only adds a top-level kotlin block when a Kotlin plugin is used', () => {
            const javaOnly = migrateAppBuildGradle('plugins {\n    id "com.android.application"\n    id "dev.flutter.flutter-gradle-plugin"\n}\nandroid {\n}\n', false, OPTIONS, VERSIONS);
            assert.ok(!/^kotlin \{/m.test(javaOnly));
        });

        test('normalises an older jvmTarget in an existing kotlin block', () => {
            const content = 'plugins {\n    id "com.android.application"\n}\nkotlin {\n    compilerOptions {\n        jvmTarget = org.jetbrains.kotlin.gradle.dsl.JvmTarget.JVM_11\n    }\n}\nandroid {\n}\n';
            const result = migrateAppBuildGradle(content, false, OPTIONS, VERSIONS);
            assert.ok(result.includes('JvmTarget.JVM_17') && !result.includes('JVM_11'));
        });

        test('leaves already-migrated reference projects functionally unchanged and is idempotent', () => {
            for (const [content, kts] of [
                [MASAKEN_GROOVY['app/build.gradle']!, false],
                [MISHKAT_KTS['app/build.gradle.kts']!, true],
                [TEMPLATE_KTS['app/build.gradle.kts']!, true],
                [LEGACY_GROOVY['app/build.gradle']!, false]
            ] as Array<[string, boolean]>) {
                const once = migrateAppBuildGradle(content, kts, OPTIONS, VERSIONS);
                assert.strictEqual(migrateAppBuildGradle(once, kts, OPTIONS, VERSIONS), once);
            }
            const masaken = migrateAppBuildGradle(MASAKEN_GROOVY['app/build.gradle']!, false, OPTIONS, VERSIONS);
            assert.strictEqual(masaken, MASAKEN_GROOVY['app/build.gradle']);
        });
    });

    suite('normalizeNdk', () => {
        const NDK = '29.0.14206865';

        test('ndkSupports16Kb is true from r28', () => {
            assert.ok(ndkSupports16Kb('28.2.13676358'));
            assert.ok(!ndkSupports16Kb('27.0.12077973'));
            assert.ok(!ndkSupports16Kb(undefined));
        });

        test('raises a literal below the floor and keeps a newer one', () => {
            assert.ok(normalizeNdk('ndkVersion = "26.1.10909125"\n', true, NDK, undefined, '28.0.0').includes(`ndkVersion = "${NDK}"`));
            assert.ok(normalizeNdk('ndkVersion "27.0.12077973"\n', false, NDK, undefined, '28.0.0').includes(`ndkVersion "${NDK}"`));
            const keep = 'ndkVersion = "28.2.13676358"\n';
            assert.strictEqual(normalizeNdk(keep, true, NDK, undefined, '28.0.0'), keep);
        });

        test('keeps flutter.ndkVersion when the Flutter SDK already ships NDK 28+', () => {
            const content = 'android {\n    ndkVersion = flutter.ndkVersion\n}\n';
            assert.strictEqual(normalizeNdk(content, true, NDK, '28.2.13676358', '28.0.0'), content);
        });

        test('pins a literal when flutter.ndkVersion is older than 28 or unknown', () => {
            const content = 'android {\n    ndkVersion flutter.ndkVersion\n}\n';
            assert.ok(normalizeNdk(content, false, NDK, '26.3.11579264', '28.0.0').includes(`ndkVersion "${NDK}"`));
            assert.ok(normalizeNdk(content, false, NDK, undefined, '28.0.0').includes(`ndkVersion "${NDK}"`));
        });

        test('adds ndkVersion when missing (Flutter-managed when capable, literal otherwise)', () => {
            assert.ok(normalizeNdk('android {\n}\n', true, NDK, '28.2.13676358', '28.0.0').includes('ndkVersion = flutter.ndkVersion'));
            assert.ok(normalizeNdk('android {\n}\n', false, NDK, undefined, '28.0.0').includes(`ndkVersion "${NDK}"`));
        });
    });

    suite('gradle wrapper', () => {
        test('updateGradleWrapper sets the exact distribution', () => {
            const wrapper = 'distributionUrl=https\\://services.gradle.org/distributions/gradle-8.0-all.zip\n';
            assert.ok(updateGradleWrapper(wrapper, '8.14.3').includes('gradle-8.14.3-all.zip'));
        });

        test('bumpGradleWrapperMinimum only raises and keeps the -bin/-all flavor', () => {
            const low = 'distributionUrl=https\\://services.gradle.org/distributions/gradle-8.0-bin.zip\n';
            assert.ok(bumpGradleWrapperMinimum(low, '8.7').includes('gradle-8.7-bin.zip'));

            const high = 'distributionUrl=https\\://services.gradle.org/distributions/gradle-9.6.0-bin.zip\n';
            assert.strictEqual(bumpGradleWrapperMinimum(high, '9.5.1'), high, 'must not downgrade 9.6.0 to 9.5.1');
        });
    });

    suite('AGP / SDK / NDK helpers', () => {
        test('bumpAgpVersion raises plugins block AGP but never downgrades', () => {
            const low = 'plugins {\n    id "com.android.application" version "8.0.0" apply false\n}\n';
            assert.ok(bumpAgpVersion(low, '8.5.2').includes('version "8.5.2"'));
            const high = 'plugins {\n    id "com.android.application" version "8.9.1" apply false\n}\n';
            assert.strictEqual(bumpAgpVersion(high, '8.5.2'), high);
        });

        test('bumpAgpVersion raises buildscript classpath AGP', () => {
            assert.ok(bumpAgpVersion("classpath 'com.android.tools.build:gradle:4.1.0'\n", '8.5.2').includes('gradle:8.5.2'));
        });

        test('bumpSdkVersions raises compileSdk/targetSdk but not minSdk or flutter vars', () => {
            const content = 'android {\n    compileSdk = 34\n    targetSdkVersion 34\n    minSdk = 21\n    compileSdkVersion flutter.compileSdkVersion\n}';
            const result = bumpSdkVersions(content, 35);
            assert.ok(result.includes('compileSdk = 35') && result.includes('targetSdkVersion 35'));
            assert.ok(result.includes('minSdk = 21'));
            assert.ok(result.includes('compileSdkVersion flutter.compileSdkVersion'));
        });

        test('bumpNdkVersion raises literals only', () => {
            assert.ok(bumpNdkVersion('ndkVersion = "26.1.10909125"\n', '28.0.12433566').includes('ndkVersion = "28.0.12433566"'));
            const flutterManaged = 'ndkVersion = flutter.ndkVersion\n';
            assert.strictEqual(bumpNdkVersion(flutterManaged, '28.0.12433566'), flutterManaged);
        });

        test('getAgpVersion reads plugins block and buildscript classpath', () => {
            assert.strictEqual(getAgpVersion('plugins {\n    id "com.android.application" version "8.12.2" apply false\n}\n'), '8.12.2');
            assert.strictEqual(getAgpVersion('id("com.android.application") version "8.13.2" apply false'), '8.13.2');
            assert.strictEqual(getAgpVersion("classpath 'com.android.tools.build:gradle:4.1.0'"), '4.1.0');
            assert.strictEqual(getAgpVersion('plugins {\n    id "com.android.application"\n}\n'), null);
        });

        test('readLiteralMinSdk reads Groovy and Kotlin forms and ignores Flutter-managed values', () => {
            assert.strictEqual(readLiteralMinSdk('minSdkVersion 31'), 31);
            assert.strictEqual(readLiteralMinSdk('minSdk = 26'), 26);
            assert.strictEqual(readLiteralMinSdk('minSdk = flutter.minSdkVersion'), null);
        });
    });

    suite('16 KB packaging', () => {
        test('ensureUseLegacyPackaging uses the modern packaging{} block (AGP 9 rejects the manifest attribute)', () => {
            const result = ensureUseLegacyPackaging('android {\n    compileSdk = 35\n}', true, true, '8.3.0');
            assert.ok(result.includes('packaging {'));
            assert.ok(!result.includes('packagingOptions'));
            assert.ok(result.includes('jniLibs {') && result.includes('useLegacyPackaging = true'));
        });

        test('ensureUseLegacyPackaging falls back to packagingOptions before AGP 8.0', () => {
            assert.ok(ensureUseLegacyPackaging('android {\n}', false, true, '7.4.2').includes('packagingOptions {'));
        });

        test('ensureUseLegacyPackaging is a no-op when disabled or already present', () => {
            const content = 'android {\n    packaging {\n        jniLibs {\n            useLegacyPackaging = true\n        }\n    }\n}\n';
            assert.strictEqual(ensureUseLegacyPackaging(content, false, true), content);
            assert.strictEqual(ensureUseLegacyPackaging('android {\n}\n', false, false), 'android {\n}\n');
        });

        test('removeExtractNativeLibs strips the attribute AGP 9 rejects and reports whether it was "true"', () => {
            const truthy = removeExtractNativeLibs('<manifest>\n    <application android:label="App" android:extractNativeLibs="true">\n    </application>\n</manifest>\n');
            assert.ok(truthy.wasTrue);
            assert.ok(!truthy.content.includes('extractNativeLibs'));
            assert.ok(truthy.content.includes('<application android:label="App">'));

            const falsy = removeExtractNativeLibs('<application android:extractNativeLibs="false" android:label="App"></application>\n');
            assert.ok(!falsy.wasTrue && !falsy.content.includes('extractNativeLibs'));
        });

        test('removeExtractNativeLibs is a no-op without the attribute and ignores other tags', () => {
            const none = '<application android:label="App"></application>\n';
            assert.deepStrictEqual(removeExtractNativeLibs(none), { content: none, wasTrue: false });
        });
    });

    suite('detectFirebaseUsage', () => {
        test('detects firebase plugins', () => {
            const usage = detectFirebaseUsage('id "com.google.gms.google-services"\nid "com.google.firebase.crashlytics"');
            assert.ok(usage.googleServices && usage.crashlytics && !usage.firebasePerf);
        });

        test('detects nothing in a plain project', () => {
            assert.deepStrictEqual(detectFirebaseUsage('plugins { id "com.android.application" }'), NO_FIREBASE);
        });
    });
});
