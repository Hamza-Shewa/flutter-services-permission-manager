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
            default:
                if (arg.startsWith('--path=')) {
                    args.path = arg.slice('--path='.length);
                } else if (arg.startsWith('--assets-path=')) {
                    args.assetsPath = arg.slice('--assets-path='.length);
                } else if (arg.startsWith('--log-path=')) {
                    args.logPath = arg.slice('--log-path='.length);
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

function findUnused(root, assetFiles, referenceFiles, alwaysUsed = new Set()) {
    const used = new Set(alwaysUsed);

    for (const refFile of referenceFiles) {
        let content;
        try {
            content = fs.readFileSync(refFile, 'utf8');
        } catch {
            continue;
        }
        for (const asset of assetFiles) {
            if (used.has(asset)) {
                continue;
            }
            const normalized = asset.replace(/\\/g, '/');
            if (content.includes(normalized) || content.includes('./' + normalized)) {
                used.add(asset);
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
            return { path: asset, size };
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
    const alwaysUsed = new Set(
        extractFontAssetPaths(pubspecText).map((p) =>
            p.replace(/\\/g, '/').replace(/^\.\//, '')
        )
    );

    const assetsPath = args.assetsPath ? path.resolve(root, args.assetsPath) : null;
    const assetAbsDirs = assetsPath
        ? [assetsPath]
        : entries
            .map((e) => path.resolve(root, e))
            .filter((p) => fs.existsSync(p) && fs.statSync(p).isDirectory());

    const assetFiles = collectAssetFiles(root, entries, args.assetsPath);
    const referenceFiles = collectReferenceFiles(root, assetAbsDirs);

    const unused = findUnused(root, assetFiles, referenceFiles, alwaysUsed);
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
            unusedAssets: unused.map((a) => ({ path: a.path, size: a.size })),
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
