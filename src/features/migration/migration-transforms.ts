/**
 * Pure, cross-platform string transforms for the Android Gradle / manifest migration.
 *
 * These functions perform NO file I/O and import NO vscode APIs so they can be
 * unit-tested anywhere and safely reused by:
 *   1. the full "migrate to the AGP 9 declarative Flutter setup" migration, and
 *   2. the "16 KB page size" migration.
 *
 * Every transform handles BOTH Groovy (`build.gradle`) and Kotlin DSL
 * (`build.gradle.kts`) files, and is idempotent: running it on its own output
 * changes nothing.
 *
 * Reference projects the output is validated against with a real Gradle build:
 *  - masaken (Groovy, AGP 9.3.1)
 *  - mishkat (Kotlin DSL, AGP 9.x)
 */

export interface MigrationVersions {
    agp: string;
    kotlin: string;
    googleServices: string;
    firebasePerf: string;
    crashlytics: string;
    compileSdk: string;
    targetSdk: string;
    /**
     * Only used to seed the legacy `ext` values that old plugin build scripts
     * read. The migration never changes the app's own minSdk.
     */
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
export const GOOGLE_SERVICES_PLUGIN = 'com.google.gms.google-services';
export const FIREBASE_PERF_PLUGIN = 'com.google.firebase.firebase-perf';
export const CRASHLYTICS_PLUGIN = 'com.google.firebase.crashlytics';

/** First NDK release that links native code with 16 KB ELF alignment by default. */
export const NDK_16KB_MINIMUM = '28.0.0';
/** First AGP release that zip-aligns uncompressed native libraries to 16 KB. */
export const AGP_16KB_MINIMUM = '8.5.1';

const SUBPROJECT_MARKER_START = '// start flutter-config-manager subproject defaults';
const SUBPROJECT_MARKER_END = '// end flutter-config-manager subproject defaults';

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

function splitVersion(version: string): { nums: number[]; pre: string } {
    const trimmed = String(version || '').trim().replace(/^v/i, '');
    const dash = trimmed.indexOf('-');
    const core = dash === -1 ? trimmed : trimmed.slice(0, dash);
    return { nums: parseVersion(core), pre: dash === -1 ? '' : trimmed.slice(dash + 1) };
}

/**
 * Compares dotted versions. A pre-release (`9.4.0-alpha06`) sorts below its
 * release (`9.4.0`) but above every earlier release (`9.3.1`).
 */
export function compareVersions(a: string, b: string): number {
    const va = splitVersion(a);
    const vb = splitVersion(b);
    const len = Math.max(va.nums.length, vb.nums.length);
    for (let i = 0; i < len; i++) {
        const na = va.nums[i] || 0;
        const nb = vb.nums[i] || 0;
        if (na !== nb) {
            return na > nb ? 1 : -1;
        }
    }
    if (va.pre === vb.pre) {
        return 0;
    }
    if (!va.pre) {
        return 1;
    }
    if (!vb.pre) {
        return -1;
    }
    return va.pre.localeCompare(vb.pre, undefined, { numeric: true });
}

export function maxVersion(a: string, b: string): string {
    return compareVersions(a, b) >= 0 ? a : b;
}

export function isPrerelease(version: string): boolean {
    return /-(alpha|beta|rc|dev|snapshot)/i.test(version);
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

/** Removes a whole top-level `name { ... }` block (and its line) by brace counting. */
function removeBlockByName(content: string, blockName: string): string {
    const re = new RegExp(`^[ \\t]*${escapeRegExp(blockName)}\\s*\\{`, 'm');
    const match = re.exec(content);
    if (!match) {
        return content;
    }
    const openIdx = match.index + match[0].lastIndexOf('{');
    const end = findMatchingBrace(content, openIdx);
    if (end === -1) {
        return content;
    }
    return content.slice(0, match.index) + content.slice(end + 1).replace(/^[ \t]*\r?\n/, '');
}

function formatPluginId(pluginId: string, kts: boolean): string {
    return kts ? `id("${pluginId}")` : `id "${pluginId}"`;
}

function pluginIdPattern(pluginId: string): string {
    return `id\\s*\\(?\\s*["']${escapeRegExp(pluginId)}["']\\s*\\)?`;
}

/** Extracts the declared version of a plugin (null when absent or versionless). */
function extractPluginVersion(content: string, pluginId: string): string | null {
    const re = new RegExp(`${pluginIdPattern(pluginId)}[^\\n]*?version\\s*\\(?\\s*["']([^"']+)["']`);
    const m = re.exec(content);
    return m ? m[1] : null;
}

/**
 * Sets (or inserts, right after `plugins {`) a plugin line. `applyFalse`
 * distinguishes settings-level declarations (`apply false`) from the Flutter
 * plugin loader, which MUST be applied in settings.
 */
function setPluginLine(
    content: string,
    pluginId: string,
    version: string | undefined,
    kts: boolean,
    applyFalse: boolean
): string {
    const suffix = `${version ? ` version "${version}"` : ''}${applyFalse ? ' apply false' : ''}`;
    const re = new RegExp(`^([ \\t]*)${pluginIdPattern(pluginId)}[^\\n]*$`, 'm');
    const existing = re.exec(content);
    if (existing) {
        const line = existing[0];
        const sameVersion = (extractPluginVersion(line, pluginId) ?? undefined) === version;
        if (sameVersion && /\bapply\s+false\b/.test(line) === applyFalse) {
            return content; // already correct: keep the user's quoting and trailing comments
        }
        return content.replace(re, (_m, indent: string) => `${indent}${formatPluginId(pluginId, kts)}${suffix}`);
    }
    const block = /^([ \t]*)plugins\s*\{[^\n]*$/m.exec(content);
    if (!block) {
        return content;
    }
    const insertAt = block.index + block[0].length;
    return `${content.slice(0, insertAt)}\n${block[1]}    ${formatPluginId(pluginId, kts)}${suffix}${content.slice(insertAt)}`;
}

/**
 * Keeps an existing version when it is at or above the target (never
 * downgrades - a project already on a newer AGP/Kotlin stays there),
 * otherwise uses the target.
 */
function resolvePluginVersion(existing: string | null, target: string): string {
    return existing && compareVersions(existing, target) >= 0 ? existing : target;
}

function insertIntoAndroidBlock(content: string, line: string): string {
    const androidMatch = /^[ \t]*android\s*\{/m.exec(content);
    if (!androidMatch) {
        return content;
    }
    const insertPos = androidMatch.index + androidMatch[0].length;
    return `${content.slice(0, insertPos)}\n    ${line}${content.slice(insertPos)}`;
}

/** Index just after the last leading `import ...` line (0 when there are none). */
function afterImports(content: string): number {
    const re = /^(?:[ \t]*import[^\n]*\r?\n|[ \t]*\r?\n)*/;
    const m = re.exec(content);
    return m ? m[0].length : 0;
}

// ---------------------------------------------------------------------------
// settings.gradle(.kts)
// ---------------------------------------------------------------------------

/**
 * Ensures a `pluginManagement { repositories { ... } }` block exists.
 * Without one a `plugins {}` block cannot resolve any plugin.
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
 * True for settings files that still use the imperative Flutter loader
 * (`apply from: ".../app_plugin_loader.gradle"`), i.e. projects created before
 * Flutter 3.16 that have no declarative `plugins {}` block for the loader.
 */
export function isLegacySettings(content: string): boolean {
    if (/app_plugin_loader\.gradle/.test(content)) {
        return true;
    }
    return !new RegExp(pluginIdPattern(FLUTTER_PLUGIN_LOADER)).test(content);
}

function pluginEntries(
    versions: MigrationVersions,
    firebase: FirebaseUsage
): Array<{ id: string; version: string; applyFalse: boolean }> {
    const entries = [
        { id: FLUTTER_PLUGIN_LOADER, version: '1.0.0', applyFalse: false },
        { id: ANDROID_APPLICATION_PLUGIN, version: versions.agp, applyFalse: true },
        { id: KOTLIN_ANDROID_PLUGIN, version: versions.kotlin, applyFalse: true }
    ];
    if (firebase.googleServices) {
        entries.push({ id: GOOGLE_SERVICES_PLUGIN, version: versions.googleServices, applyFalse: true });
    }
    if (firebase.firebasePerf) {
        entries.push({ id: FIREBASE_PERF_PLUGIN, version: versions.firebasePerf, applyFalse: true });
    }
    if (firebase.crashlytics) {
        entries.push({ id: CRASHLYTICS_PLUGIN, version: versions.crashlytics, applyFalse: true });
    }
    return entries;
}

/**
 * Builds the standard declarative settings file (the layout `flutter create`
 * generates and both reference projects use), keeping the project's existing
 * `include` lines and `dependencyResolutionManagement` block.
 */
export function buildDeclarativeSettings(
    kts: boolean,
    versions: MigrationVersions,
    firebase: FirebaseUsage,
    previous = ''
): string {
    const pluginLines = pluginEntries(versions, firebase).map(
        (e) => `    ${formatPluginId(e.id, kts)} version "${e.version}"${e.applyFalse ? ' apply false' : ''}`
    );
    const includes = previous
        .split(/\r?\n/)
        .filter((line) => /^\s*include\b/.test(line))
        .map((line) => line.trim());
    if (includes.length === 0) {
        includes.push(kts ? 'include(":app")' : 'include ":app"');
    }
    const drm = extractBlock(previous, 'dependencyResolutionManagement');

    const pluginManagement = kts
        ? [
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
            '}'
        ]
        : [
            'pluginManagement {',
            '    def flutterSdkPath = {',
            '        def properties = new Properties()',
            '        file("local.properties").withInputStream { properties.load(it) }',
            '        def flutterSdkPath = properties.getProperty("flutter.sdk")',
            '        assert flutterSdkPath != null, "flutter.sdk not set in local.properties"',
            '        return flutterSdkPath',
            '    }()',
            '',
            '    includeBuild("$flutterSdkPath/packages/flutter_tools/gradle")',
            '',
            '    repositories {',
            '        google()',
            '        mavenCentral()',
            '        gradlePluginPortal()',
            '    }',
            '}'
        ];

    return [
        ...pluginManagement,
        '',
        'plugins {',
        ...pluginLines,
        '}',
        '',
        ...(drm ? [drm, ''] : []),
        ...includes,
        ''
    ].join('\n');
}

function extractBlock(content: string, blockName: string): string | null {
    const match = new RegExp(`^[ \\t]*${escapeRegExp(blockName)}\\s*\\{`, 'm').exec(content);
    if (!match) {
        return null;
    }
    const end = findMatchingBrace(content, match.index + match[0].lastIndexOf('{'));
    return end === -1 ? null : content.slice(match.index, end + 1);
}

/**
 * Makes `plugins {}` in settings.gradle(.kts) declare the Flutter plugin
 * loader, the Android application plugin and the Kotlin Android plugin (plus
 * the Firebase plugins the app uses).
 *
 * Version policy: each plugin is raised to the reference version but NEVER
 * lowered - a project already on a newer AGP/Kotlin keeps it. The loader is
 * applied (no `apply false`); everything else is `apply false`.
 *
 * Projects on the pre-3.16 imperative loader get the standard declarative
 * settings file instead, since a `plugins {}` block appended to that file
 * would not even parse.
 */
export function updateSettingsPlugins(
    content: string,
    kts: boolean,
    versions: MigrationVersions,
    firebase: FirebaseUsage,
    minimums: { agp: string; kotlin: string }
): string {
    if (isLegacySettings(content)) {
        return buildDeclarativeSettings(kts, versions, firebase, content);
    }

    let result = content;
    for (const entry of pluginEntries(versions, firebase)) {
        const target = entry.id === ANDROID_APPLICATION_PLUGIN ? maxVersion(entry.version, minimums.agp)
            : entry.id === KOTLIN_ANDROID_PLUGIN ? maxVersion(entry.version, minimums.kotlin)
                : entry.version;
        const existing = extractPluginVersion(result, entry.id);
        const version = entry.id === FLUTTER_PLUGIN_LOADER ? (existing ?? target) : resolvePluginVersion(existing, target);
        result = setPluginLine(result, entry.id, version, kts, entry.applyFalse);
    }
    return result;
}

// ---------------------------------------------------------------------------
// Project-level build.gradle(.kts)
// ---------------------------------------------------------------------------

/**
 * Ensures the project-level `allprojects { repositories { ... } }` block
 * contains BOTH `google()` and `mavenCentral()` (Kotlin artifacts live on
 * Maven Central). Adds an `allprojects` block if one is missing.
 */
export function ensureProjectRepositories(content: string, _kts: boolean): string {
    const allprojectsMatch = /\ballprojects\s*\{/.exec(content);
    if (allprojectsMatch) {
        const openIdx = allprojectsMatch.index + allprojectsMatch[0].length;
        const blockEnd = findMatchingBrace(content, openIdx - 1);
        if (blockEnd !== -1) {
            const block = content.slice(openIdx, blockEnd);
            const reposMatch = /repositories\s*\{/.exec(block);
            if (reposMatch) {
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
                        const newBlock = `${block.slice(0, reposEnd).replace(/[ \t]+$/, '')}\n${injected}\n    ${block.slice(reposEnd)}`;
                        return content.slice(0, openIdx) + newBlock + content.slice(blockEnd);
                    }
                }
            }
            return content;
        }
    }

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
    return content.trimEnd() + block;
}

/** Ensures `dependencyResolutionManagement` (when present) lists google() and mavenCentral(). */
export function ensureDependencyResolutionManagement(content: string): string {
    const drmMatch = /\bdependencyResolutionManagement\s*\{/.exec(content);
    if (!drmMatch) {
        return content;
    }
    const openIdx = drmMatch.index + drmMatch[0].length;
    const blockEnd = findMatchingBrace(content, openIdx - 1);
    if (blockEnd === -1) {
        return content;
    }
    const block = content.slice(openIdx, blockEnd);
    const reposMatch = /repositories\s*\{/.exec(block);
    if (!reposMatch) {
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
    const newBlock = `${block.slice(0, reposEnd).replace(/[ \t]+$/, '')}\n${injected}\n    ${block.slice(reposEnd)}`;
    return content.slice(0, openIdx) + newBlock + content.slice(blockEnd);
}

/**
 * Old Flutter plugins were written against older Android Gradle plugins: many
 * lack a `namespace`, and some pin a `compileSdk`, NDK or Java level that AGP 9
 * rejects. This block (the masaken reference approach) aligns every Android
 * subproject other than the app, and seeds the `ext` values legacy plugin
 * scripts read. It is wrapped in markers so re-running replaces it in place.
 */
function buildSubprojectDefaults(kts: boolean, versions: MigrationVersions): string {
    const { compileSdk, targetSdk, minSdk, ndk } = versions;
    const lines = kts
        ? [
            SUBPROJECT_MARKER_START,
            'allprojects {',
            `    extra["compileSdkVersion"] = ${compileSdk}`,
            `    extra["targetSdkVersion"] = ${targetSdk}`,
            `    extra["minSdkVersion"] = ${minSdk}`,
            '    extra["flutter"] = mapOf(',
            `        "compileSdkVersion" to ${compileSdk},`,
            `        "targetSdkVersion" to ${targetSdk},`,
            `        "minSdkVersion" to ${minSdk},`,
            `        "ndkVersion" to "${ndk}"`,
            '    )',
            '}',
            'subprojects {',
            '    if (name != "app") {',
            '        afterEvaluate {',
            '            extensions.findByType(com.android.build.gradle.BaseExtension::class.java)?.apply {',
            '                if (namespace.isNullOrEmpty()) {',
            '                    namespace = project.group.toString()',
            '                }',
            `                compileSdkVersion(${compileSdk})`,
            `                ndkVersion = "${ndk}"`,
            '                compileOptions {',
            '                    sourceCompatibility = JavaVersion.VERSION_17',
            '                    targetCompatibility = JavaVersion.VERSION_17',
            '                }',
            '            }',
            '            tasks.withType<org.jetbrains.kotlin.gradle.tasks.KotlinCompile>().configureEach {',
            '                compilerOptions.jvmTarget.set(org.jetbrains.kotlin.gradle.dsl.JvmTarget.JVM_17)',
            '            }',
            '        }',
            '    }',
            '}',
            SUBPROJECT_MARKER_END
        ]
        : [
            SUBPROJECT_MARKER_START,
            'allprojects {',
            '    ext {',
            `        compileSdkVersion = ${compileSdk}`,
            `        targetSdkVersion = ${targetSdk}`,
            `        minSdkVersion = ${minSdk}`,
            '        flutter = [',
            `            compileSdkVersion: ${compileSdk},`,
            `            targetSdkVersion: ${targetSdk},`,
            `            minSdkVersion: ${minSdk},`,
            `            ndkVersion: "${ndk}"`,
            '        ]',
            '    }',
            '}',
            'subprojects {',
            "    if (name != 'app') {",
            '        afterEvaluate {',
            "            if (it.hasProperty('android')) {",
            '                android {',
            '                    if (namespace == null || namespace.isEmpty()) {',
            '                        namespace = project.group',
            '                    }',
            `                    compileSdkVersion ${compileSdk}`,
            `                    ndkVersion "${ndk}"`,
            '                    compileOptions {',
            '                        sourceCompatibility JavaVersion.VERSION_17',
            '                        targetCompatibility JavaVersion.VERSION_17',
            '                    }',
            '                }',
            '            }',
            '            tasks.withType(org.jetbrains.kotlin.gradle.tasks.KotlinCompile).configureEach {',
            '                compilerOptions.jvmTarget.set(org.jetbrains.kotlin.gradle.dsl.JvmTarget.JVM_17)',
            '            }',
            '        }',
            '    }',
            '}',
            SUBPROJECT_MARKER_END
        ];
    return lines.join('\n');
}

/** True when the file already aligns subprojects itself (e.g. a hand-migrated masaken-style build). */
function hasHandWrittenSubprojectHook(content: string): boolean {
    return /afterEvaluate\s*\{[\s\S]{0,400}hasProperty\(\s*["']android["']\s*\)/.test(content);
}

/**
 * Migrates the project-level build.gradle(.kts) IN PLACE (the project's own
 * build-directory setup, `clean` task and repositories are kept):
 *  - removes the legacy `buildscript { classpath ... }` block (plugin versions
 *    now live in settings.gradle),
 *  - makes sure `google()` and `mavenCentral()` are listed,
 *  - adds the marker-delimited subproject defaults block (before the
 *    `evaluationDependsOn(":app")` block, since `afterEvaluate` cannot be
 *    registered on a project that is already evaluated).
 */
export function migrateProjectBuildGradle(
    content: string,
    kts: boolean,
    versions: MigrationVersions
): string {
    let result = removeBlockByName(content, 'buildscript');
    result = ensureProjectRepositories(result, kts);

    const markerRe = new RegExp(
        `[ \\t]*${escapeRegExp(SUBPROJECT_MARKER_START)}[\\s\\S]*?${escapeRegExp(SUBPROJECT_MARKER_END)}`
    );
    const block = buildSubprojectDefaults(kts, versions);
    if (markerRe.test(result)) {
        return result.replace(markerRe, () => block);
    }
    if (hasHandWrittenSubprojectHook(result)) {
        return result;
    }

    const dependsOn = /^[ \t]*subprojects\s*\{[^{}]*evaluationDependsOn/m.exec(result);
    if (dependsOn) {
        return `${result.slice(0, dependsOn.index)}${block}\n${result.slice(dependsOn.index)}`;
    }
    return `${result.trimEnd()}\n\n${block}\n`;
}

// ---------------------------------------------------------------------------
// App-level app/build.gradle(.kts)
// ---------------------------------------------------------------------------

export interface AppBuildOptions {
    /** Add `useLibrary "org.apache.http.legacy"` (legacy Apache HTTP clients). */
    apacheHttpLegacy: boolean;
    /**
     * `flutter.ndkVersion` of the project's Flutter SDK, when known. A value
     * of NDK 28+ is already 16 KB aligned, so the Flutter-managed reference is
     * kept instead of pinning a literal.
     */
    flutterNdk?: string;
    /** NDK versions below this are replaced with `versions.ndk` (defaults to `versions.ndk`). */
    ndkFloor?: string;
}

const LEGACY_APPLY_RE =
    /^[ \t]*apply\s+plugin\s*:\s*['"]([^'"]+)['"][ \t]*\r?\n?/gm;

/**
 * Migrates android/app/build.gradle(.kts):
 *  - a `plugins {}` block (Android, Kotlin, Firebase and Flutter plugins, in
 *    that order) replaces `apply plugin:` / `apply from: flutter.gradle`,
 *  - `compileSdk` / `targetSdk` literals are RAISED to the reference (never
 *    lowered; `flutter.*` references are kept), `minSdk` is never touched,
 *  - the NDK is raised (see `normalizeNdk`),
 *  - Java 8/11 -> 17 and the Kotlin JVM target moves to a top-level
 *    `kotlin { compilerOptions {} }` block,
 *  - `useLibrary` for the legacy Apache HTTP client when the app uses it,
 *  - a `flutter { source ... }` block.
 */
export function migrateAppBuildGradle(
    content: string,
    kts: boolean,
    options: AppBuildOptions,
    versions: MigrationVersions
): string {
    let result = content;

    // 1. Legacy `apply plugin:` lines become entries of the plugins block.
    const legacyIds: string[] = [];
    result = result.replace(LEGACY_APPLY_RE, (_m, id: string) => {
        if (
            id === ANDROID_APPLICATION_PLUGIN || id === KOTLIN_APPLY_PLUGIN || id === KOTLIN_ANDROID_PLUGIN ||
            id === GOOGLE_SERVICES_PLUGIN || id === FIREBASE_PERF_PLUGIN || id === CRASHLYTICS_PLUGIN
        ) {
            legacyIds.push(id);
            return '';
        }
        return _m;
    });
    result = result.replace(/^[ \t]*apply\s+from\s*:.*flutter\.gradle.*\r?\n?/gm, '');
    // `$kotlin_version` came from the removed buildscript `ext`; the Kotlin stdlib is added by the plugin.
    result = result.replace(
        /^[ \t]*(?:implementation|api|compile)\s*\(?\s*["']org\.jetbrains\.kotlin:kotlin-stdlib[^"'\n]*\$\{?kotlin_version\}?["']\s*\)?[ \t]*\r?\n?/gm,
        ''
    );
    result = ensureAppPlugins(result, kts, legacyIds);

    // 2. SDK levels (raise-only), NDK, Java, Kotlin.
    result = normalizeSdkRefs(result, kts, versions);
    result = normalizeNdk(result, kts, versions.ndk, options.flutterNdk, options.ndkFloor ?? versions.ndk);
    result = normalizeCompileOptions(result);
    result = normalizeKotlinOptions(result);

    // 3. Legacy Apache HTTP support (only when the project actually uses it).
    if (options.apacheHttpLegacy && !result.includes('org.apache.http.legacy')) {
        result = insertIntoAndroidBlock(
            result,
            kts ? 'useLibrary("org.apache.http.legacy")' : "useLibrary 'org.apache.http.legacy'"
        );
    }

    // 4. `flutter { source ... }`.
    return ensureFlutterSourceBlock(result, kts);
}

/**
 * Makes sure the app `plugins {}` block lists the Android plugin, Kotlin (when
 * used), any Firebase plugins moved over from `apply plugin:`, and finally the
 * Flutter Gradle plugin (which must come after the Android and Kotlin plugins).
 */
function ensureAppPlugins(content: string, kts: boolean, carriedOver: string[]): string {
    const wanted = [...new Set([
        ANDROID_APPLICATION_PLUGIN,
        ...carriedOver.filter((id) => id !== ANDROID_APPLICATION_PLUGIN),
        FLUTTER_GRADLE_PLUGIN
    ])];
    const ordered = (ids: string[]) => {
        // Android, Kotlin, Firebase, then Flutter last.
        const rank = (id: string) => (id === FLUTTER_GRADLE_PLUGIN ? 3 : id === ANDROID_APPLICATION_PLUGIN ? 0 : /kotlin/.test(id) ? 1 : 2);
        return [...ids].sort((a, b) => rank(a) - rank(b));
    };

    const match = /^([ \t]*)plugins\s*\{/m.exec(content);
    if (!match) {
        const block = `plugins {\n${ordered(wanted).map((id) => `    ${formatPluginId(id, kts)}`).join('\n')}\n}\n\n`;
        const at = afterImports(content);
        return `${content.slice(0, at)}${block}${content.slice(at).trimStart()}`;
    }

    const open = match.index + match[0].lastIndexOf('{');
    const close = findMatchingBrace(content, open);
    if (close === -1) {
        return content;
    }
    const body = content.slice(open + 1, close);
    const missing = wanted.filter((id) => !new RegExp(pluginIdPattern(id)).test(body) &&
        !(id === KOTLIN_APPLY_PLUGIN && body.includes(KOTLIN_ANDROID_PLUGIN)));
    if (missing.length === 0) {
        return content;
    }
    // Existing entries keep their order; missing ones go before the Flutter
    // plugin when it is present, otherwise at the end.
    const additions = ordered(missing);
    const flutterLine = new RegExp(`^[ \\t]*${pluginIdPattern(FLUTTER_GRADLE_PLUGIN)}[^\\n]*$`, 'm').exec(body);
    const rendered = (ids: string[]) => ids.map((id) => `    ${formatPluginId(id, kts)}`).join('\n');
    if (flutterLine && !additions.includes(FLUTTER_GRADLE_PLUGIN)) {
        const at = open + 1 + flutterLine.index;
        return `${content.slice(0, at)}${rendered(additions)}\n${content.slice(at)}`;
    }
    const trimmedBody = body.replace(/\s+$/, '');
    return `${content.slice(0, open + 1)}${trimmedBody}\n${rendered(additions)}\n${content.slice(close)}`;
}

function normalizeCompileOptions(content: string): string {
    let result = content;
    result = result.replace(/JavaVersion\.VERSION_1_8/g, 'JavaVersion.VERSION_17');
    result = result.replace(/JavaVersion\.VERSION_(?:1_7|11)/g, 'JavaVersion.VERSION_17');
    result = result.replace(
        /((?:source|target)Compatibility)(\s*=\s*|\s+)(['"])(?:1\.8|11)\3/g,
        (_m, prop: string, sep: string, quote: string) => `${prop}${sep}${quote}17${quote}`
    );
    return result;
}

function usesKotlinPlugin(content: string): boolean {
    return /["']kotlin-android["']|["']org\.jetbrains\.kotlin\.android["']|kotlin\(\s*["']android["']\s*\)/.test(content);
}

function normalizeKotlinOptions(content: string): string {
    let result = removeKotlinOptionsBlock(content);

    if (!/^[ \t]*kotlin\s*\{/m.test(result)) {
        if (!usesKotlinPlugin(result)) {
            return result;
        }
        const block = [
            'kotlin {',
            '    compilerOptions {',
            '        jvmTarget = org.jetbrains.kotlin.gradle.dsl.JvmTarget.JVM_17',
            '    }',
            '}'
        ].join('\n');
        const pluginsMatch = /^[ \t]*plugins\s*\{/m.exec(result);
        if (pluginsMatch) {
            const closeIdx = findMatchingBrace(result, pluginsMatch.index + pluginsMatch[0].lastIndexOf('{'));
            if (closeIdx !== -1) {
                return `${result.slice(0, closeIdx + 1)}\n\n${block}\n${result.slice(closeIdx + 1)}`;
            }
        }
        return `${block}\n\n${result.trimStart()}`;
    }

    // A top-level kotlin block already exists: normalise any older jvmTarget to 17.
    result = result.replace(
        /(jvmTarget\s*(?:=|\.set\()\s*)(?:org\.jetbrains\.kotlin\.gradle\.dsl\.)?JvmTarget\.(?:fromTarget\(\s*["'](?:1\.8|11)["']\s*\)|JVM_1_8|JVM_11)/g,
        '$1org.jetbrains.kotlin.gradle.dsl.JvmTarget.JVM_17'
    );
    result = result.replace(/(jvmTarget\s*=\s*)(['"])(?:1\.8|11)\2/g, '$1$217$2');
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
        const lineStart = result.lastIndexOf('\n', match.index) + 1;
        const after = result.slice(end + 1).replace(/^[ \t]*\r?\n/, '');
        result = result.slice(0, lineStart) + after;
        match = /\bkotlinOptions\s*\{/.exec(result);
    }
    return result;
}

/**
 * Raises literal compileSdk / targetSdk values to the reference (never lowers
 * them) and puts a floor under `flutter.compileSdkVersion`: plugins built for
 * AGP 9 require compileSdk 37, which is newer than what Flutter's default
 * currently is, and the AAR metadata check fails the build otherwise. Flutter
 * still decides when it is higher. `targetSdk = flutter.targetSdkVersion` and
 * `minSdk` are left alone.
 */
function normalizeSdkRefs(content: string, kts: boolean, versions: MigrationVersions): string {
    let result = content;
    const floored = kts
        ? `maxOf(flutter.compileSdkVersion, ${versions.compileSdk})`
        : `Math.max(flutter.compileSdkVersion, ${versions.compileSdk})`;
    result = result.replace(
        /(\bcompileSdk(?:Version)?\s*(?:=\s*|\s+))flutter\.compileSdkVersion\b/g,
        (_m, pre: string) => `${pre}${floored}`
    );
    const raise = (prop: string, floor: number) => {
        result = result.replace(
            new RegExp(`(\\b${prop}(?:Version)?\\s*(?:=\\s*|\\s+))(\\d+)\\b`, 'g'),
            (_m, pre: string, num: string) => `${pre}${Math.max(parseInt(num, 10), floor)}`
        );
    };
    raise('compileSdk', parseInt(versions.compileSdk, 10));
    raise('targetSdk', parseInt(versions.targetSdk, 10));
    return result;
}

/** Whether an NDK version links native code with 16 KB alignment by default. */
export function ndkSupports16Kb(version: string | undefined): boolean {
    return !!version && compareVersions(version, NDK_16KB_MINIMUM) >= 0;
}

/**
 * Applies the NDK policy to an app build file:
 *  - a literal below `floor` is replaced by `target` (a newer literal stays),
 *  - `flutter.ndkVersion` is kept when the Flutter SDK's NDK is 16 KB capable
 *    (`flutterNdk` >= 28) and pinned to `target` otherwise,
 *  - a missing `ndkVersion` is added, with the same choice.
 */
export function normalizeNdk(
    content: string,
    kts: boolean,
    target: string,
    flutterNdk: string | undefined,
    floor: string
): string {
    let result = content;
    const literal = kts ? `ndkVersion = "${target}"` : `ndkVersion "${target}"`;
    const viaFlutter = kts ? 'ndkVersion = flutter.ndkVersion' : 'ndkVersion flutter.ndkVersion';

    // Literals: raise-only.
    result = result.replace(
        /(ndkVersion\s*=\s*|ndkVersion\s+)(["'])([^"']+)\2/g,
        (_m, pre: string, quote: string, ver: string) =>
            compareVersions(ver, floor) >= 0 ? _m : `${pre}${quote}${target}${quote}`
    );

    // `flutter.ndkVersion` references.
    if (/ndkVersion\s*=?\s*flutter\.ndkVersion/.test(result) && !ndkSupports16Kb(flutterNdk)) {
        result = result.replace(/ndkVersion\s*=?\s*flutter\.ndkVersion/g, literal);
    }

    if (!/\bndkVersion\b/.test(result)) {
        result = insertIntoAndroidBlock(result, ndkSupports16Kb(flutterNdk) ? viaFlutter : literal);
    }
    return result;
}

function ensureFlutterSourceBlock(content: string, kts: boolean): string {
    if (/^[ \t]*flutter\s*\{/m.test(content)) {
        return content;
    }
    const block = kts
        ? '\nflutter {\n    source = "../.."\n}\n'
        : "\nflutter {\n    source '../..'\n}\n";
    return content.trimEnd() + block;
}

/** Reads the app's literal minSdk (`minSdk 24`, `minSdkVersion = 21`), or null when it is Flutter-managed. */
export function readLiteralMinSdk(appBuildContent: string): number | null {
    const m = /\bminSdk(?:Version)?\s*(?:=\s*|\s+)(\d+)\b/.exec(appBuildContent);
    return m ? parseInt(m[1], 10) : null;
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

/** Raises the Gradle distribution to `minimum` when it is older; keeps `-bin`/`-all` and never downgrades. */
export function bumpGradleWrapperMinimum(content: string, minimum: string): string {
    const match = content.match(/distributionUrl=.*gradle-([0-9][0-9a-zA-Z.\-]*?)(?:-(bin|all))?\.zip/);
    if (!match) {
        return updateGradleWrapper(content, minimum);
    }
    if (compareVersions(match[1], minimum) >= 0) {
        return content;
    }
    const flavor = match[2] || 'all';
    return content.replace(
        /distributionUrl=.*/,
        `distributionUrl=https\\://services.gradle.org/distributions/gradle-${minimum}-${flavor}.zip`
    );
}

// ---------------------------------------------------------------------------
// gradle.properties
// ---------------------------------------------------------------------------

/**
 * Flags an AGP 9 + Flutter project needs. The two `false` values are what
 * Flutter's own migrator writes: they keep AGP's built-in Kotlin and new DSL
 * off, because Flutter and many plugins still use `kotlin-android` and the
 * legacy `android {}` extension.
 */
const REQUIRED_GRADLE_PROPERTIES: Array<{ key: string; value: string; comment?: string; force: boolean }> = [
    { key: 'android.useAndroidX', value: 'true', force: false },
    { key: 'android.builtInKotlin', value: 'false', comment: '# This builtInKotlin flag was added by the Flutter migrator', force: true },
    { key: 'android.newDsl', value: 'false', comment: '# This newDsl flag was added by the Flutter migrator', force: true }
];

/**
 * Ensures the AGP 9 flags exist in `gradle.properties` and gives Gradle enough
 * memory when the file sets none. Every other line is left exactly as it was
 * (no machine-specific flags are copied from the reference projects).
 */
export function ensureAgpGradleProperties(content: string): string {
    const eol = /\r\n/.test(content) ? '\r\n' : '\n';
    let lines = content.length ? content.split(/\r?\n/) : [];
    if (lines.length && lines[lines.length - 1] === '') {
        lines.pop();
    }
    const find = (key: string) => lines.findIndex((l) => new RegExp(`^\\s*${escapeRegExp(key)}\\s*=`).test(l));

    for (const prop of REQUIRED_GRADLE_PROPERTIES) {
        const idx = find(prop.key);
        if (idx === -1) {
            if (prop.comment) {
                lines.push(prop.comment);
            }
            lines.push(`${prop.key}=${prop.value}`);
        } else if (prop.force) {
            lines[idx] = `${prop.key}=${prop.value}`;
        }
    }
    if (find('org.gradle.jvmargs') === -1) {
        lines = ['org.gradle.jvmargs=-Xmx4G', ...lines];
    }
    return lines.join(eol) + eol;
}

// ---------------------------------------------------------------------------
// 16 KB page-size transforms
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
 * Never downgrades and never touches `flutter.*` variables or `minSdk`.
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

/**
 * Raises literal `ndkVersion` values to at least `minimum`. `flutter.ndkVersion`
 * references are not literals and are left alone (see `normalizeNdk`).
 */
export function bumpNdkVersion(content: string, minimum: string): string {
    return content.replace(
        /(ndkVersion\s*=\s*|ndkVersion\s+)(["'])([^"']+)\2/g,
        (_m, pre: string, quote: string, ver: string) => `${pre}${quote}${maxVersion(ver, minimum)}${quote}`
    );
}

/**
 * Extracts the declared Android Gradle Plugin version from a `plugins {}`
 * block or a legacy `buildscript` classpath (null when inherited/unknown).
 */
export function getAgpVersion(content: string): string | null {
    const pluginRe =
        /id\s*\(?["']com\.android\.application["']\)?[^\n]*?version\s+["']([^"']+)["']/;
    const pluginMatch = content.match(pluginRe);
    if (pluginMatch) {
        return pluginMatch[1];
    }
    const classpathRe = /classpath\s*\(?\s*["']com\.android\.tools\.build:gradle:([^"']+)["']/;
    const classpathMatch = content.match(classpathRe);
    return classpathMatch ? classpathMatch[1] : null;
}

/**
 * On AGP older than 8.5.1, uncompressed native libraries are not 16 KB
 * zip-aligned, so Google's guide says to package them compressed:
 *
 *   android { packaging { jniLibs { useLegacyPackaging = true } } }
 *
 * (`packagingOptions` on AGP < 8.0.) Do NOT express this with the manifest
 * attribute `android:extractNativeLibs`: AGP 9 fails the build when it is set
 * there. No-op when already present.
 */
export function ensureUseLegacyPackaging(content: string, _kts: boolean, enable: boolean, agpVersion?: string | null): string {
    if (!enable || /useLegacyPackaging\s*(=)?\s*true/.test(content)) {
        return content;
    }
    const block = agpVersion && compareVersions(agpVersion, '8.0.0') < 0 ? 'packagingOptions' : 'packaging';
    const line = `${block} {\n        jniLibs {\n            useLegacyPackaging = true\n        }\n    }`;
    return insertIntoAndroidBlock(content, line);
}

// ---------------------------------------------------------------------------
// AndroidManifest.xml
// ---------------------------------------------------------------------------

/**
 * Removes `android:extractNativeLibs` from the manifest. AGP 9 (and 4.2+
 * lint) reject the attribute with a build error - "Avoid setting
 * android:extractNativeLibs="true" explicitly in AndroidManifest.xml" - and
 * `useLegacyPackaging` in the build script is the supported way to express it.
 * `wasTrue` tells the caller to carry the intent over to the build script.
 */
export function removeExtractNativeLibs(manifestContent: string): { content: string; wasTrue: boolean } {
    const attr = /[ \t]*\r?\n?[ \t]*android:extractNativeLibs="(true|false)"/;
    const match = attr.exec(manifestContent);
    if (!match) {
        return { content: manifestContent, wasTrue: false };
    }
    const tag = /<application\b[^>]*>/i.exec(manifestContent);
    if (!tag || match.index < tag.index || match.index > tag.index + tag[0].length) {
        return { content: manifestContent, wasTrue: false };
    }
    return { content: manifestContent.replace(attr, ''), wasTrue: match[1] === 'true' };
}

// ---------------------------------------------------------------------------
// Detection helpers (pure)
// ---------------------------------------------------------------------------

/** Detects Firebase plugins referenced from the app build.gradle content. */
export function detectFirebaseUsage(appBuildContent: string): FirebaseUsage {
    return {
        googleServices: appBuildContent.includes(GOOGLE_SERVICES_PLUGIN),
        firebasePerf: appBuildContent.includes(FIREBASE_PERF_PLUGIN),
        crashlytics: appBuildContent.includes(CRASHLYTICS_PLUGIN)
    };
}
