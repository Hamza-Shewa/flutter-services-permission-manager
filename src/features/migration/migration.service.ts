import * as path from 'path';
import * as fs from 'fs';
import * as vscode from 'vscode';
import { getRecommendedVersions } from '../build/version-fetcher.js';
import { DEFAULT_VERSIONS, MIGRATION_MINIMUMS, SIXTEEN_KB_MINIMUMS } from '../../core/constants/versions.js';
import { logger } from '../../core/shared/index.js';
import { compareVersions, isPrerelease, type MigrationVersions } from './migration-transforms.js';
import { runFullMigration, run16kbMigration, type MigrationReport } from './migration-core.js';

export type { MigrationReport } from './migration-core.js';

function getAndroidDir(): string {
    const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    if (!workspaceRoot) {
        throw new Error('No workspace root found');
    }
    const androidDir = path.join(workspaceRoot, 'android');
    if (!fs.existsSync(androidDir)) {
        throw new Error('No android directory found in the workspace');
    }
    return androidDir;
}

/**
 * A fetched plugin version is used only when it is a stable release at or
 * above the reference; the "latest" entry in Maven metadata can be an alpha.
 */
function stableAtLeast(fetched: string | undefined, reference: string): string {
    if (!fetched || isPrerelease(fetched) || compareVersions(fetched, reference) < 0) {
        return reference;
    }
    return fetched;
}

/** Reference versions, with the Firebase plugin versions refreshed from Google Maven when a stable newer one exists. */
async function resolveVersions(): Promise<MigrationVersions> {
    const remote = await getRecommendedVersions().catch((error) => {
        logger.warn('Version lookup failed, using reference versions', { error: String(error) });
        return { ...DEFAULT_VERSIONS };
    });
    return {
        ...DEFAULT_VERSIONS,
        // AGP, Kotlin and Gradle stay on the reference: they are tied to the Flutter release.
        agp: MIGRATION_MINIMUMS.agp,
        kotlin: MIGRATION_MINIMUMS.kotlin,
        googleServices: stableAtLeast(remote.googleServices, MIGRATION_MINIMUMS.googleServices),
        firebasePerf: stableAtLeast(remote.firebasePerf, DEFAULT_VERSIONS.firebasePerf),
        crashlytics: stableAtLeast(remote.crashlytics, DEFAULT_VERSIONS.crashlytics)
    };
}

/**
 * Migrates the workspace's Android project to the AGP 9 declarative setup
 * (see `runFullMigration`). Works with Groovy and Kotlin DSL projects and
 * runs identically on Windows, Linux and macOS (pure fs/path manipulation).
 */
export async function migrateAndroidSetup(): Promise<MigrationReport> {
    const androidDir = getAndroidDir();
    return runFullMigration(androidDir, await resolveVersions());
}

/** Makes the workspace's Android project 16 KB page-size compatible (see `run16kbMigration`). */
export async function migrateAndroid16kbSetup(): Promise<MigrationReport> {
    return run16kbMigration(getAndroidDir(), SIXTEEN_KB_MINIMUMS.ndk);
}
