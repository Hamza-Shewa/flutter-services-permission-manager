/**
 * permission_handler Podfile macros (pure, vscode-free).
 *
 * The macro set is the one documented in the Baseflow/flutter-permission-handler
 * README. `PERMISSION_CALENDARS` never existed there; older releases of this
 * extension wrote it, so saving migrates it to the real calendar macros.
 */

/** Every macro permission_handler reads from GCC_PREPROCESSOR_DEFINITIONS. */
export const PERMISSION_HANDLER_MACROS = [
    'PERMISSION_EVENTS',
    'PERMISSION_EVENTS_FULL_ACCESS',
    'PERMISSION_REMINDERS',
    'PERMISSION_CONTACTS',
    'PERMISSION_CAMERA',
    'PERMISSION_MICROPHONE',
    'PERMISSION_SPEECH_RECOGNIZER',
    'PERMISSION_PHOTOS',
    'PERMISSION_PHOTOS_ADD_ONLY',
    'PERMISSION_LOCATION',
    'PERMISSION_LOCATION_WHENINUSE',
    'PERMISSION_NOTIFICATIONS',
    'PERMISSION_MEDIA_LIBRARY',
    'PERMISSION_SENSORS',
    'PERMISSION_BLUETOOTH',
    'PERMISSION_APP_TRACKING_TRANSPARENCY',
    'PERMISSION_CRITICAL_ALERTS',
    'PERMISSION_ASSISTANT',
] as const;

const KNOWN = new Set<string>(PERMISSION_HANDLER_MACROS);

/** Macros written by older releases that permission_handler does not know. */
export const LEGACY_PODFILE_MACROS = ['PERMISSION_CALENDARS'] as const;

/**
 * The macros that replace a legacy macro, given the Info.plist keys present.
 * `PERMISSION_CALENDARS` becomes `PERMISSION_EVENTS_FULL_ACCESS` when the full-access
 * calendar key is declared, and `PERMISSION_EVENTS` for write-only / pre-iOS 17 keys.
 */
export function replacementForLegacyMacro(macro: string, plistKeys: Iterable<string>): string[] {
    if (macro !== 'PERMISSION_CALENDARS') {
        return [];
    }
    const keys = new Set(plistKeys);
    const result: string[] = [];
    if (keys.has('NSCalendarsFullAccessUsageDescription')) {
        result.push('PERMISSION_EVENTS_FULL_ACCESS');
    }
    if (keys.has('NSCalendarsWriteOnlyAccessUsageDescription') || keys.has('NSCalendarsUsageDescription')) {
        result.push('PERMISSION_EVENTS');
    }
    return result.length > 0 ? result : ['PERMISSION_EVENTS'];
}

/** `'NAME=1'` entries found in the Podfile, in order. */
export function extractPodfileMacroNames(content: string): string[] {
    const names: string[] = [];
    const regex = /['"](PERMISSION_[A-Z_]+)=1['"]/g;
    let match: RegExpExecArray | null;
    while ((match = regex.exec(content)) !== null) {
        names.push(match[1]);
    }
    return names;
}

/** Rewrites legacy macros in place (keeps the rest of the Podfile untouched). */
export function migrateLegacyPodfileMacros(content: string, plistKeys: Iterable<string>): string {
    const keys = Array.from(plistKeys);
    return content.replace(/(['"])(PERMISSION_[A-Z_]+)=1\1(,?)/g, (whole, quote: string, macro: string, comma: string) => {
        if (!(LEGACY_PODFILE_MACROS as readonly string[]).includes(macro)) {
            return whole;
        }
        const replacements = replacementForLegacyMacro(macro, keys).filter(
            replacement => !new RegExp(`['"]${replacement}=1['"]`).test(content),
        );
        if (replacements.length === 0) {
            return '';
        }
        return replacements.map(name => `${quote}${name}=1${quote}`).join(`${comma} `) + comma;
    });
}

/** True when the name is a macro permission_handler understands. */
export function isPermissionHandlerMacro(name: string): boolean {
    return KNOWN.has(name);
}

/**
 * Entries of an existing `GCC_PREPROCESSOR_DEFINITIONS ||= [ ... ]` array that
 * are not permission macros (`'$(inherited)'` excluded), so a rewrite keeps them.
 */
export function nonPermissionDefinitions(blockText: string): string[] {
    // Skip the `build_settings['GCC_PREPROCESSOR_DEFINITIONS']` accessor: the array starts after `=`.
    const assign = blockText.search(/\]\s*\|{0,2}=\s*\[/);
    const open = assign === -1 ? blockText.indexOf('[') : blockText.indexOf('[', assign + 1);
    const inner = blockText.slice(open + 1, blockText.lastIndexOf(']'));
    const result: string[] = [];
    const regex = /(['"])((?:(?!\1).)*)\1/g;
    let match: RegExpExecArray | null;
    while ((match = regex.exec(inner)) !== null) {
        const value = match[2];
        if (value === '$(inherited)' || /^PERMISSION_[A-Z_]+=/.test(value)) {
            continue;
        }
        result.push(value);
    }
    return result;
}

/** The GCC_PREPROCESSOR_DEFINITIONS assignment for the given macros (sorted, deduplicated). */
export function buildGccPreprocessorBlock(macros: Iterable<string>, extraDefinitions: string[] = []): string {
    const indent = '              ';
    const unique = Array.from(new Set(macros)).sort();
    const lines = [
        `${indent}'$(inherited)',`,
        ...extraDefinitions.map(definition => `${indent}'${definition.replace(/'/g, "\\'")}',`),
        ...unique.map(macro => `${indent}'${macro}=1',`),
    ];
    return `config.build_settings['GCC_PREPROCESSOR_DEFINITIONS'] ||= [\n${lines.join('\n')}\n            ]`;
}
