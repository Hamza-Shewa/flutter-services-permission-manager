import * as assert from 'assert';
import {
    compareVersions,
    maxVersion,
    ensurePluginManagement,
    updateSettingsPlugins,
    migrateProjectBuildGradle,
    ensureProjectRepositories,
    ensureDependencyResolutionManagement,
    migrateAppBuildGradle,
    updateGradleWrapper,
    bumpGradleWrapperMinimum,
    bumpAgpVersion,
    bumpSdkVersions,
    bumpNdkVersion,
    ensureExtractNativeLibs,
    getAgpVersion,
    ensureUseLegacyPackaging,
    detectFirebaseUsage,
    mergeMasakenGradleProperties,
    MASAKEN_GRADLE_PROPERTIES,
    type MigrationVersions
} from '../../features/migration/migration-transforms.js';

// masaken reference versions (also the extension defaults).
const VERSIONS: MigrationVersions = {
    agp: '9.3.1',
    kotlin: '2.4.10',
    googleServices: '4.5.0',
    firebasePerf: '2.0.2',
    crashlytics: '3.0.7',
    compileSdk: '37',
    targetSdk: '37',
    minSdk: '26',
    gradle: '9.5.1',
    ndk: '29.0.14206865'
};

const MINIMUMS = { agp: '9.3.1', kotlin: '2.4.10', googleServices: '4.5.0' };

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

        test('maxVersion returns the newer version', () => {
            assert.strictEqual(maxVersion('8.5.2', '8.4.0'), '8.5.2');
            assert.strictEqual(maxVersion('8.4.0', '8.5.2'), '8.5.2');
            assert.strictEqual(maxVersion('8.5.2', '8.5.2'), '8.5.2');
        });
    });

    suite('ensurePluginManagement', () => {
        test('adds pluginManagement to a legacy settings.gradle', () => {
            const legacy = "include ':app'\n";
            const result = ensurePluginManagement(legacy, false);
            assert.ok(result.startsWith('pluginManagement {'));
            assert.ok(result.includes('google()'));
            assert.ok(result.includes('mavenCentral()'));
            assert.ok(result.includes('gradlePluginPortal()'));
            assert.ok(result.includes("include ':app'"));
        });

        test('leaves existing pluginManagement untouched', () => {
            const modern = 'pluginManagement {\n    repositories { google() }\n}\nplugins {}\n';
            assert.strictEqual(ensurePluginManagement(modern, true), modern);
        });
    });

    suite('updateSettingsPlugins', () => {
        test('creates a plugins block for legacy projects', () => {
            const legacy = 'pluginManagement {\n    repositories { google() }\n}\ninclude ":app"\n';
            const result = updateSettingsPlugins(legacy, false, VERSIONS, NO_FIREBASE, MINIMUMS);
            assert.ok(result.includes('id "dev.flutter.flutter-plugin-loader" version "1.0.0"'));
            assert.ok(result.includes('id "com.android.application" version "9.3.1" apply false'));
            assert.ok(result.includes('id "org.jetbrains.kotlin.android" version "2.4.10" apply false'));
            assert.ok(result.includes('include ":app"'));
        });

        test('adds firebase plugins only when detected', () => {
            const legacy = 'include ":app"\n';
            const result = updateSettingsPlugins(legacy, false, VERSIONS, {
                googleServices: true,
                firebasePerf: false,
                crashlytics: true
            }, MINIMUMS);
            assert.ok(result.includes('id "com.google.gms.google-services" version "4.5.0" apply false'));
            assert.ok(!result.includes('firebase-perf'));
            assert.ok(result.includes('id "com.google.firebase.crashlytics" version "3.0.7" apply false'));
        });

        test('raises existing plugins to the masaken reference versions', () => {
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
            assert.ok(!result.includes('version "8.0.0"'));
            assert.ok(!result.includes('version "1.9.22"'));
        });

        test('forces google-services to the masaken reference when firebase detected', () => {
            const kts = [
                'plugins {',
                '    id "dev.flutter.flutter-plugin-loader" version "1.0.0" apply false',
                '    id "com.android.application" version "9.3.1" apply false',
                '    id "com.google.gms.google-services" version "4.3.8" apply false',
                '    id "org.jetbrains.kotlin.android" version "2.4.10" apply false',
                '}',
                'include ":app"'
            ].join('\n');
            const result = updateSettingsPlugins(kts, false, VERSIONS, {
                googleServices: true,
                firebasePerf: false,
                crashlytics: false
            }, MINIMUMS);
            assert.ok(result.includes('com.android.application" version "9.3.1"'));
            assert.ok(result.includes('org.jetbrains.kotlin.android" version "2.4.10"'));
            assert.ok(result.includes('com.google.gms.google-services" version "4.5.0"'));
            assert.ok(!result.includes('version "4.3.8"'));
        });
    });

    suite('migrateProjectBuildGradle', () => {
        test('builds the masaken-style project build.gradle with ext + Java 17', () => {
            const legacy = [
                'buildscript {',
                '    repositories { google() }',
                '    dependencies {',
                '        classpath "com.android.tools.build:gradle:4.1.0"',
                '    }',
                '}',
                '',
                'allprojects {',
                '    repositories {',
                '        google()',
                '        mavenCentral()',
                '    }',
                '}'
            ].join('\n');
            const result = migrateProjectBuildGradle(legacy, false, VERSIONS);
            assert.ok(!result.includes('buildscript'));
            assert.ok(!result.includes('com.android.tools.build:gradle'));
            // masaken-style ext block with the SDK/minSdk/NDK versions.
            assert.ok(result.includes('allprojects {'));
            assert.ok(result.includes('compileSdkVersion = 37'));
            assert.ok(result.includes('targetSdkVersion = 37'));
            assert.ok(result.includes('minSdkVersion = 26'));
            assert.ok(result.includes('ndkVersion: "29.0.14206865"'));
            // subprojects afterEvaluate with Java 17 + Kotlin JVM_17.
            assert.ok(result.includes('subprojects {'));
            assert.ok(result.includes('afterEvaluate'));
            assert.ok(result.includes('JavaVersion.VERSION_17'));
            assert.ok(result.includes('JvmTarget.JVM_17'));
            assert.ok(result.includes('tasks.register("clean", Delete)'));
        });

        test('preserves custom allprojects repositories (private mirrors)', () => {
            const legacy = [
                'allprojects {',
                '    repositories {',
                '        google()',
                '        maven { url "https://ozforensics.jfrog.io/artifactory/main" }',
                '    }',
                '}'
            ].join('\n');
            const result = migrateProjectBuildGradle(legacy, false, VERSIONS);
            assert.ok(result.includes('ozforensics.jfrog.io'));
            assert.ok(result.includes('google()'));
            assert.ok(result.includes('mavenCentral()'));
        });

        test('builds a Kotlin DSL masaken-style project build.gradle', () => {
            const legacy = 'allprojects {\n    repositories { google() }\n}\n';
            const result = migrateProjectBuildGradle(legacy, true, VERSIONS);
            assert.ok(result.includes('extra {'));
            assert.ok(result.includes('set("compileSdkVersion", 37)'));
            assert.ok(result.includes('set("flutter", mapOf('));
            assert.ok(result.includes('"ndkVersion" to "29.0.14206865"'));
            assert.ok(result.includes('afterEvaluate'));
            assert.ok(result.includes('tasks.register<Delete>("clean")'));
        });
    });

    suite('ensureProjectRepositories', () => {
        test('adds mavenCentral when allprojects only has google() and a mirror', () => {
            // Mirrors the reported failure: project resolves deps from google +
            // a private mirror but NOT Maven Central → kotlin-stdlib not found.
            const legacy = [
                'allprojects {',
                '    repositories {',
                '        google()',
                '        maven { url "https://ozforensics.jfrog.io/artifactory/main" }',
                '    }',
                '}'
            ].join('\n');
            const result = ensureProjectRepositories(legacy, false);
            assert.ok(result.includes('mavenCentral()'));
            assert.ok(result.includes('google()'));
            assert.ok(result.includes('ozforensics.jfrog.io'));
        });

        test('is idempotent when both repositories exist', () => {
            const content = [
                'allprojects {',
                '    repositories {',
                '        google()',
                '        mavenCentral()',
                '    }',
                '}'
            ].join('\n');
            assert.strictEqual(ensureProjectRepositories(content, true), content);
        });

        test('appends an allprojects block when missing', () => {
            const content = "def localProperties = new Properties()\n";
            const result = ensureProjectRepositories(content, false);
            assert.ok(result.includes('allprojects {'));
            assert.ok(result.includes('google()'));
            assert.ok(result.includes('mavenCentral()'));
        });
    });

    suite('ensureDependencyResolutionManagement', () => {
        test('adds mavenCentral to dependencyResolutionManagement repositories', () => {
            const content = [
                'dependencyResolutionManagement {',
                '    repositoriesMode.set(RepositoriesMode.FAIL_ON_PROJECT_REPOS)',
                '    repositories {',
                '        google()',
                '    }',
                '}'
            ].join('\n');
            const result = ensureDependencyResolutionManagement(content);
            assert.ok(result.includes('mavenCentral()'));
            assert.ok(result.includes('RepositoriesMode.FAIL_ON_PROJECT_REPOS'));
        });

        test('is idempotent when both repositories exist', () => {
            const content = [
                'dependencyResolutionManagement {',
                '    repositories {',
                '        google()',
                '        mavenCentral()',
                '    }',
                '}'
            ].join('\n');
            assert.strictEqual(ensureDependencyResolutionManagement(content), content);
        });
    });

    suite('gradle.properties (masaken)', () => {
        test('mergeMasakenGradleProperties adds the masaken flags to an empty file', () => {
            const result = mergeMasakenGradleProperties('');
            assert.ok(result.includes('org.gradle.jvmargs=-Xmx4096m'));
            assert.ok(result.includes('android.useAndroidX=true'));
            assert.ok(result.includes('android.enableJetifier=true'));
            assert.ok(result.includes('org.gradle.daemon=false'));
            assert.ok(result.includes('android.builtInKotlin=false'));
            assert.ok(result.includes('android.newDsl=false'));
            assert.ok(result.includes('kotlin.incremental=false'));
        });

        test('mergeMasakenGradleProperties preserves existing values', () => {
            const existing = 'org.gradle.jvmargs=-Xmx2g\nandroid.useAndroidX=true\n';
            const result = mergeMasakenGradleProperties(existing);
            assert.ok(result.includes('org.gradle.jvmargs=-Xmx2g'));
            assert.ok(result.includes('android.useAndroidX=true'));
        });

        test('MASAKEN_GRADLE_PROPERTIES is a complete reference block', () => {
            assert.ok(MASAKEN_GRADLE_PROPERTIES.includes('android.newDsl=false'));
            assert.ok(MASAKEN_GRADLE_PROPERTIES.includes('kotlin.incremental=false'));
            assert.ok(MASAKEN_GRADLE_PROPERTIES.includes('org.gradle.daemon=false'));
        });
    });

    suite('migrateAppBuildGradle', () => {
        test('converts a legacy Groovy app build.gradle to the masaken style', () => {
            const legacy = [
                "apply plugin: 'com.android.application'",
                "apply plugin: 'kotlin-android'",
                '',
                'android {',
                '    compileSdkVersion 34',
                '    ndkVersion "27.0.12077973"',
                '    compileOptions {',
                '        sourceCompatibility JavaVersion.VERSION_1_8',
                '        targetCompatibility JavaVersion.VERSION_1_8',
                '    }',
                '    kotlinOptions {',
                "        jvmTarget = '1.8'",
                '    }',
                '    defaultConfig {',
                '        applicationId "com.example.app"',
                '        minSdkVersion 21',
                '        targetSdkVersion 34',
                '        versionCode flutter.versionCode',
                '        versionName flutter.versionName',
                '    }',
                '}'
            ].join('\n');
            const result = migrateAppBuildGradle(legacy, false, { apacheHttpLegacy: false }, VERSIONS);
            assert.ok(result.startsWith('plugins {'));
            assert.ok(result.includes('id "com.android.application"'));
            assert.ok(result.includes('id "kotlin-android"'));
            assert.ok(result.includes('id "dev.flutter.flutter-gradle-plugin"'));
            assert.ok(!result.includes("apply plugin:"));
            // masaken literal SDK values.
            assert.ok(result.includes('compileSdkVersion 37'));
            assert.ok(result.includes('targetSdkVersion 37'));
            assert.ok(result.includes('minSdkVersion 26'));
            assert.ok(result.includes('ndkVersion "29.0.14206865"'));
            // Java 17 toolchain.
            assert.ok(result.includes('JavaVersion.VERSION_17'));
            // Top-level kotlin { compilerOptions { jvmTarget = JVM_17 } } block.
            assert.ok(result.includes('kotlin {'));
            assert.ok(result.includes('compilerOptions {'));
            assert.ok(result.includes('org.jetbrains.kotlin.gradle.dsl.JvmTarget.JVM_17'));
            // Old kotlinOptions inside android is removed.
            assert.ok(!result.includes('kotlinOptions'));
            assert.ok(result.includes("flutter {\n    source '../..'"));
        });

        test('adds useLibrary when apache http legacy is used', () => {
            const legacy = [
                "apply plugin: 'com.android.application'",
                '',
                'android {',
                '    compileSdkVersion 34',
                '}'
            ].join('\n');
            const result = migrateAppBuildGradle(legacy, false, { apacheHttpLegacy: true }, VERSIONS);
            assert.ok(result.includes("useLibrary 'org.apache.http.legacy'"));
        });

        test('migrates a Kotlin DSL app build.gradle.kts to the masaken style', () => {
            const kts = [
                'plugins {',
                '    id("com.android.application")',
                '    id("kotlin-android")',
                '    id("dev.flutter.flutter-gradle-plugin")',
                '}',
                '',
                'android {',
                '    namespace = "com.example.app"',
                '    compileSdk = 34',
                '    ndkVersion = "27.0.12077973"',
                '    compileOptions {',
                '        sourceCompatibility = JavaVersion.VERSION_11',
                '        targetCompatibility = JavaVersion.VERSION_11',
                '    }',
                '    defaultConfig {',
                '        applicationId = "com.example.app"',
                '        minSdk = 21',
                '        targetSdk = 34',
                '    }',
                '}',
                '',
                'flutter {',
                '    source = "../.."',
                '}'
            ].join('\n');
            const result = migrateAppBuildGradle(kts, true, { apacheHttpLegacy: false }, VERSIONS);
            // masaken literal SDK values.
            assert.ok(result.includes('compileSdk = 37'));
            assert.ok(result.includes('targetSdk = 37'));
            assert.ok(result.includes('minSdk = 26'));
            assert.ok(result.includes('ndkVersion = "29.0.14206865"'));
            // Top-level kotlin { compilerOptions {} } block.
            assert.ok(result.includes('kotlin {'));
            assert.ok(result.includes('compilerOptions {'));
            assert.ok(result.includes('org.jetbrains.kotlin.gradle.dsl.JvmTarget.JVM_17'));
            // Toolchain normalized to 17.
            assert.ok(result.includes('JavaVersion.VERSION_17'));
            assert.ok(!result.includes('JavaVersion.VERSION_1_8'));
            assert.ok(!result.includes('kotlinOptions'));
        });

        test('normalizes an existing top-level kotlin block jvmTarget to 17', () => {
            const content = [
                'plugins {',
                '    id "com.android.application"',
                '}',
                '',
                'kotlin {',
                '    compilerOptions {',
                '        jvmTarget = org.jetbrains.kotlin.gradle.dsl.JvmTarget.JVM_11',
                '    }',
                '}',
                '',
                'android {',
                '    compileSdk = 36',
                '}',
                '',
                'flutter {',
                "    source '../..'",
                '}'
            ].join('\n');
            const result = migrateAppBuildGradle(content, false, { apacheHttpLegacy: false }, VERSIONS);
            assert.ok(result.includes('JvmTarget.JVM_17'));
            assert.ok(!result.includes('JVM_11'));
        });
    });

    suite('gradle wrapper', () => {
        test('updateGradleWrapper sets the exact distribution', () => {
            const wrapper = 'distributionUrl=https\\://services.gradle.org/distributions/gradle-8.0-all.zip\n';
            const result = updateGradleWrapper(wrapper, '8.14.3');
            assert.ok(result.includes('gradle-8.14.3-all.zip'));
        });

        test('bumpGradleWrapperMinimum only raises', () => {
            const low = 'distributionUrl=https\\://services.gradle.org/distributions/gradle-8.0-bin.zip\n';
            const raised = bumpGradleWrapperMinimum(low, '8.7');
            assert.ok(raised.includes('gradle-8.7-bin.zip'));

            const high = 'distributionUrl=https\\://services.gradle.org/distributions/gradle-8.11.1-all.zip\n';
            assert.strictEqual(bumpGradleWrapperMinimum(high, '8.7'), high);
        });
    });

    suite('16 KB transforms', () => {
        test('bumpAgpVersion raises plugins block AGP but never downgrades', () => {
            const low = 'plugins {\n    id "com.android.application" version "8.0.0" apply false\n}\n';
            const result = bumpAgpVersion(low, '8.5.2');
            assert.ok(result.includes('version "8.5.2"'));

            const high = 'plugins {\n    id "com.android.application" version "8.9.1" apply false\n}\n';
            assert.strictEqual(bumpAgpVersion(high, '8.5.2'), high);
        });

        test('bumpAgpVersion raises buildscript classpath AGP', () => {
            const legacy = "classpath 'com.android.tools.build:gradle:4.1.0'\n";
            const result = bumpAgpVersion(legacy, '8.5.2');
            assert.ok(result.includes('com.android.tools.build:gradle:8.5.2'));
        });

        test('bumpSdkVersions raises compileSdk/targetSdk but not minSdk or flutter vars', () => {
            const content = [
                'android {',
                '    compileSdk = 34',
                '    targetSdkVersion 34',
                '    minSdk = 21',
                '    compileSdkVersion flutter.compileSdkVersion',
                '}'
            ].join('\n');
            const result = bumpSdkVersions(content, 35);
            assert.ok(result.includes('compileSdk = 35'));
            assert.ok(result.includes('targetSdkVersion 35'));
            assert.ok(result.includes('minSdk = 21'));
            assert.ok(result.includes('compileSdkVersion flutter.compileSdkVersion'));
        });

        test('bumpNdkVersion raises only when set', () => {
            const content = 'ndkVersion = "26.1.10909125"\n';
            const result = bumpNdkVersion(content, '28.0.12433566');
            assert.ok(result.includes('ndkVersion = "28.0.12433566"'));
        });

        test('getAgpVersion reads plugins block and buildscript classpath', () => {
            assert.strictEqual(
                getAgpVersion('plugins {\n    id "com.android.application" version "8.12.2" apply false\n}\n'),
                '8.12.2'
            );
            assert.strictEqual(
                getAgpVersion('id("com.android.application") version "8.13.2" apply false'),
                '8.13.2'
            );
            assert.strictEqual(
                getAgpVersion("classpath 'com.android.tools.build:gradle:4.1.0'"),
                '4.1.0'
            );
            assert.strictEqual(getAgpVersion('plugins {\n    id "com.android.application"\n}\n'), null);
        });

        test('ensureUseLegacyPackaging adds the guide fallback when enabled', () => {
            const content = [
                'android {',
                '    compileSdk = 35',
                '}'
            ].join('\n');
            const result = ensureUseLegacyPackaging(content, true, true);
            assert.ok(result.includes('packagingOptions {'));
            assert.ok(result.includes('jniLibs {'));
            assert.ok(result.includes('useLegacyPackaging = true'));
        });

        test('ensureUseLegacyPackaging is a no-op when disabled or already present', () => {
            const content = 'android {\n    packagingOptions {\n        jniLibs {\n            useLegacyPackaging true\n        }\n    }\n}\n';
            assert.strictEqual(ensureUseLegacyPackaging(content, false, true), content);
            assert.strictEqual(ensureUseLegacyPackaging(content, false, false), content);
        });

        test('ensureExtractNativeLibs adds the attribute', () => {
            const manifest = '<manifest>\n    <application android:label="App">\n    </application>\n</manifest>\n';
            const result = ensureExtractNativeLibs(manifest);
            assert.ok(result.includes('android:extractNativeLibs="true"'));
        });

        test('ensureExtractNativeLibs is idempotent', () => {
            const manifest = '<application android:extractNativeLibs="true" android:label="App"></application>\n';
            assert.strictEqual(ensureExtractNativeLibs(manifest), manifest);
        });

        test('ensureExtractNativeLibs flips an explicit false to true', () => {
            const manifest = '<application android:extractNativeLibs="false" android:label="App"></application>\n';
            const result = ensureExtractNativeLibs(manifest);
            assert.ok(result.includes('android:extractNativeLibs="true"'));
        });
    });

    suite('detectFirebaseUsage', () => {
        test('detects firebase plugins', () => {
            const content = [
                'id "com.google.gms.google-services"',
                'id "com.google.firebase.crashlytics"'
            ].join('\n');
            const usage = detectFirebaseUsage(content);
            assert.ok(usage.googleServices);
            assert.ok(!usage.firebasePerf);
            assert.ok(usage.crashlytics);
        });
    });
});
