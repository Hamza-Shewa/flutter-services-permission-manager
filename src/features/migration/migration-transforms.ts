/**
 * Pure, cross-platform string transforms for the Android Gradle / manifest migration.
 *
 * These functions perform NO file I/O and import NO vscode APIs so they can be
 * unit-tested anywhere and safely reused by:
 *   1. the full "migrate to latest Flutter declarative setup" migration, and
 *   2. the safe "16 KB page size only" fallback migration (for projects that
 *      still use outdated packages incompatible with the full migration).
 *
 * Every transform is written to handle BOTH legacy Groovy (`build.gradle`) and
 * modern Kotlin DSL (`build.gradle.kts`) files.
 */

export interface MigrationVersions {
    agp: string;
    kotlin: string;
    googleServices: string;
    firebasePerf: string;
    crashlytics: string;
    compileSdk: string;
    targetSdk: string;
    minSdk: string;
    gradle: string;
    ndk: string;
}

export interface FirebaseUsage {
    googleServices: boolean;
    firebasePerf: boolean;
    crashlytics: boolean;
}

export const FLUTTER_PLUGIN_LOADER = 'dev.flutter.flutter-plugin-loader';
export const FLUTTER_GRADLE_PLUGIN = 'dev.flutter.flutter-gradle-plugin';
export const ANDROID_APPLICATION_PLUGIN = 'com.android.application';
export const KOTLIN_ANDROID_PLUGIN = 'org.jetbrains.kotlin.android';
export const KOTLIN_APPLY_PLUGIN = 'kotlin-android';

// ---------------------------------------------------------------------------
// Version helpers
// ---------------------------------------------------------------------------

export function parseVersion(version: string): number[] {
    return String(version || '')
        .trim()
        .replace(/^v/i, '')
        .split('.')
        .map((part) => parseInt(part, 10) || 0);
}

export function compareVersions(a: string, b: string): number {
    const pa = parseVersion(a);
    const pb = parseVersion(b);
    const len = Math.max(pa.length, pb.length);
    for (let i = 0; i < len; i++) {
        const va = pa[i] || 0;
        const vb = pb[i] || 0;
        if (va !== vb) {
            return va > vb ? 1 : -1;
        }
    }
    return 0;
}

export function maxVersion(a: string, b: string): string {
    return compareVersions(a, b) >= 0 ? a : b;
}

function escapeRegExp(value: string): string {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// ---------------------------------------------------------------------------
// Low-level Gradle text helpers
// ---------------------------------------------------------------------------

/**
 * Finds the index of the closing brace that matches the opening brace at
 * `openBraceIndex` (brace counting, handles nesting). Returns -1 if unmatched.
 */
function findMatchingBrace(content: string, openBraceIndex: number): number {
    let depth = 0;
    for (let i = openBraceIndex; i < content.length; i++) {
        const ch = content[i];
        if (ch === '{') {
            depth++;
        } else if (ch === '}') {
            depth--;
            if (depth === 0) {
                return i;
            }
        }
    }
    return -1;
}

/**
 * Removes a `name { ... }` block by brace counting (handles nesting).
 * Returns the input unchanged if the block is not found.
 */
function removeBlockByName(content: string, blockName: string): string {
    const re = new RegExp(`\\b${escapeRegExp(blockName)}\\s*\\{`);
    const match = re.exec(content);
    if (!match) {
        return content;
    }
    const openIdx = match.index + match[0].indexOf('{');
    const end = findMatchingBrace(content, openIdx);
    if (end === -1) {
        return content;
    }
    return content.slice(0, match.index) + content.slice(end + 1);
}

function formatPluginId(pluginId: string, kts: boolean): string {
    return kts ? `id("${pluginId}")` : `id "${pluginId}"`;
}

/**
 * Extracts the currently declared version of a plugin from a `plugins {}`
 * block (or null if absent).
 */
function extractPluginVersion(content: string, pluginId: string): string | null {
    const escaped = escapeRegExp(pluginId);
    const re = new RegExp(
        `id\\s*\\(?["']${escaped}["']\\)?[^\\n]*?version\\s+["']([^"']+)["']`
    );
    const m = re.exec(content);
    return m ? m[1] : null;
}

/**
 * Chooses the plugin version to write:
 *  - if a version is already declared AND it is at/above `minimum`, KEEP it.
 *    Forcing a newer patch version onto a project that already builds is what
 *    breaks otherwise-working projects (e.g. `kotlin-stdlib` not found, or the
 *    Flutter embedding not being wired up after blindly bumping Kotlin/AGP).
 *  - otherwise fall back to `recommended`.
 */
function resolvePluginVersion(existing: string | null, recommended: string, minimum: string): string {
    if (existing && compareVersions(existing, minimum) >= 0) {
        return existing;
    }
    return recommended;
}

/**
 * Sets (or inserts) the version of a plugin inside a `plugins { }` block.
 * Handles both Groovy (`id "x.y" version "1.0"`) and Kotlin DSL
 * (`id("x.y") version "1.0"`).
 */
function setPluginVersion(content: string, pluginId: string, version: string, kts: boolean): string {
    const escaped = escapeRegExp(pluginId);
    const idPattern = `id\\s*\\(?["']${escaped}["']\\)?`;
    let replaced = false;
    const result = content.replace(new RegExp(`${idPattern}[^\\n]*`, 'g'), (match) => {
        replaced = true;
        const leading = match.match(/^\s*/)?.[0] ?? '';
        return `${leading}${formatPluginId(pluginId, kts)} version "${version}" apply false`;
    });
    if (replaced) {
        return result;
    }
    // Plugin not present — insert it inside the plugins block.
    const pluginsMatch = result.match(/(^|\n)(\s*)plugins\s*\{/m);
    if (pluginsMatch) {
        const insertPos = pluginsMatch.index! + pluginsMatch[0].length;
        const line = `\n${pluginsMatch[2]}    ${formatPluginId(pluginId, kts)} version "${version}" apply false`;
        return result.slice(0, insertPos) + line + result.slice(insertPos);
    }
    return result;
}

function insertIntoAndroidBlock(content: string, line: string): string {
    const androidMatch = content.match(/android\s*\{/);
    if (!androidMatch || androidMatch.index === undefined) {
        return content;
    }
    const insertPos = androidMatch.index + androidMatch[0].length;
    return content.slice(0, insertPos) + `\n    ${line}` + content.slice(insertPos);
}

// ---------------------------------------------------------------------------
// settings.gradle(.kts)
// ---------------------------------------------------------------------------

/**
 * Ensures a `pluginManagement { repositories { google(); mavenCentral();
 * gradlePluginPortal() } }` block exists at the top of settings.gradle.
 *
 * Legacy Flutter projects have NO pluginManagement block, so a bare
 * `plugins {}` block cannot resolve any plugin — this is one of the reasons
 * the old migration silently produced broken projects.
 */
export function ensurePluginManagement(content: string, _kts: boolean): string {
    if (/\bpluginManagement\s*\{/.test(content)) {
        return content;
    }
    const block = [
        'pluginManagement {',
        '    repositories {',
        '        google()',
        '        mavenCentral()',
        '        gradlePluginPortal()',
        '    }',
        '}',
        ''
    ].join('\n');
    return `${block}\n${content.trimStart()}`;
}

/**
 * Ensures the `plugins {}` block in settings.gradle declares the Flutter
 * plugin loader, the Android application plugin and the Kotlin Android plugin
 * (plus Firebase plugins when detected).
 *
 * Version policy (important for not breaking working projects):
 *  - legacy projects with no `plugins {}` block get the recommended versions,
 *  - projects that ALREADY have a `plugins {}` block keep their existing
 *    versions when those are at/above the minimums (`minimums`), and are only
 *    raised when they fall below them. Never forces the latest patch onto a
 *    working project.
 */
export function updateSettingsPlugins(
    content: string,
    kts: boolean,
    versions: MigrationVersions,
    firebase: FirebaseUsage,
    minimums: { agp: string; kotlin: string }
): string {
    let result = content;
    const hasPlugins = /^\s*plugins\s*\{/m.test(result);

    if (!hasPlugins) {
        const lines: string[] = ['plugins {'];
        const entries: Array<[string, string]> = [
            [FLUTTER_PLUGIN_LOADER, '1.0.0'],
            [ANDROID_APPLICATION_PLUGIN, versions.agp],
            [KOTLIN_ANDROID_PLUGIN, versions.kotlin],
            ['com.google.gms.google-services', versions.googleServices],
            ['com.google.firebase.firebase-perf', versions.firebasePerf],
            ['com.google.firebase.crashlytics', versions.crashlytics]
        ];
        for (const [id, version] of entries) {
            const needed =
                id === FLUTTER_PLUGIN_LOADER ||
                id === ANDROID_APPLICATION_PLUGIN ||
                id === KOTLIN_ANDROID_PLUGIN ||
                (id === 'com.google.gms.google-services' && firebase.googleServices) ||
                (id === 'com.google.firebase.firebase-perf' && firebase.firebasePerf) ||
                (id === 'com.google.firebase.crashlytics' && firebase.crashlytics);
            if (needed) {
                lines.push(`    ${formatPluginId(id, kts)} version "${version}" apply false`);
            }
        }
        lines.push('}');
        result = `${result.trimEnd()}\n\n${lines.join('\n')}\n`;
        return result;
    }

    // plugins block already exists → update/insert each plugin version, but
    // never force newer versions onto a project that already meets minimums.
    const loaderExisting = extractPluginVersion(result, FLUTTER_PLUGIN_LOADER);
    result = setPluginVersion(result, FLUTTER_PLUGIN_LOADER, loaderExisting ?? '1.0.0', kts);
    result = setPluginVersion(
        result,
        ANDROID_APPLICATION_PLUGIN,
        resolvePluginVersion(
            extractPluginVersion(result, ANDROID_APPLICATION_PLUGIN),
            versions.agp,
            minimums.agp
        ),
        kts
    );
    result = setPluginVersion(
        result,
        KOTLIN_ANDROID_PLUGIN,
        resolvePluginVersion(
            extractPluginVersion(result, KOTLIN_ANDROID_PLUGIN),
            versions.kotlin,
            minimums.kotlin
        ),
        kts
    );
    if (firebase.googleServices) {
        const existing = extractPluginVersion(result, 'com.google.gms.google-services');
        result = setPluginVersion(result, 'com.google.gms.google-services', existing ?? versions.googleServices, kts);
    }
    if (firebase.firebasePerf) {
        const existing = extractPluginVersion(result, 'com.google.firebase.firebase-perf');
        result = setPluginVersion(result, 'com.google.firebase.firebase-perf', existing ?? versions.firebasePerf, kts);
    }
    if (firebase.crashlytics) {
        const existing = extractPluginVersion(result, 'com.google.firebase.crashlytics');
        result = setPluginVersion(result, 'com.google.firebase.crashlytics', existing ?? versions.crashlytics, kts);
    }
    return result;
}

// ---------------------------------------------------------------------------
// Project-level build.gradle(.kts)
// ---------------------------------------------------------------------------

/**
 * Migrates the project-level build.gradle. Removes the legacy `buildscript`
 * block (plugin classpaths now live in settings.gradle's plugins block).
 * `allprojects` repositories are preserved.
 */
export function migrateProjectBuildGradle(content: string, _kts: boolean): string {
    let result = content;
    if (/\bbuildscript\s*\{/.test(result)) {
        result = removeBlockByName(result, 'buildscript');
    }
    result = result.trim();
    if (!result.endsWith('\n')) {
        result += '\n';
    }
    return result;
}

/**
 * Ensures the project-level `allprojects { repositories { ... } }` block
 * contains BOTH `google()` and `mavenCentral()`.
 *
 * This is the repository set used to resolve app dependencies (e.g.
 * `org.jetbrains.kotlin:kotlin-stdlib`). Kotlin artifacts are hosted on Maven
 * Central — projects whose `allprojects` only lists Google Maven or a private
 * mirror fail with "Could not find org.jetbrains.kotlin:kotlin-stdlib:...",
 * which is exactly what happens after the full migration bumps the Kotlin
 * plugin version. Adds an `allprojects` block if one is missing.
 *
 * Same syntax works for both Groovy and Kotlin DSL.
 */
export function ensureProjectRepositories(content: string, _kts: boolean): string {
    let result = content;

    const allprojectsMatch = result.match(/\ballprojects\s*\{/);
    if (allprojectsMatch && allprojectsMatch.index !== undefined) {
        const openIdx = allprojectsMatch.index + allprojectsMatch[0].length;
        const blockEnd = findMatchingBrace(result, openIdx - 1);
        if (blockEnd !== -1) {
            const block = result.slice(openIdx, blockEnd);
            const reposMatch = block.match(/repositories\s*\{/);
            if (reposMatch && reposMatch.index !== undefined) {
                const reposOpen = reposMatch.index + reposMatch[0].length;
                const reposEnd = findMatchingBrace(block, reposOpen - 1);
                if (reposEnd !== -1) {
                    const reposInner = block.slice(reposOpen, reposEnd);
                    const additions: string[] = [];
                    if (!/\bgoogle\s*\(/.test(reposInner)) {
                        additions.push('google()');
                    }
                    if (!/\bmavenCentral\s*\(/.test(reposInner)) {
                        additions.push('mavenCentral()');
                    }
                    if (additions.length > 0) {
                        const injected = additions.map((r) => `        ${r}`).join('\n');
                        const newBlock =
                            block.slice(0, reposEnd) + `\n${injected}\n    ` + block.slice(reposEnd);
                        result = result.slice(0, openIdx) + newBlock + result.slice(blockEnd);
                    }
                }
            }
            return result;
        }
    }

    // No allprojects block — append a standard Flutter-style one.
    const block = [
        '',
        'allprojects {',
        '    repositories {',
        '        google()',
        '        mavenCentral()',
        '    }',
        '}',
        ''
    ].join('\n');
    return result.trimEnd() + block;
}

/**
 * Ensures a `dependencyResolutionManagement { repositories { google();
 * mavenCentral() } }` block contains both repositories when present in
 * settings.gradle(.kts). Some projects (and newer Gradle templates) resolve
 * project dependencies here instead of `allprojects`.
 */
export function ensureDependencyResolutionManagement(content: string): string {
    const drmMatch = content.match(/\bdependencyResolutionManagement\s*\{/);
    if (!drmMatch || drmMatch.index === undefined) {
        return content;
    }
    const openIdx = drmMatch.index + drmMatch[0].length;
    const blockEnd = findMatchingBrace(content, openIdx - 1);
    if (blockEnd === -1) {
        return content;
    }
    const block = content.slice(openIdx, blockEnd);
    const reposMatch = block.match(/repositories\s*\{/);
    if (!reposMatch || reposMatch.index === undefined) {
        return content;
    }
    const reposOpen = reposMatch.index + reposMatch[0].length;
    const reposEnd = findMatchingBrace(block, reposOpen - 1);
    if (reposEnd === -1) {
        return content;
    }
    const reposInner = block.slice(reposOpen, reposEnd);
    const additions: string[] = [];
    if (!/\bgoogle\s*\(/.test(reposInner)) {
        additions.push('google()');
    }
    if (!/\bmavenCentral\s*\(/.test(reposInner)) {
        additions.push('mavenCentral()');
    }
    if (additions.length === 0) {
        return content;
    }
    const injected = additions.map((r) => `        ${r}`).join('\n');
    const newBlock = block.slice(0, reposEnd) + `\n${injected}\n    ` + block.slice(reposEnd);
    return content.slice(0, openIdx) + newBlock + content.slice(blockEnd);
}

// ---------------------------------------------------------------------------
// App-level app/build.gradle(.kts)
// ---------------------------------------------------------------------------

export interface AppBuildOptions {
    /** Add `useLibrary 'org.apache.http.legacy'` (legacy Apache HTTP clients). */
    apacheHttpLegacy: boolean;
}

/**
 * Migrates android/app/build.gradle(.kts) to the modern declarative setup:
 *  - a `plugins {}` block (com.android.application, kotlin-android,
 *    dev.flutter.flutter-gradle-plugin) replacing `apply plugin:`,
 *  - SDK/NDK versions driven by Flutter's built-in variables
 *    (`flutter.compileSdkVersion`, `flutter.targetSdkVersion`,
 *    `flutter.ndkVersion`) instead of hardcoded numbers,
 *  - a `flutter { source '../..' }` block.
 *
 * Non-destructive for projects that are already on the modern template: the
 * project's own `minSdk` and Java/Kotlin toolchain are left untouched so a
 * working build is never broken by the migration. The toolchain is only
 * normalized (1.8 → 11) when a legacy `apply plugin:` project is converted.
 */
export function migrateAppBuildGradle(
    content: string,
    kts: boolean,
    options: AppBuildOptions
): string {
    let result = content;
    const hadPluginsBlock = /^\s*plugins\s*\{/m.test(result);

    // 1. Ensure plugins block exists with the required plugins.
    result = ensureAppPluginsBlock(result, kts);

    // 2. Remove legacy `apply plugin:` / `apply from: flutter.gradle` lines
    //    (those plugins are now applied via the plugins block / flutter plugin).
    result = result
        .replace(/^\s*apply\s+plugin\s*:\s*['"](?:com\.android\.application|kotlin-android|com\.google\.gms\.google-services|com\.google\.firebase\.firebase-perf|com\.google\.firebase\.crashlytics)['"]\s*$/gm, '')
        .replace(/^\s*apply\s+from\s*:.*flutter\.gradle.*$/gm, '');

    // 3. Only normalize the Java/Kotlin toolchain when converting a legacy
    //    project. Already-modern files keep their own toolchain settings.
    if (!hadPluginsBlock) {
        result = normalizeCompileOptions(result);
        result = normalizeKotlinOptions(result, kts);
    }

    // 4. Drive compileSdk/targetSdk/ndk from Flutter's built-in variables
    //    (minSdk is intentionally left alone — never silently lower it).
    result = normalizeSdkRefs(result, kts);

    // 5. Legacy Apache HTTP support (only when the project actually uses it).
    if (options.apacheHttpLegacy && !result.includes('org.apache.http.legacy')) {
        result = insertIntoAndroidBlock(result, `useLibrary 'org.apache.http.legacy'`);
    }

    // 6. Ensure the `flutter { source ... }` block is present.
    result = ensureFlutterSourceBlock(result, kts);

    return result;
}

function ensureAppPluginsBlock(content: string, kts: boolean): string {
    if (/^\s*plugins\s*\{/m.test(content)) {
        if (!content.includes(FLUTTER_GRADLE_PLUGIN)) {
            content = content.replace(
                /(^\s*plugins\s*\{)/m,
                `$1\n    ${formatPluginId(FLUTTER_GRADLE_PLUGIN, kts)}`
            );
        }
        return content;
    }
    const ids = [
        formatPluginId(ANDROID_APPLICATION_PLUGIN, kts),
        formatPluginId(KOTLIN_APPLY_PLUGIN, kts),
        formatPluginId(FLUTTER_GRADLE_PLUGIN, kts)
    ];
    const block = `plugins {\n    ${ids.join('\n    ')}\n}\n\n`;
    return block + content.trimStart();
}

function normalizeCompileOptions(content: string): string {
    let result = content;
    // JavaVersion enum form (Groovy & KTS).
    result = result.replace(/JavaVersion\.VERSION_1_8/g, 'JavaVersion.VERSION_11');
    // String form: sourceCompatibility '1.8' / sourceCompatibility = "1.8".
    result = result.replace(
        /((?:source|target)Compatibility)(\s*=\s*|\s+)(['"])1\.8\3/g,
        (_m, prop: string, sep: string, quote: string) => `${prop}${sep}${quote}11${quote}`
    );
    return result;
}

function normalizeKotlinOptions(content: string, kts: boolean): string {
    let result = content;
    // jvmTarget = '1.8' → '11' (Groovy) and jvmTarget = "1.8" → "11".
    result = result.replace(
        /(jvmTarget\s*=\s*)(['"])1\.8\2/g,
        (_m, pre: string, quote: string) => `${pre}${quote}11${quote}`
    );
    // Add a kotlinOptions block if none exists (matches Flutter's own template).
    if (!/\bkotlinOptions\s*\{/.test(result)) {
        const line = kts
            ? 'kotlinOptions {\n        jvmTarget = JavaVersion.VERSION_11.toString()\n    }'
            : "kotlinOptions {\n        jvmTarget = '11'\n    }";
        result = insertIntoAndroidBlock(result, line);
    }
    return result;
}

function normalizeSdkRefs(content: string, kts: boolean): string {
    let result = content;

    // Groovy forms. (minSdk is intentionally NOT converted — the project's
    // explicit minSdk must never be silently lowered to flutter.minSdkVersion.)
    result = result.replace(/(compileSdkVersion\s+)\d+/g, '$1flutter.compileSdkVersion');
    result = result.replace(/(\bcompileSdk\s+)\d+/g, '$1flutter.compileSdkVersion');
    result = result.replace(/(targetSdkVersion\s+)\d+/g, '$1flutter.targetSdkVersion');

    // Kotlin DSL forms.
    result = result.replace(/(compileSdkVersion\s*=\s*)\d+/g, '$1flutter.compileSdkVersion');
    result = result.replace(/(\bcompileSdk\s*=\s*)\d+/g, '$1flutter.compileSdkVersion');
    result = result.replace(/(targetSdkVersion\s*=\s*)\d+/g, '$1flutter.targetSdkVersion');
    result = result.replace(/(\btargetSdk\s*=\s*)\d+/g, '$1flutter.targetSdkVersion');

    // ndkVersion → flutter.ndkVersion.
    result = result.replace(/ndkVersion\s*=\s*["'][^"']*["']/g, 'ndkVersion = flutter.ndkVersion');
    result = result.replace(/ndkVersion\s+["'][^"']*["']/g, 'ndkVersion flutter.ndkVersion');

    if (!result.includes('ndkVersion')) {
        const line = kts ? 'ndkVersion = flutter.ndkVersion' : 'ndkVersion flutter.ndkVersion';
        result = insertIntoAndroidBlock(result, line);
    }

    return result;
}

function ensureFlutterSourceBlock(content: string, kts: boolean): string {
    if (/^\s*flutter\s*\{/m.test(content)) {
        return content;
    }
    const block = kts
        ? '\nflutter {\n    source = "../.."\n}\n'
        : "\nflutter {\n    source '../..'\n}\n";
    return content.trimEnd() + block;
}

// ---------------------------------------------------------------------------
// Gradle wrapper
// ---------------------------------------------------------------------------

/** Sets the Gradle distribution to an exact version. */
export function updateGradleWrapper(content: string, gradleVersion: string): string {
    return content.replace(
        /distributionUrl=.*/,
        `distributionUrl=https\\://services.gradle.org/distributions/gradle-${gradleVersion}-all.zip`
    );
}

/** Raises the Gradle distribution version only if it is below `minimum`. */
export function bumpGradleWrapperMinimum(content: string, minimum: string): string {
    const match = content.match(/distributionUrl=.*gradle-([0-9.]+)(-(bin|all))?\.zip/);
    if (!match) {
        return updateGradleWrapper(content, minimum);
    }
    const current = match[1];
    if (compareVersions(current, minimum) >= 0) {
        return content;
    }
    const flavor = match[3] || 'all';
    return content.replace(
        /distributionUrl=.*/,
        `distributionUrl=https\\://services.gradle.org/distributions/gradle-${minimum}-${flavor}.zip`
    );
}

// ---------------------------------------------------------------------------
// 16 KB page-size transforms (fallback migration)
// ---------------------------------------------------------------------------

/**
 * Raises the Android Gradle Plugin version to at least `minimum` wherever it
 * is declared (settings plugins block or legacy buildscript classpath).
 * Never downgrades.
 */
export function bumpAgpVersion(content: string, minimum: string): string {
    let result = content;
    const pluginRe = /(id\s*\(?["']com\.android\.application["']\)?[^\n]*version\s+["'])([^"']+)(["'])/g;
    result = result.replace(pluginRe, (_m, pre: string, ver: string, post: string) => {
        return `${pre}${maxVersion(ver, minimum)}${post}`;
    });
    const classpathRe = /(classpath\s+["']com\.android\.tools\.build:gradle:)([^"']+)(["'])/g;
    result = result.replace(classpathRe, (_m, pre: string, ver: string, post: string) => {
        return `${pre}${maxVersion(ver, minimum)}${post}`;
    });
    return result;
}

/**
 * Raises `compileSdk` / `targetSdk` to at least `minimum` (Groovy and KTS).
 * Never downgrades and never touches `flutter.*` variables (they contain no
 * literal number) or `minSdk`.
 */
export function bumpSdkVersions(content: string, minimum: number): string {
    let result = content;
    for (const prop of ['compileSdk', 'targetSdk']) {
        result = result.replace(
            new RegExp(`(${prop}(?:Version)?\\s*=\\s*)(\\d+)`, 'g'),
            (_m, pre: string, num: string) => `${pre}${Math.max(parseInt(num, 10), minimum)}`
        );
        result = result.replace(
            new RegExp(`(${prop}(?:Version)?\\s+)(\\d+)`, 'g'),
            (_m, pre: string, num: string) => `${pre}${Math.max(parseInt(num, 10), minimum)}`
        );
    }
    return result;
}

/** Raises the NDK version to at least `minimum` (only when already set). */
export function bumpNdkVersion(content: string, minimum: string): string {
    let result = content;
    result = result.replace(
        /(ndkVersion\s*=\s*["'])([^"']+)(["'])/g,
        (_m, pre: string, ver: string, post: string) => `${pre}${maxVersion(ver, minimum)}${post}`
    );
    result = result.replace(
        /(ndkVersion\s+["'])([^"']+)(["'])/g,
        (_m, pre: string, ver: string, post: string) => `${pre}${maxVersion(ver, minimum)}${post}`
    );
    return result;
}

/**
 * Extracts the currently declared Android Gradle Plugin version from a
 * `plugins {}` block or a legacy `buildscript` classpath. Returns null if not
 * found (e.g. the version is inherited from a composite build).
 */
export function getAgpVersion(content: string): string | null {
    const pluginRe =
        /id\s*\(?["']com\.android\.application["']\)?[^\n]*?version\s+["']([^"']+)["']/;
    const pluginMatch = content.match(pluginRe);
    if (pluginMatch) {
        return pluginMatch[1];
    }
    const classpathRe = /classpath\s+["']com\.android\.tools\.build:gradle:([^"']+)["']/;
    const classpathMatch = content.match(classpathRe);
    return classpathMatch ? classpathMatch[1] : null;
}

/**
 * Per the official 16 KB guide, apps shipping UNCOMPRESSED shared libraries on
 * AGP below 8.5.1 will not be 16 KB zip-aligned when built from an App Bundle
 * in Play. The guide's fallback for that case is to compress the libraries:
 *
 *   android {
 *     packagingOptions {
 *       jniLibs { useLegacyPackaging true }
 *     }
 *   }
 *
 * Only applied when `enable` is true (AGP is still below 8.5.1 after the
 * migration's best-effort bump) and when it isn't already present.
 */
export function ensureUseLegacyPackaging(content: string, kts: boolean, enable: boolean): string {
    if (!enable) {
        return content;
    }
    if (/useLegacyPackaging\s*(=)?\s*true/.test(content)) {
        return content;
    }
    const line = kts
        ? 'packagingOptions {\n        jniLibs {\n            useLegacyPackaging = true\n        }\n    }'
        : 'packagingOptions {\n        jniLibs {\n            useLegacyPackaging true\n        }\n    }';
    return insertIntoAndroidBlock(content, line);
}

// ---------------------------------------------------------------------------
// AndroidManifest.xml
// ---------------------------------------------------------------------------

/**
 * Ensures `android:extractNativeLibs="true"` on the `<application>` tag.
 * This is required so pre-Android-15 devices can load native libraries that
 * are 16 KB aligned, and is the standard requirement for 16 KB page-size
 * compatibility.
 */
export function ensureExtractNativeLibs(manifestContent: string): string {
    if (/android:extractNativeLibs="true"/.test(manifestContent)) {
        return manifestContent;
    }
    const appTagRegex = /<application\b[^>]*>/i;
    const match = appTagRegex.exec(manifestContent);
    if (!match) {
        return manifestContent;
    }
    const tag = match[0];
    if (/android:extractNativeLibs="false"/.test(tag)) {
        return manifestContent.replace(
            tag,
            tag.replace(/android:extractNativeLibs="false"/, 'android:extractNativeLibs="true"')
        );
    }
    const updatedTag = tag.replace(/>\s*$/, ' android:extractNativeLibs="true">');
    return manifestContent.replace(tag, updatedTag);
}

// ---------------------------------------------------------------------------
// Detection helpers (pure)
// ---------------------------------------------------------------------------

/** Detects Firebase plugins referenced from the app build.gradle content. */
export function detectFirebaseUsage(appBuildContent: string): FirebaseUsage {
    return {
        googleServices: appBuildContent.includes('com.google.gms.google-services'),
        firebasePerf: appBuildContent.includes('com.google.firebase.firebase-perf'),
        crashlytics: appBuildContent.includes('com.google.firebase.crashlytics')
    };
}
