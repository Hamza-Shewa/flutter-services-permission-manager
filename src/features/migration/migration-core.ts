/**
 * File-level orchestration of the Android migrations, free of vscode APIs so
 * it can run against any `android/` directory (unit tests, scripts, CI).
 * `migration.service.ts` resolves the workspace and remote versions, then
 * calls into this module.
 */

import * as fs from 'fs';
import * as path from 'path';
import { logger, toError, toErrorMessage } from '../../core/shared/index.js';
import {
    AGP_16KB_MINIMUM,
    NDK_16KB_MINIMUM,
    bumpGradleWrapperMinimum,
    compareVersions,
    detectFirebaseUsage,
    ensureAgpGradleProperties,
    ensureDependencyResolutionManagement,
    ensurePluginManagement,
    ensureUseLegacyPackaging,
    getAgpVersion,
    isLegacySettings,
    migrateAppBuildGradle,
    migrateProjectBuildGradle,
    ndkSupports16Kb,
    normalizeNdk,
    readLiteralMinSdk,
    removeExtractNativeLibs,
    updateSettingsPlugins,
    type MigrationVersions
} from './migration-transforms.js';

export interface MigrationReport {
    message: string;
    details: string[];
    /** Things the user should know about that the migration could not or chose not to change. */
    warnings: string[];
    /** True when at least one file was modified. */
    changed: boolean;
}

export interface GradleFile {
    filePath: string;
    kts: boolean;
}

export interface AndroidLayout {
    androidDir: string;
    settings?: GradleFile;
    projectBuild?: GradleFile;
    appBuild?: GradleFile;
    wrapperPath?: string;
    manifestPath?: string;
    gradlePropertiesPath: string;
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

function normalizeToFileEol(content: string, original: string | null): string {
    if (original && /\r\n/.test(original)) {
        return content.replace(/\r\n/g, '\n').replace(/\n/g, '\r\n');
    }
    return content;
}

/**
 * Writes the file only when the content actually changed, keeping the file's
 * original line endings so Windows CRLF projects stay CRLF.
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
        throw new Error(`Could not write ${path.basename(filePath)}: ${toErrorMessage(error)}`);
    }
}

export function detectGradleLayout(androidDir: string): AndroidLayout {
    const pick = (dir: string, base: string): GradleFile | undefined => {
        const kts = path.join(dir, `${base}.gradle.kts`);
        const groovy = path.join(dir, `${base}.gradle`);
        if (fs.existsSync(kts)) {
            return { filePath: kts, kts: true };
        }
        if (fs.existsSync(groovy)) {
            return { filePath: groovy, kts: false };
        }
        return undefined;
    };

    const appDir = path.join(androidDir, 'app');
    const wrapperPath = path.join(androidDir, 'gradle', 'wrapper', 'gradle-wrapper.properties');
    const manifestPath = path.join(appDir, 'src', 'main', 'AndroidManifest.xml');
    return {
        androidDir,
        settings: pick(androidDir, 'settings'),
        projectBuild: pick(androidDir, 'build'),
        appBuild: pick(appDir, 'build'),
        wrapperPath: fs.existsSync(wrapperPath) ? wrapperPath : undefined,
        manifestPath: fs.existsSync(manifestPath) ? manifestPath : undefined,
        gradlePropertiesPath: path.join(androidDir, 'gradle.properties')
    };
}

/**
 * The NDK the project's Flutter SDK applies through `flutter.ndkVersion`, read
 * from the SDK in `local.properties` (undefined when it cannot be found).
 */
export function readFlutterNdk(androidDir: string): string | undefined {
    const localProperties = readIfExists(path.join(androidDir, 'local.properties'));
    const raw = localProperties && /^\s*flutter\.sdk\s*=\s*(.+)$/m.exec(localProperties)?.[1].trim();
    if (!raw) {
        return undefined;
    }
    const sdk = raw.replace(/\\(.)/g, '$1');
    const gradleDir = path.join(sdk, 'packages', 'flutter_tools', 'gradle');
    const candidates = [
        path.join(gradleDir, 'src', 'main', 'kotlin', 'FlutterExtension.kt'),
        path.join(gradleDir, 'src', 'main', 'groovy', 'FlutterExtension.groovy'),
        path.join(gradleDir, 'src', 'main', 'groovy', 'flutter.groovy')
    ];
    for (const file of candidates) {
        const match = /ndkVersion[^"'\n]*=\s*["'](\d+(?:\.\d+)+)["']/.exec(readIfExists(file) ?? '');
        if (match) {
            return match[1];
        }
    }
    return undefined;
}

/**
 * Scans android/app/src/main for `org.apache.http` usage (legacy Apache HTTP
 * client), which needs `useLibrary` on newer AGP.
 */
export function detectApacheHttpUsage(androidDir: string): boolean {
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
// Full migration
// ---------------------------------------------------------------------------

/**
 * Migrates the Android project to the AGP 9 declarative setup used by the
 * masaken (Groovy) and mishkat (Kotlin DSL) reference projects:
 *  - settings.gradle(.kts): declarative `plugins {}` with the Flutter loader,
 *    AGP, Kotlin and the Firebase plugins the app uses. Versions are raised to
 *    `versions`, never lowered. Pre-3.16 imperative settings are rewritten.
 *  - project build.gradle(.kts): legacy `buildscript` removed, repositories
 *    ensured, subproject defaults added (namespace / compileSdk / NDK / Java 17
 *    for older plugins).
 *  - app build.gradle(.kts): plugins block, raise-only SDK/NDK, Java 17, Kotlin
 *    `compilerOptions`. The app's `minSdk` is never changed.
 *  - Gradle wrapper raised to `versions.gradle` (never lowered).
 *  - gradle.properties: `android.builtInKotlin=false` / `android.newDsl=false`
 *    (what Flutter's migrator writes) so `kotlin-android` and the legacy DSL
 *    keep working under AGP 9.
 *  - AndroidManifest.xml: `android:extractNativeLibs` removed (AGP 9 fails the
 *    build on it); the intent moves to `useLegacyPackaging`.
 *
 * Handles Groovy and Kotlin DSL, and is idempotent.
 */
export function runFullMigration(androidDir: string, versions: MigrationVersions): MigrationReport {
    const layout = detectGradleLayout(androidDir);
    const details: string[] = [];
    const warnings: string[] = [];
    const flutterNdk = readFlutterNdk(androidDir);
    const name = (file: string) => path.relative(androidDir, file).split(path.sep).join('/');

    const appOriginal = layout.appBuild ? readIfExists(layout.appBuild.filePath) ?? '' : '';
    const firebase = detectFirebaseUsage(appOriginal);
    const minSdk = readLiteralMinSdk(appOriginal);
    const effective: MigrationVersions = { ...versions, minSdk: String(minSdk ?? versions.minSdk) };

    // Manifest first: an explicit extractNativeLibs="true" becomes useLegacyPackaging in the app script.
    let needsLegacyPackaging = false;
    if (layout.manifestPath) {
        const manifest = removeExtractNativeLibs(readIfExists(layout.manifestPath) ?? '');
        needsLegacyPackaging = manifest.wasTrue;
        if (writeIfChanged(layout.manifestPath, manifest.content)) {
            details.push(`${name(layout.manifestPath)}: removed android:extractNativeLibs (AGP 9 rejects it in the manifest)`);
        }
    }

    // settings.gradle(.kts)
    let agpAfter: string | null = null;
    if (layout.settings) {
        const original = readIfExists(layout.settings.filePath) ?? '';
        const legacy = isLegacySettings(original);
        let content = ensurePluginManagement(original, layout.settings.kts);
        content = updateSettingsPlugins(content, layout.settings.kts, effective, firebase, {
            agp: versions.agp,
            kotlin: versions.kotlin
        });
        content = ensureDependencyResolutionManagement(content);
        agpAfter = getAgpVersion(content);
        if (writeIfChanged(layout.settings.filePath, content)) {
            details.push(legacy
                ? `${name(layout.settings.filePath)}: replaced the imperative Flutter loader with declarative plugins (AGP ${agpAfter ?? versions.agp}, Kotlin ${versions.kotlin})`
                : `${name(layout.settings.filePath)}: declarative plugins (AGP ${agpAfter ?? versions.agp}, Kotlin ${versions.kotlin}${firebase.googleServices ? `, google-services ${versions.googleServices}` : ''})`);
        }
        if (agpAfter && compareVersions(agpAfter, versions.agp) > 0) {
            warnings.push(`Kept AGP ${agpAfter}, which is newer than the reference ${versions.agp}.`);
        }
    } else {
        warnings.push('No settings.gradle(.kts) found, so plugin versions were not migrated.');
    }

    // Project-level build.gradle(.kts)
    if (layout.projectBuild) {
        const content = migrateProjectBuildGradle(readIfExists(layout.projectBuild.filePath) ?? '', layout.projectBuild.kts, effective);
        if (writeIfChanged(layout.projectBuild.filePath, content)) {
            details.push(`${name(layout.projectBuild.filePath)}: removed legacy buildscript, ensured repositories, added subproject defaults for older plugins`);
        }
    }

    // App-level build.gradle(.kts)
    if (layout.appBuild) {
        let content = migrateAppBuildGradle(appOriginal, layout.appBuild.kts, {
            apacheHttpLegacy: detectApacheHttpUsage(androidDir),
            flutterNdk
        }, effective);
        content = ensureUseLegacyPackaging(content, layout.appBuild.kts, needsLegacyPackaging, agpAfter);
        if (writeIfChanged(layout.appBuild.filePath, content)) {
            details.push(`${name(layout.appBuild.filePath)}: plugins block, SDK ${versions.compileSdk}+, NDK, Java 17, Kotlin compilerOptions${needsLegacyPackaging ? ', useLegacyPackaging' : ''}`);
        }
    }

    // Gradle wrapper
    if (layout.wrapperPath) {
        const original = readIfExists(layout.wrapperPath) ?? '';
        const content = bumpGradleWrapperMinimum(original, versions.gradle);
        if (writeIfChanged(layout.wrapperPath, content)) {
            details.push(`${name(layout.wrapperPath)}: Gradle raised to ${versions.gradle}`);
        }
    }

    // gradle.properties
    const properties = readIfExists(layout.gradlePropertiesPath) ?? '';
    if (writeIfChanged(layout.gradlePropertiesPath, ensureAgpGradleProperties(properties))) {
        details.push('gradle.properties: android.builtInKotlin=false, android.newDsl=false');
    }

    const changed = details.length > 0;
    return {
        message: changed
            ? `Android project migrated to the AGP ${agpAfter ?? versions.agp} declarative setup (Gradle ${versions.gradle}+, SDK ${versions.compileSdk}, Java 17).`
            : 'Android project is already on the AGP 9 declarative setup - nothing to change.',
        details,
        warnings,
        changed
    };
}

// ---------------------------------------------------------------------------
// 16 KB page-size migration
// ---------------------------------------------------------------------------

/**
 * Makes the app 16 KB page-size compatible without touching the rest of the
 * build. Three things decide compatibility:
 *  1. the NDK that compiles native code: r28+ aligns ELF segments to 16 KB by
 *     default. A literal or Flutter-managed NDK below 28 is pinned to `ndk`;
 *  2. AGP 8.5.1+, which zip-aligns uncompressed libraries. On older AGP the
 *     libraries are packaged compressed (`useLegacyPackaging`) instead, and the
 *     report says to upgrade AGP;
 *  3. `android:extractNativeLibs` in the manifest, which AGP 9 rejects - removed
 *     and carried over to `useLegacyPackaging` if it was "true".
 *
 * Prebuilt `.so` files inside third-party dependencies cannot be fixed here and
 * are called out in the report.
 */
export function run16kbMigration(androidDir: string, ndk: string): MigrationReport {
    const layout = detectGradleLayout(androidDir);
    const details: string[] = [];
    const warnings: string[] = [];
    const flutterNdk = readFlutterNdk(androidDir);
    const name = (file: string) => path.relative(androidDir, file).split(path.sep).join('/');

    const agp = [layout.settings, layout.projectBuild]
        .map((file) => (file ? getAgpVersion(readIfExists(file.filePath) ?? '') : null))
        .find((version): version is string => !!version) ?? null;
    const packagedCompressed = !!agp && compareVersions(agp, AGP_16KB_MINIMUM) < 0;
    let needsLegacyPackaging = packagedCompressed;

    if (layout.manifestPath) {
        const manifest = removeExtractNativeLibs(readIfExists(layout.manifestPath) ?? '');
        needsLegacyPackaging = needsLegacyPackaging || manifest.wasTrue;
        if (writeIfChanged(layout.manifestPath, manifest.content)) {
            details.push(`${name(layout.manifestPath)}: removed android:extractNativeLibs (AGP 9 rejects it in the manifest)`);
        }
    }

    if (layout.appBuild) {
        const kts = layout.appBuild.kts;
        const original = readIfExists(layout.appBuild.filePath) ?? '';
        const withNdk = normalizeNdk(original, kts, ndk, flutterNdk, NDK_16KB_MINIMUM);
        const content = ensureUseLegacyPackaging(withNdk, kts, needsLegacyPackaging, agp);
        if (writeIfChanged(layout.appBuild.filePath, content)) {
            const parts: string[] = [];
            if (withNdk !== original) {
                parts.push(ndkSupports16Kb(flutterNdk) ? 'NDK from flutter.ndkVersion' : `NDK ${ndk}`);
            }
            if (content !== withNdk) {
                parts.push('useLegacyPackaging');
            }
            details.push(`${name(layout.appBuild.filePath)}: ${parts.join(', ')}`);
        }
    } else {
        warnings.push('No app/build.gradle(.kts) found, so the NDK version could not be checked.');
    }

    // A `flutter = [ ndkVersion: ... ]` map in the project script (masaken style) feeds older plugins.
    if (layout.projectBuild) {
        const original = readIfExists(layout.projectBuild.filePath) ?? '';
        const content = original.replace(
            /(ndkVersion["']?\s*(?:=|:|to)?\s*["'])([^"']+)(["'])/g,
            (m, pre: string, ver: string, post: string) => (compareVersions(ver, NDK_16KB_MINIMUM) >= 0 ? m : `${pre}${ndk}${post}`)
        );
        if (writeIfChanged(layout.projectBuild.filePath, content)) {
            details.push(`${name(layout.projectBuild.filePath)}: NDK ${ndk}`);
        }
    }

    if (packagedCompressed) {
        warnings.push(`AGP ${agp} cannot 16 KB-align uncompressed native libraries (needs ${AGP_16KB_MINIMUM}+), so they are packaged compressed instead. Run the full migration to upgrade AGP.`);
    } else if (!agp) {
        warnings.push(`Could not read the AGP version; make sure it is ${AGP_16KB_MINIMUM} or newer.`);
    }
    warnings.push('Prebuilt native libraries inside third-party dependencies must be 16 KB aligned by their authors; check the Play Console pre-launch report or run "zipalign -c -P 16 -v 4" on the built APK.');

    const changed = details.length > 0;
    return {
        message: changed
            ? `16 KB page-size support enabled (NDK ${ndk}).`
            : '16 KB page-size support: nothing to change - the NDK and packaging are already compatible.',
        details,
        warnings,
        changed
    };
}
