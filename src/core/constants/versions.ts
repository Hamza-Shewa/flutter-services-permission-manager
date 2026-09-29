/**
 * Reference versions for the Android migrations.
 *
 * Taken from the two reference projects the migration output is validated
 * against with a real Gradle build:
 *  - masaken (Groovy): AGP 9.3.1, Kotlin 2.4.10, google-services 4.5.0,
 *    Gradle 9.5.1, compileSdk/targetSdk 37, NDK 29.0.14206865
 *  - mishkat (Kotlin DSL): AGP 9.x, Gradle 9.6.0
 *
 * The migration only ever RAISES a project to these values.
 */
export const DEFAULT_VERSIONS = {
    agp: "9.3.1",
    kotlin: "2.4.10",
    googleServices: "4.5.0",
    firebasePerf: "2.0.2",
    crashlytics: "3.0.7",
    compileSdk: "37",
    targetSdk: "37",
    // Seed for the legacy `ext` values only (Flutter's own default); the migration never changes an app's minSdk.
    minSdk: "24",
    gradle: "9.5.1",
    ndk: "29.0.14206865"
} as const;

/**
 * NDK the 16 KB page-size migration pins when the project's NDK is below r28
 * (r28+ links native code with 16 KB ELF alignment by default).
 */
export const SIXTEEN_KB_MINIMUMS = {
    ndk: "29.0.14206865"
} as const;

/**
 * Plugin versions the full migration will not go below. AGP and Kotlin are
 * exact references: a project already on newer versions keeps them.
 */
export const MIGRATION_MINIMUMS = {
    agp: "9.3.1",
    kotlin: "2.4.10",
    googleServices: "4.5.0"
} as const;
