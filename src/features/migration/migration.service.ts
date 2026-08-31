import * as path from 'path';
import * as fs from 'fs';
import * as vscode from 'vscode';
import { getRecommendedVersions } from '../build/version-fetcher.js';
import { SIXTEEN_KB_MINIMUMS, MIGRATION_MINIMUMS } from '../../core/constants/versions.js';
import { logger, toError, toErrorMessage } from '../../core/shared/index.js';
import {
    ensurePluginManagement,
    updateSettingsPlugins,
    migrateProjectBuildGradle,
    ensureDependencyResolutionManagement,
    migrateAppBuildGradle,
    updateGradleWrapper,
    ensureExtractNativeLibs,
    bumpNdkVersion,
    detectFirebaseUsage,
    mergeMasakenGradleProperties
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
    gradlePropertiesPath?: string;
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

    const gradlePropertiesPath = path.join(androidDir, 'gradle.properties');
    if (fs.existsSync(gradlePropertiesPath)) {
        layout.gradlePropertiesPath = gradlePropertiesPath;
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

// ---------------------------------------------------------------------------
// Full migration — masaken declarative setup + 16 KB support
// ---------------------------------------------------------------------------

/**
 * Migrates the Android project to the masaken reference configuration:
 *  - declarative `plugins {}` Gradle setup pinned to the masaken versions
 *    (AGP 9.3.1, Kotlin 2.4.10, google-services 4.5.0),
 *  - project build.gradle rewritten to the masaken `ext` block style
 *    (compileSdk/targetSdk 37, minSdk 26, flutter map with NDK 29.0.14206865,
 *    Java 17 afterEvaluate),
 *  - app build.gradle set to the masaken SDK/NDK values with a top-level
 *    `kotlin { compilerOptions {} }` block and Java 17 toolchain,
 *  - Gradle wrapper 9.5.1, masaken gradle.properties, and 16 KB page-size
 *    support enabled (`android:extractNativeLibs="true"`).
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

    // 1. settings.gradle(.kts) → pluginManagement + declarative plugins
    //    (AGP / Kotlin / google-services pinned to the masaken reference).
    if (layout.settings) {
        let content = readIfExists(layout.settings.filePath) ?? '';
        content = ensurePluginManagement(content, layout.settings.kts);
        content = updateSettingsPlugins(content, layout.settings.kts, versions, firebase, {
            agp: MIGRATION_MINIMUMS.agp,
            kotlin: MIGRATION_MINIMUMS.kotlin
        });
        content = ensureDependencyResolutionManagement(content);
        if (writeIfChanged(layout.settings.filePath, content)) {
            details.push(`Updated ${path.basename(layout.settings.filePath)} (declarative plugins, AGP ${versions.agp}, Kotlin ${versions.kotlin}, google-services ${versions.googleServices})`);
        }
    }

    // 2. Project-level build.gradle(.kts) → masaken-style `ext` block with
    //    compileSdk/targetSdk/minSdk/flutter map + Java 17 afterEvaluate.
    if (layout.projectBuild) {
        let content = readIfExists(layout.projectBuild.filePath) ?? '';
        content = migrateProjectBuildGradle(content, layout.projectBuild.kts, versions);
        if (writeIfChanged(layout.projectBuild.filePath, content)) {
            details.push(`Updated ${path.basename(layout.projectBuild.filePath)} (masaken-style ext: SDK ${versions.compileSdk}, minSdk ${versions.minSdk}, NDK ${versions.ndk}, Java 17)`);
        }
    }

    // 3. App-level app/build.gradle(.kts) → masaken-style SDK/NDK versions,
    //    Java 17, and the top-level `kotlin { compilerOptions {} }` block.
    if (layout.appBuild) {
        const apacheHttpLegacy = detectApacheHttpUsage(layout.androidDir);
        let content = readIfExists(layout.appBuild.filePath) ?? '';
        content = migrateAppBuildGradle(content, layout.appBuild.kts, { apacheHttpLegacy }, versions);
        if (writeIfChanged(layout.appBuild.filePath, content)) {
            details.push(`Updated ${path.basename(layout.appBuild.filePath)} (masaken SDK/NDK + Java 17 + top-level kotlin block)`);
        }
    }

    // 4. Gradle wrapper → recommended version (9.5.1).
    if (layout.wrapperPath) {
        let content = readIfExists(layout.wrapperPath) ?? '';
        content = updateGradleWrapper(content, versions.gradle);
        if (writeIfChanged(layout.wrapperPath, content)) {
            details.push(`Updated Gradle wrapper to ${versions.gradle}`);
        }
    }

    // 5. gradle.properties → masaken reference content.
    if (layout.gradlePropertiesPath) {
        let content = readIfExists(layout.gradlePropertiesPath) ?? '';
        content = mergeMasakenGradleProperties(content);
        if (writeIfChanged(layout.gradlePropertiesPath, content)) {
            details.push(`Updated gradle.properties (masaken reference JVM/Android flags)`);
        }
    }

    // 6. AndroidManifest.xml → 16 KB page-size support.
    if (layout.manifestPath) {
        let content = readIfExists(layout.manifestPath) ?? '';
        content = ensureExtractNativeLibs(content);
        if (writeIfChanged(layout.manifestPath, content)) {
            details.push(`Enabled android:extractNativeLibs in AndroidManifest.xml (16 KB page size)`);
        }
    }

    return {
        message: 'Android setup successfully migrated to the masaken declarative configuration (AGP 9.3.1, Gradle 9.5.1, SDK 37, minSdk 26, NDK 29.0.14206865, Java 17).',
        details
    };
}

// ---------------------------------------------------------------------------
// Fallback migration — NDK ONLY
// ---------------------------------------------------------------------------

/**
 * Lightweight 16 KB helper. Per product decision this migration ONLY updates
 * the NDK version to the masaken reference (29.0.14206865) so native
 * libraries are compiled with 16 KB-aligned ELF segments. It does NOT touch
 * AGP, SDK levels, packaging, the Gradle wrapper or the manifest.
 */
export async function migrateAndroid16kbSetup(): Promise<MigrationReport> {
    const layout = getAndroidLayout();
    const details: string[] = [];

    // 1. NDK version → 29.0.14206865 in app/build.gradle(.kts).
    if (layout.appBuild) {
        let content = readIfExists(layout.appBuild.filePath) ?? '';
        content = bumpNdkVersion(content, SIXTEEN_KB_MINIMUMS.ndk);
        if (writeIfChanged(layout.appBuild.filePath, content)) {
            details.push(`Updated NDK version to ${SIXTEEN_KB_MINIMUMS.ndk} in ${path.basename(layout.appBuild.filePath)}`);
        }
    }

    // 2. Also update the NDK inside the project-level `flutter = [...]` ext map
    //    when present (masaken-style projects declare it there too).
    if (layout.projectBuild) {
        let content = readIfExists(layout.projectBuild.filePath) ?? '';
        const before = content;
        content = bumpNdkVersion(content, SIXTEEN_KB_MINIMUMS.ndk);
        if (writeIfChanged(layout.projectBuild.filePath, content)) {
            details.push(`Updated NDK version to ${SIXTEEN_KB_MINIMUMS.ndk} in ${path.basename(layout.projectBuild.filePath)}`);
        }
        void before;
    }

    return {
        message: `NDK version updated to ${SIXTEEN_KB_MINIMUMS.ndk} (16 KB page-size compatible).`,
        details
    };
}
