#!/usr/bin/env node
'use strict';

/**
 * convert-images-to-webp.js
 *
 * Converts the PNG / JPG / JPEG files declared as Flutter assets to WebP, then
 * (unless --keep-originals) deletes the originals and rewrites every static
 * reference to them in the project's Dart, JSON and YAML files, so the app keeps
 * working. Flutter decodes WebP natively on Android, iOS, web, desktop.
 *
 * Nothing is written unless you pass --apply; the default run encodes in memory
 * and reports how much space would be saved.
 *
 * Usage:
 *   node convert-images-to-webp.js [options]
 *
 * Exit codes:
 *   0 - completed (files may have been skipped, see the report)
 *   1 - error (e.g. no pubspec.yaml found, invalid option)
 */

const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');

const IMAGE_EXT_RE = /\.(png|jpe?g)$/i;
const VARIANT_DIR_RE = /(^|\/)\d+(?:\.\d+)?x\//;
// Directories that are never scanned for references (build/cache/vendored/native).
const EXCLUDED_DIRS = new Set([
    'build', '.dart_tool', '.git', '.idea', '.vscode', 'node_modules', 'out', 'coverage', 'Pods',
    'android', 'ios', 'macos', 'linux', 'windows', 'web',
]);
const MAX_SOURCE_BYTES = 8 * 1024 * 1024;

const HELP = `convert-images-to-webp.js - convert PNG/JPG/JPEG assets to WebP

Usage:
  node convert-images-to-webp.js [options]

Without --apply nothing is written: images are encoded in memory and the report
shows what would be saved.

Options:
  --path <dir>         Path to the Flutter project (default: current directory)
  --assets-path <dir>  Only convert images under this folder (e.g. assets/images)
  --apply              Write the .webp files, delete the originals and rewrite the
                       references in Dart/JSON/YAML files
  --keep-originals     With --apply: only write the .webp files next to the originals
                       (no deletion, no reference rewriting)
  --quality <1-100>    Lossy quality (default: 85)
  --lossless           Lossless WebP (exact pixels; larger files, best for UI art)
  --method <0-6>       Encoder effort, higher is slower and smaller (default: 4)
  --min-psnr <dB>      Skip an image whose decoded WebP is further than this from the
                       original (default: 35, 0 disables the check)
  --min-savings <pct>  Skip an image unless WebP is at least this much smaller
                       (default: 1)
  --ignore-asset-dirs <list>
                       Asset folders to leave alone (comma-separated and/or repeated)
  --json               Print machine-readable JSON instead of human text
  --log-path <file>    Write the report to a file as well
  -h, --help           Show this help

Images are skipped (never deleted) when the project refers to them in a way that
cannot be rewritten safely: a path built at runtime ('assets/images/$name.png'),
a bare file name, or a tool configuration such as flutter_launcher_icons.
Resolution variants (assets/2.0x/foo.png) are converted together or not at all.
`;

// ---------------------------------------------------------------------------
// Arguments
// ---------------------------------------------------------------------------

function pushList(target, value) {
    for (const part of String(value).split(',')) {
        const trimmed = part.trim();
        if (trimmed) {
            target.push(trimmed);
        }
    }
}

function fail(message) {
    console.error(`Error: ${message}`);
    process.exit(1);
}

function parseNumber(name, value, min, max, integer = true) {
    const n = Number(value);
    if (!Number.isFinite(n) || n < min || n > max || (integer && !Number.isInteger(n))) {
        fail(`${name} must be ${integer ? 'an integer' : 'a number'} between ${min} and ${max} (got "${value}").`);
    }
    return n;
}

function parseArgs(argv) {
    const args = {
        path: process.cwd(),
        assetsPath: null,
        apply: false,
        keepOriginals: false,
        quality: 85,
        lossless: false,
        method: 4,
        minPsnr: 35,
        minSavings: 1,
        ignoreAssetDirs: [],
        json: false,
        logPath: null,
        help: false,
    };
    const valued = new Set([
        '--path', '--assets-path', '--quality', '--method', '--min-psnr', '--min-savings',
        '--ignore-asset-dirs', '--log-path',
    ]);
    const positionals = [];
    for (let i = 0; i < argv.length; i++) {
        let arg = argv[i];
        let inline;
        const eq = arg.indexOf('=');
        if (arg.startsWith('--') && eq > 0) {
            inline = arg.slice(eq + 1);
            arg = arg.slice(0, eq);
        }
        let value = inline;
        if (valued.has(arg) && value === undefined) {
            value = argv[++i];
            if (value === undefined) {
                fail(`${arg} needs a value.`);
            }
        }
        switch (arg) {
            case '-h': case '--help': args.help = true; break;
            case '--path': args.path = value; break;
            case '--assets-path': args.assetsPath = value; break;
            case '--apply': args.apply = true; break;
            case '--keep-originals': args.keepOriginals = true; break;
            case '--lossless': args.lossless = true; break;
            case '--json': args.json = true; break;
            case '--log-path': args.logPath = value; break;
            case '--quality': args.quality = parseNumber('--quality', value, 1, 100); break;
            case '--method': args.method = parseNumber('--method', value, 0, 6); break;
            case '--min-psnr': args.minPsnr = parseNumber('--min-psnr', value, 0, 100, false); break;
            case '--min-savings': args.minSavings = parseNumber('--min-savings', value, 0, 100, false); break;
            case '--ignore-asset-dirs': pushList(args.ignoreAssetDirs, value); break;
            default:
                if (arg.startsWith('-')) {
                    fail(`unknown option ${arg}. Use --help.`);
                }
                positionals.push(arg);
        }
    }
    if (args.path === process.cwd() && positionals.length > 0) {
        args.path = positionals[0];
    }
    if (args.keepOriginals && !args.apply) {
        fail('--keep-originals only makes sense together with --apply.');
    }
    return args;
}

// ---------------------------------------------------------------------------
// pubspec.yaml / file discovery
// ---------------------------------------------------------------------------

function indentationOf(line) {
    const match = line.match(/^[ \t]*/);
    return match ? match[0].length : 0;
}

function isComment(line) {
    return line.trim().startsWith('#');
}

/** The `flutter: assets:` entries (project-relative files or folders, as declared). */
function extractAssetEntries(pubspecText) {
    const lines = pubspecText.split(/\r?\n/);
    const flutterIdx = lines.findIndex((line) => /^flutter:\s*$/.test(line));
    if (flutterIdx === -1) {
        return [];
    }
    const flutterIndent = indentationOf(lines[flutterIdx]);
    let assetsIdx = -1;
    for (let i = flutterIdx + 1; i < lines.length; i++) {
        const line = lines[i];
        if (line.trim() === '' || isComment(line)) {
            continue;
        }
        if (indentationOf(line) <= flutterIndent) {
            break;
        }
        if (/^\s*assets:\s*$/.test(line)) {
            assetsIdx = i;
            break;
        }
    }
    if (assetsIdx === -1) {
        return [];
    }
    const assetsIndent = indentationOf(lines[assetsIdx]);
    const entries = [];
    for (let i = assetsIdx + 1; i < lines.length; i++) {
        const line = lines[i];
        if (line.trim() === '' || isComment(line)) {
            continue;
        }
        if (indentationOf(line) <= assetsIndent) {
            break;
        }
        const match = line.match(/^\s*-\s*(.+?)\s*$/);
        if (!match) {
            continue;
        }
        let value = match[1].trim();
        if (!value.startsWith('"') && !value.startsWith("'")) {
            value = value.replace(/\s+#.*$/, '').trim();
        }
        value = value.replace(/^['"](.*)['"]$/, '$1').trim();
        if (value) {
            entries.push(value);
        }
    }
    return entries;
}

function toProjectRelative(root, absPath) {
    return path.relative(root, absPath).split(path.sep).join('/');
}

function walk(dir, onFile, excludedDirs, skipDirs) {
    let list;
    try {
        list = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
        return;
    }
    for (const entry of list) {
        if (entry.name.startsWith('.')) {
            continue;
        }
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
            if (excludedDirs && excludedDirs.has(entry.name)) {
                continue;
            }
            if (skipDirs && skipDirs.some((d) => full === d || full.startsWith(d + path.sep))) {
                continue;
            }
            walk(full, onFile, excludedDirs, skipDirs);
        } else if (entry.isFile()) {
            onFile(full);
        }
    }
}

function isUnderAnyDir(relPath, dirs) {
    for (const dir of dirs || []) {
        const d = String(dir).replace(/\\/g, '/').replace(/^\.?\//, '').replace(/\/+$/, '');
        if (d && (relPath === d || relPath.startsWith(d + '/'))) {
            return true;
        }
    }
    return false;
}

/** Every PNG/JPG/JPEG file under the declared asset entries (project-relative, forward slashes). */
function collectImages(root, entries, assetsPathOverride, ignoreAssetDirs) {
    const targets = assetsPathOverride ? [assetsPathOverride] : entries;
    const seen = new Set();
    const files = [];
    const add = (rel) => {
        if (!IMAGE_EXT_RE.test(rel) || seen.has(rel) || isUnderAnyDir(rel, ignoreAssetDirs)) {
            return;
        }
        seen.add(rel);
        files.push(rel);
    };
    for (const target of targets) {
        const abs = path.resolve(root, target);
        let stat;
        try {
            stat = fs.statSync(abs);
        } catch {
            continue;
        }
        if (!abs.startsWith(root + path.sep)) {
            continue; // never touch anything outside the project
        }
        if (stat.isFile()) {
            add(toProjectRelative(root, abs));
        } else if (stat.isDirectory()) {
            walk(abs, (f) => add(toProjectRelative(root, f)), null, null);
        }
    }
    return files.sort();
}

/** The asset directories (absolute) so source scanning does not read the assets themselves. */
function assetDirectories(root, entries, assetsPathOverride) {
    const targets = assetsPathOverride ? [assetsPathOverride] : entries;
    return targets
        .map((e) => path.resolve(root, e))
        .filter((p) => {
            try {
                return fs.statSync(p).isDirectory();
            } catch {
                return false;
            }
        });
}

// ---------------------------------------------------------------------------
// Reference analysis
// ---------------------------------------------------------------------------

/**
 * Finds every string literal in Dart source: position of the content, whether it is interpolated and
 * whether `+` follows it (string concatenation). Comments are skipped; raw and triple-quoted strings
 * and nested `${...}` expressions are understood.
 */
function scanDartLiterals(src) {
    const literals = [];
    const n = src.length;
    let i = 0;

    function skipComment() {
        if (src[i] === '/' && src[i + 1] === '/') {
            while (i < n && src[i] !== '\n') {
                i++;
            }
            return true;
        }
        if (src[i] === '/' && src[i + 1] === '*') {
            let depth = 1;
            i += 2;
            while (i < n && depth > 0) {
                if (src[i] === '/' && src[i + 1] === '*') {
                    depth++;
                    i += 2;
                } else if (src[i] === '*' && src[i + 1] === '/') {
                    depth--;
                    i += 2;
                } else {
                    i++;
                }
            }
            return true;
        }
        return false;
    }

    function readString(raw) {
        const quote = src[i];
        const triple = src.startsWith(quote.repeat(3), i);
        const open = triple ? 3 : 1;
        i += open;
        const start = i;
        let interpolated = false;
        while (i < n) {
            const c = src[i];
            if (!raw && c === '\\') {
                i += 2;
                continue;
            }
            if (triple ? src.startsWith(quote.repeat(3), i) : c === quote) {
                literals.push({ start, end: i, value: src.slice(start, i), interpolated, closeLength: open });
                i += open;
                return;
            }
            if (!triple && c === '\n') {
                return; // unterminated; give up on this string
            }
            if (!raw && c === '$') {
                if (src[i + 1] === '{') {
                    interpolated = true;
                    i += 2;
                    scanCode(1);
                    continue;
                }
                if (/[A-Za-z_]/.test(src[i + 1] || '')) {
                    interpolated = true;
                }
            }
            i++;
        }
    }

    function scanCode(depthStart) {
        let depth = depthStart;
        while (i < n) {
            if (skipComment()) {
                continue;
            }
            const c = src[i];
            if (c === '{') {
                depth++;
                i++;
            } else if (c === '}') {
                depth--;
                i++;
                if (depthStart > 0 && depth <= 0) {
                    return;
                }
            } else if (c === '"' || c === "'") {
                readString(false);
            } else if ((c === 'r' || c === 'R') && (src[i + 1] === '"' || src[i + 1] === "'") && !/[A-Za-z0-9_$]/.test(src[i - 1] || '')) {
                i++;
                readString(true);
            } else {
                i++;
            }
        }
    }

    scanCode(0);
    for (const literal of literals) {
        let j = literal.end + literal.closeLength;
        while (j < n && /\s/.test(src[j])) {
            j++;
        }
        literal.concatenated = src[j] === '+';
    }
    return literals;
}

/** JSON string values (no interpolation, no comments). */
function scanJsonLiterals(src) {
    const literals = [];
    const re = /"((?:\\.|[^"\\\r\n])*)"/g;
    let m;
    while ((m = re.exec(src)) !== null) {
        literals.push({
            start: m.index + 1,
            end: m.index + 1 + m[1].length,
            value: m[1],
            interpolated: false,
            concatenated: false,
            closeLength: 1,
        });
    }
    return literals;
}

/**
 * The identity of an asset for matching against source text. macOS stores accented file names decomposed
 * (NFD) while editors write them composed (NFC), so both sides are compared in NFC; the real file name is
 * still what is read, written and deleted.
 */
function logicalKey(assetPath) {
    return assetPath.replace(VARIANT_DIR_RE, '$1').normalize('NFC');
}

function baseName(p) {
    return p.slice(p.lastIndexOf('/') + 1);
}

function escapeRegExp(value) {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Reads the project's sources and works out, per logical asset (a file plus its 2.0x/3.0x variants),
 * which references can be rewritten and which make the asset unsafe to rename.
 */
function analyzeReferences(root, groups, assetAbsDirs) {
    const keys = [...groups.keys()];
    const keySet = new Set(keys);
    const blocked = new Map(); // key -> reason
    const replacements = new Map(); // abs file -> [{start,end,to}]
    const block = (key, reason) => {
        if (!blocked.has(key)) {
            blocked.set(key, reason);
        }
    };
    const addReplacement = (file, start, end, to, key) => {
        if (!replacements.has(file)) {
            replacements.set(file, []);
        }
        replacements.get(file).push({ start, end, to, key });
    };

    const sources = [];
    walk(root, (f) => {
        const ext = path.extname(f).toLowerCase();
        if (['.dart', '.json', '.yaml', '.yml'].includes(ext)) {
            sources.push(f);
        }
    }, EXCLUDED_DIRS, assetAbsDirs);

    for (const file of sources) {
        const rel = toProjectRelative(root, file);
        let size;
        try {
            size = fs.statSync(file).size;
        } catch {
            continue;
        }
        if (size > MAX_SOURCE_BYTES) {
            continue;
        }
        const text = fs.readFileSync(file, 'utf8');
        const ext = path.extname(file).toLowerCase();

        if (ext === '.yaml' || ext === '.yml') {
            // YAML is only scanned at the project root (pubspec.yaml, flutter_launcher_icons.yaml, ...).
            if (path.dirname(file) !== root) {
                continue;
            }
            analyzeYaml(rel, file, text, keys, keySet, block, addReplacement);
            continue;
        }

        const literals = ext === '.dart' ? scanDartLiterals(text) : scanJsonLiterals(text);
        for (const literal of literals) {
            classifyLiteral(literal, file, rel, keys, keySet, block, addReplacement);
        }
    }
    return { blocked, replacements };
}

function classifyLiteral(literal, file, rel, keys, keySet, block, addReplacement) {
    const value = literal.value.normalize('NFC');
    if (!value) {
        return;
    }
    if (literal.interpolated || literal.concatenated) {
        const dollar = value.indexOf('$');
        const prefix = literal.interpolated && dollar >= 0 ? value.slice(0, dollar) : value;
        if (!prefix.includes('/')) {
            return;
        }
        const tailExt = /\.([A-Za-z0-9]+)$/.exec(value);
        if (tailExt && !IMAGE_EXT_RE.test(value)) {
            return; // builds a path to some other kind of file
        }
        for (const key of keys) {
            if (key.startsWith(prefix)) {
                block(key, `a path is built at runtime in ${rel} ("${value}")`);
            }
        }
        return;
    }
    if (keySet.has(value)) {
        addReplacement(file, literal.start, literal.end, literal.value.replace(IMAGE_EXT_RE, '.webp'), value);
        return;
    }
    if (!IMAGE_EXT_RE.test(value) || /^[a-z][a-z0-9+.-]*:\/\//i.test(value)) {
        return; // not an image path, or a URL
    }
    // An image path that is not an exact asset path ('logo.png', '/images/logo.png', 'assets/x.png?v=2'):
    // it may well point at one of our files, and we cannot rewrite it with confidence.
    const trimmed = value.replace(/^\.?\/+/, '');
    for (const key of keys) {
        if (key === trimmed || key.endsWith('/' + trimmed) || (!trimmed.includes('/') && baseName(key) === trimmed)) {
            block(key, `${rel} refers to it by a partial path ("${value}")`);
        }
    }
}

/** YAML: a `- path` item under pubspec's flutter.assets is rewritten, any other mention blocks the asset. */
function analyzeYaml(rel, file, text, keys, keySet, block, addReplacement) {
    const isPubspec = path.basename(file) === 'pubspec.yaml';
    const lines = text.split('\n');
    let offset = 0;
    const assetListLines = isPubspec ? flutterAssetItemLines(lines) : new Set();
    lines.forEach((line, lineIndex) => {
        const lineStart = offset;
        offset += line.length + 1;
        const normalizedLine = line.normalize('NFC');
        for (const key of keys) {
            const at = line.indexOf(key);
            const found = at >= 0 ? at : normalizedLine.indexOf(key);
            if (found < 0) {
                continue;
            }
            const after = normalizedLine[found + key.length];
            if (after && /[A-Za-z0-9_]/.test(after)) {
                continue;
            }
            if (at >= 0 && assetListLines.has(lineIndex) && /^\s*-\s*['"]?[^'"#]+['"]?\s*(#.*)?\r?$/.test(line) && line.split(key).length === 2) {
                addReplacement(file, lineStart + at, lineStart + at + key.length, key.replace(IMAGE_EXT_RE, '.webp'), key);
            } else {
                block(key, `${rel} (line ${lineIndex + 1}) refers to it outside the flutter.assets list`);
            }
        }
        // Mentions by file name only inside tool configuration.
        if (!assetListLines.has(lineIndex) && keySet.size > 0) {
            const names = normalizedLine.match(/[^\s'"\/]+\.(?:png|jpe?g)\b/gi) || [];
            for (const name of names) {
                for (const key of keys) {
                    if (baseName(key) === name && !normalizedLine.includes(key)) {
                        block(key, `${rel} (line ${lineIndex + 1}) mentions ${name}`);
                    }
                }
            }
        }
    });
}

/** Line indexes (0-based) of the `- item` lines in pubspec's `flutter: assets:` list. */
function flutterAssetItemLines(lines) {
    const result = new Set();
    const flutterIdx = lines.findIndex((line) => /^flutter:\s*$/.test(line));
    if (flutterIdx === -1) {
        return result;
    }
    const flutterIndent = indentationOf(lines[flutterIdx]);
    let assetsIdx = -1;
    for (let i = flutterIdx + 1; i < lines.length; i++) {
        if (lines[i].trim() === '' || isComment(lines[i])) {
            continue;
        }
        if (indentationOf(lines[i]) <= flutterIndent) {
            break;
        }
        if (/^\s*assets:\s*$/.test(lines[i])) {
            assetsIdx = i;
            break;
        }
    }
    if (assetsIdx === -1) {
        return result;
    }
    const assetsIndent = indentationOf(lines[assetsIdx]);
    for (let i = assetsIdx + 1; i < lines.length; i++) {
        if (lines[i].trim() === '' || isComment(lines[i])) {
            continue;
        }
        if (indentationOf(lines[i]) <= assetsIndent) {
            break;
        }
        if (/^\s*-\s*/.test(lines[i])) {
            result.add(i);
        }
    }
    return result;
}

// ---------------------------------------------------------------------------
// Codec (Jimp decodes PNG/JPEG, the jSquash WASM encoder writes WebP)
// ---------------------------------------------------------------------------

async function loadCodec() {
    let Jimp;
    try {
        ({ Jimp } = require('jimp'));
    } catch (error) {
        fail(`the "jimp" package is required (run npm install): ${error.message}`);
    }
    let packageDir;
    try {
        packageDir = path.dirname(require.resolve('@jsquash/webp'));
    } catch (error) {
        fail(`the "@jsquash/webp" package is required (run npm install): ${error.message}`);
    }
    const load = (name) => import(pathToFileURL(path.join(packageDir, name)).href);
    const [encodeModule, decodeModule, featureDetect] = await Promise.all([
        load('encode.js'),
        load('decode.js'),
        import(pathToFileURL(require.resolve('wasm-feature-detect', { paths: [packageDir] })).href).catch(() => null),
    ]);
    // The WASM bytes are handed over explicitly: the packaged loader fetches them by URL, which Node cannot do.
    const wasm = (relative) => WebAssembly.compile(fs.readFileSync(path.join(packageDir, 'codec', relative)));
    const hasSimd = featureDetect && typeof featureDetect.simd === 'function' ? await featureDetect.simd() : false;
    await encodeModule.init(await wasm(hasSimd ? 'enc/webp_enc_simd.wasm' : 'enc/webp_enc.wasm'));
    await decodeModule.init(await wasm('dec/webp_dec.wasm'));
    return { Jimp, encode: encodeModule.default, decode: decodeModule.default };
}

/**
 * PSNR in dB between two RGBA buffers, comparing alpha-premultiplied colour: what you actually see when the
 * image is drawn over a background. Comparing raw RGB would blame the encoder for the (invisible) colour of
 * almost-transparent pixels.
 */
function psnr(original, decoded) {
    let squared = 0;
    for (let p = 0; p < original.length; p += 4) {
        const alphaA = original[p + 3] / 255;
        const alphaB = decoded[p + 3] / 255;
        for (let c = 0; c < 3; c++) {
            const d = original[p + c] * alphaA - decoded[p + c] * alphaB;
            squared += d * d;
        }
        const da = original[p + 3] - decoded[p + 3];
        squared += da * da;
    }
    if (squared === 0) {
        return Infinity;
    }
    return 10 * Math.log10((255 * 255) / (squared / original.length));
}

async function convertOne(codec, args, absPath) {
    const input = fs.readFileSync(absPath);
    let image;
    try {
        image = await codec.Jimp.read(input);
    } catch (error) {
        return { status: 'failed', reason: `could not decode (${error.message})` };
    }
    const { width, height } = image.bitmap;
    const rgba = new Uint8ClampedArray(image.bitmap.data.buffer, image.bitmap.data.byteOffset, image.bitmap.data.length);
    let encoded;
    try {
        encoded = await codec.encode(
            { data: rgba, width, height, colorSpace: 'srgb' },
            { quality: args.quality, lossless: args.lossless ? 1 : 0, method: args.method, exact: 0 }
        );
    } catch (error) {
        return { status: 'failed', reason: `could not encode (${error.message})` };
    }
    const output = Buffer.from(encoded);
    const decoded = await codec.decode(encoded);
    if (decoded.width !== width || decoded.height !== height) {
        return { status: 'failed', reason: 'the encoded WebP has different dimensions' };
    }
    const quality = args.lossless ? Infinity : psnr(image.bitmap.data, decoded.data);
    return { status: 'encoded', buffer: output, before: input.length, after: output.length, psnr: quality, width, height };
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

function formatSize(bytes) {
    if (bytes < 1024) {
        return `${bytes} B`;
    }
    if (bytes < 1024 * 1024) {
        return `${(bytes / 1024).toFixed(1)} KB`;
    }
    return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

function percent(before, after) {
    return before > 0 ? Math.round((1 - after / before) * 100) : 0;
}

function writeFileAtomic(target, buffer) {
    const temp = `${target}.tmp-${process.pid}`;
    fs.writeFileSync(temp, buffer);
    fs.renameSync(temp, target);
}

function applyReplacements(file, list) {
    let text = fs.readFileSync(file, 'utf8');
    for (const { start, end, to } of [...list].sort((a, b) => b.start - a.start)) {
        text = text.slice(0, start) + to + text.slice(end);
    }
    fs.writeFileSync(file, text, 'utf8');
}

async function main() {
    const args = parseArgs(process.argv.slice(2));
    if (args.help) {
        console.log(HELP.trim());
        return;
    }

    const root = path.resolve(args.path);
    if (!fs.existsSync(root) || !fs.statSync(root).isDirectory()) {
        fail(`path is not a directory: ${root}`);
    }
    const pubspecPath = path.join(root, 'pubspec.yaml');
    if (!fs.existsSync(pubspecPath)) {
        fail(`no pubspec.yaml found in ${root}. Not a Flutter project?`);
    }
    const entries = extractAssetEntries(fs.readFileSync(pubspecPath, 'utf8'));
    if (entries.length === 0 && !args.assetsPath) {
        fail('no flutter.assets entries found in pubspec.yaml.');
    }

    const images = collectImages(root, entries, args.assetsPath, args.ignoreAssetDirs);
    const groups = new Map(); // logical key -> [project-relative file]
    for (const image of images) {
        const key = logicalKey(image);
        if (!groups.has(key)) {
            groups.set(key, []);
        }
        groups.get(key).push(image);
    }

    const results = []; // { path, group, status, reason?, before?, after?, psnr? }
    const deleteOriginals = !args.keepOriginals;
    const rewriting = args.apply ? !args.keepOriginals : true; // dry-run reports what --apply would do
    let blocked = new Map();
    let replacements = new Map();
    if (rewriting) {
        ({ blocked, replacements } = analyzeReferences(root, groups, assetDirectories(root, entries, args.assetsPath)));
    }

    const codec = images.length > 0 ? await loadCodec() : null;
    const pending = []; // converted groups ready to be written

    for (const [key, files] of groups) {
        if (blocked.has(key)) {
            for (const file of files) {
                results.push({ path: file, status: 'skipped', reason: blocked.get(key) });
            }
            continue;
        }
        const outputs = [];
        let groupFailure = null;
        for (const file of files) {
            const target = file.replace(IMAGE_EXT_RE, '.webp');
            if (fs.existsSync(path.join(root, target))) {
                groupFailure = { path: file, reason: `${target} already exists` };
                break;
            }
            const outcome = await convertOne(codec, args, path.join(root, file));
            if (outcome.status !== 'encoded') {
                groupFailure = { path: file, reason: outcome.reason, failed: true };
                break;
            }
            const saved = percent(outcome.before, outcome.after);
            if (outcome.after >= outcome.before || saved < args.minSavings) {
                groupFailure = { path: file, reason: `WebP would not be smaller (${formatSize(outcome.before)} -> ${formatSize(outcome.after)})` };
                break;
            }
            if (args.minPsnr > 0 && outcome.psnr < args.minPsnr) {
                groupFailure = { path: file, reason: `quality loss too high (PSNR ${outcome.psnr.toFixed(1)} dB < ${args.minPsnr}); use a higher --quality or --lossless` };
                break;
            }
            outputs.push({ file, target, outcome });
        }
        if (groupFailure) {
            for (const file of files) {
                const own = file === groupFailure.path;
                results.push({
                    path: file,
                    status: groupFailure.failed && own ? 'failed' : 'skipped',
                    reason: own ? groupFailure.reason : `its variant ${groupFailure.path} was not converted: ${groupFailure.reason}`,
                });
            }
            continue;
        }
        for (const { file, target, outcome } of outputs) {
            results.push({
                path: file,
                status: args.apply ? 'converted' : 'would-convert',
                webp: target,
                before: outcome.before,
                after: outcome.after,
                psnr: Number.isFinite(outcome.psnr) ? Math.round(outcome.psnr * 10) / 10 : null,
            });
        }
        pending.push({ key, outputs });
    }

    // Write everything.
    const rewrittenFiles = new Set();
    if (args.apply) {
        for (const { key, outputs } of pending) {
            for (const { target, outcome } of outputs) {
                writeFileAtomic(path.join(root, target), outcome.buffer);
            }
            if (deleteOriginals) {
                for (const { file } of outputs) {
                    fs.unlinkSync(path.join(root, file));
                }
            }
        }
        if (deleteOriginals) {
            const convertedKeys = new Set(pending.map((p) => p.key));
            for (const [file, list] of replacements) {
                const relevant = list.filter((r) => convertedKeys.has(r.key));
                if (relevant.length > 0) {
                    applyReplacements(file, relevant);
                    rewrittenFiles.add(toProjectRelative(root, file));
                }
            }
        }
    }

    const done = results.filter((r) => r.status === 'converted' || r.status === 'would-convert');
    const before = done.reduce((sum, r) => sum + r.before, 0);
    const after = done.reduce((sum, r) => sum + r.after, 0);
    const summary = {
        projectRoot: root,
        applied: args.apply,
        keepOriginals: args.apply && args.keepOriginals,
        lossless: args.lossless,
        quality: args.quality,
        totalImages: images.length,
        converted: done.length,
        skipped: results.filter((r) => r.status === 'skipped').length,
        failed: results.filter((r) => r.status === 'failed').length,
        bytesBefore: before,
        bytesAfter: after,
        bytesSaved: before - after,
        rewrittenFiles: [...rewrittenFiles].sort(),
        images: results.sort((a, b) => a.path.localeCompare(b.path)),
    };

    const output = args.json ? JSON.stringify(summary, null, 2) : buildReport(summary);
    console.log(output);
    if (args.logPath) {
        fs.writeFileSync(path.resolve(root, args.logPath), output + '\n', 'utf8');
    }
}

function buildReport(summary) {
    const lines = [];
    lines.push(`WebP conversion ${summary.applied ? '' : '(dry run - nothing was written) '}for ${summary.projectRoot}`);
    lines.push(`Mode: ${summary.lossless ? 'lossless' : `lossy, quality ${summary.quality}`}${summary.keepOriginals ? ', originals kept' : ''}`);
    lines.push('');
    for (const r of summary.images) {
        if (r.status === 'converted' || r.status === 'would-convert') {
            const psnr = r.psnr === null ? 'lossless' : `${r.psnr} dB`;
            lines.push(`  ${summary.applied ? '✓' : '→'} ${r.path}  ${formatSize(r.before)} -> ${formatSize(r.after)}  (-${percent(r.before, r.after)}%, ${psnr})`);
        } else {
            lines.push(`  ${r.status === 'failed' ? '✗' : '–'} ${r.path}  ${r.status}: ${r.reason}`);
        }
    }
    lines.push('');
    lines.push(`Images: ${summary.totalImages}  ${summary.applied ? 'converted' : 'convertible'}: ${summary.converted}  skipped: ${summary.skipped}  failed: ${summary.failed}`);
    lines.push(`Size: ${formatSize(summary.bytesBefore)} -> ${formatSize(summary.bytesAfter)}  (saves ${formatSize(summary.bytesSaved)}, ${percent(summary.bytesBefore, summary.bytesAfter)}%)`);
    if (summary.rewrittenFiles.length > 0) {
        lines.push(`References updated in ${summary.rewrittenFiles.length} file(s): ${summary.rewrittenFiles.join(', ')}`);
    }
    if (!summary.applied && summary.converted > 0) {
        lines.push('');
        lines.push('Run again with --apply to write the files, delete the originals and update references.');
    }
    if (summary.applied && !summary.keepOriginals && summary.converted > 0) {
        lines.push('');
        lines.push('Originals were deleted and references rewritten. Paths built from variables cannot be detected: run the app and review the diff.');
    }
    return lines.join('\n');
}

main().catch((error) => {
    console.error(`Error: ${error && error.stack ? error.stack : error}`);
    process.exit(1);
});
