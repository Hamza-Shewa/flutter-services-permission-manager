import * as assert from 'assert';
import { translateBatch, translateMany, translateText } from '../../features/localization/machine-translator.js';

suite('Machine Translator Test Suite', () => {
    const originalFetch = globalThis.fetch;

    function jsonResponse(body: unknown): Response {
        return { ok: true, status: 200, json: async () => body } as unknown as Response;
    }

    function failingResponse(): Response {
        return { ok: false, status: 500, json: async () => ({}) } as unknown as Response;
    }

    teardown(() => {
        globalThis.fetch = originalFetch;
    });

    suite('translateBatch', () => {
        test('joins all strings into one q and splits the result back', async () => {
            let capturedUrl = '';
            globalThis.fetch = (async (input: string) => {
                capturedUrl = String(input);
                // gtx returns one sentence segment per line, with a trailing
                // newline on every line except the last.
                return jsonResponse([
                    [
                        ['Hola\n', 'hello\n', null, null, 1],
                        ['Mundo', 'world', null, null, 1],
                    ],
                    null,
                    'es',
                ]);
            }) as typeof fetch;

            const result = await translateBatch(['hello', 'world'], 'en', 'es');

            assert.deepStrictEqual(result, ['Hola', 'Mundo']);
            const url = new URL(capturedUrl);
            assert.strictEqual(url.searchParams.get('client'), 'dict-chrome-ex');
            assert.strictEqual(url.searchParams.get('q'), 'hello\nworld');
        });

        test('keeps multi-line values intact', async () => {
            globalThis.fetch = (async () =>
                jsonResponse([
                    [
                        ['Línea uno\n', 'line one\n', null, null, 1],
                        ['Línea dos', 'line two', null, null, 1],
                    ],
                    null,
                    'es',
                ])) as typeof fetch;

            const result = await translateBatch(['line one\nline two'], 'en', 'es');
            assert.deepStrictEqual(result, ['Línea uno\nLínea dos']);
        });

        test('returns null when the request throws', async () => {
            globalThis.fetch = (async () => {
                throw new Error('network down');
            }) as typeof fetch;

            const result = await translateBatch(['hello'], 'en', 'es');
            assert.strictEqual(result, null);
        });

        test('returns null when the response is not ok', async () => {
            globalThis.fetch = (async () => failingResponse()) as typeof fetch;
            const result = await translateBatch(['hello'], 'en', 'es');
            assert.strictEqual(result, null);
        });

        test('chunks large batches into multiple requests', async () => {
            const calls: string[] = [];
            globalThis.fetch = (async (input: string) => {
                const url = new URL(String(input));
                calls.push(url.href);
                const lines = (url.searchParams.get('q') ?? '').split('\n');
                const segments = lines.map((line, i) => {
                    const translated = `T:${line}`;
                    return [
                        i < lines.length - 1 ? `${translated}\n` : translated,
                        i < lines.length - 1 ? `${line}\n` : line,
                    ];
                });
                return jsonResponse([segments, null, 'es']);
            }) as typeof fetch;

            // Three ~700-char strings exceed the 1500-char budget → 2 requests.
            const texts = [
                'a'.repeat(700),
                'b'.repeat(700),
                'c'.repeat(700),
            ];
            const result = await translateBatch(texts, 'en', 'es');

            assert.strictEqual(result!.length, 3);
            assert.strictEqual(calls.length, 2);
            assert.strictEqual(result![0], 'T:' + 'a'.repeat(700));
            assert.strictEqual(result![2], 'T:' + 'c'.repeat(700));
        });
    });

    suite('translateMany', () => {
        test('translates everything with a single batched request', async () => {
            let googleCalls = 0;
            globalThis.fetch = (async (input: string) => {
                const url = new URL(String(input));
                if (url.hostname === 'translate.googleapis.com') {
                    googleCalls += 1;
                    const lines = (url.searchParams.get('q') ?? '').split('\n');
                    const segments = lines.map((line, i) => [
                        i < lines.length - 1 ? `ES:${line}\n` : `ES:${line}`,
                        line,
                    ]);
                    return jsonResponse([segments, null, 'es']);
                }
                return jsonResponse({ responseData: { translatedText: '' } });
            }) as typeof fetch;

            const result = await translateMany(
                { a: 'hello', b: 'world', c: 'foo' },
                'es',
                'en',
            );

            assert.deepStrictEqual(result, { a: 'ES:hello', b: 'ES:world', c: 'ES:foo' });
            assert.strictEqual(googleCalls, 1);
        });

        test('falls back to per-item requests when the batch fails', async () => {
            const googleCalls: string[] = [];
            const mymemoryCalls: string[] = [];
            globalThis.fetch = (async (input: string) => {
                const url = new URL(String(input));
                if (url.hostname === 'translate.googleapis.com') {
                    googleCalls.push(url.href);
                    throw new Error('batch unavailable');
                }
                if (url.hostname === 'api.mymemory.translated.net') {
                    mymemoryCalls.push(url.href);
                    const q = url.searchParams.get('q') ?? '';
                    return jsonResponse({ responseData: { translatedText: `TR:${q}` } });
                }
                return jsonResponse({ translatedText: '' });
            }) as typeof fetch;

            const result = await translateMany({ a: 'hello', b: 'world' }, 'es', 'en');

            // Batch failed (google), so per-item MyMemory calls produced the values.
            assert.deepStrictEqual(result, { a: 'TR:hello', b: 'TR:world' });
            assert.ok(googleCalls.length > 0);
            assert.strictEqual(mymemoryCalls.length, 2);
        });

        test('skips empty values', async () => {
            globalThis.fetch = (async () => {
                throw new Error('should not be called');
            }) as typeof fetch;

            const result = await translateMany({ a: '', b: '   ' }, 'es', 'en');
            assert.deepStrictEqual(result, {});
        });
    });

    suite('translateText', () => {
        test('returns null for blank input without calling fetch', async () => {
            globalThis.fetch = (async () => {
                throw new Error('should not be called');
            }) as typeof fetch;
            assert.strictEqual(await translateText('   ', 'es', 'en'), null);
        });

        test('translates via the provider chain', async () => {
            globalThis.fetch = (async (input: string) => {
                const url = new URL(String(input));
                if (url.hostname === 'api.mymemory.translated.net') {
                    return jsonResponse({ responseData: { translatedText: 'Hola' } });
                }
                return jsonResponse({ responseData: { translatedText: '' } });
            }) as typeof fetch;

            assert.strictEqual(await translateText('hello', 'es', 'en'), 'Hola');
        });
    });
});
