import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';
import {
    assertSafeRelativePath,
    assertSafeTranslationFileName,
    assertValidLocale,
    normalizeTranslationDir,
} from '../../features/localization/arb-core.js';
import {
    createTranslationFileForLocale,
    saveTranslationFiles,
} from '../../features/localization/arb-translations.service.js';
import type { TranslationFileData } from '../../core/types/index.js';

suite('Translation path safety', () => {
    test('accepts ordinary locale codes', () => {
        for (const locale of ['en', 'ar', 'pt_BR', 'pt-br', 'zh-Hans', 'zh_Hans_CN', 'es-419', 'fil']) {
            assert.strictEqual(assertValidLocale(locale), locale);
        }
    });

    test('rejects locale codes that could steer the file location', () => {
        for (const locale of ['', '../../evil', '..', 'a/b', 'a\\b', 'en.arb', 'x'.repeat(20), 'e', 'en ', 'en\0', 'C:evil']) {
            assert.throws(() => assertValidLocale(locale), /not a valid locale code/, JSON.stringify(locale));
        }
    });

    test('rejects directories and file names that leave the project', () => {
        for (const dir of ['../outside', 'lib/../../outside', '..\\outside', 'C:/Windows', 'C:\\Windows', 'a/../../b']) {
            assert.throws(() => normalizeTranslationDir(dir), /must stay inside the project/, dir);
            assert.throws(() => assertSafeRelativePath(dir), /must stay inside the project/, dir);
        }
        assert.throws(() => assertSafeRelativePath('//server/share'), /must stay inside the project/);
        assert.strictEqual(normalizeTranslationDir('//server/share'), 'server/share', 'leading slashes are stripped, so it is relative');
        assert.strictEqual(normalizeTranslationDir('/lib/l10n/'), 'lib/l10n');
        assert.strictEqual(normalizeTranslationDir('lib\\l10n'), 'lib/l10n');
        assert.strictEqual(normalizeTranslationDir('assets/..hidden/x'), 'assets/..hidden/x');
    });

    test('only .arb / .json files inside the project may be written', () => {
        assert.strictEqual(assertSafeTranslationFileName('lib/l10n/app_en.arb'), 'lib/l10n/app_en.arb');
        assert.strictEqual(assertSafeTranslationFileName('assets\\i18n\\en.json'), 'assets/i18n/en.json');
        for (const name of ['../x.arb', 'lib/../../x.json', '/etc/passwd.json', 'lib/l10n/app_en.dart', 'lib/l10n/.bashrc', 'C:/x.arb']) {
            assert.throws(() => assertSafeTranslationFileName(name), Error, name);
        }
    });

    suite('on disk', () => {
        let scratch: string;
        setup(() => { scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'fcm-trans-')); });
        teardown(() => { fs.rmSync(scratch, { recursive: true, force: true }); });

        test('createTranslationFileForLocale refuses a traversing locale and writes nothing', async () => {
            const root = vscode.Uri.file(path.join(scratch, 'project'));
            fs.mkdirSync(root.fsPath, { recursive: true });
            await assert.rejects(() => createTranslationFileForLocale(root, '../../evil', undefined, 'lib/l10n'), /not a valid locale code/);
            assert.deepStrictEqual(fs.readdirSync(scratch), ['project']);
            assert.deepStrictEqual(fs.readdirSync(root.fsPath), []);
        });

        test('saveTranslationFiles skips files outside the project', async () => {
            const root = vscode.Uri.file(path.join(scratch, 'project'));
            fs.mkdirSync(root.fsPath, { recursive: true });
            const make = (fileName: string): TranslationFileData => ({ locale: 'en', fileName, isArb: true, keys: { a: 'b' }, metadata: {} });
            const result = await saveTranslationFiles([make('../escaped.arb'), make('lib/l10n/app_en.arb')], root);
            assert.strictEqual(result.success, true);
            assert.ok(!fs.existsSync(path.join(scratch, 'escaped.arb')), 'must not write outside the project');
            assert.ok(fs.existsSync(path.join(root.fsPath, 'lib', 'l10n', 'app_en.arb')));
        });
    });
});
