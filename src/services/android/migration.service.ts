import * as path from 'path';
import * as fs from 'fs';
import * as vscode from 'vscode';
import { getRecommendedVersions } from './version-fetcher.js';
import { SIXTEEN_KB_MINIMUMS, MIGRATION_MINIMUMS } from '../../constants/versions.js';
import { logger, toError, toErrorMessage } from '../../shared/index.js';
import {
    ensurePluginManagement,
    updateSettingsPlugins,
    migrateProjectBuildGradle,
    ensureProjectRepositories,
    ensureDependencyResolutionManagement,
    migrateAppBuildGradle,
    updateGradleWrapper,
    ensureExtractNativeLibs,
    bumpAgpVersion,
    bumpSdkVersions,
    bumpNdkVersion,
    bumpGradleWrapperMinimum,
    getAgpVersion,
    ensureUseLegacyPackaging,
    compareVersions,
    detectFirebaseUsage
} from './migration-transforms.js';

export interface MigrationReport {
    message: string;
    details: string[];
}

interface GradleFile {
    filePath: string;
    kts: boolean;
}

interface AndroidLayout {
    androidDir: string;
    settings?: GradleFile;
    projectBuild?: GradleFile;
    appBuild?: GradleFile;
    wrapperPath?: string;
    manifestPath?: string;
}

// ---------------------------------------------------------------------------
// File helpers
// ---------------------------------------------------------------------------

function readIfExists(filePath: string): string | null {
    try {
        if (fs.existsSync(filePath)) {
            return fs.readFileSync(filePath, 'utf8');
        }
    } catch (error) {
        logger.warn(`Failed to read ${filePath}`, { error: toErrorMessage(error) });
    }
    return null;
}

/**
 * Writes the file only when the content actually changed, normalizing line
 * endings to the file's original style so Windows CRLF projects stay CRLF.
 */
function writeIfChanged(filePath: string, content: string): boolean {
    const current = readIfExists(filePath);
    if (current === content) {
        return false;
    }
    const finalContent = normalizeToFileEol(content, current);
    if (current === finalContent) {
        return false;
    }
    try {
        fs.writeFileSync(filePath, finalContent);
        return true;
    } catch (error) {
        logger.error(`Failed to write ${filePath}`, toError(error));
        return false;
    }
}

function normalizeToFileEol(content: string, original: string | null): string {
    if (original && /\r\n/.test(original)) {
        return content.replace(/\r\n/g, '\n').replace(/\n/g, '\r\n');
    }
    return content;
}

function detectGradleLayout(androidDir: string): AndroidLayout {
    const layout: AndroidLayout = { androidDir };

    const pick = (base: string): GradleFile | undefined => {
        const kts = path.join(androidDir, `${base}.gradle.kts`);
        const groovy = path.join(androidDir, `${base}.gradle`);
        if (fs.existsSync(kts)) {
            return { filePath: kts, kts: true };
        }
        if (fs.existsSync(groovy)) {
            return { filePath: groovy, kts: false };
        }
        return undefined;
    };

    layout.settings = pick('settings');
    layout.projectBuild = pick('build');

    const appDir = path.join(androidDir, 'app');
    if (fs.existsSync(appDir)) {
        const appKts = path.join(appDir, 'build.gradle.kts');
        const appGroovy = path.join(appDir, 'build.gradle');
        if (fs.existsSync(appKts)) {
            layout.appBuild = { filePath: appKts, kts: true };
        } else if (fs.existsSync(appGroovy)) {
            layout.appBuild = { filePath: appGroovy, kts: false };
        }

        const wrapperPath = path.join(androidDir, 'gradle', 'wrapper', 'gradle-wrapper.properties');
        if (fs.existsSync(wrapperPath)) {
            layout.wrapperPath = wrapperPath;
        }

        const manifest = path.join(appDir, 'src', 'main', 'AndroidManifest.xml');
        if (fs.existsSync(manifest)) {
            layout.manifestPath = manifest;
        }
    }

    return layout;
}

function getAndroidLayout(): AndroidLayout {
    const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    if (!workspaceRoot) {
        throw new Error('No workspace root found');
    }
    const androidDir = path.join(workspaceRoot, 'android');
    if (!fs.existsSync(androidDir)) {
        throw new Error('No android directory found in the workspace');
    }
    return detectGradleLayout(androidDir);
}

/**
 * Scans android/app/src/main for `org.apache.http` usage (legacy Apache HTTP
 * client) which requires `useLibrary 'org.apache.http.legacy'` on newer AGP.
 * Cross-platform (pure fs/path traversal).
 */
function detectApacheHttpUsage(androidDir: string): boolean {
    const appMain = path.join(androidDir, 'app', 'src', 'main');
    if (!fs.existsSync(appMain)) {
        return false;
    }
    const stack: string[] = [appMain];
    while (stack.length > 0) {
        const dir = stack.pop()!;
        let entries: fs.Dirent[];
        try {
            entries = fs.readdirSync(dir, { withFileTypes: true });
        } catch {
            continue;
        }
        for (const entry of entries) {
            const full = path.join(dir, entry.name);
            if (entry.isDirectory()) {
                stack.push(full);
            } else if (/\.(java|kt)$/i.test(entry.name)) {
                try {
                    if (fs.readFileSync(full, 'utf8').includes('org.apache.http')) {
                        return true;
                    }
                } catch {
                    // ignore unreadable files
                }
            }
        }
    }
    return false;
}

/**
 * Determines whether the app uses native code (NDK / JNI). Native libraries
 * must be 16 KB aligned, so the NDK version matters for the 16 KB migration.
 */
function detectNativeUsage(buildContent: string, androidDir: string): boolean {
    if (/ndkVersion|externalNativeBuild|jniLibs|\.so\b/.test(buildContent)) {
        return true;
    }
    const appMain = path.join(androidDir, 'app', 'src', 'main');
    for (const sub of ['jniLibs', 'libs']) {
        const dir = path.join(appMain, sub);
        if (fs.existsSync(dir)) {
            return true;
        }
    }
    return false;
}

// ---------------------------------------------------------------------------
// Full migration — latest Flutter declarative setup + 16 KB support
// ---------------------------------------------------------------------------

/**
 * Migrates the Android project to the latest Flutter requirements:
 *  - declarative `plugins {}` Gradle setup driven by Flutter's built-in
 *    variables (`flutter.compileSdkVersion`, `flutter.minSdkVersion`,
 *    `flutter.targetSdkVersion`, `flutter.ndkVersion`),
 *  - legacy `buildscript` blocks removed,
 *  - Gradle wrapper / AGP / Kotlin bumped to the recommended versions, and
 *  - 16 KB page-size support enabled (`android:extractNativeLibs="true"`,
 *    targetSdk 35+, AGP 8.5.2+).
 *
 * Works with BOTH legacy Groovy (`build.gradle`) and modern Kotlin DSL
 * (`build.gradle.kts`) projects, and runs identically on Windows, Linux and
 * macOS (pure fs/path file manipulation — no shell commands).
 */
export async function migrateAndroidSetup(): Promise<MigrationReport> {
    const layout = getAndroidLayout();
    const versions = await getRecommendedVersions();
    const details: string[] = [];

    let firebase = { googleServices: false, firebasePerf: false, crashlytics: false };
    if (layout.appBuild) {
        const appContent = readIfExists(layout.appBuild.filePath) ?? '';
        firebase = detectFirebaseUsage(appContent);
    }

    // 1. settings.gradle(.kts) → pluginManagement + declarative plugins.
    if (layout.settings) {
        let content = readIfExists(layout.settings.filePath) ?? '';
        content = ensurePluginManagement(content, layout.settings.kts);
        content = updateSettingsPlugins(content, layout.settings.kts, versions, firebase, {
            agp: MIGRATION_MINIMUMS.agp,
            kotlin: MIGRATION_MINIMUMS.kotlin
        });
        content = ensureDependencyResolutionManagement(content);
        if (writeIfChanged(layout.settings.filePath, content)) {
            details.push(`Updated ${path.basename(layout.settings.filePath)} (declarative plugins, AGP ≥ ${MIGRATION_MINIMUMS.agp}, Kotlin ≥ ${MIGRATION_MINIMUMS.kotlin})`);
        }
    }

    // 2. Project-level build.gradle(.kts) → remove legacy buildscript and
    //    guarantee google()/mavenCentral() so the new Kotlin/AGP versions
    //    (hosted on Maven Central) can actually be resolved.
    if (layout.projectBuild) {
        let content = readIfExists(layout.projectBuild.filePath) ?? '';
        content = migrateProjectBuildGradle(content, layout.projectBuild.kts);
        content = ensureProjectRepositories(content, layout.projectBuild.kts);
        if (writeIfChanged(layout.projectBuild.filePath, content)) {
            details.push(`Updated ${path.basename(layout.projectBuild.filePath)} (removed legacy buildscript, ensured google()/mavenCentral())`);
        }
    }

    // 3. App-level app/build.gradle(.kts) → Flutter-driven SDK/NDK versions.
    if (layout.appBuild) {
        const apacheHttpLegacy = detectApacheHttpUsage(layout.androidDir);
        let content = readIfExists(layout.appBuild.filePath) ?? '';
        content = migrateAppBuildGradle(content, layout.appBuild.kts, { apacheHttpLegacy });
        if (writeIfChanged(layout.appBuild.filePath, content)) {
            details.push(`Updated ${path.basename(layout.appBuild.filePath)} (Flutter-built-in SDK/NDK versions)`);
        }
    }

    // 4. Gradle wrapper → recommended version.
    if (layout.wrapperPath) {
        let content = readIfExists(layout.wrapperPath) ?? '';
        content = updateGradleWrapper(content, versions.gradle);
        if (writeIfChanged(layout.wrapperPath, content)) {
            details.push(`Updated Gradle wrapper to ${versions.gradle}`);
        }
    }

    // 5. AndroidManifest.xml → 16 KB page-size support.
    if (layout.manifestPath) {
        let content = readIfExists(layout.manifestPath) ?? '';
        content = ensureExtractNativeLibs(content);
        if (writeIfChanged(layout.manifestPath, content)) {
            details.push(`Enabled android:extractNativeLibs in AndroidManifest.xml (16 KB page size)`);
        }
    }

    return {
        message: 'Android setup successfully migrated to declarative plugins and 16 KB page size support enabled.',
        details
    };
}

// ---------------------------------------------------------------------------
// Fallback migration — 16 KB page size ONLY
// ---------------------------------------------------------------------------

/**
 * Safe fallback for projects that still use outdated packages incompatible
 * with the full declarative migration. It applies ONLY the minimal changes
 * required for Android 15+ 16 KB page-size compatibility and leaves the
 * existing legacy `buildscript` setup, plugin versions and package layout
 * untouched. Follows the official Android guide
 * (https://developer.android.com/guide/practices/page-sizes#update-packaging):
 *  - AGP raised to at least 8.5.1 (never downgraded) → uncompressed shared
 *    libraries are 16 KB zip-aligned automatically,
 *  - compileSdk/targetSdk raised to at least 35,
 *  - NDK raised to at least r28 (compiles 16 KB-aligned ELF segments by
 *    default; only for native projects),
 *  - `useLegacyPackaging true` (the guide's compressed-libs fallback) when AGP
 *    is still below 8.5.1,
 *  - Gradle wrapper raised if needed,
 *  - `android:extractNativeLibs="true"` added to the manifest.
 */
export async function migrateAndroid16kbSetup(): Promise<MigrationReport> {
    const layout = getAndroidLayout();
    const details: string[] = [];

    // 1. AGP >= 8.5.2 wherever it is declared. Track the resulting version so
    //    the guide's compressed-libs fallback can be applied when AGP stays
    //    below 8.5.1.
    const gradleFiles: GradleFile[] = [layout.settings, layout.projectBuild].filter(
        (f): f is GradleFile => f !== undefined
    );
    let agpBelow815 = false;
    for (const gf of gradleFiles) {
        let content = readIfExists(gf.filePath) ?? '';
        content = bumpAgpVersion(content, SIXTEEN_KB_MINIMUMS.agp);
        const declaredAgp = getAgpVersion(content);
        if (declaredAgp && compareVersions(declaredAgp, "8.5.1") < 0) {
            agpBelow815 = true;
        }
        if (writeIfChanged(gf.filePath, content)) {
            details.push(`Raised AGP to >= ${SIXTEEN_KB_MINIMUMS.agp} in ${path.basename(gf.filePath)}`);
        }
    }

    // 2. compileSdk/targetSdk >= 35, NDK >= r28 (native projects only), and the
    //    guide's compressed-libs packaging fallback when AGP < 8.5.1.
    if (layout.appBuild) {
        let content = readIfExists(layout.appBuild.filePath) ?? '';
        const before = content;
        content = bumpSdkVersions(content, parseInt(SIXTEEN_KB_MINIMUMS.targetSdk, 10));
        if (detectNativeUsage(before, layout.androidDir)) {
            content = bumpNdkVersion(content, SIXTEEN_KB_MINIMUMS.ndk);
        }
        content = ensureUseLegacyPackaging(content, layout.appBuild.kts, agpBelow815);
        if (writeIfChanged(layout.appBuild.filePath, content)) {
            details.push(`Raised SDK levels to >= ${SIXTEEN_KB_MINIMUMS.targetSdk} in ${path.basename(layout.appBuild.filePath)}`);
            if (agpBelow815) {
                details.push(`Added useLegacyPackaging (compressed native libs) — AGP below 8.5.1`);
            }
        }
    }

    // 3. Gradle wrapper >= 8.7 (AGP 8.5.2 requirement).
    if (layout.wrapperPath) {
        let content = readIfExists(layout.wrapperPath) ?? '';
        content = bumpGradleWrapperMinimum(content, SIXTEEN_KB_MINIMUMS.gradle);
        if (writeIfChanged(layout.wrapperPath, content)) {
            details.push(`Updated Gradle wrapper to >= ${SIXTEEN_KB_MINIMUMS.gradle}`);
        }
    }

    // 4. AndroidManifest.xml → extractNativeLibs.
    if (layout.manifestPath) {
        let content = readIfExists(layout.manifestPath) ?? '';
        content = ensureExtractNativeLibs(content);
        if (writeIfChanged(layout.manifestPath, content)) {
            details.push(`Enabled android:extractNativeLibs in AndroidManifest.xml (16 KB page size)`);
        }
    }

    return {
        message: '16 KB page size support enabled. Your legacy build setup was left untouched.',
        details
    };
}
