/**
 * Reads the top-level key/value pairs of an XML property list without
 * reformatting it, so writers can edit one value in place.
 *
 * Pure (no vscode, no fs): the MCP server imports it from `out/`.
 */

export type PlistValueType = 'string' | 'boolean' | 'array' | 'dictionary' | 'integer' | 'real' | 'date' | 'data' | 'unknown';

/** A simple, editable value: string, boolean, array of strings, or flat string dictionary. */
export type PlistSimpleValue = string | boolean | string[] | Record<string, string>;

export interface PlistTopLevelEntry {
    key: string;
    type: PlistValueType;
    /** Parsed value when it is simple (see `PlistSimpleValue`); undefined for nested structures. */
    value?: PlistSimpleValue;
    /** Offset of `<key>`. */
    keyStart: number;
    /** Offset of the value element's `<`. */
    valueStart: number;
    /** Offset just past the value element. */
    valueEnd: number;
    /** Raw XML of the value element. */
    rawValue: string;
}

export interface PlistTopLevel {
    entries: PlistTopLevelEntry[];
    /** Offset of the root `</dict>`. */
    rootCloseStart: number;
}

const TYPE_BY_TAG: Record<string, PlistValueType> = {
    string: 'string',
    true: 'boolean',
    false: 'boolean',
    array: 'array',
    dict: 'dictionary',
    integer: 'integer',
    real: 'real',
    date: 'date',
    data: 'data',
};

/** Skips whitespace and comments starting at `position`. */
function skipTrivia(source: string, position: number): number {
    let index = position;
    for (;;) {
        while (index < source.length && /\s/.test(source[index])) {
            index++;
        }
        if (source.startsWith('<!--', index)) {
            const close = source.indexOf('-->', index + 4);
            index = close === -1 ? source.length : close + 3;
            continue;
        }
        return index;
    }
}

/** Offset just past the element that starts at `start` (handles nesting of the same tag). */
function elementEnd(source: string, start: number): { end: number; tag: string } | null {
    const open = /^<([A-Za-z]+)\b[^>]*?(\/?)>/.exec(source.slice(start, start + 200));
    if (!open) {
        return null;
    }
    const tag = open[1];
    if (open[2] === '/') {
        return { end: start + open[0].length, tag };
    }
    const openRe = new RegExp(`<${tag}\\b[^>]*?(/?)>`, 'g');
    const closeTag = `</${tag}>`;
    let depth = 1;
    let position = start + open[0].length;
    while (depth > 0) {
        const nextClose = source.indexOf(closeTag, position);
        if (nextClose === -1) {
            return null;
        }
        openRe.lastIndex = position;
        let nextOpen = openRe.exec(source);
        while (nextOpen && nextOpen[1] === '/' && nextOpen.index < nextClose) {
            nextOpen = openRe.exec(source);
        }
        if (nextOpen && nextOpen.index < nextClose) {
            depth++;
            position = nextOpen.index + nextOpen[0].length;
        } else {
            depth--;
            position = nextClose + closeTag.length;
        }
    }
    return { end: position, tag };
}

export function decodePlistText(text: string): string {
    return text
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&apos;/g, "'")
        .replace(/&amp;/g, '&');
}

/** Escapes text for a plist element, leaving entities that are already there alone. */
export function escapePlistText(text: string): string {
    return text
        .replace(/&(?!(?:amp|lt|gt|quot|apos|#\d+|#x[0-9a-fA-F]+);)/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
}

function parseSimpleValue(raw: string, type: PlistValueType): PlistSimpleValue | undefined {
    if (type === 'string') {
        const match = /^<string>([\s\S]*)<\/string>$/.exec(raw) ?? (/^<string\s*\/>$/.test(raw) ? ['', ''] : null);
        return match ? match[1] : undefined;
    }
    if (type === 'boolean') {
        return raw.startsWith('<true');
    }
    if (type === 'array') {
        const inner = raw.replace(/^<array>/, '').replace(/<\/array>$/, '').replace(/<!--[\s\S]*?-->/g, '');
        if (/^<array\s*\/>$/.test(raw)) {
            return [];
        }
        const items: string[] = [];
        const itemRe = /<string>([\s\S]*?)<\/string>|<string\s*\/>/g;
        let match: RegExpExecArray | null;
        while ((match = itemRe.exec(inner)) !== null) {
            items.push(match[1] ?? '');
        }
        // Anything other than strings (dicts, numbers...) is not a simple value.
        const leftover = inner.replace(itemRe, '').trim();
        return leftover ? undefined : items;
    }
    if (type === 'dictionary') {
        if (/^<dict\s*\/>$/.test(raw)) {
            return {};
        }
        const inner = raw.replace(/^<dict>/, '').replace(/<\/dict>$/, '').replace(/<!--[\s\S]*?-->/g, '');
        const result: Record<string, string> = {};
        const pairRe = /<key>([\s\S]*?)<\/key>\s*<string>([\s\S]*?)<\/string>/g;
        let match: RegExpExecArray | null;
        while ((match = pairRe.exec(inner)) !== null) {
            result[match[1]] = match[2];
        }
        const leftover = inner.replace(pairRe, '').trim();
        return leftover ? undefined : result;
    }
    return undefined;
}

/** Parses the root dictionary. Returns null when the content has no `<plist><dict>`. */
export function parsePlistTopLevel(source: string): PlistTopLevel | null {
    const plistOpen = /<plist\b[^>]*>/.exec(source);
    if (!plistOpen) {
        return null;
    }
    let position = skipTrivia(source, plistOpen.index + plistOpen[0].length);
    if (!source.startsWith('<dict', position)) {
        return null;
    }
    const dictOpen = /^<dict\b[^>]*>/.exec(source.slice(position));
    if (!dictOpen) {
        return null;
    }
    position += dictOpen[0].length;
    const entries: PlistTopLevelEntry[] = [];
    for (;;) {
        position = skipTrivia(source, position);
        if (source.startsWith('</dict>', position)) {
            return { entries, rootCloseStart: position };
        }
        const keyMatch = /^<key>([\s\S]*?)<\/key>/.exec(source.slice(position, position + 1000));
        if (!keyMatch) {
            return null;
        }
        const keyStart = position;
        position = skipTrivia(source, position + keyMatch[0].length);
        const element = elementEnd(source, position);
        if (!element) {
            return null;
        }
        const rawValue = source.slice(position, element.end);
        const type = TYPE_BY_TAG[element.tag] ?? 'unknown';
        entries.push({
            key: decodePlistText(keyMatch[1].trim()),
            type,
            value: parseSimpleValue(rawValue, type),
            keyStart,
            valueStart: position,
            valueEnd: element.end,
            rawValue,
        });
        position = element.end;
    }
}
