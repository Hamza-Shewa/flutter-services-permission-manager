import * as assert from 'assert';
import {
    getLocaleFromFileName,
    normalizeTranslationDir,
    parseTranslationContent,
    serializeTranslationContent,
    autoAddMissingKeys,
    findMissingKeys,
    translateLocale,
} from '../../features/localization/arb-translations.service.js';
import type { TranslationFileData } from '../../core/types/index.js';

suite('ARB / JSON Translations Service Test Suite', () => {
    suite('getLocaleFromFileName', () => {
        test('extracts locale from intl_xx.arb', () => {
            assert.strictEqual(getLocaleFromFileName('intl_en.arb'), 'en');
            assert.strictEqual(getLocaleFromFileName('intl_ar.arb'), 'ar');
        });

        test('extracts locale from app_xx.json', () => {
            assert.strictEqual(getLocaleFromFileName('app_fr.json'), 'fr');
        });

        test('extracts locale from en.json', () => {
            assert.strictEqual(getLocaleFromFileName('en.json'), 'en');
        });

        test('extracts locale from a relative path', () => {
            assert.strictEqual(getLocaleFromFileName('lib/l10n/intl_en.arb'), 'en');
            assert.strictEqual(getLocaleFromFileName('translations/ar.json'), 'ar');
        });

        test('falls back to the base name when no locale is present', () => {
            assert.strictEqual(getLocaleFromFileName('strings.json'), 'strings');
        });
    });

    suite('normalizeTranslationDir', () => {
        test('strips leading/trailing slashes', () => {
            assert.strictEqual(normalizeTranslationDir('/lib/l10n/'), 'lib/l10n');
            assert.strictEqual(normalizeTranslationDir('  '), undefined);
        });

        test('converts backslashes to forward slashes', () => {
            assert.strictEqual(normalizeTranslationDir('lib\\l10n'), 'lib/l10n');
        });

        test('returns undefined for empty input', () => {
            assert.strictEqual(normalizeTranslationDir(undefined), undefined);
            assert.strictEqual(normalizeTranslationDir(''), undefined);
        });
    });

    suite('parseTranslationContent', () => {
        test('parses a plain JSON translation file', () => {
            const data = parseTranslationContent('{ "hello": "Hello", "bye": "Bye" }', 'en.json');
            assert.ok(data);
            assert.strictEqual(data!.locale, 'en');
            assert.strictEqual(data!.isArb, false);
            assert.deepStrictEqual(data!.keys, { hello: 'Hello', bye: 'Bye' });
        });

        test('parses an ARB file and separates metadata from keys', () => {
            const content = JSON.stringify({
                '@@locale': 'ar',
                'hello': 'مرحبا',
                '@hello': { description: 'Greeting' },
            });
            const data = parseTranslationContent(content, 'intl_ar.arb');
            assert.ok(data);
            assert.strictEqual(data!.locale, 'ar');
            assert.strictEqual(data!.isArb, true);
            assert.deepStrictEqual(data!.keys, { hello: 'مرحبا' });
            assert.strictEqual(data!.metadata['@@locale'], 'ar');
            assert.deepStrictEqual(data!.metadata['@hello'], { description: 'Greeting' });
        });

        test('uses @@locale over the file name for ARB', () => {
            const data = parseTranslationContent('{ "@@locale": "fr", "a": "1" }', 'intl_xx.arb');
            assert.strictEqual(data!.locale, 'fr');
        });

        test('returns null for invalid JSON', () => {
            assert.strictEqual(parseTranslationContent('not json', 'en.json'), null);
        });

        test('flattens nested objects into dot-path keys', () => {
            const content = JSON.stringify({
                app_name: 'Mishkat',
                tabs: { home: 'Home', quran: 'Quran' },
                quran: { title: 'The Holy Quran', reciters: ['A', 'B'] },
            });
            const data = parseTranslationContent(content, 'en.json');
            assert.ok(data);
            assert.deepStrictEqual(data!.keys, {
                app_name: 'Mishkat',
                'tabs.home': 'Home',
                'tabs.quran': 'Quran',
                'quran.title': 'The Holy Quran',
                'quran.reciters.0': 'A',
                'quran.reciters.1': 'B',
            });
        });

        test('does not treat ARB metadata as nested keys', () => {
            const content = JSON.stringify({
                '@@locale': 'en',
                tabs: { home: 'Home' },
                '@tabs': { description: 'Tabs section' },
            });
            const data = parseTranslationContent(content, 'intl_en.arb');
            assert.ok(data);
            assert.deepStrictEqual(data!.keys, { 'tabs.home': 'Home' });
            assert.deepStrictEqual(data!.metadata['@tabs'], { description: 'Tabs section' });
        });
    });

    suite('serializeTranslationContent', () => {
        test('preserves @@locale and interleaves @key metadata', () => {
            const data: TranslationFileData = {
                locale: 'ar',
                fileName: 'intl_ar.arb',
                isArb: true,
                keys: { hello: 'مرحبا' },
                metadata: { '@@locale': 'ar', '@hello': { description: 'Greeting' } },
            };
            const out = JSON.parse(serializeTranslationContent(data));
            assert.strictEqual(out['@@locale'], 'ar');
            assert.strictEqual(out['hello'], 'مرحبا');
            assert.deepStrictEqual(out['@hello'], { description: 'Greeting' });
        });

        test('adds @@locale when missing for ARB files', () => {
            const data: TranslationFileData = {
                locale: 'en',
                fileName: 'intl_en.arb',
                isArb: true,
                keys: { a: '1' },
                metadata: {},
            };
            const out = JSON.parse(serializeTranslationContent(data));
            assert.strictEqual(out['@@locale'], 'en');
        });

        test('plain JSON has no metadata entries', () => {
            const data: TranslationFileData = {
                locale: 'en',
                fileName: 'en.json',
                isArb: false,
                keys: { a: '1' },
                metadata: {},
            };
            const out = JSON.parse(serializeTranslationContent(data));
            assert.deepStrictEqual(out, { a: '1' });
        });

        test('round-trips nested objects and arrays', () => {
            const original = {
                app_name: 'Mishkat',
                tabs: { home: 'Home', quran: 'Quran' },
                quran: {
                    title: 'The Holy Quran',
                    reciters: ['A', 'B', { name: 'X' }],
                },
            };
            const data = parseTranslationContent(JSON.stringify(original), 'en.json');
            assert.ok(data);
            assert.deepStrictEqual(
                JSON.parse(serializeTranslationContent(data!)),
                original,
            );
        });

        test('round-trips a Mishkat-style nested file end-to-end', () => {
            const original = {
                app_name: 'Mishkat',
                tabs: {
                    home: 'Home',
                    quran: 'Quran',
                    library: 'Library',
                    radio: 'Radio',
                    mosques: 'Mosques',
                    settings: 'Settings',
                },
                quran: { title: 'The Holy Quran', listening: 'Listening' },
                common: { retry: 'Retry', cancel: 'Cancel' },
            };
            const data = parseTranslationContent(JSON.stringify(original), 'en.json');
            assert.ok(data);
            // Nested keys are flattened for the grid + translation pipeline.
            assert.ok(data!.keys['tabs.home']);
            assert.ok(data!.keys['quran.title']);
            // The flattened dot-keys are tracked as nested paths...
            assert.deepStrictEqual(data!.nestedPaths, [
                'tabs.home',
                'tabs.quran',
                'tabs.library',
                'tabs.radio',
                'tabs.mosques',
                'tabs.settings',
                'quran.title',
                'quran.listening',
                'common.retry',
                'common.cancel',
            ]);
            // Saving restores the exact nested structure.
            assert.deepStrictEqual(
                JSON.parse(serializeTranslationContent(data!)),
                original,
            );
        });

        test('flat file with literal dot keys stays flat on round-trip', () => {
            // masaken-style: flat keys that happen to contain dots (sentences
            // ending in "." / "..." plus flat keys like input_field.context_menu.cut).
            const original = {
                'app_name': 'Masaken',
                'show full description...': 'Show full description...',
                'input_field.context_menu.cut': 'Cut',
                'input_field.context_menu.copy': 'Copy',
                'input_field.context_menu.paste': 'Paste',
                'input_field.context_menu.select_all': 'Select All',
                'this action is unauthorized.': 'This action is unauthorized.',
                'select the city location of it .': 'Select the city location of it .',
                'you\'re leaving...': 'You\'re leaving...',
            };
            const data = parseTranslationContent(JSON.stringify(original), 'en.json');
            assert.ok(data);
            // No nested objects → nestedPaths is empty.
            assert.deepStrictEqual(data!.nestedPaths, []);
            // Every literal dot key must survive EXACTLY as-is (never nested,
            // never split on the dot).
            assert.deepStrictEqual(
                JSON.parse(serializeTranslationContent(data!)),
                original,
            );
        });

        test('mixed file keeps literal dot keys flat while re-nesting real objects', () => {
            const original = {
                'app_name': 'Mixed',
                'this action is unauthorized.': 'Unauthorized.',
                'input_field.context_menu.cut': 'Cut',
                'tabs': { home: 'Home', settings: 'Settings' },
                'common': { retry: 'Retry' },
            };
            const data = parseTranslationContent(JSON.stringify(original), 'en.json');
            assert.ok(data);
            assert.deepStrictEqual(data!.nestedPaths, ['tabs.home', 'tabs.settings', 'common.retry']);
            const out = JSON.parse(serializeTranslationContent(data!)) as Record<string, unknown>;
            // Real nested objects are restored.
            assert.deepStrictEqual(out['tabs'], { home: 'Home', settings: 'Settings' });
            assert.deepStrictEqual(out['common'], { retry: 'Retry' });
            // Literal dot keys stay top-level, untouched.
            assert.strictEqual(out['this action is unauthorized.'], 'Unauthorized.');
            assert.strictEqual(out['input_field.context_menu.cut'], 'Cut');
        });

        test('manually built flat data without nestedPaths keeps dot keys flat', () => {
            // Backward compatibility: if a caller constructs TranslationFileData
            // directly (no nestedPaths), dot keys must not be re-nested.
            const data: TranslationFileData = {
                locale: 'en',
                fileName: 'en.json',
                isArb: false,
                keys: { 'input_field.context_menu.cut': 'Cut' },
                metadata: {},
            };
            const out = JSON.parse(serializeTranslationContent(data)) as Record<string, unknown>;
            assert.strictEqual(out['input_field.context_menu.cut'], 'Cut');
            assert.ok(!('input_field' in out));
        });
    });

    suite('autoAddMissingKeys / findMissingKeys', () => {
        const en: TranslationFileData = {
            locale: 'en', fileName: 'intl_en.arb', isArb: true,
            keys: { hello: 'Hello', world: 'World' }, metadata: {},
        };
        const ar: TranslationFileData = {
            locale: 'ar', fileName: 'intl_ar.arb', isArb: true,
            keys: { hello: 'مرحبا' }, metadata: {},
        };

        test('findMissingKeys lists keys absent in the target', () => {
            assert.deepStrictEqual(findMissingKeys(en, ar), ['world']);
        });

        test('autoAddMissingKeys adds reference keys as empty to other locales', () => {
            const result = autoAddMissingKeys([en, ar], 'en');
            const arNext = result.find((t) => t.locale === 'ar')!;
            assert.strictEqual(arNext.keys['world'], '');
            assert.strictEqual(arNext.keys['hello'], 'مرحبا');
            // Reference stays untouched.
            const enNext = result.find((t) => t.locale === 'en')!;
            assert.deepStrictEqual(enNext.keys, en.keys);
        });

        test('autoAddMissingKeys defaults to the first file as reference', () => {
            const result = autoAddMissingKeys([en, ar]);
            const arNext = result.find((t) => t.locale === 'ar')!;
            assert.ok('world' in arNext.keys);
        });
    });

    suite('translateLocale (nested keys)', () => {
        const originalFetch = globalThis.fetch;
        const en: TranslationFileData = {
            locale: 'en', fileName: 'en.json', isArb: false,
            keys: {
                app_name: 'Mishkat',
                'tabs.home': 'Home',
                'tabs.settings': 'Settings',
                'quran.title': 'The Holy Quran',
            },
            metadata: {},
            // Nested file: these dot-keys came from real nested objects.
            nestedPaths: ['tabs.home', 'tabs.settings', 'quran.title'],
        };
        const es: TranslationFileData = {
            locale: 'es', fileName: 'es.json', isArb: false,
            keys: {
                app_name: '',
                'tabs.home': '',
                'tabs.settings': '',
                'quran.title': '',
            },
            metadata: {},
            nestedPaths: ['tabs.home', 'tabs.settings', 'quran.title'],
        };

        function googleMock(calls: string[]): void {
            globalThis.fetch = (async (input: string) => {
                const url = new URL(String(input));
                if (url.hostname === 'translate.googleapis.com') {
                    calls.push(url.href);
                    const lines = (url.searchParams.get('q') ?? '').split('\n');
                    const segments = lines.map((line, i) => [
                        i < lines.length - 1 ? `ES:${line}\n` : `ES:${line}`,
                        line,
                    ]);
                    return {
                        ok: true, status: 200,
                        json: async () => [segments, null, 'es'],
                    } as unknown as Response;
                }
                return { ok: true, status: 200, json: async () => ({ responseData: { translatedText: '' } }) } as unknown as Response;
            }) as typeof fetch;
        }

        teardown(() => {
            globalThis.fetch = originalFetch;
        });

        test('translateLocale fills missing nested values and keeps dot-path keys', async () => {
            const calls: string[] = [];
            googleMock(calls);

            const result = await translateLocale([en, es], 'es', 'en', true);

            const updated = result.translations.find((t) => t.locale === 'es')!;
            // Every nested key got a translation.
            assert.strictEqual(updated.keys['tabs.home'], 'ES:Home');
            assert.strictEqual(updated.keys['quran.title'], 'ES:The Holy Quran');
            // The structure survives a save round-trip (nested objects restored).
            const saved = JSON.parse(serializeTranslationContent(updated));
            assert.strictEqual(saved.tabs.home, 'ES:Home');
            assert.strictEqual(saved.quran.title, 'ES:The Holy Quran');
            // Batched into a single request (joined with newlines).
            assert.strictEqual(calls.length, 1);
        });

        test('translateLocale missingOnly leaves already-translated nested values intact', async () => {
            const calls: string[] = [];
            googleMock(calls);
            const partial: TranslationFileData = {
                locale: 'es', fileName: 'es.json', isArb: false,
                keys: { app_name: '', 'tabs.home': 'Inicio', 'tabs.settings': '', 'quran.title': '' },
                nestedPaths: ['tabs.home', 'tabs.settings', 'quran.title'],
                metadata: {},
            };

            const result = await translateLocale([en, partial], 'es', 'en', true);
            const updated = result.translations.find((t) => t.locale === 'es')!;
            assert.strictEqual(updated.keys['tabs.home'], 'Inicio');
            assert.strictEqual(updated.keys['quran.title'], 'ES:The Holy Quran');
        });
    });
});
