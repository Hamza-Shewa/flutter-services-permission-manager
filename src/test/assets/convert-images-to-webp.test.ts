import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { Jimp } from 'jimp';
import { convertImagesToWebp } from '../../features/assets/assets.service.js';

/** A smooth gradient: PNG stores it poorly and WebP stores it well, like real artwork. */
async function writeImage(file: string, kind: 'png' | 'jpeg', alpha = false): Promise<void> {
    const size = 160;
    const image = new Jimp({ width: size, height: size, color: 0xffffffff });
    for (let y = 0; y < size; y++) {
        for (let x = 0; x < size; x++) {
            const r = Math.round((x / size) * 255);
            const g = Math.round((y / size) * 255);
            const b = Math.round(((x + y) / (2 * size)) * 255);
            const a = alpha ? Math.round(160 + (x / size) * 95) : 255;
            image.bitmap.data.writeUInt32BE(((r << 24) | (g << 16) | (b << 8) | a) >>> 0, (y * size + x) * 4);
        }
    }
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const buffer = kind === 'png' ? await image.getBuffer('image/png') : await image.getBuffer('image/jpeg', { quality: 95 });
    fs.writeFileSync(file, buffer);
}

suite('convertImagesToWebp', () => {
    let root: string;

    setup(async () => {
        root = fs.mkdtempSync(path.join(os.tmpdir(), 'fcm-webp-'));
        fs.writeFileSync(path.join(root, 'pubspec.yaml'), [
            'name: sample',
            'flutter:',
            '  assets:',
            '    - assets/images/',
            '    - assets/photos/hero.jpg',
            '',
        ].join('\n'));
        await writeImage(path.join(root, 'assets/images/logo.png'), 'png', true);
        await writeImage(path.join(root, 'assets/images/banner.png'), 'png');
        await writeImage(path.join(root, 'assets/images/dynamic/one.png'), 'png');
        await writeImage(path.join(root, 'assets/images/icon.png'), 'png');
        await writeImage(path.join(root, 'assets/images/short.png'), 'png');
        await writeImage(path.join(root, 'assets/photos/hero.jpg'), 'jpeg');
        fs.mkdirSync(path.join(root, 'lib'), { recursive: true });
        fs.writeFileSync(path.join(root, 'lib/main.dart'), [
            "// don't confuse the scanner: 'assets/images/commented.png'",
            "const logo = 'assets/images/logo.png';",
            "final banner = Image.asset(\"assets/images/banner.png\");",
            "final hero = AssetImage('assets/photos/hero.jpg');",
            "String pick(String name) => 'assets/images/dynamic/$name.png';",
            "final icon = AssetImage('icon.png');",
            "final prose = 'See assets/images/short.png for details';",
            '',
        ].join('\n'));
        fs.writeFileSync(path.join(root, 'flutter_launcher_icons.yaml'), 'flutter_launcher_icons:\n  image_path: "assets/images/short.png"\n');
    });

    teardown(() => { fs.rmSync(root, { recursive: true, force: true }); });

    const statusOf = (result: Awaited<ReturnType<typeof convertImagesToWebp>>, file: string) =>
        result.images.find((i) => i.path === file)?.status;

    test('dry run reports savings and writes nothing', async () => {
        const before = fs.readdirSync(path.join(root, 'assets/images')).sort();
        const result = await convertImagesToWebp(root);
        assert.strictEqual(result.applied, false);
        assert.strictEqual(statusOf(result, 'assets/images/logo.png'), 'would-convert');
        assert.ok(result.bytesSaved > 0);
        assert.deepStrictEqual(fs.readdirSync(path.join(root, 'assets/images')).sort(), before);
        assert.ok(fs.readFileSync(path.join(root, 'lib/main.dart'), 'utf8').includes('logo.png'));
    });

    test('apply converts, deletes originals and rewrites exact references', async () => {
        const result = await convertImagesToWebp(root, { apply: true });
        assert.strictEqual(result.applied, true);
        for (const file of ['assets/images/logo.png', 'assets/images/banner.png', 'assets/photos/hero.jpg']) {
            assert.strictEqual(statusOf(result, file), 'converted', file);
        }
        assert.ok(fs.existsSync(path.join(root, 'assets/images/logo.webp')));
        assert.ok(!fs.existsSync(path.join(root, 'assets/images/logo.png')));
        assert.ok(fs.existsSync(path.join(root, 'assets/photos/hero.webp')));

        const dart = fs.readFileSync(path.join(root, 'lib/main.dart'), 'utf8');
        assert.ok(dart.includes("const logo = 'assets/images/logo.webp';"));
        assert.ok(dart.includes('Image.asset("assets/images/banner.webp")'));
        assert.ok(dart.includes("AssetImage('assets/photos/hero.webp')"));
        assert.ok(dart.includes("// don't confuse the scanner: 'assets/images/commented.png'"), 'comments are left alone');
        assert.ok(fs.readFileSync(path.join(root, 'pubspec.yaml'), 'utf8').includes('- assets/photos/hero.webp'));
        assert.ok(result.rewrittenFiles.includes('lib/main.dart'));
        assert.ok(result.rewrittenFiles.includes('pubspec.yaml'));
    });

    test('the output is a WebP file', async () => {
        await convertImagesToWebp(root, { apply: true });
        const bytes = fs.readFileSync(path.join(root, 'assets/images/logo.webp'));
        assert.strictEqual(bytes.subarray(0, 4).toString('ascii'), 'RIFF');
        assert.strictEqual(bytes.subarray(8, 12).toString('ascii'), 'WEBP');
    });

    test('images that cannot be renamed safely are left untouched', async () => {
        const result = await convertImagesToWebp(root, { apply: true });
        const dynamic = result.images.find((i) => i.path === 'assets/images/dynamic/one.png');
        assert.strictEqual(dynamic?.status, 'skipped');
        assert.match(dynamic?.reason ?? '', /built at runtime/);
        const icon = result.images.find((i) => i.path === 'assets/images/icon.png');
        assert.strictEqual(icon?.status, 'skipped');
        assert.match(icon?.reason ?? '', /partial path/);
        const tool = result.images.find((i) => i.path === 'assets/images/short.png');
        assert.strictEqual(tool?.status, 'skipped');
        assert.match(tool?.reason ?? '', /flutter_launcher_icons\.yaml/);
        for (const file of ['dynamic/one.png', 'icon.png', 'short.png']) {
            assert.ok(fs.existsSync(path.join(root, 'assets/images', file)), `${file} must still exist`);
        }
    });

    test('--keep-originals only adds the .webp files', async () => {
        const result = await convertImagesToWebp(root, { apply: true, keepOriginals: true });
        assert.ok(result.converted > 0);
        assert.ok(fs.existsSync(path.join(root, 'assets/images/logo.png')));
        assert.ok(fs.existsSync(path.join(root, 'assets/images/logo.webp')));
        assert.ok(fs.readFileSync(path.join(root, 'lib/main.dart'), 'utf8').includes('logo.png'));
        assert.deepStrictEqual(result.rewrittenFiles, []);
    });

    test('a 2.0x variant is converted together with its base image', async () => {
        await writeImage(path.join(root, 'assets/varied/pic.png'), 'png');
        await writeImage(path.join(root, 'assets/varied/2.0x/pic.png'), 'png');
        fs.appendFileSync(path.join(root, 'pubspec.yaml'), '    - assets/varied/\n');
        fs.appendFileSync(path.join(root, 'lib/main.dart'), "const pic = 'assets/varied/pic.png';\n");
        const result = await convertImagesToWebp(root, { apply: true });
        assert.strictEqual(statusOf(result, 'assets/varied/pic.png'), 'converted');
        assert.strictEqual(statusOf(result, 'assets/varied/2.0x/pic.png'), 'converted');
        assert.ok(fs.existsSync(path.join(root, 'assets/varied/pic.webp')));
        assert.ok(fs.existsSync(path.join(root, 'assets/varied/2.0x/pic.webp')));
        assert.ok(fs.readFileSync(path.join(root, 'lib/main.dart'), 'utf8').includes("'assets/varied/pic.webp'"));
    });

    test('matches decomposed (macOS) file names against composed names in source', async () => {
        const decomposed = 'cafe\u0301.png'; // what macOS stores for "caf\u00e9.png"
        const composed = 'caf\u00e9.png'; // what an editor writes
        await writeImage(path.join(root, 'assets/images', decomposed), 'png');
        fs.appendFileSync(path.join(root, 'lib/main.dart'), `const cafe = 'assets/images/${composed}';\n`);
        const result = await convertImagesToWebp(root, { apply: true });
        assert.strictEqual(result.images.find((i) => i.path.endsWith('.png') && i.path.normalize('NFC').endsWith(composed))?.status, 'converted');
        assert.ok(fs.readFileSync(path.join(root, 'lib/main.dart'), 'utf8').includes(`'assets/images/${composed.replace('.png', '.webp')}'`));
        assert.ok(!fs.existsSync(path.join(root, 'assets/images', decomposed)) || process.platform === 'darwin', 'original removed');
    });

    test('a corrupt image fails on its own without stopping the others', async () => {
        fs.writeFileSync(path.join(root, 'assets/images/broken.png'), Buffer.from('not an image'));
        const result = await convertImagesToWebp(root);
        assert.strictEqual(statusOf(result, 'assets/images/broken.png'), 'failed');
        assert.strictEqual(statusOf(result, 'assets/images/logo.png'), 'would-convert');
    });

    test('fails clearly outside a Flutter project', async () => {
        const empty = fs.mkdtempSync(path.join(os.tmpdir(), 'fcm-webp-empty-'));
        try {
            await assert.rejects(() => convertImagesToWebp(empty), /pubspec\.yaml/);
        } finally {
            fs.rmSync(empty, { recursive: true, force: true });
        }
    });
});
