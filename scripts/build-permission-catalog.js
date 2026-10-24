#!/usr/bin/env node
'use strict';

/**
 * build-permission-catalog.js
 *
 * Generates src/categorized-android-permissions.json and
 * src/categorized-ios-permissions.json from the sources in
 * src/permission-sources/. Never edit the two catalogs by hand: edit the
 * overlays and run `npm run catalog:build`.
 *
 * Sources (all committed, so CI can regenerate without an Android SDK):
 *   android-sdk-permissions.json   Manifest.permission + HealthPermissions fields with their
 *                                  API levels, from the SDK's data/api-versions.xml.
 *   android-protection-levels.json protectionLevel / permissionGroup per permission, from AOSP
 *                                  frameworks/base/core/res/AndroidManifest.xml.
 *   android-overlay.json           curated: descriptions (from developer.android.com), categories,
 *                                  audience, SDK-gated variants, successors, pairs, Play policy
 *                                  notes and vendor permissions.
 *   ios-apple-keys.json            Apple documentation data per Info.plist key (abstract, value
 *                                  type, introduced/deprecated releases).
 *   ios-overlay.json               curated: which keys are in the catalog, categories,
 *                                  permission_handler Podfile macros, successors and pairs.
 *
 * Usage:
 *   node scripts/build-permission-catalog.js            regenerate both catalogs
 *   node scripts/build-permission-catalog.js --check    exit 1 when the committed catalogs are stale
 *   node scripts/build-permission-catalog.js --sdk <platform dir>
 *        refresh android-sdk-permissions.json from <platform dir>/data/api-versions.xml
 *        (e.g. $ANDROID_HOME/platforms/android-37.0)
 *   node scripts/build-permission-catalog.js --aosp-manifest <AndroidManifest.xml>
 *        refresh android-protection-levels.json from an AOSP core manifest
 *   node scripts/build-permission-catalog.js --fetch-apple
 *        refresh ios-apple-keys.json from developer.apple.com (one request per key)
 *
 * The refresh options rewrite the source file, then regenerate the catalogs.
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const SOURCES_DIR = path.join(ROOT, 'src', 'permission-sources');
const ANDROID_CATALOG = path.join(ROOT, 'src', 'categorized-android-permissions.json');
const IOS_CATALOG = path.join(ROOT, 'src', 'categorized-ios-permissions.json');

function readJson(file) {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function serialize(value) {
    return `${JSON.stringify(value, null, 2)}\n`;
}

function loadSources(dir = SOURCES_DIR) {
    return {
        sdk: readJson(path.join(dir, 'android-sdk-permissions.json')),
        protection: readJson(path.join(dir, 'android-protection-levels.json')),
        androidOverlay: readJson(path.join(dir, 'android-overlay.json')),
        appleKeys: readJson(path.join(dir, 'ios-apple-keys.json')),
        iosOverlay: readJson(path.join(dir, 'ios-overlay.json')),
    };
}

// ---------------------------------------------------------------------------
// Android
// ---------------------------------------------------------------------------

function apiLevel(since) {
    return Math.floor(parseFloat(since));
}

function optionalInt(value) {
    return value === null || value === undefined ? undefined : apiLevel(value);
}

/** `app` when a third-party app can be granted it: normal, dangerous or app-op permissions. */
function deriveAudience(protectionLevel) {
    const flags = String(protectionLevel || '').split('|');
    return flags.includes('normal') || flags.includes('dangerous') || flags.includes('appop') ? 'app' : 'system';
}

/** Copies only defined values, in a fixed key order, so the output is stable. */
function compact(entry) {
    const order = [
        'permission', 'constantValue', 'description', 'category', 'protectionLevel', 'permissionGroup',
        'apiLevel', 'apiLevelExact', 'deprecatedIn', 'removedIn', 'audience', 'source',
        'replacedBy', 'recommended', 'pairsWith', 'playPolicy',
    ];
    const result = {};
    for (const key of order) {
        const value = entry[key];
        if (value === undefined || value === null || (Array.isArray(value) && value.length === 0)) {
            continue;
        }
        result[key] = value;
    }
    return result;
}

function curated(overlayEntry) {
    const pick = {};
    for (const key of ['replacedBy', 'recommended', 'pairsWith', 'playPolicy']) {
        if (overlayEntry[key] !== undefined) {
            pick[key] = overlayEntry[key];
        }
    }
    return pick;
}

function groupByCategory(entries, categoryOrder, label) {
    const known = new Set(categoryOrder);
    const grouped = {};
    for (const category of categoryOrder) {
        grouped[category] = [];
    }
    for (const entry of entries) {
        if (!known.has(entry.category)) {
            throw new Error(`${label}: ${entry.permission} has category "${entry.category}" which is not in the allow-list`);
        }
        grouped[entry.category].push(entry);
    }
    for (const category of categoryOrder) {
        grouped[category].sort((a, b) => a.permission.localeCompare(b.permission));
        if (grouped[category].length === 0) {
            delete grouped[category];
        }
    }
    return grouped;
}

function buildAndroidCatalog(sources) {
    const { sdk, protection, androidOverlay } = sources;
    const overlay = androidOverlay.permissions || {};
    const entries = [];
    const seen = new Set();

    const add = (entry) => {
        if (seen.has(entry.constantValue)) {
            throw new Error(`duplicate Android permission ${entry.constantValue}`);
        }
        seen.add(entry.constantValue);
        entries.push(compact(entry));
    };

    for (const field of sdk.manifest) {
        const constantValue = (protection.constantValues || {})[field.name] || `android.permission.${field.name}`;
        const extra = overlay[constantValue] || {};
        const aosp = (protection.permissions || {})[constantValue] || {};
        const protectionLevel = extra.protectionLevel || aosp.protectionLevel || 'unknown';
        const removedIn = optionalInt(field.removed);
        add({
            permission: field.name,
            constantValue,
            description: extra.description || (removedIn ? `Removed from the public SDK in API level ${removedIn}.` : ''),
            category: extra.category || 'Other',
            protectionLevel,
            permissionGroup: extra.permissionGroup || aosp.permissionGroup,
            apiLevel: apiLevel(field.since),
            apiLevelExact: String(field.since).includes('.') ? String(field.since) : undefined,
            deprecatedIn: optionalInt(field.deprecated),
            removedIn,
            audience: extra.audience || deriveAudience(protectionLevel),
            source: 'android',
            ...curated(extra),
        });
    }

    for (const field of sdk.health || []) {
        const constantValue = `android.permission.health.${field.name}`;
        const extra = overlay[constantValue] || {};
        const protectionLevel = extra.protectionLevel || 'dangerous';
        add({
            permission: `health.${field.name}`,
            constantValue,
            description: extra.description || '',
            category: extra.category || 'Health Connect',
            protectionLevel,
            permissionGroup: extra.permissionGroup,
            apiLevel: apiLevel(field.since),
            apiLevelExact: String(field.since).includes('.') ? String(field.since) : undefined,
            deprecatedIn: optionalInt(field.deprecated),
            removedIn: optionalInt(field.removed),
            audience: extra.audience || deriveAudience(protectionLevel),
            source: 'health',
            ...curated(extra),
        });
    }

    for (const vendor of androidOverlay.vendor || []) {
        add({
            permission: vendor.permission || vendor.constantValue,
            constantValue: vendor.constantValue,
            description: vendor.description,
            category: vendor.category || 'Vendor',
            protectionLevel: vendor.protectionLevel || 'normal',
            permissionGroup: vendor.permissionGroup,
            apiLevel: vendor.apiLevel || 1,
            audience: vendor.audience || 'app',
            source: 'vendor',
            ...curated(vendor),
        });
    }

    for (const key of Object.keys(overlay)) {
        if (!seen.has(key)) {
            throw new Error(`android-overlay.json describes ${key}, which is not in the SDK data`);
        }
    }

    return groupByCategory(entries, androidOverlay.categories, 'Android');
}

// ---------------------------------------------------------------------------
// iOS
// ---------------------------------------------------------------------------

function buildIosCatalog(sources) {
    const { appleKeys, iosOverlay } = sources;
    const entries = [];
    for (const [key, extra] of Object.entries(iosOverlay.keys)) {
        const apple = appleKeys[key];
        if (!apple) {
            throw new Error(`ios-overlay.json lists ${key}, which is not in ios-apple-keys.json (Apple documentation)`);
        }
        const ios = (apple.platforms || {}).iOS || {};
        const mac = (apple.platforms || {}).macOS || {};
        const entry = {
            permission: key,
            description: extra.description || apple.abstract,
            type: extra.type || apple.type,
            category: extra.category,
            minOS: ios.introducedAt,
            minMacOS: mac.introducedAt,
            deprecatedInOS: ios.deprecatedAt,
            replacedBy: extra.replacedBy,
            pairsWith: extra.pairsWith,
            podfileMacro: extra.podfileMacro,
        };
        const result = {};
        for (const [name, value] of Object.entries(entry)) {
            if (value !== undefined && value !== null && !(Array.isArray(value) && value.length === 0)) {
                result[name] = value;
            }
        }
        entries.push(result);
    }
    return groupByCategory(entries, iosOverlay.categories, 'iOS');
}

// ---------------------------------------------------------------------------
// Source refresh
// ---------------------------------------------------------------------------

function classFields(xml, className) {
    const start = xml.indexOf(`<class name="${className}"`);
    if (start === -1) {
        throw new Error(`class ${className} not found in api-versions.xml`);
    }
    const end = xml.indexOf('</class>', start);
    const block = xml.slice(start, end);
    const classSince = (/^<class [^>]*\bsince="([0-9.]+)"/.exec(block) || [])[1] || '1';
    const fields = [];
    for (const match of block.matchAll(/<field name="([A-Z0-9_]+)"([^>]*?)\/>/g)) {
        const attr = (name) => {
            const found = new RegExp(`\\b${name}="([0-9.]+)"`).exec(match[2]);
            return found ? found[1] : null;
        };
        fields.push({ name: match[1], since: attr('since') || classSince, deprecated: attr('deprecated'), removed: attr('removed') });
    }
    return fields.sort((a, b) => a.name.localeCompare(b.name));
}

function refreshSdk(platformDir) {
    const xml = fs.readFileSync(path.join(platformDir, 'data', 'api-versions.xml'), 'utf8');
    const data = {
        platform: path.basename(path.resolve(platformDir)),
        manifest: classFields(xml, 'android/Manifest$permission'),
        health: classFields(xml, 'android/health/connect/HealthPermissions').map(({ name, since, deprecated, removed }) => ({ name, since, deprecated, removed })),
    };
    fs.writeFileSync(path.join(SOURCES_DIR, 'android-sdk-permissions.json'), serialize(data));
    console.log(`android-sdk-permissions.json: ${data.manifest.length} Manifest.permission fields, ${data.health.length} HealthPermissions fields (${data.platform})`);
}

function refreshProtection(manifestPath) {
    const xml = fs.readFileSync(manifestPath, 'utf8');
    const sdk = readJson(path.join(SOURCES_DIR, 'android-sdk-permissions.json'));
    const all = {};
    for (const match of xml.matchAll(/<permission\b([\s\S]*?)\/>/g)) {
        const attr = (name) => {
            const found = new RegExp(`${name}="([^"]*)"`).exec(match[1]);
            return found ? found[1] : undefined;
        };
        const name = attr('android:name');
        if (name) {
            all[name] = { protectionLevel: attr('android:protectionLevel'), permissionGroup: attr('android:permissionGroup') };
        }
    }
    const constantValues = {};
    const permissions = {};
    for (const field of sdk.manifest) {
        let constantValue = `android.permission.${field.name}`;
        if (!all[constantValue]) {
            const vendorName = Object.keys(all).find(name => name.startsWith('com.android.') && name.endsWith(`.permission.${field.name}`));
            if (vendorName) {
                constantValue = vendorName;
                constantValues[field.name] = vendorName;
            }
        }
        const found = all[constantValue];
        if (found && found.protectionLevel) {
            const entry = { protectionLevel: found.protectionLevel };
            if (found.permissionGroup && found.permissionGroup !== 'android.permission-group.UNDEFINED') {
                entry.permissionGroup = found.permissionGroup;
            }
            permissions[constantValue] = entry;
        }
    }
    const sorted = (object) => Object.fromEntries(Object.keys(object).sort().map(key => [key, object[key]]));
    const data = {
        source: 'AOSP frameworks/base/core/res/AndroidManifest.xml',
        constantValues: sorted(constantValues),
        permissions: sorted(permissions),
    };
    fs.writeFileSync(path.join(SOURCES_DIR, 'android-protection-levels.json'), serialize(data));
    console.log(`android-protection-levels.json: ${Object.keys(permissions).length} protection levels`);
}

function appleTypeOf(details) {
    const value = ((details || {}).value || [])[0] || {};
    const base = String(value.baseType || 'string').trim();
    if (value.arrayMode) {
        return 'array';
    }
    if (base === 'dictionary' || base === 'boolean') {
        return base;
    }
    return 'string';
}

async function refreshApple() {
    const overlay = readJson(path.join(SOURCES_DIR, 'ios-overlay.json'));
    const keys = Object.keys(overlay.keys).concat(overlay.extraAppleKeys || []);
    const result = {};
    for (const key of [...new Set(keys)].sort()) {
        const url = `https://developer.apple.com/tutorials/data/documentation/bundleresources/information-property-list/${key.toLowerCase()}.json`;
        const response = await fetch(url);
        if (!response.ok) {
            console.warn(`skip ${key}: HTTP ${response.status} (not documented by Apple)`);
            continue;
        }
        const doc = await response.json();
        const platforms = {};
        for (const platform of (doc.metadata || {}).platforms || []) {
            if (platform.name === 'iOS' || platform.name === 'macOS') {
                platforms[platform.name] = {};
                if (platform.introducedAt) {
                    platforms[platform.name].introducedAt = platform.introducedAt;
                }
                if (platform.deprecatedAt) {
                    platforms[platform.name].deprecatedAt = platform.deprecatedAt;
                }
            }
        }
        const details = ((doc.primaryContentSections || []).find(section => section.details) || {}).details;
        result[key] = {
            abstract: (doc.abstract || []).map(part => part.text || part.code || '').join('').trim(),
            type: appleTypeOf(details),
            platforms,
        };
    }
    fs.writeFileSync(path.join(SOURCES_DIR, 'ios-apple-keys.json'), serialize(result));
    console.log(`ios-apple-keys.json: ${Object.keys(result).length} keys`);
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

function generate() {
    const sources = loadSources();
    return {
        android: serialize(buildAndroidCatalog(sources)),
        ios: serialize(buildIosCatalog(sources)),
    };
}

async function main(argv) {
    const option = (name) => {
        const index = argv.indexOf(name);
        return index === -1 ? undefined : argv[index + 1];
    };
    if (option('--sdk')) {
        refreshSdk(option('--sdk'));
    }
    if (option('--aosp-manifest')) {
        refreshProtection(option('--aosp-manifest'));
    }
    if (argv.includes('--fetch-apple')) {
        await refreshApple();
    }
    const output = generate();
    if (argv.includes('--check')) {
        const stale = [
            [ANDROID_CATALOG, output.android],
            [IOS_CATALOG, output.ios],
        ].filter(([file, text]) => fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n') !== text);
        if (stale.length > 0) {
            console.error(`Stale catalog(s): ${stale.map(([file]) => path.relative(ROOT, file)).join(', ')}. Run npm run catalog:build.`);
            process.exitCode = 1;
            return;
        }
        console.log('Permission catalogs are up to date.');
        return;
    }
    fs.writeFileSync(ANDROID_CATALOG, output.android);
    fs.writeFileSync(IOS_CATALOG, output.ios);
    const count = (text) => Object.values(JSON.parse(text)).reduce((sum, list) => sum + list.length, 0);
    console.log(`Wrote ${path.relative(ROOT, ANDROID_CATALOG)} (${count(output.android)}) and ${path.relative(ROOT, IOS_CATALOG)} (${count(output.ios)}).`);
}

module.exports = { loadSources, buildAndroidCatalog, buildIosCatalog, serialize, deriveAudience, SOURCES_DIR, ANDROID_CATALOG, IOS_CATALOG };

if (require.main === module) {
    main(process.argv.slice(2)).catch((error) => {
        console.error(error.message || error);
        process.exitCode = 1;
    });
}
