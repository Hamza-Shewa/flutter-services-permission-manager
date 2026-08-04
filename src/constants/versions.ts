/**
 * Default fallback versions for Android migration
 */
export const DEFAULT_VERSIONS = {
    agp: "8.13.2",
    kotlin: "2.2.21",
    googleServices: "4.4.4",
    firebasePerf: "1.4.1",
    crashlytics: "2.8.1",
    compileSdk: "37",
    targetSdk: "37",
    minSdk: "21",
    // Gradle distribution used by the full declarative migration.
    gradle: "8.14.3",
    // NDK r27 — first NDK with 16 KB page-size alignment enabled by default.
    ndk: "27.1.12297006"
} as const;

/**
 * Minimum versions required for Android 15+ 16 KB page-size compatibility.
 *
 * Values follow the official Android guide
 * (https://developer.android.com/guide/practices/page-sizes#update-packaging):
 *  - AGP 8.5.1+ aligns uncompressed shared libraries to a 16 KB zip boundary,
 *  - NDK r28+ compiles 16 KB-aligned ELF segments by default (r27 and lower
 *    require manual linker flags, which a migration cannot reliably apply).
 *
 * Used by the safe "16 KB page size only" migration so projects that still
 * depend on outdated/legacy packages are NOT forced onto the full declarative
 * Gradle setup — they only get the minimal changes required to pass Play Store
 * 16 KB checks.
 */
export const SIXTEEN_KB_MINIMUMS = {
    // AGP 8.5.1+ aligns native libraries to 16 KB page sizes by default.
    agp: "8.5.2",
    // targetSdk 35 (Android 15) is where 16 KB page-size enforcement begins.
    compileSdk: "35",
    targetSdk: "35",
    // AGP 8.5.2 requires Gradle 8.7+.
    gradle: "8.7",
    // NDK r28 — compiles 16 KB-aligned ELF segments by default.
    ndk: "28.0.12433566"
} as const;

/**
 * Minimum plugin versions the FULL migration guarantees when a `plugins {}`
 * block already exists. Versions at/above these are left untouched — forcing
 * newer patch versions onto a project that already builds is what breaks
 * otherwise-working projects (e.g. kotlin-stdlib not found, or the Flutter
 * embedding not being wired up after blindly bumping Kotlin/AGP).
 */
export const MIGRATION_MINIMUMS = {
    agp: "8.5.2",
    kotlin: "2.0.0"
} as const;
