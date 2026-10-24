/**
 * Reads the SDK levels that decide which permission variants apply:
 * Android minSdk / targetSdk / compileSdk from app/build.gradle(.kts) (Groovy
 * and Kotlin DSL, literal values, `flutter.*SdkVersion` resolved from the
 * Flutter SDK, `maxOf(...)`), the AGP / Gradle versions for display, and the
 * iOS deployment target from the Podfile or project.pbxproj.
 *
 * vscode-free (uses `fs` only) so the MCP server can import it from `out/`.
 */

import * as fs from 'fs';
import * as path from 'path';
import { detectGradleLayout } from '../migration/migration-core.js';
import { getAgpVersion } from '../migration/migration-transforms.js';
import { extractPodfileMacroNames } from '../../core/platform/ios/podfile-macros.js';

export type SdkLevelName = 'minSdk' | 'targetSdk' | 'compileSdk';

export interface SdkLevel {
    value?: number;
    /** The expression as written (`26`, `flutter.minSdkVersion`, `maxOf(flutter.compileSdkVersion, 36)`). */
    expression?: string;
    /** Where the value came from. */
    source?: string;
}

export interface AndroidProjectFacts {
    minSdk: SdkLevel;
    targetSdk: SdkLevel;
    compileSdk: SdkLevel;
    agpVersion?: string;
    gradleVersion?: string;
    buildFile?: string;
    kotlinDsl?: boolean;
    /** `android:requestLegacyExternalStorage="true"` on <application>. */
    requestLegacyExternalStorage?: boolean;
}

export interface IOSProjectFacts {
    deploymentTarget?: string;
    deploymentTargetSource?: string;
    hasPodfile: boolean;
    /** permission_handler macros currently in the Podfile. */
    podfileMacros: string[];
}

export interface ProjectPermissionFacts {
    android?: AndroidProjectFacts;
    ios?: IOSProjectFacts;
}

function readIfExists(file: string): string | undefined {
    try {
        return fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : undefined;
    } catch {
        return undefined;
    }
}

/** `flutter.minSdkVersion` & co. as defined by the Flutter SDK named in local.properties. */
export function readFlutterSdkDefaults(androidDir: string): Partial<Record<SdkLevelName, number>> {
    const localProperties = readIfExists(path.join(androidDir, 'local.properties'));
    const raw = localProperties && /^\s*flutter\.sdk\s*=\s*(.+)$/m.exec(localProperties)?.[1].trim();
    if (!raw) {
        return {};
    }
    const sdk = raw.replace(/\\(.)/g, '$1');
    const gradleDir = path.join(sdk, 'packages', 'flutter_tools', 'gradle');
    const candidates = [
        path.join(gradleDir, 'src', 'main', 'kotlin', 'FlutterExtension.kt'),
        path.join(gradleDir, 'src', 'main', 'groovy', 'FlutterExtension.groovy'),
        path.join(gradleDir, 'src', 'main', 'groovy', 'flutter.groovy'),
    ];
    const result: Partial<Record<SdkLevelName, number>> = {};
    for (const file of candidates) {
        const content = readIfExists(file);
        if (!content) {
            continue;
        }
        for (const [name, property] of [['minSdk', 'minSdkVersion'], ['targetSdk', 'targetSdkVersion'], ['compileSdk', 'compileSdkVersion']] as const) {
            const match = new RegExp(`\\b${property}\\b[^=\\n]*=\\s*(\\d+)`).exec(content);
            if (match && result[name] === undefined) {
                result[name] = parseInt(match[1], 10);
            }
        }
    }
    return result;
}

/** Evaluates a Gradle SDK expression: literals, `flutter.*SdkVersion`, `maxOf`/`Math.max`/`minOf`/`Math.min`. */
export function evaluateSdkExpression(expression: string, flutterDefaults: Partial<Record<SdkLevelName, number>>): number | undefined {
    const text = expression.trim().replace(/;$/, '');
    if (/^\d+$/.test(text)) {
        return parseInt(text, 10);
    }
    const flutter = /^flutter\.(minSdkVersion|targetSdkVersion|compileSdkVersion)$/.exec(text);
    if (flutter) {
        const key = flutter[1].replace('Version', '') as SdkLevelName;
        return flutterDefaults[key];
    }
    const call = /^(maxOf|minOf|Math\.max|Math\.min)\s*\(([\s\S]*)\)$/.exec(text);
    if (call) {
        const values = call[2].split(',').map(part => evaluateSdkExpression(part, flutterDefaults));
        if (values.some(value => value === undefined)) {
            const known = values.filter((value): value is number => value !== undefined);
            // maxOf(x, 36) with an unknown x is at least 36.
            return /max/i.test(call[1]) && known.length > 0 ? Math.max(...known) : undefined;
        }
        return /max/i.test(call[1]) ? Math.max(...(values as number[])) : Math.min(...(values as number[]));
    }
    return undefined;
}

/** The raw expressions for minSdk / targetSdk / compileSdk in an app build file (Groovy or Kotlin DSL). */
export function readGradleSdkExpressions(content: string): Partial<Record<SdkLevelName, string>> {
    const stripped = content.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    const result: Partial<Record<SdkLevelName, string>> = {};
    for (const name of ['minSdk', 'targetSdk', 'compileSdk'] as const) {
        // `minSdk = 26`, `minSdkVersion 26`, `minSdkVersion(26)`, `compileSdk = maxOf(flutter.compileSdkVersion, 36)`
        const regex = new RegExp(`\\b${name}(?:Version)?\\b[ \\t]*(=|\\(|[ \\t])[ \\t]*([^\\n]+)`);
        const match = regex.exec(stripped);
        if (!match) {
            continue;
        }
        let expression = match[2].replace(/\s*\/\/.*$/, '').trim();
        if (match[1] === '(') {
            // Call form `minSdkVersion(26)`: keep what is inside the balanced parentheses.
            let depth = 1;
            let end = 0;
            for (; end < expression.length && depth > 0; end++) {
                if (expression[end] === '(') {
                    depth++;
                } else if (expression[end] === ')') {
                    depth--;
                }
            }
            expression = expression.slice(0, depth === 0 ? end - 1 : end).trim();
        } else {
            expression = expression.replace(/[\s}]+$/, '').trim();
        }
        result[name] = expression;
    }
    return result;
}

function readAndroidFacts(projectRoot: string): AndroidProjectFacts | undefined {
    const androidDir = path.join(projectRoot, 'android');
    if (!fs.existsSync(androidDir)) {
        return undefined;
    }
    const layout = detectGradleLayout(androidDir);
    const facts: AndroidProjectFacts = { minSdk: {}, targetSdk: {}, compileSdk: {} };
    const appBuild = layout.appBuild ? readIfExists(layout.appBuild.filePath) : undefined;
    if (layout.appBuild && appBuild !== undefined) {
        facts.buildFile = path.relative(projectRoot, layout.appBuild.filePath).split(path.sep).join('/');
        facts.kotlinDsl = layout.appBuild.kts;
        const expressions = readGradleSdkExpressions(appBuild);
        const needsFlutter = Object.values(expressions).some(expression => /flutter\./.test(expression ?? ''));
        const flutterDefaults = needsFlutter ? readFlutterSdkDefaults(androidDir) : {};
        for (const name of ['minSdk', 'targetSdk', 'compileSdk'] as const) {
            const expression = expressions[name];
            if (!expression) {
                continue;
            }
            facts[name] = {
                expression,
                value: evaluateSdkExpression(expression, flutterDefaults),
                source: /flutter\./.test(expression) ? `${facts.buildFile} + Flutter SDK defaults` : facts.buildFile,
            };
        }
    }
    for (const file of [layout.settings, layout.projectBuild]) {
        const content = file ? readIfExists(file.filePath) : undefined;
        const agp = content ? getAgpVersion(content) : null;
        if (agp) {
            facts.agpVersion = agp;
            break;
        }
    }
    const wrapper = layout.wrapperPath ? readIfExists(layout.wrapperPath) : undefined;
    const gradle = wrapper && /gradle-([0-9][^/\s]*?)-(?:all|bin)\.zip/.exec(wrapper);
    if (gradle) {
        facts.gradleVersion = gradle[1];
    }
    const manifest = layout.manifestPath ? readIfExists(layout.manifestPath) : undefined;
    if (manifest) {
        facts.requestLegacyExternalStorage = /android:requestLegacyExternalStorage\s*=\s*"true"/.test(manifest);
    }
    return facts;
}

function readIOSFacts(projectRoot: string): IOSProjectFacts | undefined {
    const iosDir = path.join(projectRoot, 'ios');
    if (!fs.existsSync(iosDir)) {
        return undefined;
    }
    const podfile = readIfExists(path.join(iosDir, 'Podfile'));
    const facts: IOSProjectFacts = { hasPodfile: podfile !== undefined, podfileMacros: podfile ? extractPodfileMacroNames(podfile) : [] };
    const platform = podfile && /^\s*platform\s*:ios\s*,\s*['"]([^'"]+)['"]/m.exec(podfile);
    if (platform) {
        facts.deploymentTarget = platform[1];
        facts.deploymentTargetSource = 'ios/Podfile';
        return facts;
    }
    const pbxproj = readIfExists(path.join(iosDir, 'Runner.xcodeproj', 'project.pbxproj'));
    const targets = pbxproj ? [...pbxproj.matchAll(/IPHONEOS_DEPLOYMENT_TARGET\s*=\s*"?([0-9.]+)"?\s*;/g)].map(match => match[1]) : [];
    if (targets.length > 0) {
        // The highest value is the one the app target can rely on.
        facts.deploymentTarget = targets.sort(compareOsVersions).pop();
        facts.deploymentTargetSource = 'ios/Runner.xcodeproj/project.pbxproj';
    }
    return facts;
}

/** Compares dotted OS versions ("13.0" < "16.6" < "26.0"). */
export function compareOsVersions(a: string, b: string): number {
    const pa = a.split('.').map(part => parseInt(part, 10) || 0);
    const pb = b.split('.').map(part => parseInt(part, 10) || 0);
    for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
        const diff = (pa[i] ?? 0) - (pb[i] ?? 0);
        if (diff !== 0) {
            return diff;
        }
    }
    return 0;
}

/** SDK facts for a Flutter project root (the folder holding pubspec.yaml). */
export function readProjectPermissionFacts(projectRoot: string): ProjectPermissionFacts {
    return {
        android: readAndroidFacts(projectRoot),
        ios: readIOSFacts(projectRoot),
    };
}
