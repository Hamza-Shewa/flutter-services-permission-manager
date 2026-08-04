#!/usr/bin/env node
'use strict';

/**
 * check-unused-assets.js
 *
 * Scans a Flutter project and reports (or deletes) asset files that are not
 * referenced anywhere in the project's Dart/JSON source.
 *
 * Inspired by https://github.com/3boodev/unused_assets_removal
 *
 * Usage:
 *   node check-unused-assets.js [options]
 *
 * Options:
 *   --path <dir>         Path to the Flutter project (default: current directory)
 *   --assets-path <dir>  Only scan this asset folder (e.g. assets/images)
 *   --delete             Actually delete the unused files (default is dry-run)
 *   --json               Print machine-readable JSON instead of human text
 *   --log-path <file>    Write the report to a file as well
 *   -h, --help           Show this help
 *
 * Exit codes:
 *   0 - completed successfully (unused assets may have been found)
 *   1 - error (e.g. no pubspec.yaml found)
 */

const fs = require('fs');
const path = require('path');

// Directories that are never scanned for references (build/cache/vendored).
const EXCLUDED_DIRS = new Set([
    'build',
    '.dart_tool',
    '.git',
    '.idea',
    '.vscode',
    'node_modules',
    'out',
    'coverage',
    'Pods',
]);

const HELP = `check-unused-assets.js - detect unused asset files in a Flutter project

Usage:
  node check-unused-assets.js [options]

Options:
  --path <dir>         Path to the Flutter project (default: current directory)
  --assets-path <dir>  Only scan this asset folder (e.g. assets/images)
  --delete             Actually delete the unused files (default is dry-run)
  --json               Print machine-readable JSON instead of human text
  --log-path <file>    Write the report to a file as well
  --ignore-dirs <list> Project-relative directories to skip when scanning for
                       references, comma-separated and/or repeated
                       (e.g. --ignore-dirs lib/widgets,lib/generated)
  --ignore-files <list>Files to skip when scanning for references, by relative
                       path or basename, comma-separated and/or repeated
                       (e.g. --ignore-files my_image.dart,my_icon.dart)
  --ignore-dynamic-dirs <list>
                       Directories to skip for DYNAMIC pattern detection only;
                       literal asset references in them still count as used
  --ignore-dynamic-files <list>
                       Files (relative path or basename) to skip for DYNAMIC
                       pattern detection only; literal references still count
  -h, --help           Show this help

Example:
  node check-unused-assets.js --path ~/projects/my_app --dry-run
  node check-unused-assets.js --path ~/projects/my_app --delete
`;

function printHelp() {
    console.log(HELP.trim());
}

function parseArgs(argv) {
    const args = {
        path: process.cwd(),
        delete: false,
        json: false,
        help: false,
        assetsPath: null,
        logPath: null,
        ignoreDirs: [],
        ignoreFiles: [],
        ignoreDynamicDirs: [],
        ignoreDynamicFiles: [],
    };

    const pushList = (arr, raw) => {
        for (const part of String(raw || '').split(',')) {
            const v = part.trim();
            if (v) {
                arr.push(v);
            }
        }
    };

    const positionals = [];
    for (let i = 0; i < argv.length; i++) {
        const arg = argv[i];
        switch (arg) {
            case '-h':
            case '--help':
                args.help = true;
                break;
            case '--delete':
            case '-d':
                args.delete = true;
                break;
            case '--json':
                args.json = true;
                break;
            case '--path':
            case '-p':
                args.path = argv[++i];
                break;
            case '--assets-path':
                args.assetsPath = argv[++i];
                break;
            case '--log-path':
                args.logPath = argv[++i];
                break;
            case '--ignore-dirs':
                pushList(args.ignoreDirs, argv[++i]);
                break;
            case '--ignore-files':
                pushList(args.ignoreFiles, argv[++i]);
                break;
            case '--ignore-dynamic-dirs':
                pushList(args.ignoreDynamicDirs, argv[++i]);
                break;
            case '--ignore-dynamic-files':
                pushList(args.ignoreDynamicFiles, argv[++i]);
                break;
            default:
                if (arg.startsWith('--path=')) {
                    args.path = arg.slice('--path='.length);
                } else if (arg.startsWith('--assets-path=')) {
                    args.assetsPath = arg.slice('--assets-path='.length);
                } else if (arg.startsWith('--log-path=')) {
                    args.logPath = arg.slice('--log-path='.length);
                } else if (arg.startsWith('--ignore-dirs=')) {
                    pushList(args.ignoreDirs, arg.slice('--ignore-dirs='.length));
                } else if (arg.startsWith('--ignore-files=')) {
                    pushList(args.ignoreFiles, arg.slice('--ignore-files='.length));
                } else if (arg.startsWith('--ignore-dynamic-dirs=')) {
                    pushList(args.ignoreDynamicDirs, arg.slice('--ignore-dynamic-dirs='.length));
                } else if (arg.startsWith('--ignore-dynamic-files=')) {
                    pushList(args.ignoreDynamicFiles, arg.slice('--ignore-dynamic-files='.length));
                } else if (!arg.startsWith('-')) {
                    positionals.push(arg);
                }
                break;
        }
    }

    if (args.path === process.cwd() && positionals.length > 0) {
        args.path = positionals[0];
    }

    return args;
}

function indentationOf(line) {
    const match = line.match(/^[ \t]*/);
    return match ? match[0].length : 0;
}

function isComment(line) {
    return line.trim().startsWith('#');
}

/**
 * Extract the `flutter.assets` entries from a pubspec.yaml string.
 * Returns project-relative folder/file paths (as declared).
 */
function extractAssetEntries(pubspecText) {
    const lines = pubspecText.split('\n');

    // Find the top-level `flutter:` block (must start at column 0).
    let flutterIdx = -1;
    for (let i = 0; i < lines.length; i++) {
        if (/^flutter:\s*$/.test(lines[i])) {
            flutterIdx = i;
            break;
        }
    }
    if (flutterIdx === -1) {
        return [];
    }
    const flutterIndent = indentationOf(lines[flutterIdx]);

    // Find the `assets:` key inside the flutter block.
    let assetsIdx = -1;
    for (let i = flutterIdx + 1; i < lines.length; i++) {
        const line = lines[i];
        if (line.trim() === '' || isComment(line)) {
            continue;
        }
        const indent = indentationOf(line);
        if (indent <= flutterIndent) {
            break; // left the flutter block
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
        const indent = indentationOf(line);
        if (indent <= assetsIndent) {
            break; // left the assets list
        }
        const match = line.match(/^\s*-\s*(.+?)\s*$/);
        if (!match) {
            continue;
        }
        let value = match[1].trim();
        // Strip inline YAML comments (not inside quotes).
        if (!value.startsWith('"') && !value.startsWith("'")) {
            value = value.replace(/\s+#.*$/, '').trim();
        }
        // Strip surrounding quotes.
        value = value.replace(/^['"](.*)['"]$/, '$1').trim();
        if (value) {
            entries.push(value);
        }
    }
    return entries;
}

/**
 * Extract asset paths declared in the `flutter.fonts` section. Fonts are
 * referenced by family name at runtime, so they are never "unused" even though
 * the path string does not appear in Dart code.
 */
function extractFontAssetPaths(pubspecText) {
    const lines = pubspecText.split('\n');

    let flutterIdx = -1;
    for (let i = 0; i < lines.length; i++) {
        if (/^flutter:\s*$/.test(lines[i])) {
            flutterIdx = i;
            break;
        }
    }
    if (flutterIdx === -1) {
        return [];
    }
    const flutterIndent = indentationOf(lines[flutterIdx]);

    let fontsIdx = -1;
    for (let i = flutterIdx + 1; i < lines.length; i++) {
        const line = lines[i];
        if (line.trim() === '' || isComment(line)) {
            continue;
        }
        const indent = indentationOf(line);
        if (indent <= flutterIndent) {
            break;
        }
        if (/^\s*fonts:\s*$/.test(line)) {
            fontsIdx = i;
            break;
        }
    }
    if (fontsIdx === -1) {
        return [];
    }
    const fontsIndent = indentationOf(lines[fontsIdx]);

    const paths = [];
    for (let i = fontsIdx + 1; i < lines.length; i++) {
        const line = lines[i];
        if (line.trim() === '' || isComment(line)) {
            continue;
        }
        const indent = indentationOf(line);
        if (indent <= fontsIndent) {
            break;
        }
        const match = line.match(/^\s*-\s*asset:\s*(.+?)\s*$/);
        if (!match) {
            continue;
        }
        let value = match[1].trim().replace(/\s+#.*$/, '').trim();
        value = value.replace(/^['"](.*)['"]$/, '$1').trim();
        if (value) {
            paths.push(value);
        }
    }
    return paths;
}

/**
 * Extract the translations folder configured for easy_localization.
 * Defaults to "assets/translations" (the package default) and honors an
 * `easy_localization:` (or `easy_localization_loader:`) block in pubspec with
 * an `asset_path:` / `path:` entry. Returns a project-relative path without a
 * trailing slash, or null.
 */
function extractEasyLocalizationAssetRoot(pubspecText) {
    const lines = pubspecText.split('\n');

    let blockIdx = -1;
    for (let i = 0; i < lines.length; i++) {
        if (/^easy_localization:\s*$/.test(lines[i]) || /^easy_localization_loader:\s*$/.test(lines[i])) {
            blockIdx = i;
            break;
        }
    }
    if (blockIdx !== -1) {
        const blockIndent = indentationOf(lines[blockIdx]);
        for (let i = blockIdx + 1; i < lines.length; i++) {
            const line = lines[i];
            if (line.trim() === '' || isComment(line)) {
                continue;
            }
            const indent = indentationOf(line);
            if (indent <= blockIndent) {
                break;
            }
            const match = line.match(/^\s*(?:asset_path|path):\s*(.+?)\s*$/);
            if (match) {
                let value = match[1].trim().replace(/\s+#.*$/, '').trim();
                value = value.replace(/^['"](.*)['"]$/, '$1').trim();
                if (value) {
                    return value.replace(/[\\/]+$/, '');
                }
            }
        }
    }
    return 'assets/translations';
}

/**
 * Collect the project-relative paths of every file under the
 * easy_localization translations folder. These files are loaded at runtime by
 * language code (not by literal path in Dart), so they are never "unused".
 */
function collectTranslationAssetPaths(root, pubspecText) {
    const folder = extractEasyLocalizationAssetRoot(pubspecText);
    if (!folder) {
        return [];
    }
    const abs = path.resolve(root, folder);
    if (!fs.existsSync(abs) || !fs.statSync(abs).isDirectory()) {
        return [];
    }
    const files = [];
    walk(abs, (f) => files.push(toProjectRelative(root, f)), null, null);
    return files;
}

function walk(dir, onFile, excludedDirs, assetAbsDirs) {
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
            if (assetAbsDirs && assetAbsDirs.some((ad) => full === ad || full.startsWith(ad + path.sep))) {
                continue; // don't scan declared asset dirs as "references"
            }
            walk(full, onFile, excludedDirs, assetAbsDirs);
        } else if (entry.isFile()) {
            onFile(full);
        }
    }
}

function toProjectRelative(root, absPath) {
    return path.relative(root, absPath).split(path.sep).join('/');
}

/**
 * Collect every file under the declared asset entries.
 * Returns project-relative paths (forward slashes).
 */
function collectAssetFiles(root, entries, assetsPathOverride) {
    const targets = assetsPathOverride ? [assetsPathOverride] : entries;
    const files = [];
    const seen = new Set();

    const add = (rel) => {
        if (!seen.has(rel)) {
            seen.add(rel);
            files.push(rel);
        }
    };

    for (const target of targets) {
        const abs = path.resolve(root, target);
        if (!fs.existsSync(abs)) {
            continue;
        }
        const stat = fs.statSync(abs);
        if (stat.isFile()) {
            add(toProjectRelative(root, abs));
        } else if (stat.isDirectory()) {
            walk(abs, (f) => add(toProjectRelative(root, f)), null, null);
        }
    }
    return files;
}

/**
 * Collect the source files to scan for references: .dart and .json files in
 * the project, excluding build artifacts, caches and the asset folders.
 */
function collectReferenceFiles(root, assetAbsDirs) {
    const files = [];
    walk(
        root,
        (f) => {
            const ext = path.extname(f).toLowerCase();
            if (ext !== '.dart' && ext !== '.json') {
                return;
            }
            files.push(f);
        },
        EXCLUDED_DIRS,
        assetAbsDirs
    );
    return files;
}

// ---------------------------------------------------------------------------
// Dynamic asset reference detection
// ---------------------------------------------------------------------------

// Matches Dart string interpolation: $name or ${expr}
const DART_VARIABLE_RE = /\$([A-Za-z_][A-Za-z0-9_]*|\{[^}]*\})/g;

// Loader APIs whose first argument can be a fully-dynamic expression.
const LOADER_CALL_RE = /\b(Image\.asset|SvgPicture\.asset|AssetImage|precacheImage|rootBundle\.load)\s*\(\s*/g;

// Matches a single-line quoted string literal (single or double quotes),
// honoring backslash escapes and never crossing the closing quote.
function findStringLiterals(content) {
    const literals = [];
    const re = /(['"])(?:\\(?:\r?\n|.)|(?!\1)[^\\\r\n])*\1/g;
    let m;
    while ((m = re.exec(content)) !== null) {
        const raw = m[0];
        if (raw.length < 2) {
            continue;
        }
        literals.push({
            start: m.index,
            end: m.index + raw.length,
            inner: raw.slice(1, -1),
        });
    }
    return literals;
}

// Builds an offset -> { line, column } lookup (1-based line, 0-based column).
function buildPositionIndex(content) {
    const starts = [0];
    for (let i = 0; i < content.length; i++) {
        if (content.charCodeAt(i) === 10) {
            starts.push(i + 1);
        }
    }
    return (offset) => {
        let lo = 0;
        let hi = starts.length - 1;
        while (lo < hi) {
            const mid = (lo + hi + 1) >> 1;
            if (starts[mid] <= offset) {
                lo = mid;
            } else {
                hi = mid - 1;
            }
        }
        return { line: lo + 1, column: offset - starts[lo] };
    };
}

/**
 * Detect dynamic asset patterns in a Dart source file.
 * Returns pattern objects:
 *   - anchored (dynamic=false): { prefix, suffix, pattern, offset, ... }
 *     prefix is a static asset-root path, suffix is optional static text
 *   - fully-dynamic (dynamic=true): no static anchor, matches every asset
 */
function detectDynamicPatterns(content, assetRoots) {
    const patterns = [];
    const pos = buildPositionIndex(content);
    const isRooted = (p) => {
        const clean = p.replace(/^\.\//, '');
        return assetRoots.some((r) => clean.startsWith(r));
    };
    const push = (p) => {
        const loc = pos(p.offset);
        p.line = loc.line;
        p.column = loc.column;
        patterns.push(p);
    };

    // 1) Interpolated strings: 'assets/icon/$icon', "assets/$folder/logo.png"
    for (const lit of findStringLiterals(content)) {
        DART_VARIABLE_RE.lastIndex = 0;
        const v = DART_VARIABLE_RE.exec(lit.inner);
        if (!v) {
            continue;
        }
        const prefix = lit.inner.slice(0, v.index).replace(/^\.\//, '');
        if (!isRooted(prefix)) {
            continue;
        }
        const suffix = lit.inner.slice(v.index + v[0].length);
        // If another variable follows we cannot build a reliable static suffix.
        const cleanSuffix = suffix.includes('$') ? '' : suffix;
        push({
            prefix,
            suffix: cleanSuffix,
            dynamic: false,
            pattern: lit.inner,
            offset: lit.start + 1 + v.index,
        });
    }

    // 2) Concatenation prefixes: 'assets/icon/' + icon + '.svg'
    const concatRe = /(['"])((?:\\(?:\r?\n|.)|(?!\1)[^\\\r\n])*)\1\s*\+/g;
    let cm;
    while ((cm = concatRe.exec(content)) !== null) {
        const inner = cm[2].replace(/^\.\//, '');
        if (!isRooted(inner)) {
            continue;
        }
        push({
            prefix: inner,
            suffix: '',
            dynamic: false,
            pattern: inner,
            offset: cm.index + 1,
        });
    }

    // 3) Fully-dynamic loader calls: Image.asset(path), rootBundle.load(key)
    LOADER_CALL_RE.lastIndex = 0;
    let lm;
    while ((lm = LOADER_CALL_RE.exec(content)) !== null) {
        const rest = content.slice(lm.index + lm[0].length);
        const trimmed = rest.replace(/^\s+/, '');
        // A literal argument rooted at an asset folder is handled by the
        // string scans above (anchored), so it is not "fully dynamic".
        if (trimmed[0] === "'" || trimmed[0] === '"') {
            const lits = findStringLiterals(trimmed);
            if (lits.length > 0 && isRooted(lits[0].inner.replace(/^\.\//, ''))) {
                continue;
            }
        }
        push({
            prefix: '',
            suffix: '',
            dynamic: true,
            pattern: 'dynamic loader call',
            offset: lm.index,
        });
    }

    return patterns;
}

/**
 * Does an asset path match an anchored pattern?
 * The static prefix must match at the start; when a suffix is present the
 * asset must also end with it and have a non-empty "variable" middle.
 */
function matchesDynamicPattern(assetPath, pattern) {
    if (pattern.dynamic) {
        return true;
    }
    if (!assetPath.startsWith(pattern.prefix)) {
        return false;
    }
    if (pattern.suffix) {
        if (!assetPath.endsWith(pattern.suffix)) {
            return false;
        }
        return assetPath.length > pattern.prefix.length + pattern.suffix.length;
    }
    return true;
}

/**
 * Should a reference file be skipped entirely (not scanned for references)?
 * Ignored directories match by path prefix; ignored files match by exact
 * project-relative path or by basename (e.g. "my_image.dart").
 */
function isIgnoredReferenceFile(relPath, ignoreDirs, ignoreFiles) {
    const norm = String(relPath).replace(/\\/g, '/');
    for (const dir of ignoreDirs || []) {
        const d = String(dir).replace(/\\/g, '/').replace(/^\.?\//, '').replace(/\/+$/, '');
        if (d && (norm === d || norm.startsWith(d + '/'))) {
            return true;
        }
    }
    const base = norm.split('/').pop();
    for (const file of ignoreFiles || []) {
        const f = String(file).replace(/\\/g, '/').replace(/^\.?\//, '');
        if (!f) {
            continue;
        }
        if (norm === f || base === f) {
            return true;
        }
    }
    return false;
}

function findUnused(root, assetFiles, referenceFiles, alwaysUsed = new Set(), assetRoots = [], ignoreDynamicDirs = [], ignoreDynamicFiles = []) {
    const used = new Set(alwaysUsed);
    const dynamicPatterns = [];

    for (const refFile of referenceFiles) {
        let content;
        try {
            content = fs.readFileSync(refFile, 'utf8');
        } catch {
            continue;
        }

        // Files in the "ignore dynamic references only" lists are still scanned
        // for literal references, but their dynamic patterns are suppressed so
        // they cannot flag assets as "maybe used".
        const skipDynamic = isIgnoredReferenceFile(
            toProjectRelative(root, refFile),
            ignoreDynamicDirs,
            ignoreDynamicFiles
        );

        // Static literal reference detection (existing behaviour).
        for (const asset of assetFiles) {
            if (used.has(asset)) {
                continue;
            }
            const normalized = asset.replace(/\\/g, '/');
            if (content.includes(normalized) || content.includes('./' + normalized)) {
                used.add(asset);
            }
        }

        // Dynamic pattern detection (Dart only - JSON has no interpolation).
        if (!skipDynamic && path.extname(refFile).toLowerCase() === '.dart') {
            const hasRoot = assetRoots.some((r) => content.includes(r));
            const hasLoader = /Image\.asset|SvgPicture\.asset|AssetImage|precacheImage|rootBundle\.load/.test(content);
            if (hasRoot || hasLoader) {
                const patterns = detectDynamicPatterns(content, assetRoots);
                for (const p of patterns) {
                    p.file = toProjectRelative(root, refFile);
                    dynamicPatterns.push(p);
                }
            }
        }
    }

    const unused = assetFiles
        .filter((asset) => !used.has(asset))
        .map((asset) => {
            let size;
            try {
                size = fs.statSync(path.resolve(root, asset)).size;
            } catch {
                size = undefined;
            }
            // Collect matching dynamic references, one per referencing file.
            const perFile = new Map();
            for (const p of dynamicPatterns) {
                if (!matchesDynamicPattern(asset, p)) {
                    continue;
                }
                const existing = perFile.get(p.file);
                // Prefer anchored (strong) over fully-dynamic (weak), earliest line.
                if (
                    !existing ||
                    (p.dynamic === false && existing.dynamic === true) ||
                    (p.dynamic === existing.dynamic && p.line < existing.line)
                ) {
                    perFile.set(p.file, p);
                }
            }
            const refs = Array.from(perFile.values())
                .map((p) => ({
                    file: p.file,
                    line: p.line,
                    column: p.column,
                    dynamic: p.dynamic,
                    pattern: p.pattern,
                }))
                .sort((a, b) => (a.dynamic === b.dynamic ? a.line - b.line : a.dynamic ? 1 : -1));
            return { path: asset, size, refs };
        });

    return unused;
}

function formatSize(bytes) {
    if (bytes == null) {
        return '';
    }
    if (bytes < 1024) {
        return `${bytes} B`;
    }
    if (bytes < 1024 * 1024) {
        return `${(bytes / 1024).toFixed(1)} KB`;
    }
    return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

function buildReport(args, root, assetAbsDirs, totalAssets, usedAssets, unused) {
    const lines = [];
    const maybeUsed = unused.filter((a) => a.refs && a.refs.length > 0).length;
    lines.push('Scanning assets...');
    lines.push(`Found ${totalAssets} assets`);
    lines.push(`Found ${usedAssets} used assets`);
    if (unused.length === 0) {
        lines.push('No unused assets found! 🎉');
    } else {
        lines.push(`Unused assets (${unused.length}):`);
        for (const asset of unused) {
            const size = formatSize(asset.size);
            lines.push(`  • ${asset.path}${size ? ` (${size})` : ''}`);
        }
        if (maybeUsed > 0) {
            lines.push('');
            lines.push(`⚠️  ${maybeUsed} of the above may be used via dynamic references ` +
                `(e.g. 'assets/icon/$icon' or Image.asset(path)) and were flagged accordingly.`);
        }
        if (!args.delete) {
            lines.push('');
            lines.push('Run again with --delete to remove them.');
        }
    }
    return lines.join('\n');
}

function main() {
    const args = parseArgs(process.argv.slice(2));
    if (args.help) {
        printHelp();
        process.exit(0);
    }

    const root = path.resolve(args.path);
    if (!fs.existsSync(root) || !fs.statSync(root).isDirectory()) {
        console.error(`Error: path is not a directory: ${root}`);
        process.exit(1);
    }

    const pubspecPath = path.join(root, 'pubspec.yaml');
    if (!fs.existsSync(pubspecPath)) {
        console.error(`Error: no pubspec.yaml found in ${root}. Not a Flutter project?`);
        process.exit(1);
    }

    const pubspecText = fs.readFileSync(pubspecPath, 'utf8');
    const entries = extractAssetEntries(pubspecText);
    if (entries.length === 0) {
        console.error('Error: no flutter.assets entries found in pubspec.yaml.');
        process.exit(1);
    }

    // Fonts are referenced by family name at runtime, so treat them as used.
    // easy_localization translation files are loaded by language code at
    // runtime, so treat them as used too.
    const alwaysUsed = new Set([
        ...extractFontAssetPaths(pubspecText).map((p) =>
            p.replace(/\\/g, '/').replace(/^\.\//, '')
        ),
        ...collectTranslationAssetPaths(root, pubspecText),
    ]);

    const assetsPath = args.assetsPath ? path.resolve(root, args.assetsPath) : null;
    const assetAbsDirs = assetsPath
        ? [assetsPath]
        : entries
            .map((e) => path.resolve(root, e))
            .filter((p) => fs.existsSync(p) && fs.statSync(p).isDirectory());

    const assetFiles = collectAssetFiles(root, entries, args.assetsPath);
    let referenceFiles = collectReferenceFiles(root, assetAbsDirs);

    // User-configured ignored directories/files are skipped when scanning for
    // references (e.g. custom wrapper widgets like my_image.dart).
    if (args.ignoreDirs.length > 0 || args.ignoreFiles.length > 0) {
        referenceFiles = referenceFiles.filter(
            (f) => !isIgnoredReferenceFile(toProjectRelative(root, f), args.ignoreDirs, args.ignoreFiles)
        );
    }

    // Asset roots are the directory entries from pubspec.yaml (e.g. "assets/").
    // They anchor dynamic pattern detection: 'assets/icon/$icon' is only an
    // asset reference when "assets/" (or a sub-root) is a declared asset root.
    const assetRoots = args.assetsPath
        ? [args.assetsPath.replace(/\\/g, '/').replace(/\/?$/, '/')]
        : entries
            .map((e) => e.replace(/\\/g, '/'))
            .filter((e) => {
                if (e.endsWith('/')) {
                    return true;
                }
                const abs = path.resolve(root, e);
                return fs.existsSync(abs) && fs.statSync(abs).isDirectory();
            })
            .map((e) => (e.endsWith('/') ? e : e + '/'));

    const unused = findUnused(
        root,
        assetFiles,
        referenceFiles,
        alwaysUsed,
        assetRoots,
        args.ignoreDynamicDirs,
        args.ignoreDynamicFiles
    );
    const totalAssets = assetFiles.length;
    const usedAssets = totalAssets - unused.length;

    let deleted = 0;
    if (args.delete && unused.length > 0) {
        for (const asset of unused) {
            const abs = path.resolve(root, asset.path);
            // Safety: never delete outside the project root.
            if (abs === root || !abs.startsWith(root + path.sep)) {
                console.error(`  ✗ Skipping ${asset.path} (outside project root)`);
                continue;
            }
            try {
                fs.unlinkSync(abs);
                deleted++;
            } catch (err) {
                console.error(`  ✗ Failed to delete ${asset.path}: ${err.message}`);
            }
        }
    }

    if (args.json) {
        const payload = {
            projectRoot: root,
            totalAssets,
            usedAssets,
            deleted: args.delete ? deleted : 0,
            unusedAssets: unused.map((a) => ({
                path: a.path,
                size: a.size,
                refs: a.refs && a.refs.length > 0 ? a.refs : [],
            })),
        };
        const output = JSON.stringify(payload, null, 2);
        console.log(output);
        if (args.logPath) {
            fs.writeFileSync(path.resolve(root, args.logPath), output, 'utf8');
        }
        process.exit(0);
    }

    const report = buildReport(args, root, assetAbsDirs, totalAssets, usedAssets, unused);
    console.log(report);
    if (args.delete) {
        console.log(`Deleted ${deleted} unused asset file(s).`);
    }
    if (args.logPath) {
        fs.writeFileSync(path.resolve(root, args.logPath), report + '\n', 'utf8');
    }
}

main();
