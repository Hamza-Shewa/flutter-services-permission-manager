/**
 * Structure-preserving reading and writing of `<uses-permission>` and
 * `<uses-permission-sdk-23>` elements in AndroidManifest.xml.
 *
 * Pure (no vscode, no fs) so the MCP server can import it from `out/`.
 *
 * Rules the writer follows:
 *  - An element that stays (same name in the entry list) is edited in place:
 *    only the attributes the entry specifies change. `undefined` keeps the
 *    attribute as it is, `null` removes it, a value sets it. Every other
 *    attribute (`tools:*`, `android:required`...) is kept verbatim.
 *  - Elements with `tools:node="remove"` are never deleted because they are
 *    missing from the list; they only change when the list carries their name.
 *  - New elements go after the last declared (not merger-removed) permission,
 *    with the same indentation. Comments and `<queries>` are never touched.
 */

import type { AndroidPermissionEntry } from '../../types/index.js';

export type UsesPermissionTag = 'uses-permission' | 'uses-permission-sdk-23';

export interface ManifestAttribute {
    name: string;
    value: string;
}

/** One permission element found in a manifest. */
export interface ManifestPermissionElement {
    tag: UsesPermissionTag;
    /** `android:name` as written. */
    name: string;
    attributes: ManifestAttribute[];
    /** Offset of `<`. */
    start: number;
    /** Offset just past the element (`/>` or the closing tag). */
    end: number;
    raw: string;
}

/** Entry attributes the writer manages, with how they map onto the XML attribute. */
type ManagedKey = 'minSdkVersion' | 'maxSdkVersion' | 'usesPermissionFlags';
const MANAGED_ATTRIBUTES: Array<{ key: ManagedKey; attribute: string }> = [
    { key: 'minSdkVersion', attribute: 'android:minSdkVersion' },
    { key: 'maxSdkVersion', attribute: 'android:maxSdkVersion' },
    { key: 'usesPermissionFlags', attribute: 'android:usesPermissionFlags' },
];

const TOOLS_NAMESPACE = 'http://schemas.android.com/tools';

/** Entry shape accepted by the writer: `null` on an attribute means "remove it". */
export type AndroidPermissionEntryInput = Omit<AndroidPermissionEntry, ManagedKey | 'toolsNode' | 'toolsAttributes' | 'sdk23'> & {
    minSdkVersion?: number | null;
    maxSdkVersion?: number | null;
    usesPermissionFlags?: string | null;
    sdk23?: boolean | null;
    toolsNode?: AndroidPermissionEntry['toolsNode'] | null;
    toolsAttributes?: Record<string, string | null>;
};

/**
 * Full permission name: names without a dot get `android.permission.`;
 * vendor names (`com.google.android.gms.permission.AD_ID`) are kept as-is.
 */
export function normalizeAndroidPermissionName(name: string): string {
    const trimmed = (name ?? '').trim();
    if (!trimmed) {
        return '';
    }
    return trimmed.includes('.') ? trimmed : `android.permission.${trimmed}`;
}

function commentRanges(content: string): Array<[number, number]> {
    const ranges: Array<[number, number]> = [];
    let index = content.indexOf('<!--');
    while (index !== -1) {
        const close = content.indexOf('-->', index + 4);
        const end = close === -1 ? content.length : close + 3;
        ranges.push([index, end]);
        index = content.indexOf('<!--', end);
    }
    return ranges;
}

function insideRanges(position: number, ranges: Array<[number, number]>): boolean {
    return ranges.some(([start, end]) => position >= start && position < end);
}

function parseAttributes(openTag: string): ManifestAttribute[] {
    const attributes: ManifestAttribute[] = [];
    const regex = /([A-Za-z_][\w:.-]*)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;
    let match: RegExpExecArray | null;
    while ((match = regex.exec(openTag)) !== null) {
        attributes.push({ name: match[1], value: match[2] ?? match[3] ?? '' });
    }
    return attributes;
}

/** Finds the `>` that closes the opening tag starting at `start`, skipping quoted values. */
function findTagEnd(content: string, start: number): number {
    let quote = '';
    for (let i = start; i < content.length; i++) {
        const char = content[i];
        if (quote) {
            if (char === quote) {
                quote = '';
            }
        } else if (char === '"' || char === "'") {
            quote = char;
        } else if (char === '>') {
            return i;
        }
    }
    return -1;
}

/** All `<uses-permission>` / `<uses-permission-sdk-23>` elements outside comments, in document order. */
export function parseManifestPermissions(content: string): ManifestPermissionElement[] {
    const comments = commentRanges(content);
    const elements: ManifestPermissionElement[] = [];
    const regex = /<(uses-permission(?:-sdk-23)?)(?=[\s/>])/g;
    let match: RegExpExecArray | null;
    while ((match = regex.exec(content)) !== null) {
        const start = match.index;
        if (insideRanges(start, comments)) {
            continue;
        }
        const tag = match[1] as UsesPermissionTag;
        const openEnd = findTagEnd(content, start + match[0].length);
        if (openEnd === -1) {
            break;
        }
        let end = openEnd + 1;
        if (content[openEnd - 1] !== '/') {
            const closeTag = `</${tag}>`;
            const closeIndex = content.indexOf(closeTag, end);
            if (closeIndex !== -1) {
                end = closeIndex + closeTag.length;
            }
        }
        const openTag = content.slice(start, openEnd + 1);
        const attributes = parseAttributes(openTag);
        const name = attributes.find(attribute => attribute.name === 'android:name')?.value ?? '';
        if (name) {
            elements.push({ tag, name, attributes, start, end, raw: content.slice(start, end) });
        }
        regex.lastIndex = end;
    }
    return elements;
}

function toNumber(value: string | undefined): number | undefined {
    if (value === undefined || !/^\d+$/.test(value.trim())) {
        return undefined;
    }
    return parseInt(value.trim(), 10);
}

/** The writer entry that reproduces an existing element. */
export function permissionEntryFromElement(element: ManifestPermissionElement): AndroidPermissionEntry {
    const get = (name: string) => element.attributes.find(attribute => attribute.name === name)?.value;
    const entry: AndroidPermissionEntry = { name: element.name };
    const minSdk = toNumber(get('android:minSdkVersion'));
    const maxSdk = toNumber(get('android:maxSdkVersion'));
    const flags = get('android:usesPermissionFlags');
    if (minSdk !== undefined) {
        entry.minSdkVersion = minSdk;
    }
    if (maxSdk !== undefined) {
        entry.maxSdkVersion = maxSdk;
    }
    if (flags) {
        entry.usesPermissionFlags = flags;
    }
    if (element.tag === 'uses-permission-sdk-23') {
        entry.sdk23 = true;
    }
    const toolsNode = get('tools:node');
    if (toolsNode) {
        entry.toolsNode = toolsNode as AndroidPermissionEntry['toolsNode'];
    }
    const toolsAttributes: Record<string, string> = {};
    for (const attribute of element.attributes) {
        if (attribute.name.startsWith('tools:') && attribute.name !== 'tools:node') {
            toolsAttributes[attribute.name] = attribute.value;
        }
    }
    if (Object.keys(toolsAttributes).length > 0) {
        entry.toolsAttributes = toolsAttributes;
    }
    return entry;
}

/** Entries for every element of a manifest, in document order. */
export function extractAndroidPermissionEntries(content: string): AndroidPermissionEntry[] {
    return parseManifestPermissions(content).map(permissionEntryFromElement);
}

function isMergerRemoved(element: ManifestPermissionElement): boolean {
    return element.attributes.some(attribute => attribute.name === 'tools:node' && attribute.value === 'remove');
}

function escapeAttribute(value: string): string {
    return value.replace(/&(?!(?:amp|lt|gt|quot|apos|#\d+|#x[0-9a-fA-F]+);)/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
}

function escapeRegExp(value: string): string {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Desired attribute changes for one entry: value to set, `null` to remove; missing keys are left alone. */
function attributeChanges(entry: AndroidPermissionEntryInput): Map<string, string | null> {
    const changes = new Map<string, string | null>();
    for (const { key, attribute } of MANAGED_ATTRIBUTES) {
        const value = entry[key];
        if (value === null) {
            changes.set(attribute, null);
        } else if (value !== undefined && String(value).trim() !== '') {
            changes.set(attribute, String(value).trim());
        }
    }
    if (entry.toolsNode === null) {
        changes.set('tools:node', null);
    } else if (entry.toolsNode) {
        changes.set('tools:node', entry.toolsNode);
    }
    for (const [name, value] of Object.entries(entry.toolsAttributes ?? {})) {
        if (!name.startsWith('tools:') || name === 'tools:node') {
            continue;
        }
        changes.set(name, value === null ? null : String(value));
    }
    return changes;
}

/** Applies attribute changes to the raw element text, touching nothing else. */
function editElement(raw: string, tag: UsesPermissionTag, targetTag: UsesPermissionTag, changes: Map<string, string | null>): string {
    let result = raw;
    if (tag !== targetTag) {
        result = result.replace(new RegExp(`^<${escapeRegExp(tag)}(?=[\\s/>])`), `<${targetTag}`);
        result = result.replace(new RegExp(`</${escapeRegExp(tag)}>$`), `</${targetTag}>`);
    }
    for (const [name, value] of changes) {
        const attributeRegex = new RegExp(`(\\s+)${escapeRegExp(name)}\\s*=\\s*(?:"[^"]*"|'[^']*')`);
        const existing = attributeRegex.exec(result);
        if (value === null) {
            if (existing) {
                result = result.slice(0, existing.index) + result.slice(existing.index + existing[0].length);
            }
            continue;
        }
        const serialized = `${name}="${escapeAttribute(value)}"`;
        if (existing) {
            const current = parseAttributes(existing[0])[0]?.value;
            if (current !== value) {
                result = result.slice(0, existing.index) + existing[1] + serialized + result.slice(existing.index + existing[0].length);
            }
            continue;
        }
        // Append before `/>` (or `>` for an element with a closing tag), keeping the space style.
        const closeMatch = /\s*\/?>/.exec(result);
        if (closeMatch) {
            const insertAt = closeMatch.index;
            result = `${result.slice(0, insertAt)} ${serialized}${result.slice(insertAt)}`;
        }
    }
    return result;
}

function serializeNewElement(entry: AndroidPermissionEntryInput, name: string): string {
    const tag: UsesPermissionTag = entry.sdk23 ? 'uses-permission-sdk-23' : 'uses-permission';
    const parts = [`android:name="${escapeAttribute(name)}"`];
    for (const [attribute, value] of attributeChanges(entry)) {
        if (value !== null) {
            parts.push(`${attribute}="${escapeAttribute(value)}"`);
        }
    }
    return `<${tag} ${parts.join(' ')} />`;
}

function normalizeEntries(entries: Array<AndroidPermissionEntryInput | string>): AndroidPermissionEntryInput[] {
    const seen = new Set<string>();
    const result: AndroidPermissionEntryInput[] = [];
    for (const raw of entries ?? []) {
        const entry: AndroidPermissionEntryInput = typeof raw === 'string' ? { name: raw } : { ...raw };
        const name = normalizeAndroidPermissionName(entry.name);
        if (!name) {
            continue;
        }
        const key = `${name}|${entry.sdk23 === true ? 'sdk23' : entry.sdk23 === false ? 'plain' : 'any'}`;
        if (seen.has(key)) {
            continue;
        }
        seen.add(key);
        result.push({ ...entry, name });
    }
    return result;
}

function lineBounds(content: string, start: number, end: number): { start: number; end: number; alone: boolean } {
    let lineStart = start;
    while (lineStart > 0 && (content[lineStart - 1] === ' ' || content[lineStart - 1] === '\t')) {
        lineStart--;
    }
    const startsLine = lineStart === 0 || content[lineStart - 1] === '\n';
    let lineEnd = end;
    while (lineEnd < content.length && (content[lineEnd] === ' ' || content[lineEnd] === '\t')) {
        lineEnd++;
    }
    let endsLine = lineEnd >= content.length;
    if (content[lineEnd] === '\r' && content[lineEnd + 1] === '\n') {
        lineEnd += 2;
        endsLine = true;
    } else if (content[lineEnd] === '\n') {
        lineEnd += 1;
        endsLine = true;
    }
    return startsLine && endsLine ? { start: lineStart, end: lineEnd, alone: true } : { start, end, alone: false };
}

function ensureToolsNamespace(content: string): string {
    const manifestMatch = /<manifest\b[^>]*>/.exec(content);
    if (!manifestMatch || manifestMatch[0].includes('xmlns:tools=')) {
        return content;
    }
    const tagText = manifestMatch[0];
    const insertAt = tagText.endsWith('/>') ? tagText.length - 2 : tagText.length - 1;
    const updatedTag = `${tagText.slice(0, insertAt).replace(/\s+$/, '')} xmlns:tools="${TOOLS_NAMESPACE}"${tagText.slice(insertAt)}`;
    return content.slice(0, manifestMatch.index) + updatedTag + content.slice(manifestMatch.index + tagText.length);
}

/**
 * Updates the permission elements of AndroidManifest.xml.
 *
 * `entries` is the full set the app should declare. A plain string is an
 * entry that only names the permission (existing attributes are kept), which
 * keeps the old `string[]` callers working.
 */
export function updateAndroidManifest(
    manifestContent: string,
    entries: Array<AndroidPermissionEntry | AndroidPermissionEntryInput | string>,
): string {
    const manifestMatch = /<manifest\b[^>]*>/.exec(manifestContent);
    if (!manifestMatch) {
        return manifestContent;
    }
    const newline = manifestContent.includes('\r\n') ? '\r\n' : '\n';
    const wanted = normalizeEntries(entries as Array<AndroidPermissionEntryInput | string>);
    const elements = parseManifestPermissions(manifestContent);

    // Match each entry to one existing element of the same name (same tag first).
    const matched = new Map<ManifestPermissionElement, AndroidPermissionEntryInput>();
    const unmatchedEntries: AndroidPermissionEntryInput[] = [];
    for (const entry of wanted) {
        const sameName = elements.filter(element => element.name === entry.name && !matched.has(element));
        const preferredTag: UsesPermissionTag | undefined =
            entry.sdk23 === true ? 'uses-permission-sdk-23' : entry.sdk23 === false ? 'uses-permission' : undefined;
        const element = (preferredTag && sameName.find(candidate => candidate.tag === preferredTag)) || sameName[0];
        if (element) {
            matched.set(element, entry);
        } else {
            unmatchedEntries.push(entry);
        }
    }

    type Edit = { start: number; end: number; text: string };
    const edits: Edit[] = [];
    let needsToolsNamespace = false;
    for (const element of elements) {
        const entry = matched.get(element);
        if (!entry) {
            if (isMergerRemoved(element)) {
                continue; // Never dropped implicitly.
            }
            const bounds = lineBounds(manifestContent, element.start, element.end);
            edits.push({ start: bounds.start, end: bounds.end, text: '' });
            continue;
        }
        const changes = attributeChanges(entry);
        const targetTag: UsesPermissionTag =
            entry.sdk23 === true ? 'uses-permission-sdk-23' : entry.sdk23 === false ? 'uses-permission' : element.tag;
        const updated = editElement(element.raw, element.tag, targetTag, changes);
        if (updated !== element.raw) {
            edits.push({ start: element.start, end: element.end, text: updated });
        }
        if ([...changes].some(([name, value]) => name.startsWith('tools:') && value !== null)) {
            needsToolsNamespace = true;
        }
    }

    if (unmatchedEntries.length > 0) {
        const kept = elements.filter(element => matched.has(element) || isMergerRemoved(element));
        const anchor = [...kept].reverse().find(element => !isMergerRemoved(element)) ?? kept[kept.length - 1];
        let indent = '    ';
        let insertAt: number;
        let prefix: string;
        let suffix: string;
        if (anchor) {
            const bounds = lineBounds(manifestContent, anchor.start, anchor.end);
            indent = manifestContent.slice(bounds.start, anchor.start).replace(/[^ \t]/g, '') || indent;
            if (bounds.alone) {
                insertAt = bounds.end;
                const endsWithNewline = manifestContent.slice(0, bounds.end).endsWith('\n');
                prefix = endsWithNewline ? '' : newline;
                suffix = endsWithNewline ? newline : '';
            } else {
                insertAt = anchor.end;
                prefix = newline;
                suffix = '';
            }
        } else if (elements.length > 0) {
            // Everything is being replaced: put the new set where the old one was.
            const first = elements[0];
            const bounds = lineBounds(manifestContent, first.start, first.end);
            indent = manifestContent.slice(bounds.start, first.start).replace(/[^ \t]/g, '') || indent;
            insertAt = bounds.alone ? bounds.start : first.start;
            prefix = '';
            suffix = bounds.alone ? newline : ' ';
        } else {
            insertAt = manifestMatch.index + manifestMatch[0].length;
            prefix = newline;
            suffix = '';
        }
        const lines = unmatchedEntries.map(entry => {
            if (entry.toolsNode || Object.keys(entry.toolsAttributes ?? {}).length > 0) {
                needsToolsNamespace = true;
            }
            return `${indent}${serializeNewElement(entry, entry.name)}`;
        });
        const text = `${prefix}${lines.join(newline)}${suffix}`;
        edits.push({ start: insertAt, end: insertAt, text });
    }

    // Apply from the end so offsets stay valid. Insertions at the same offset as a
    // removal's end are applied after it.
    edits.sort((a, b) => (b.start - a.start) || (b.end - a.end));
    let result = manifestContent;
    for (const edit of edits) {
        result = result.slice(0, edit.start) + edit.text + result.slice(edit.end);
    }

    if (needsToolsNamespace) {
        result = ensureToolsNamespace(result);
    }

    // Safeguard: never lose a <queries> block.
    const queries = /(\s*<queries>[\s\S]*?<\/queries>\s*)/.exec(manifestContent);
    if (queries && !result.includes('<queries>')) {
        const close = result.lastIndexOf('</manifest>');
        result = close === -1 ? result + queries[1] : result.slice(0, close) + queries[1] + result.slice(close);
    }
    return result;
}
