/**
 * Android project fixtures for the migration tests, modeled on real projects:
 *  - TEMPLATE_KTS: what `flutter create` generates today (Kotlin DSL, AGP 9.0)
 *  - MISHKAT_KTS: the mishkat reference (Kotlin DSL, AGP 9.4 pre-release, Flutter-managed SDK/NDK)
 *  - MASAKEN_GROOVY: the masaken reference (Groovy, AGP 9.3.1, hand-written subproject hook)
 *  - LEGACY_GROOVY: a Flutter 3.13-era project (imperative loader, buildscript, apply plugin)
 */

export interface AndroidFixture {
    'settings.gradle'?: string;
    'settings.gradle.kts'?: string;
    'build.gradle'?: string;
    'build.gradle.kts'?: string;
    'app/build.gradle'?: string;
    'app/build.gradle.kts'?: string;
    'gradle/wrapper/gradle-wrapper.properties': string;
    'gradle.properties'?: string;
    'app/src/main/AndroidManifest.xml': string;
}

const KTS_SETTINGS_HEAD = [
    'pluginManagement {',
    '    val flutterSdkPath =',
    '        run {',
    '            val properties = java.util.Properties()',
    '            file("local.properties").inputStream().use { properties.load(it) }',
    '            val flutterSdkPath = properties.getProperty("flutter.sdk")',
    '            require(flutterSdkPath != null) { "flutter.sdk not set in local.properties" }',
    '            flutterSdkPath',
    '        }',
    '',
    '    includeBuild("$flutterSdkPath/packages/flutter_tools/gradle")',
    '',
    '    repositories {',
    '        google()',
    '        mavenCentral()',
    '        gradlePluginPortal()',
    '    }',
    '}',
    ''
].join('\n');

const KTS_PROJECT_BUILD = [
    'allprojects {',
    '    repositories {',
    '        google()',
    '        mavenCentral()',
    '    }',
    '}',
    '',
    'val newBuildDir: Directory =',
    '    rootProject.layout.buildDirectory',
    '        .dir("../../build")',
    '        .get()',
    'rootProject.layout.buildDirectory.value(newBuildDir)',
    '',
    'subprojects {',
    '    val newSubprojectBuildDir: Directory = newBuildDir.dir(project.name)',
    '    project.layout.buildDirectory.value(newSubprojectBuildDir)',
    '}',
    'subprojects {',
    '    project.evaluationDependsOn(":app")',
    '}',
    '',
    'tasks.register<Delete>("clean") {',
    '    delete(rootProject.layout.buildDirectory)',
    '}',
    ''
].join('\n');

const WRAPPER = (version: string, flavor = 'all') =>
    `distributionBase=GRADLE_USER_HOME\ndistributionPath=wrapper/dists\nzipStoreBase=GRADLE_USER_HOME\nzipStorePath=wrapper/dists\ndistributionUrl=https\\://services.gradle.org/distributions/gradle-${version}-${flavor}.zip\n`;

const MANIFEST = (applicationAttrs = '') =>
    `<manifest xmlns:android="http://schemas.android.com/apk/res/android">\n    <application android:label="app" android:name="\${applicationName}" android:icon="@mipmap/ic_launcher"${applicationAttrs}>\n    </application>\n</manifest>\n`;

export const TEMPLATE_KTS: AndroidFixture = {
    'settings.gradle.kts': `${KTS_SETTINGS_HEAD}
plugins {
    id("dev.flutter.flutter-plugin-loader") version "1.0.0"
    id("com.android.application") version "9.0.1" apply false
    id("org.jetbrains.kotlin.android") version "2.3.20" apply false
}

include(":app")
`,
    'build.gradle.kts': KTS_PROJECT_BUILD,
    'app/build.gradle.kts': `plugins {
    id("com.android.application")
    id("dev.flutter.flutter-gradle-plugin")
}

android {
    namespace = "dev.test.fapp"
    compileSdk = flutter.compileSdkVersion
    ndkVersion = flutter.ndkVersion

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    defaultConfig {
        applicationId = "dev.test.fapp"
        minSdk = flutter.minSdkVersion
        targetSdk = flutter.targetSdkVersion
        versionCode = flutter.versionCode
        versionName = flutter.versionName
    }
}

kotlin {
    compilerOptions {
        jvmTarget = org.jetbrains.kotlin.gradle.dsl.JvmTarget.JVM_17
    }
}

flutter {
    source = "../.."
}
`,
    'gradle/wrapper/gradle-wrapper.properties': WRAPPER('9.1.0'),
    'gradle.properties': 'org.gradle.jvmargs=-Xmx8G\nandroid.useAndroidX=true\nandroid.newDsl=false\nandroid.builtInKotlin=false\n',
    'app/src/main/AndroidManifest.xml': MANIFEST()
};

export const MISHKAT_KTS: AndroidFixture = {
    'settings.gradle.kts': `${KTS_SETTINGS_HEAD}
plugins {
    id("dev.flutter.flutter-plugin-loader") version "1.0.0"
    id("com.android.application") version "9.4.0-alpha06" apply false

}

include(":app")
`,
    'build.gradle.kts': KTS_PROJECT_BUILD,
    'app/build.gradle.kts': `import java.util.Properties
import java.io.FileInputStream

plugins {
    id("com.android.application")
    // The Flutter Gradle Plugin must be applied after the Android and Kotlin Gradle plugins.
    id("dev.flutter.flutter-gradle-plugin")
}

val keystoreProperties = Properties()
val keystorePropertiesFile = rootProject.file("key.properties")
if (keystorePropertiesFile.exists()) {
    keystoreProperties.load(FileInputStream(keystorePropertiesFile))
}

kotlin {
    compilerOptions {
        jvmTarget = org.jetbrains.kotlin.gradle.dsl.JvmTarget.fromTarget("17")
    }
}
android {
    namespace = "ly.mishkat.mishkat"
    compileSdk = flutter.compileSdkVersion
    ndkVersion = flutter.ndkVersion

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
        isCoreLibraryDesugaringEnabled = true
    }

    defaultConfig {
        applicationId = "ly.mishkat.mishkat"
        minSdk = flutter.minSdkVersion
        targetSdk = flutter.targetSdkVersion
        versionCode = flutter.versionCode
        versionName = flutter.versionName
    }

    buildTypes {
        release {
            isMinifyEnabled = true
            isShrinkResources = true
        }
    }
}

flutter {
    source = "../.."
}

dependencies {
    coreLibraryDesugaring("com.android.tools:desugar_jdk_libs:2.1.5")
}
`,
    'gradle/wrapper/gradle-wrapper.properties': WRAPPER('9.6.0', 'bin'),
    'gradle.properties': 'org.gradle.jvmargs=-Xmx8G -XX:MaxMetaspaceSize=4G\nandroid.useAndroidX=true\n# This builtInKotlin flag was added automatically by Flutter migrator\nandroid.builtInKotlin=false\n# This newDsl flag was added automatically by Flutter migrator\nandroid.newDsl=false\n',
    'app/src/main/AndroidManifest.xml': MANIFEST()
};

export const MASAKEN_GROOVY: AndroidFixture = {
    'settings.gradle': `pluginManagement {
    def flutterSdkPath = {
        def properties = new Properties()
        file("local.properties").withInputStream { properties.load(it) }
        def flutterSdkPath = properties.getProperty("flutter.sdk")
        assert flutterSdkPath != null, "flutter.sdk not set in local.properties"
        return flutterSdkPath
    }
    settings.ext.flutterSdkPath = flutterSdkPath()

    includeBuild("\${settings.ext.flutterSdkPath}/packages/flutter_tools/gradle")

    repositories {
        google()
        mavenCentral()
        gradlePluginPortal()
    }
}

plugins {
    id "dev.flutter.flutter-plugin-loader" version "1.0.0"
    id "com.android.application" version '9.3.1' apply false
    // START: FlutterFire Configuration
    id "com.google.gms.google-services" version "4.5.0" apply false
    id "com.google.firebase.firebase-perf" version "2.0.2" apply false
    id "com.google.firebase.crashlytics" version "3.0.7" apply false
    // END: FlutterFire Configuration
    id "org.jetbrains.kotlin.android" version "2.4.10" apply false
}

include ":app"
`,
    'build.gradle': `allprojects {
    repositories {
        google()
        mavenCentral()
    }
    ext {
        compileSdkVersion = 37
        flutter = [
            compileSdkVersion: 37,
            ndkVersion: "29.0.14206865"
        ]
    }
}
rootProject.buildDir = '../build'

subprojects {
    project.buildDir = "\${rootProject.buildDir}/\${project.name}"

    afterEvaluate {
        // check if android block is available
        if (it.hasProperty('android')) {
            android {
                if (namespace == null || namespace.isEmpty()) {
                    namespace = project.group
                }
                compileSdkVersion 37
            }
        }
    }
}
subprojects {
    project.evaluationDependsOn(':app')
}

tasks.register("clean", Delete) {
    delete rootProject.buildDir
}
`,
    'app/build.gradle': `plugins {
    id "com.android.application"
    id "kotlin-android"
    id "dev.flutter.flutter-gradle-plugin"
    id 'com.google.gms.google-services'
    id 'com.google.firebase.firebase-perf'
    id 'com.google.firebase.crashlytics'
}

kotlin {
    compilerOptions {
        jvmTarget = org.jetbrains.kotlin.gradle.dsl.JvmTarget.JVM_17
    }
}
android {
    namespace "com.alalama.masakin"
    compileSdk = 37
    ndkVersion = "29.0.14206865"
    useLibrary 'org.apache.http.legacy'

    compileOptions {
        sourceCompatibility JavaVersion.VERSION_17
        targetCompatibility JavaVersion.VERSION_17
        coreLibraryDesugaringEnabled true
    }

    defaultConfig {
        applicationId "com.alalama.masakin"
        minSdkVersion 25
        targetSdkVersion 37
        versionCode 1
        versionName "1.0"
    }
}

flutter {
    source '../..'
}
dependencies {
  implementation platform('com.google.firebase:firebase-bom:34.17.0')
  implementation 'com.google.firebase:firebase-analytics'
}
`,
    'gradle/wrapper/gradle-wrapper.properties': WRAPPER('9.5.1'),
    'gradle.properties': 'org.gradle.jvmargs=-Xmx4096m\nandroid.useAndroidX=true\nandroid.enableJetifier=true\norg.gradle.daemon=false\nandroid.builtInKotlin=false\nandroid.newDsl=false\nkotlin.incremental=false\n',
    'app/src/main/AndroidManifest.xml': MANIFEST(' android:enableOnBackInvokedCallback="true"')
};

export const LEGACY_GROOVY: AndroidFixture = {
    'settings.gradle': `include ':app'

def localPropertiesFile = new File(rootProject.projectDir, "local.properties")
def properties = new Properties()

assert localPropertiesFile.exists()
localPropertiesFile.withReader("UTF-8") { reader -> properties.load(reader) }

def flutterSdkPath = properties.getProperty("flutter.sdk")
assert flutterSdkPath != null, "flutter.sdk not set in local.properties"
apply from: "$flutterSdkPath/packages/flutter_tools/gradle/app_plugin_loader.gradle"
`,
    'build.gradle': `buildscript {
    ext.kotlin_version = '1.7.10'
    repositories {
        google()
        mavenCentral()
    }

    dependencies {
        classpath 'com.android.tools.build:gradle:7.3.0'
        classpath "org.jetbrains.kotlin:kotlin-gradle-plugin:$kotlin_version"
        classpath 'com.google.gms:google-services:4.3.15'
    }
}

allprojects {
    repositories {
        google()
        maven { url 'https://private.example.com/maven' }
    }
}

rootProject.buildDir = '../build'
subprojects {
    project.buildDir = "\${rootProject.buildDir}/\${project.name}"
}
subprojects {
    project.evaluationDependsOn(':app')
}

tasks.register("clean", Delete) {
    delete rootProject.buildDir
}
`,
    'app/build.gradle': `def localProperties = new Properties()
def localPropertiesFile = rootProject.file('local.properties')
if (localPropertiesFile.exists()) {
    localPropertiesFile.withReader('UTF-8') { reader ->
        localProperties.load(reader)
    }
}

def flutterRoot = localProperties.getProperty('flutter.sdk')
if (flutterRoot == null) {
    throw new GradleException("Flutter SDK not found. Define location with flutter.sdk in the local.properties file.")
}

apply plugin: 'com.android.application'
apply plugin: 'kotlin-android'
apply plugin: 'com.google.gms.google-services'
apply from: "$flutterRoot/packages/flutter_tools/gradle/flutter.gradle"

android {
    namespace "com.example.legacy"
    compileSdkVersion 33
    ndkVersion flutter.ndkVersion

    compileOptions {
        sourceCompatibility JavaVersion.VERSION_1_8
        targetCompatibility JavaVersion.VERSION_1_8
    }

    kotlinOptions {
        jvmTarget = '1.8'
    }

    defaultConfig {
        applicationId "com.example.legacy"
        minSdkVersion 31
        targetSdkVersion 33
        versionCode 1
        versionName "1.0"
    }
}

flutter {
    source '../..'
}

dependencies {
    implementation "org.jetbrains.kotlin:kotlin-stdlib-jdk7:$kotlin_version"
    implementation 'com.google.firebase:firebase-analytics'
}
`,
    'gradle/wrapper/gradle-wrapper.properties': WRAPPER('7.5', 'all'),
    'gradle.properties': 'org.gradle.jvmargs=-Xmx1536M\nandroid.useAndroidX=true\nandroid.enableJetifier=true\n',
    'app/src/main/AndroidManifest.xml': MANIFEST(' android:extractNativeLibs="true"')
};
