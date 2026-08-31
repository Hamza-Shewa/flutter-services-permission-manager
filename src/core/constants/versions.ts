/**
 * Default fallback versions for Android migration.
 *
 * Mirrors the masaken reference project configuration:
 *  - AGP 9.3.1, Kotlin 2.4.10, google-services 4.5.0
 *  - compileSdk / targetSdk 37, minSdk 26
 *  - Gradle 9.5.1, NDK 29.0.14206865
 */
export const DEFAULT_VERSIONS = {
    agp: "9.3.1",
    kotlin: "2.4.10",
    googleServices: "4.5.0",
    firebasePerf: "2.0.2",
    crashlytics: "3.0.7",
    compileSdk: "37",
    targetSdk: "37",
    minSdk: "26",
    // Gradle distribution used by the full declarative migration.
    gradle: "9.5.1",
    // NDK 29.0.14206865 — the version used by the masaken reference project.
    ndk: "29.0.14206865"
} as const;

/**
 * The 16 KB page-size fallback migration now ONLY updates the NDK version to
 * the masaken reference value (29.0.14206865). All other 16 KB steps (AGP /
 * SDK bumps, useLegacyPackaging, wrapper, extractNativeLibs) were removed per
 * product decision — the 16 KB button is a lightweight, non-destructive NDK
 * alignment helper.
 */
export const SIXTEEN_KB_MINIMUMS = {
    // NDK 29.0.14206865 — the masaken reference NDK.
    ndk: "29.0.14206865"
} as const;

/**
 * Minimum plugin versions the FULL migration guarantees when a `plugins {}`
 * block already exists. Versions at/above these are left untouched — forcing
 * newer patch versions onto a project that already builds is what breaks
 * otherwise-working projects (e.g. kotlin-stdlib not found, or the Flutter
 * embedding not being wired up after blindly bumping Kotlin/AGP).
 */
export const MIGRATION_MINIMUMS = {
    agp: "9.3.1",
    kotlin: "2.4.10",
    googleServices: "4.5.0"
} as const;
