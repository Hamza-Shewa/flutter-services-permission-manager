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
 * Version policy: the full migration targets the masaken reference versions
 * (`versions`), which are also the current defaults. Plugins are set/updated
 * to those versions so the migrated project matches the reference exactly.
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

    // plugins block already exists → set every managed plugin to the masaken
    // reference version (legacy projects get raised; already-at-reference
    // versions are simply re-affirmed).
    const loaderExisting = extractPluginVersion(result, FLUTTER_PLUGIN_LOADER);
    result = setPluginVersion(result, FLUTTER_PLUGIN_LOADER, loaderExisting ?? '1.0.0', kts);
    result = setPluginVersion(result, ANDROID_APPLICATION_PLUGIN, versions.agp, kts);
    result = setPluginVersion(result, KOTLIN_ANDROID_PLUGIN, versions.kotlin, kts);
    if (firebase.googleServices) {
        result = setPluginVersion(result, 'com.google.gms.google-services', versions.googleServices, kts);
    }
    if (firebase.firebasePerf) {
        result = setPluginVersion(result, 'com.google.firebase.firebase-perf', versions.firebasePerf, kts);
    }
    if (firebase.crashlytics) {
        result = setPluginVersion(result, 'com.google.firebase.crashlytics', versions.crashlytics, kts);
    }
    return result;
}

// ---------------------------------------------------------------------------
// Project-level build.gradle(.kts)
// ---------------------------------------------------------------------------

/** Extracts custom repository lines (non-google/mavenCentral) from an existing allprojects block. */
function extractCustomRepositories(content: string): string[] {
    const allMatch = content.match(/\ballprojects\s*\{/);
    if (!allMatch || allMatch.index === undefined) {
        return [];
    }
    const openIdx = allMatch.index + allMatch[0].indexOf('{');
    const blockEnd = findMatchingBrace(content, openIdx);
    if (blockEnd === -1) {
        return [];
    }
    const block = content.slice(allMatch.index, blockEnd);
    const reposMatch = block.match(/repositories\s*\{/);
    if (!reposMatch || reposMatch.index === undefined) {
        return [];
    }
    const reposOpen = reposMatch.index + reposMatch[0].indexOf('{');
    const reposEnd = findMatchingBrace(block, reposOpen);
    if (reposEnd === -1) {
        return [];
    }
    const inner = block.slice(reposOpen + 1, reposEnd);
    return inner
        .split('\n')
        .map((l) => l.trim())
        .filter((l) => l && !/^(google\(\)|mavenCentral\(\)|gradlePluginPortal\(\))/.test(l));
}

function indentLines(lines: string[], spaces: number): string {
    const pad = ' '.repeat(spaces);
    return lines.map((l) => (l ? pad + l : l)).join('\n');
}

function buildProjectExtBlock(versions: MigrationVersions, indent: string, kts: boolean): string {
    const { compileSdk, targetSdk, minSdk, ndk } = versions;
    if (kts) {
        return [
            `${indent}extra {`,
            `${indent}    set("compileSdkVersion", ${compileSdk})`,
            `${indent}    set("targetSdkVersion", ${targetSdk})`,
            `${indent}    set("minSdkVersion", ${minSdk})`,
            `${indent}    set("flutter", mapOf(`,
            `${indent}        "compileSdkVersion" to ${compileSdk},`,
            `${indent}        "targetSdkVersion" to ${targetSdk},`,
            `${indent}        "minSdkVersion" to ${minSdk},`,
            `${indent}        "ndkVersion" to "${ndk}"`,
            `${indent}    ))`,
            `${indent}}`
        ].join('\n');
    }
    return [
        `${indent}ext {`,
        `${indent}    compileSdkVersion = ${compileSdk}`,
        `${indent}    targetSdkVersion = ${targetSdk}`,
        `${indent}    minSdkVersion = ${minSdk}`,
        `${indent}    flutter = [`,
        `${indent}        compileSdkVersion: ${compileSdk},`,
        `${indent}        targetSdkVersion: ${targetSdk},`,
        `${indent}        minSdkVersion: ${minSdk},`,
        `${indent}        ndkVersion: "${ndk}"`,
        `${indent}    ]`,
        `${indent}}`
    ].join('\n');
}

function buildMasakenProjectGradle(
    kts: boolean,
    versions: MigrationVersions,
    customRepos: string[]
): string {
    const { compileSdk, targetSdk, minSdk, ndk } = versions;
    const repos = ['google()', 'mavenCentral()', ...customRepos];
    const reposBlock = indentLines(repos, 8);
    const extAll = buildProjectExtBlock(versions, '    ', kts);
    const extSub = buildProjectExtBlock(versions, '    ', kts);

    if (kts) {
        return [
            'allprojects {',
            '    repositories {',
            reposBlock,
            '    }',
            extAll,
            '}',
            'rootProject.buildDir = file("../build")',
            '',
            'subprojects {',
            '    project.buildDir = file("${rootProject.buildDir}/${project.name}")',
            '',
            extSub,
            '',
            '    afterEvaluate {',
            '        if (project.hasProperty("android")) {',
            '            val javaVersion = JavaVersion.VERSION_17',
            '            extensions.configure<com.android.build.gradle.BaseExtension>("android") {',
            '                if (namespace == null || namespace.isEmpty()) {',
            '                    namespace = project.group as String?',
            '                }',
            `                compileSdkVersion(${compileSdk})`,
            `                ndkVersion = "${ndk}"`,
            '                defaultConfig {',
            `                    targetSdkVersion(${targetSdk})`,
            `                    minSdkVersion(${minSdk})`,
            '                    multiDexEnabled = true',
            '                }',
            '                compileOptions {',
            '                    sourceCompatibility = javaVersion',
            '                    targetCompatibility = javaVersion',
            '                }',
            '            }',
            '            tasks.withType<org.jetbrains.kotlin.gradle.tasks.KotlinCompile>().configureEach {',
            '                compilerOptions.jvmTarget.set(org.jetbrains.kotlin.gradle.dsl.JvmTarget.JVM_17)',
            '            }',
            '        }',
            '    }',
            '}',
            'subprojects {',
            '    project.evaluationDependsOn(":app")',
            '}',
            '',
            'tasks.register<Delete>("clean") {',
            '    delete(rootProject.buildDir)',
            '}',
            ''
        ].join('\n');
    }

    return [
        'allprojects {',
        '    repositories {',
        reposBlock,
        '    }',
        extAll,
        '}',
        "rootProject.buildDir = '../build'",
        '',
        'subprojects {',
        '    project.buildDir = "${rootProject.buildDir}/${project.name}"',
        '',
        extSub,
        '',
        '    afterEvaluate {',
        "        // check if android block is available",
        "        if (it.hasProperty('android')) {",
        '            def javaVersion = JavaVersion.VERSION_17',
        '            android {',
        '                if (namespace == null || namespace.isEmpty()) {',
        '                    namespace = project.group',
        '                }',
        `                compileSdkVersion ${compileSdk}`,
        `                ndkVersion "${ndk}"`,
        '                defaultConfig {',
        `                    targetSdkVersion ${targetSdk}`,
        `                    minSdkVersion ${minSdk}`,
        '                    multiDexEnabled true',
        '                }',
        '                compileOptions {',
        '                    sourceCompatibility javaVersion',
        '                    targetCompatibility javaVersion',
        '                }',
        '                tasks.withType(org.jetbrains.kotlin.gradle.tasks.KotlinCompile).configureEach {',
        '                    compilerOptions.jvmTarget.set(org.jetbrains.kotlin.gradle.dsl.JvmTarget.JVM_17)',
        '                }',
        '            }',
        '        }',
        '    }',
        '}',
        'subprojects {',
        "    project.evaluationDependsOn(':app')",
        '}',
        '',
        'tasks.register("clean", Delete) {',
        '    delete rootProject.buildDir',
        '}',
        ''
    ].join('\n');
}

/**
 * Migrates the project-level build.gradle to the masaken reference style:
 *  - removes the legacy `buildscript` block,
 *  - builds the `allprojects` / `subprojects` blocks with `ext` (compileSdk /
 *    targetSdk / minSdk / flutter map with the masaken NDK) and an
 *    `afterEvaluate` that forces Java 17 + the masaken SDK/NDK on every
 *    Android subproject,
 *  - keeps custom `allprojects` repositories (private mirrors etc.).
 *
 * This mirrors the masaken reference project (`E:\work_space\masaken`) so the
 * full migration produces the exact same Gradle structure.
 */
export function migrateProjectBuildGradle(
    content: string,
    kts: boolean,
    versions: MigrationVersions
): string {
    const customRepos = extractCustomRepositories(content);
    return buildMasakenProjectGradle(kts, versions, customRepos);
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
 * Migrates android/app/build.gradle(.kts) to the masaken reference style:
 *  - a `plugins {}` block (com.android.application, kotlin-android,
 *    dev.flutter.flutter-gradle-plugin) replacing `apply plugin:`,
 *  - SDK/NDK set to the masaken literal values (compileSdk 37, targetSdk 37,
 *    minSdk 26, ndkVersion 29.0.14206865),
 *  - Java 17 toolchain (`compileOptions` `JavaVersion.VERSION_17`),
 *  - the Kotlin JVM target now lives in a TOP-LEVEL
 *    `kotlin { compilerOptions { jvmTarget = JvmTarget.JVM_17 } }` block
 *    (matching the masaken reference — no longer `android { kotlinOptions {} }`),
 *  - a `flutter { source '../..' }` block.
 *
 * Non-destructive for projects that are already on the modern template: the
 * project's own `minSdk` is never silently lowered below the masaken target,
 * and existing plugin/toolchain blocks are preserved.
 */
export function migrateAppBuildGradle(
    content: string,
    kts: boolean,
    options: AppBuildOptions,
    versions: MigrationVersions
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

    // 3. Set the masaken literal SDK/NDK versions (compileSdk/targetSdk 37,
    //    minSdk 26, ndk 29.0.14206865).
    result = normalizeSdkRefs(result, kts, versions);

    // 4. Normalize the Java toolchain to 17 and relocate Kotlin options to a
    //    top-level `kotlin { compilerOptions { jvmTarget = JVM_17 } }` block.
    result = normalizeCompileOptions(result);
    result = normalizeKotlinOptions(result, kts);

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
    // JavaVersion enum form (Groovy & KTS) → 17.
    result = result.replace(/JavaVersion\.VERSION_1_8/g, 'JavaVersion.VERSION_17');
    result = result.replace(/JavaVersion\.VERSION_11/g, 'JavaVersion.VERSION_17');
    // String form: sourceCompatibility '1.8' / '11' / sourceCompatibility = "1.8".
    result = result.replace(
        /((?:source|target)Compatibility)(\s*=\s*|\s+)(['"])(?:1\.8|11)\3/g,
        (_m, prop: string, sep: string, quote: string) => `${prop}${sep}${quote}17${quote}`
    );
    return result;
}

function normalizeKotlinOptions(content: string, kts: boolean): string {
    let result = content;

    // Remove any legacy `android { kotlinOptions { ... } }` block — the Kotlin
    // JVM target now lives in a top-level `kotlin {}` block (masaken style).
    result = removeKotlinOptionsBlock(result);

    // Update any existing top-level `kotlin { compilerOptions { ... } }` block's
    // jvmTarget to JVM_17; otherwise insert a new top-level block.
    if (!/\bkotlin\s*\{/.test(result)) {
        const block = kts
            ? [
                  'kotlin {',
                  '    compilerOptions {',
                  '        jvmTarget = org.jetbrains.kotlin.gradle.dsl.JvmTarget.JVM_17',
                  '    }',
                  '}',
                  ''
              ].join('\n')
            : [
                  'kotlin {',
                  '    compilerOptions {',
                  '        jvmTarget = org.jetbrains.kotlin.gradle.dsl.JvmTarget.JVM_17',
                  '    }',
                  '}',
                  ''
              ].join('\n');
        // Insert right after the plugins block if present, else at the top.
        const pluginsMatch = result.match(/^\s*plugins\s*\{/m);
        if (pluginsMatch && pluginsMatch.index !== undefined) {
            const openIdx = pluginsMatch.index + pluginsMatch[0].indexOf('{');
            const closeIdx = findMatchingBrace(result, openIdx);
            if (closeIdx !== -1) {
                result =
                    result.slice(0, closeIdx + 1) + '\n\n' + block.trimEnd() + '\n\n' + result.slice(closeIdx + 1);
                return result;
            }
        }
        result = block.trimEnd() + '\n\n' + result.trimStart();
        return result;
    }

    // A top-level kotlin block already exists — normalize its jvmTarget to 17.
    result = result.replace(
        /(jvmTarget\s*=\s*)(['"])?(?:1\.8|11|17|JavaVersion\.VERSION_11\.toString\(\))(\2)?/g,
        (_m, pre: string, q: string | undefined) =>
            `${pre}${q ?? ''}org.jetbrains.kotlin.gradle.dsl.JvmTarget.JVM_17${q ?? ''}`
    );
    result = result.replace(
        /(jvmTarget\s*=\s*)org\.jetbrains\.kotlin\.gradle\.dsl\.JvmTarget\.JVM_(?:1_8|11)/g,
        '$1org.jetbrains.kotlin.gradle.dsl.JvmTarget.JVM_17'
    );
    return result;
}

/** Removes a legacy `android { kotlinOptions { ... } }` block by brace counting. */
function removeKotlinOptionsBlock(content: string): string {
    let result = content;
    let match = /\bkotlinOptions\s*\{/.exec(result);
    while (match) {
        const openIdx = match.index + match[0].indexOf('{');
        const end = findMatchingBrace(result, openIdx);
        if (end === -1) {
            break;
        }
        // Also consume the preceding indentation on the same line.
        const lineStart = result.lastIndexOf('\n', match.index) + 1;
        result = result.slice(0, lineStart) + result.slice(end + 1);
        match = /\bkotlinOptions\s*\{/.exec(result);
    }
    return result;
}

function normalizeSdkRefs(content: string, kts: boolean, versions: MigrationVersions): string {
    let result = content;
    const compileSdk = versions.compileSdk;
    const targetSdk = versions.targetSdk;
    const minSdk = versions.minSdk;
    const ndk = versions.ndk;

    // Groovy forms.
    result = result.replace(/(compileSdkVersion\s+)\d+/g, `$1${compileSdk}`);
    result = result.replace(/(\bcompileSdk\s+)\d+/g, `$1${compileSdk}`);
    result = result.replace(/(targetSdkVersion\s+)\d+/g, `$1${targetSdk}`);
    result = result.replace(/(\btargetSdk\s+)\d+/g, `$1${targetSdk}`);
    result = result.replace(/(minSdkVersion\s+)\d+/g, `$1${minSdk}`);
    result = result.replace(/(\bminSdk\s+)\d+/g, `$1${minSdk}`);

    // Kotlin DSL forms.
    result = result.replace(/(compileSdkVersion\s*=\s*)\d+/g, `$1${compileSdk}`);
    result = result.replace(/(\bcompileSdk\s*=\s*)\d+/g, `$1${compileSdk}`);
    result = result.replace(/(targetSdkVersion\s*=\s*)\d+/g, `$1${targetSdk}`);
    result = result.replace(/(\btargetSdk\s*=\s*)\d+/g, `$1${targetSdk}`);
    result = result.replace(/(minSdkVersion\s*=\s*)\d+/g, `$1${minSdk}`);
    result = result.replace(/(\bminSdk\s*=\s*)\d+/g, `$1${minSdk}`);

    // Flutter-built-in variable forms (in case the file already uses them).
    result = result.replace(/flutter\.compileSdkVersion/g, compileSdk);
    result = result.replace(/flutter\.targetSdkVersion/g, targetSdk);
    result = result.replace(/flutter\.minSdkVersion/g, minSdk);

    // ndkVersion → masaken literal.
    result = result.replace(/ndkVersion\s*=\s*["'][^"']*["']/g, `ndkVersion = "${ndk}"`);
    result = result.replace(/ndkVersion\s+["'][^"']*["']/g, `ndkVersion "${ndk}"`);

    if (!result.includes('ndkVersion')) {
        const line = kts ? `ndkVersion = "${ndk}"` : `ndkVersion "${ndk}"`;
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
// gradle.properties (masaken reference)
// ---------------------------------------------------------------------------

/**
 * The masaken reference `android/gradle.properties` content. The full
 * migration writes this so the project gets the exact same Gradle/JVM
 * settings as the masaken reference project.
 */
export const MASAKEN_GRADLE_PROPERTIES = [
    'org.gradle.jvmargs=-Xmx4096m',
    '# Gradle 8.14.x does not support running on JDK 25 (Android Studio\'s embedded JBR).',
    '# Pin the Gradle JVM to JDK 21, which is also what the command-line build uses.',
    '#org.gradle.java.home=C:/Program Files/Java/jdk-21',
    'android.useAndroidX=true',
    'android.enableJetifier=true',
    'org.gradle.daemon=false',
    '# This builtInKotlin flag was added automatically by Flutter migrator',
    'android.builtInKotlin=false',
    '# This newDsl flag was added automatically by Flutter migrator',
    'android.newDsl=false',
    '# Disable Kotlin incremental compilation: the pub cache lives on C: while this',
    '# project is on E:, and Kotlin\'s incremental cache cannot store relative paths',
    '# across different filesystem roots.',
    'kotlin.incremental=false',
    ''
].join('\n');

/**
 * Copies the masaken reference `gradle.properties` content into the project's
 * `android/gradle.properties` (merging: existing keys are preserved, the
 * masaken keys are forced to the reference values).
 */
export function mergeMasakenGradleProperties(content: string): string {
    const existing = new Map<string, string>();
    const lines = content.split(/\r?\n/);
    for (const line of lines) {
        const m = /^\s*([A-Za-z0-9_.-]+)\s*=(.*)$/.exec(line);
        if (m) {
            existing.set(m[1], m[2].trim());
        }
    }
    const masaken = MASAKEN_GRADLE_PROPERTIES.split(/\r?\n/);
    const out: string[] = [];
    const written = new Set<string>();
    for (const line of masaken) {
        const m = /^\s*([A-Za-z0-9_.-]+)\s*=(.*)$/.exec(line);
        if (m) {
            const key = m[1];
            if (existing.has(key)) {
                out.push(`${key}=${existing.get(key)}`);
            } else {
                out.push(line.trim());
            }
            written.add(key);
        } else if (line.trim()) {
            out.push(line);
        }
    }
    // Append any existing lines whose keys we didn't manage.
    for (const line of lines) {
        const m = /^\s*([A-Za-z0-9_.-]+)\s*=(.*)$/.exec(line);
        if (m && !written.has(m[1])) {
            out.push(line.trim());
        }
    }
    return out.join('\n').replace(/[ \t]+\n/g, '\n') + '\n';
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
