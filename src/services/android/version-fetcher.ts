import * as https from 'https';
import { DEFAULT_VERSIONS } from '../../constants/versions.js';
import { logger, toError } from '../../shared/index.js';

interface DependenciesVersions {
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

/**
 * Guards against recommending an AGP from a different major line than the one
 * the current Flutter tooling is validated against (e.g. a freshly released
 * AGP 9.x would break existing Flutter Gradle projects). Falls back to the
 * pinned default when the fetched version is on a different major.
 */
function compatibleAgp(fetched: string | null): string {
    if (!fetched) {
        return DEFAULT_VERSIONS.agp;
    }
    const fetchedMajor = parseInt(fetched.split('.')[0], 10);
    const pinnedMajor = parseInt(DEFAULT_VERSIONS.agp.split('.')[0], 10);
    return fetchedMajor === pinnedMajor ? fetched : DEFAULT_VERSIONS.agp;
}

/**
 * Fetches the latest version of a package from Maven repository.
 */
function fetchLatestVersionFromMaven(url: string, timeoutMs = 2000): Promise<string | null> {
    return new Promise((resolve) => {
        const req = https.get(url, (res) => {
            if (res.statusCode !== 200) {
                resolve(null);
                return;
            }

            let data = '';
            res.on('data', (chunk) => {
                data += chunk;
            });

            res.on('end', () => {
                const match = data.match(/<latest>(.*?)<\/latest>/);
                if (match && match[1]) {
                    resolve(match[1]);
                } else {
                    resolve(null);
                }
            });
        });

        req.on('error', () => {
            resolve(null);
        });

        req.setTimeout(timeoutMs, () => {
            req.destroy();
            resolve(null);
        });
    });
}

/**
 * Retrieves the recommended versions for the Android migration.
 * Attempts to fetch latest versions from Google Maven, falling back to defaults.
 */
export async function getRecommendedVersions(): Promise<DependenciesVersions> {
    try {
        const [agp, googleServices, firebasePerf, crashlytics] = await Promise.all([
            fetchLatestVersionFromMaven('https://dl.google.com/dl/android/maven2/com/android/application/com.android.application.gradle.plugin/maven-metadata.xml'),
            fetchLatestVersionFromMaven('https://dl.google.com/dl/android/maven2/com/google/gms/google-services/maven-metadata.xml'),
            fetchLatestVersionFromMaven('https://dl.google.com/dl/android/maven2/com/google/firebase/firebase-perf/maven-metadata.xml'),
            fetchLatestVersionFromMaven('https://dl.google.com/dl/android/maven2/com/google/firebase/firebase-crashlytics-gradle/maven-metadata.xml')
        ]);

        return {
            agp: compatibleAgp(agp),
            // Kotlin and SDK versions are usually tied to the Flutter release, so defaults are safer
            kotlin: DEFAULT_VERSIONS.kotlin,
            googleServices: googleServices || DEFAULT_VERSIONS.googleServices,
            firebasePerf: firebasePerf || DEFAULT_VERSIONS.firebasePerf,
            crashlytics: crashlytics || DEFAULT_VERSIONS.crashlytics,
            compileSdk: DEFAULT_VERSIONS.compileSdk,
            targetSdk: DEFAULT_VERSIONS.targetSdk,
            minSdk: DEFAULT_VERSIONS.minSdk,
            gradle: DEFAULT_VERSIONS.gradle,
            ndk: DEFAULT_VERSIONS.ndk
        };
    } catch (e) {
        logger.error("Failed to fetch versions, using defaults:", toError(e));
        return { ...DEFAULT_VERSIONS };
    }
}
