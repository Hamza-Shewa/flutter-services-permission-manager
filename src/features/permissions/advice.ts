/**
 * Permission variant advice (pure, vscode-free; the MCP server reuses it).
 *
 * Given the project's SDK levels and the permissions it declares, explains
 * which declarations apply, which are dead weight, and which SDK-gated variant
 * (`maxSdkVersion`, `usesPermissionFlags`, successor permission) to write. Each
 * fixable item carries `fix`: entries to merge into the declared set.
 *
 * Variants are keyed by SDK level, not by Gradle/AGP version. The only build
 * facts that matter are surfaced in the header: `tools:` attributes need the
 * manifest merger (every AGP), `<uses-permission-sdk-23>` needs AGP 2.0+.
 */

import type {
    AndroidPermission,
    AndroidPermissionEntry,
    IOSPermission,
    IOSPermissionEntry,
} from '../../core/types/index.js';
import { normalizeAndroidPermissionName } from '../../core/platform/android/manifest-permissions.js';
import { LEGACY_PODFILE_MACROS, replacementForLegacyMacro } from '../../core/platform/ios/podfile-macros.js';
import { findAndroidPermission } from './catalog.js';
import { compareOsVersions, type ProjectPermissionFacts } from './project-facts.js';

export type AdviceLevel = 'info' | 'warning' | 'error';

/** A writer entry plus `remove: true` to drop the permission. */
export type AndroidAdviceFix = AndroidPermissionEntry & { remove?: boolean };

export interface PermissionAdvice {
    platform: 'android' | 'ios';
    /** Full Android permission name or iOS key the advice is about. */
    permission: string;
    level: AdviceLevel;
    code: string;
    message: string;
    /** Android: entries to merge into the declared set (by name). */
    fix?: AndroidAdviceFix[];
    /** iOS: keys to add (existing keys are left alone). */
    iosFix?: IOSPermissionEntry[];
}

export interface AdviceHeader {
    android?: {
        minSdk?: number;
        targetSdk?: number;
        compileSdk?: number;
        agpVersion?: string;
        gradleVersion?: string;
        buildFile?: string;
    };
    ios?: { deploymentTarget?: string; source?: string };
    notes: string[];
}

export interface PermissionAdviceReport {
    header: AdviceHeader;
    advice: PermissionAdvice[];
}

const P = (name: string) => normalizeAndroidPermissionName(name);
const READ_MEDIA = ['READ_MEDIA_IMAGES', 'READ_MEDIA_VIDEO', 'READ_MEDIA_AUDIO'].map(P);
const SMS_CALL_LOG = ['READ_SMS', 'SEND_SMS', 'RECEIVE_SMS', 'RECEIVE_MMS', 'RECEIVE_WAP_PUSH', 'READ_CALL_LOG', 'WRITE_CALL_LOG', 'PROCESS_OUTGOING_CALLS'].map(P);
const PLAY_WARNING = new Set([
    ...SMS_CALL_LOG,
    ...['QUERY_ALL_PACKAGES', 'MANAGE_EXTERNAL_STORAGE', 'REQUEST_INSTALL_PACKAGES', 'USE_EXACT_ALARM', 'ACCESS_BACKGROUND_LOCATION'].map(P),
]);

/** Keys Apple does not define that older releases of this extension wrote. */
const INVALID_IOS_KEYS: Record<string, string> = {
    NSUserNotificationsUsageDescription: 'Apple does not define this key (older releases of this extension wrote it). Notifications need no Info.plist entry: permission_handler needs PERMISSION_NOTIFICATIONS=1 in the Podfile and push needs the aps-environment entitlement. Delete it.',
};

function atLeast(value: number | undefined, level: number): boolean {
    return value !== undefined && value >= level;
}

/** Android advice for the declared entries. */
export function adviseAndroidPermissions(
    rawEntries: AndroidPermissionEntry[],
    catalog: AndroidPermission[],
    facts: ProjectPermissionFacts = {},
): PermissionAdvice[] {
    const minSdk = facts.android?.minSdk.value;
    const targetSdk = facts.android?.targetSdk.value;
    const compileSdk = facts.android?.compileSdk.value;
    const entries = rawEntries.map(entry => ({ ...entry, name: P(entry.name) }));
    const declared = entries.filter(entry => entry.toolsNode !== 'remove');
    const names = new Set(declared.map(entry => entry.name));
    const has = (name: string) => names.has(P(name));
    const entryOf = (name: string) => declared.find(entry => entry.name === P(name));
    const advice: PermissionAdvice[] = [];
    const push = (item: Omit<PermissionAdvice, 'platform'>) => advice.push({ platform: 'android', ...item });

    const counts = new Map<string, number>();
    for (const entry of declared) {
        counts.set(entry.name, (counts.get(entry.name) ?? 0) + 1);
    }
    for (const [name, count] of counts) {
        if (count > 1) {
            push({ permission: name, level: 'warning', code: 'duplicate', message: `Declared ${count} times; the manifest merger keeps one element, so keep a single declaration with the attributes you need.` });
        }
    }

    for (const entry of entries) {
        if (entry.toolsNode === 'remove') {
            push({ permission: entry.name, level: 'info', code: 'merger-removed', message: 'tools:node="remove" strips this permission from the merged manifest (including copies declared by libraries). It is not counted as used and is always kept as written.' });
            continue;
        }
        const info = findAndroidPermission(catalog, entry.name);
        if (!info) {
            push({ permission: entry.name, level: 'info', code: 'unknown', message: 'Not in the permission catalog (custom or vendor permission). It is kept as written.' });
            continue;
        }
        if (info.audience === 'system') {
            push({ permission: entry.name, level: 'warning', code: 'system-only', message: `Protection level "${info.protectionLevel}": only the system or privileged apps can hold it, so a Play Store app is never granted it.` });
        }
        if (info.removedIn !== undefined && info.removedIn !== null) {
            const level: AdviceLevel = atLeast(minSdk, info.removedIn) ? 'error' : 'warning';
            push({ permission: entry.name, level, code: 'removed', message: `Removed from the SDK in API ${info.removedIn}${level === 'error' ? `, at or below minSdk ${minSdk}` : ''}; it has no effect there.`, fix: level === 'error' ? [{ name: entry.name, remove: true }] : undefined });
        }
        if (info.deprecatedIn !== undefined && info.deprecatedIn !== null) {
            const successors = (info.replacedBy ?? []).filter(successor => !has(successor));
            const level: AdviceLevel = atLeast(minSdk, info.deprecatedIn) ? 'warning' : 'info';
            push({
                permission: entry.name,
                level,
                code: 'deprecated',
                message: `Deprecated in API ${info.deprecatedIn}${level === 'warning' ? ` (minSdk ${minSdk} is at or above it)` : ''}.${info.replacedBy?.length ? ` Use ${info.replacedBy.map(name => name.replace(/^android\.permission\./, '')).join(', ')} instead.` : ''}`,
                fix: successors.length > 0 ? successors.map(name => ({ name })) : undefined,
            });
        }
        if (compileSdk !== undefined && info.apiLevel > compileSdk) {
            push({ permission: entry.name, level: 'error', code: 'above-compile-sdk', message: `Added in API ${info.apiLevel}, which is newer than compileSdk ${compileSdk}; the build tools of this compileSdk do not know it.` });
        }
        if (info.playPolicy && info.source !== 'health') {
            push({ permission: entry.name, level: PLAY_WARNING.has(entry.name) ? 'warning' : 'info', code: 'play-policy', message: info.playPolicy });
        }
    }
    const healthDeclared = declared.filter(entry => entry.name.startsWith('android.permission.health.'));
    if (healthDeclared.length > 0) {
        const policy = findAndroidPermission(catalog, healthDeclared[0].name)?.playPolicy;
        if (policy) {
            push({ permission: 'android.permission.health.*', level: 'info', code: 'play-policy', message: policy });
        }
    }

    // READ_EXTERNAL_STORAGE
    const readStorage = entryOf('READ_EXTERNAL_STORAGE');
    if (readStorage) {
        if (atLeast(minSdk, 33)) {
            push({ permission: readStorage.name, level: 'warning', code: 'no-effect', message: `Has no effect from API 33 and minSdk is ${minSdk}; remove it and use READ_MEDIA_IMAGES / READ_MEDIA_VIDEO / READ_MEDIA_AUDIO.`, fix: [{ name: readStorage.name, remove: true }] });
        } else if (atLeast(targetSdk, 33) && (readStorage.maxSdkVersion === undefined || readStorage.maxSdkVersion > 32)) {
            const media = READ_MEDIA.filter(name => !has(name)).map(name => name.replace('android.permission.', '')).join(' / ');
            push({
                permission: readStorage.name,
                level: 'warning',
                code: 'max-sdk',
                message: `Has no effect when targeting API 33+ (targetSdk ${targetSdk}): declare it with maxSdkVersion="32"${media ? ` and add ${media} for the media the app reads` : ''}.${atLeast(targetSdk, 34) ? ' On API 34+ also declare READ_MEDIA_VISUAL_USER_SELECTED so partial photo access works.' : ''}`,
                fix: [{ name: readStorage.name, maxSdkVersion: 32 }],
            });
        } else if (atLeast(targetSdk, 33) && !READ_MEDIA.some(name => has(name))) {
            // Correctly capped, but nothing replaces it on Android 13+: the app cannot read any media there.
            push({
                permission: readStorage.name,
                level: 'warning',
                code: 'media-missing',
                message: `Capped at API ${readStorage.maxSdkVersion}, but no READ_MEDIA_IMAGES / READ_MEDIA_VIDEO / READ_MEDIA_AUDIO is declared: on Android 13+ (targetSdk ${targetSdk}) the app has no media access. Add the READ_MEDIA_* permission for the media it reads.`,
            });
        }
    }
    if ((has('READ_MEDIA_IMAGES') || has('READ_MEDIA_VIDEO')) && atLeast(targetSdk, 34) && !has('READ_MEDIA_VISUAL_USER_SELECTED')) {
        push({ permission: P('READ_MEDIA_VISUAL_USER_SELECTED'), level: 'info', code: 'partial-media-access', message: 'Targeting API 34+: declare READ_MEDIA_VISUAL_USER_SELECTED so users can grant access to selected photos and videos only.', fix: [{ name: P('READ_MEDIA_VISUAL_USER_SELECTED') }] });
    }

    // WRITE_EXTERNAL_STORAGE
    const writeStorage = entryOf('WRITE_EXTERNAL_STORAGE');
    if (writeStorage) {
        const cap = facts.android?.requestLegacyExternalStorage ? 29 : 28;
        if (atLeast(minSdk, 30)) {
            push({ permission: writeStorage.name, level: 'warning', code: 'no-effect', message: `Has no effect on API 30+ (scoped storage) and minSdk is ${minSdk}; remove it.`, fix: [{ name: writeStorage.name, remove: true }] });
        } else if (atLeast(targetSdk, 30) && (writeStorage.maxSdkVersion === undefined || writeStorage.maxSdkVersion > cap)) {
            push({ permission: writeStorage.name, level: 'warning', code: 'max-sdk', message: `Has no effect from API 30 when targeting 30+; declare it with maxSdkVersion="${cap}"${cap === 28 ? ' (29 only if the app sets requestLegacyExternalStorage)' : ' (requestLegacyExternalStorage is set)'}.`, fix: [{ name: writeStorage.name, maxSdkVersion: cap }] });
        }
    }

    // Legacy Bluetooth
    const usesLocation = has('ACCESS_FINE_LOCATION');
    for (const legacy of ['BLUETOOTH', 'BLUETOOTH_ADMIN']) {
        const entry = entryOf(legacy);
        if (!entry) {
            continue;
        }
        if (atLeast(minSdk, 31)) {
            push({ permission: entry.name, level: 'warning', code: 'no-effect', message: `Legacy Bluetooth permission with no effect on API 31+ and minSdk is ${minSdk}; remove it.`, fix: [{ name: entry.name, remove: true }] });
        } else if (atLeast(targetSdk, 31) && (entry.maxSdkVersion === undefined || entry.maxSdkVersion > 30)) {
            push({ permission: entry.name, level: 'warning', code: 'max-sdk', message: `Targeting API 31+: declare it with maxSdkVersion="30"; Android 12+ uses BLUETOOTH_SCAN / BLUETOOTH_CONNECT / BLUETOOTH_ADVERTISE.`, fix: [{ name: entry.name, maxSdkVersion: 30 }] });
        }
    }
    if ((has('BLUETOOTH') || has('BLUETOOTH_ADMIN')) && atLeast(targetSdk, 31) && (!has('BLUETOOTH_SCAN') || !has('BLUETOOTH_CONNECT'))) {
        const fix: AndroidAdviceFix[] = [];
        if (!has('BLUETOOTH_SCAN')) {
            fix.push(usesLocation ? { name: P('BLUETOOTH_SCAN') } : { name: P('BLUETOOTH_SCAN'), usesPermissionFlags: 'neverForLocation' });
        }
        if (!has('BLUETOOTH_CONNECT')) {
            fix.push({ name: P('BLUETOOTH_CONNECT') });
        }
        push({ permission: P('BLUETOOTH_SCAN'), level: 'warning', code: 'bluetooth-runtime', message: `Targeting API 31+ (targetSdk ${targetSdk}): Bluetooth needs BLUETOOTH_SCAN${usesLocation ? '' : ' (with usesPermissionFlags="neverForLocation" unless you derive location from scans)'} and BLUETOOTH_CONNECT; add BLUETOOTH_ADVERTISE if the app advertises.`, fix });
    }
    const scan = entryOf('BLUETOOTH_SCAN');
    if (scan && !(scan.usesPermissionFlags ?? '').includes('neverForLocation')) {
        push({
            permission: scan.name,
            level: 'info',
            code: 'never-for-location',
            message: usesLocation
                ? 'Without usesPermissionFlags="neverForLocation" scan results can be used for location, which needs a location permission (declared). Add the flag if the app never derives location from scans.'
                : 'No location permission is declared: add usesPermissionFlags="neverForLocation" to assert scans are never used for location (some BLE beacons are filtered out with it).',
            fix: usesLocation ? undefined : [{ name: scan.name, usesPermissionFlags: 'neverForLocation' }],
        });
    }
    const nearbyWifi = entryOf('NEARBY_WIFI_DEVICES');
    if (nearbyWifi && !(nearbyWifi.usesPermissionFlags ?? '').includes('neverForLocation')) {
        push({ permission: nearbyWifi.name, level: 'info', code: 'never-for-location', message: 'Add usesPermissionFlags="neverForLocation" if the app never derives physical location from Wi-Fi results; otherwise ACCESS_FINE_LOCATION is also required.', fix: [{ name: nearbyWifi.name, usesPermissionFlags: 'neverForLocation' }] });
    }

    // Location
    if (has('ACCESS_FINE_LOCATION') && !has('ACCESS_COARSE_LOCATION') && atLeast(targetSdk, 31)) {
        push({ permission: P('ACCESS_FINE_LOCATION'), level: 'error', code: 'fine-without-coarse', message: `Targeting API 31+: a request for ACCESS_FINE_LOCATION alone is ignored; declare ACCESS_COARSE_LOCATION too and request both.`, fix: [{ name: P('ACCESS_COARSE_LOCATION') }] });
    }
    if (has('ACCESS_BACKGROUND_LOCATION')) {
        if (!has('ACCESS_FINE_LOCATION') && !has('ACCESS_COARSE_LOCATION')) {
            push({ permission: P('ACCESS_BACKGROUND_LOCATION'), level: 'error', code: 'background-without-foreground', message: 'Background location is only granted on top of foreground location: declare ACCESS_COARSE_LOCATION (and ACCESS_FINE_LOCATION for precise).', fix: [{ name: P('ACCESS_COARSE_LOCATION') }] });
        }
        push({ permission: P('ACCESS_BACKGROUND_LOCATION'), level: 'info', code: 'api-level', message: `Exists from API 29; on older devices foreground location already covers background use${minSdk !== undefined && minSdk < 29 ? ` (minSdk ${minSdk})` : ''}.` });
    }

    // Body sensors -> Health Connect
    for (const [legacy, successors] of [
        ['BODY_SENSORS', ['android.permission.health.READ_HEART_RATE']],
        ['BODY_SENSORS_BACKGROUND', ['android.permission.health.READ_HEART_RATE', 'android.permission.health.READ_HEALTH_DATA_IN_BACKGROUND']],
    ] as const) {
        const entry = entryOf(legacy);
        if (!entry || !atLeast(targetSdk, 36)) {
            continue;
        }
        const fix: AndroidAdviceFix[] = [];
        if (entry.maxSdkVersion === undefined || entry.maxSdkVersion > 35) {
            fix.push({ name: entry.name, maxSdkVersion: 35 });
        }
        for (const successor of successors) {
            if (!has(successor)) {
                fix.push({ name: successor });
            }
        }
        if (fix.length > 0) {
            push({ permission: entry.name, level: 'warning', code: 'health-connect', message: `Targeting API 36+: body-sensor data moves to Health Connect. Declare ${legacy} with maxSdkVersion="35" and add ${successors.map(name => name.replace('android.permission.', '')).join(' + ')}; Health Connect also requires an activity that shows the app's privacy policy.`, fix });
        }
    }

    // Foreground services
    const typed = declared.filter(entry => /^android\.permission\.FOREGROUND_SERVICE_[A-Z_]+$/.test(entry.name));
    if (has('FOREGROUND_SERVICE') && typed.length === 0 && atLeast(targetSdk, 34)) {
        push({ permission: P('FOREGROUND_SERVICE'), level: 'warning', code: 'foreground-service-type', message: `Targeting API 34+: every foreground service needs a type and the matching FOREGROUND_SERVICE_<TYPE> permission (e.g. FOREGROUND_SERVICE_DATA_SYNC, FOREGROUND_SERVICE_LOCATION).` });
    }
    if (typed.length > 0 && !has('FOREGROUND_SERVICE')) {
        push({ permission: typed[0].name, level: 'error', code: 'foreground-service-missing', message: 'FOREGROUND_SERVICE_<TYPE> permissions only work together with FOREGROUND_SERVICE.', fix: [{ name: P('FOREGROUND_SERVICE') }] });
    }

    // Notifications
    if (has('POST_NOTIFICATIONS') && targetSdk !== undefined && targetSdk < 33) {
        push({ permission: P('POST_NOTIFICATIONS'), level: 'info', code: 'api-level', message: `Runtime permission from API 33; with targetSdk ${targetSdk} the system asks on its own when the first channel is created. Harmless to keep.` });
    }
    if (has('POST_NOTIFICATIONS') && facts.ios?.hasPodfile && facts.ios.podfileMacros.length > 0 && !facts.ios.podfileMacros.includes('PERMISSION_NOTIFICATIONS')) {
        push({ permission: P('POST_NOTIFICATIONS'), level: 'info', code: 'ios-equivalent', message: 'iOS notifications need no Info.plist key: permission_handler needs PERMISSION_NOTIFICATIONS=1 in the Podfile, and push needs the aps-environment entitlement.' });
    }

    // Exact alarms
    if (has('SCHEDULE_EXACT_ALARM') && has('USE_EXACT_ALARM')) {
        const exact = entryOf('SCHEDULE_EXACT_ALARM')!;
        if (exact.maxSdkVersion === undefined || exact.maxSdkVersion > 32) {
            push({ permission: exact.name, level: 'info', code: 'max-sdk', message: 'USE_EXACT_ALARM covers API 33+, so declare SCHEDULE_EXACT_ALARM with maxSdkVersion="32".', fix: [{ name: exact.name, maxSdkVersion: 32 }] });
        }
    } else if (has('SCHEDULE_EXACT_ALARM') && atLeast(targetSdk, 33)) {
        push({ permission: P('SCHEDULE_EXACT_ALARM'), level: 'info', code: 'exact-alarm', message: 'From Android 14 this is no longer pre-granted to new installs of apps targeting API 33+: check canScheduleExactAlarms() and send users to the alarm settings screen.' });
    }

    // Phone state
    if (has('READ_PHONE_STATE') && atLeast(targetSdk, 33) && !has('READ_BASIC_PHONE_STATE')) {
        push({ permission: P('READ_PHONE_STATE'), level: 'info', code: 'basic-phone-state', message: 'If the app only needs basic telephony state (SIM state, network type), READ_BASIC_PHONE_STATE (API 33, not a runtime permission) can replace READ_PHONE_STATE on Android 13+.' });
    }

    // Local network protection (API 37)
    if (atLeast(targetSdk, 37) && has('INTERNET') && !has('ACCESS_LOCAL_NETWORK')) {
        push({ permission: P('ACCESS_LOCAL_NETWORK'), level: 'info', code: 'local-network', message: `Targeting API 37 (targetSdk ${targetSdk}): connecting to devices on the local network (mDNS/NSD discovery, LAN sockets, casting, local IoT) needs the ACCESS_LOCAL_NETWORK runtime permission. Declare and request it only if the app does that.` });
    }

    return advice;
}

/** iOS / macOS advice for the declared Info.plist keys. */
export function adviseIOSPermissions(
    entries: IOSPermissionEntry[],
    catalog: IOSPermission[],
    facts: ProjectPermissionFacts = {},
    platform: 'ios' | 'macos' = 'ios',
): PermissionAdvice[] {
    const advice: PermissionAdvice[] = [];
    const push = (item: Omit<PermissionAdvice, 'platform'>) => advice.push({ platform: 'ios', ...item });
    const keys = new Map(entries.map(entry => [entry.permission, entry]));
    const has = (key: string) => keys.has(key);
    const target = platform === 'ios' ? facts.ios?.deploymentTarget : undefined;

    for (const entry of entries) {
        const info = catalog.find(p => p.permission === entry.permission);
        if (!info && INVALID_IOS_KEYS[entry.permission]) {
            push({ permission: entry.permission, level: 'warning', code: 'invalid-key', message: INVALID_IOS_KEYS[entry.permission] });
            continue;
        }
        if (!info) {
            push({ permission: entry.permission, level: 'info', code: 'unknown', message: 'Not in the permission catalog; kept as written.' });
            continue;
        }
        if (info.deprecatedInOS) {
            const effective = !!target && compareOsVersions(target, info.deprecatedInOS) >= 0;
            const successors = (info.replacedBy ?? []).filter(key => !has(key));
            push({
                permission: entry.permission,
                level: effective ? 'warning' : 'info',
                code: 'deprecated',
                message: `Deprecated in iOS ${info.deprecatedInOS}${effective ? ` (deployment target ${target})` : ''}.${info.replacedBy?.length ? ` Use ${info.replacedBy.join(' / ')}${effective ? '' : ' as well, for newer iOS'}.` : ''}`,
                iosFix: successors.length > 0 ? successors.map(key => ({ permission: key, type: 'string', value: typeof entry.value === 'string' ? entry.value : undefined })) : undefined,
            });
        }
        if (platform === 'ios' && !info.minOS && info.minMacOS) {
            push({ permission: entry.permission, level: 'info', code: 'macos-only', message: `A macOS key (macOS ${info.minMacOS}+); iOS ignores it.` });
        } else if (target && info.minOS && compareOsVersions(info.minOS, target) > 0) {
            push({ permission: entry.permission, level: 'info', code: 'newer-than-target', message: `Read from iOS ${info.minOS}; devices on iOS ${target} to ${info.minOS} ignore it, which is harmless.` });
        }
        const type = String(entry.type ?? info.type).toLowerCase();
        if (type === 'string' && /UsageDescription$/.test(entry.permission)) {
            const text = typeof entry.value === 'string' ? entry.value.trim() : '';
            if (!text || text === 'TODO: Provide usage description.') {
                push({ permission: entry.permission, level: 'warning', code: 'empty-description', message: 'The usage description is empty or a placeholder; App Review rejects apps whose purpose strings do not explain the use.' });
            }
        }
    }

    if (has('NSLocalNetworkUsageDescription') && !has('NSBonjourServices')) {
        push({ permission: 'NSLocalNetworkUsageDescription', level: 'warning', code: 'bonjour-missing', message: 'Bonjour browsing/advertising also needs NSBonjourServices listing every service type the app uses (e.g. _ipp._tcp); without it those browses fail.', iosFix: [{ permission: 'NSBonjourServices', type: 'array', value: [] }] });
    }
    if (has('NSBonjourServices') && !has('NSLocalNetworkUsageDescription')) {
        push({ permission: 'NSBonjourServices', level: 'warning', code: 'local-network-missing', message: 'Using Bonjour triggers the local network prompt: add NSLocalNetworkUsageDescription.', iosFix: [{ permission: 'NSLocalNetworkUsageDescription', type: 'string' }] });
    }
    const bonjour = keys.get('NSBonjourServices');
    if (bonjour && Array.isArray(bonjour.value) && bonjour.value.length === 0) {
        push({ permission: 'NSBonjourServices', level: 'warning', code: 'bonjour-empty', message: 'NSBonjourServices is empty; list the service types the app browses (e.g. _ipp._tcp).' });
    }
    if (has('NSLocationAlwaysAndWhenInUseUsageDescription') && !has('NSLocationWhenInUseUsageDescription')) {
        const always = keys.get('NSLocationAlwaysAndWhenInUseUsageDescription')!;
        push({ permission: 'NSLocationAlwaysAndWhenInUseUsageDescription', level: 'error', code: 'when-in-use-missing', message: 'iOS requires NSLocationWhenInUseUsageDescription alongside NSLocationAlwaysAndWhenInUseUsageDescription; without it no location authorization is requested.', iosFix: [{ permission: 'NSLocationWhenInUseUsageDescription', type: 'string', value: typeof always.value === 'string' ? always.value : undefined }] });
    }
    const accessory = keys.get('NSAccessorySetupKitSupports');
    if (accessory && Array.isArray(accessory.value) && accessory.value.includes('Bluetooth')) {
        const missing = ['NSAccessorySetupBluetoothServices', 'NSAccessorySetupBluetoothCompanyIdentifiers', 'NSAccessorySetupBluetoothNames'].filter(key => !has(key));
        if (missing.length > 0) {
            push({ permission: 'NSAccessorySetupKitSupports', level: 'error', code: 'accessory-bluetooth', message: `"Bluetooth" in NSAccessorySetupKitSupports also needs ${missing.join(', ')}.`, iosFix: missing.map(key => ({ permission: key, type: 'array', value: [] })) });
        }
    }

    // permission_handler macros
    if (platform === 'ios' && facts.ios?.hasPodfile) {
        const macros = new Set(facts.ios.podfileMacros);
        for (const legacy of LEGACY_PODFILE_MACROS) {
            if (macros.has(legacy)) {
                push({ permission: legacy, level: 'warning', code: 'legacy-macro', message: `${legacy} is not a permission_handler macro; saving permissions replaces it with ${replacementForLegacyMacro(legacy, keys.keys()).join(' + ')}.` });
            }
        }
        if (macros.size > 0) {
            for (const entry of entries) {
                const macro = catalog.find(p => p.permission === entry.permission)?.podfileMacro;
                if (macro && !macros.has(macro)) {
                    push({ permission: entry.permission, level: 'warning', code: 'podfile-macro-missing', message: `permission_handler needs ${macro}=1 in the Podfile for this key; saving permissions adds it.` });
                }
            }
        }
    }
    return advice;
}

/** Header facts shown above the advice. */
export function adviceHeader(facts: ProjectPermissionFacts): AdviceHeader {
    const header: AdviceHeader = {
        notes: [
            'Permission variants are keyed by SDK level (minSdk / targetSdk), not by Gradle or AGP version.',
            'tools:node / tools:* attributes are applied by the manifest merger (every AGP version).',
            '<uses-permission-sdk-23> needs AGP 2.0 or newer.',
        ],
    };
    if (facts.android) {
        header.android = {
            minSdk: facts.android.minSdk.value,
            targetSdk: facts.android.targetSdk.value,
            compileSdk: facts.android.compileSdk.value,
            agpVersion: facts.android.agpVersion,
            gradleVersion: facts.android.gradleVersion,
            buildFile: facts.android.buildFile,
        };
    }
    if (facts.ios) {
        header.ios = { deploymentTarget: facts.ios.deploymentTarget, source: facts.ios.deploymentTargetSource };
    }
    return header;
}

/** Advice for both platforms. */
export function buildPermissionAdvice(input: {
    facts: ProjectPermissionFacts;
    android?: { entries: AndroidPermissionEntry[]; catalog: AndroidPermission[] };
    ios?: { entries: IOSPermissionEntry[]; catalog: IOSPermission[]; platform?: 'ios' | 'macos' };
}): PermissionAdviceReport {
    return {
        header: adviceHeader(input.facts),
        advice: [
            ...(input.android ? adviseAndroidPermissions(input.android.entries, input.android.catalog, input.facts) : []),
            ...(input.ios ? adviseIOSPermissions(input.ios.entries, input.ios.catalog, input.facts, input.ios.platform) : []),
        ],
    };
}

const SEVERITY: Record<AdviceLevel, number> = { info: 0, warning: 1, error: 2 };

/** Worst advice level per permission (for an "Applies" badge). */
export function worstAdviceLevel(advice: PermissionAdvice[], permission: string): AdviceLevel | undefined {
    return advice
        .filter(item => item.permission === permission)
        .reduce<AdviceLevel | undefined>((worst, item) => (!worst || SEVERITY[item.level] > SEVERITY[worst] ? item.level : worst), undefined);
}

/**
 * Merges Android fixes into the declared entries: a fix for an existing name
 * overrides only the attributes it sets, `remove: true` drops the entry, and
 * new names are appended. Merger-removed entries are never touched.
 */
export function applyAndroidAdviceFixes(entries: AndroidPermissionEntry[], fixes: AndroidAdviceFix[]): AndroidPermissionEntry[] {
    let result = entries.map(entry => ({ ...entry, name: P(entry.name) }));
    for (const fix of fixes) {
        const name = P(fix.name);
        const index = result.findIndex(entry => entry.name === name && entry.toolsNode !== 'remove');
        if (fix.remove) {
            result = result.filter((entry, position) => position !== index);
            continue;
        }
        const { remove: _remove, ...attributes } = fix;
        if (index === -1) {
            result.push({ ...attributes, name });
        } else {
            result[index] = { ...result[index], ...attributes, name };
        }
    }
    return result;
}
