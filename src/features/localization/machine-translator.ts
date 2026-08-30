/**
 * Free, keyless machine translation for the Localization feature.
 *
 * The bulk of the work uses BATCHED translation: all strings for a locale are
 * sent to Google's `translate_a/single` endpoint in ONE request (one `q`
 * parameter per string), which is what makes bulk translation feel near-
 * instant, the same way popular i18n VS Code extensions do it. Anything Google
 * cannot handle falls back to the per-item provider chain used by the
 * `needed_docs_api` project (app\Support\MachineTranslator.php): MyMemory →
 * Google → LibreTranslate. Falls back gracefully to `null` when every provider
 * fails, so callers can keep the original value untouched.
 */

const PROVIDERS = ['mymemory', 'google', 'libretranslate'] as const;
type Provider = (typeof PROVIDERS)[number];

/** Default source/fallback locale used when none is provided. */
export const DEFAULT_FALLBACK_LOCALE = 'en';

const TIMEOUT_MS = 15000;

/**
 * Max characters per batched Google request. Strings are joined with a newline
 * and translated together, so this budget keeps the URL length sane (the gtx
 * endpoint rejects very long `q` values).
 */
const BATCH_BUDGET = 1500;

/**
 * Client values accepted by Google's `translate_a/single` endpoint. The
 * classic keyless client `gtx` is now answered with HTTP 429, so we use the
 * browser-client value `dict-chrome-ex` (falling back to `at`).
 */
const GTX_CLIENTS = ['dict-chrome-ex', 'at'];

/** Browser-ish User-Agent, which the endpoint expects for keyless access. */
const BROWSER_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';

/**
 * Fetch Google's `translate_a/single` JSON for one `q` value, trying each
 * client in `GTX_CLIENTS` in turn. Returns the `[0]` segment array (the list of
 * `[translated, source, …]` tuples) or `null` when every client fails or
 * returns a non-JSON response.
 */
async function fetchGtxSegments(
  q: string,
  source: string,
  target: string,
): Promise<Array<Array<unknown>> | null> {
  for (const client of GTX_CLIENTS) {
    const url = new URL('https://translate.googleapis.com/translate_a/single');
    url.searchParams.set('client', client);
    url.searchParams.set('sl', source);
    url.searchParams.set('tl', target);
    url.searchParams.set('dt', 't');
    url.searchParams.set('q', q);

    try {
      const response = await fetchWithTimeout(url.toString(), {
        headers: { 'User-Agent': BROWSER_UA },
      });
      if (!response.ok) {
        continue;
      }
      const json = (await response.json()) as Array<unknown> | null;
      const segments = json?.[0];
      if (Array.isArray(segments)) {
        return segments as Array<Array<unknown>>;
      }
    } catch {
      // Try the next client.
    }
  }
  return null;
}

/**
 * Translate a single piece of text into `target`, optionally specifying the
 * `source` language. Returns `null` when translation is not possible.
 */
export async function translateText(
  text: string,
  target: string,
  source?: string,
): Promise<string | null> {
  const trimmed = text.trim();
  if (trimmed === '') {
    return null;
  }

  const src = (source || DEFAULT_FALLBACK_LOCALE).trim() || DEFAULT_FALLBACK_LOCALE;

  for (const provider of PROVIDERS) {
    const result = await translateWith(provider, trimmed, src, target);
    if (result !== null) {
      return result;
    }
  }

  return null;
}

/**
 * Translate many values for the same target locale. The bulk is sent to
 * Google's `translate_a/single` endpoint in ONE batched request (multiple `q`
 * params) — this turns N HTTP round-trips into a handful and is what makes
 * bulk translation feel near-instant, i18n-style. Values Google could not
 * translate fall back to per-item requests through the provider chain. Returns
 * a map of key → translated value; keys that failed are omitted.
 */
export async function translateMany(
  values: Record<string, string>,
  target: string,
  source?: string,
): Promise<Record<string, string>> {
  const entries = Object.entries(values).filter(([, v]) => (v || '').trim() !== '');
  const results: Record<string, string> = {};
  const src = (source || DEFAULT_FALLBACK_LOCALE).trim() || DEFAULT_FALLBACK_LOCALE;

  // Fast path: every string in a handful of batched Google requests.
  const batch = await translateBatch(
    entries.map(([, value]) => value),
    src,
    target,
  );
  const remaining: Array<[string, string]> = [];
  entries.forEach(([key, value], i) => {
    const translated = batch ? batch[i] : null;
    if (translated !== null && translated !== undefined) {
      results[key] = translated;
    } else {
      remaining.push([key, value]);
    }
  });

  // Slow fallback: per-item requests through the provider chain.
  if (remaining.length > 0) {
    const CONCURRENCY = 6;
    let index = 0;
    async function worker(): Promise<void> {
      while (index < remaining.length) {
        const i = index++;
        const [key, value] = remaining[i];
        const translated = await translateText(value, target, src);
        if (translated !== null) {
          results[key] = translated;
        }
      }
    }
    await Promise.all(
      Array.from({ length: Math.min(CONCURRENCY, remaining.length) }, () => worker()),
    );
  }

  return results;
}

/**
 * Translate an array of strings in a handful of requests via Google's gtx
 * endpoint. All strings in a chunk are joined with a newline and sent as ONE
 * `q` value; the endpoint returns one sentence segment per line, so the result
 * is split back on newlines to recover each translation. This turns N HTTP
 * round-trips into ~1-2, which is what makes bulk translation feel instant.
 * Returns an array aligned with `texts` (each entry is the translated string,
 * or `null` when that item failed), or `null` when the whole batch failed so
 * callers fall back to per-item translation.
 */
export async function translateBatch(
  texts: string[],
  source: string,
  target: string,
): Promise<Array<string | null> | null> {
  if (texts.length === 0) {
    return [];
  }

  const output: Array<string | null> = new Array(texts.length).fill(null);

  // Group into chunks by character budget so the URL stays within limits.
  const chunks: Array<Array<{ index: number; text: string }>> = [];
  let current: Array<{ index: number; text: string }> = [];
  let currentLength = 0;
  texts.forEach((text, index) => {
    const item = { index, text };
    if (current.length > 0 && currentLength + text.length + 1 > BATCH_BUDGET) {
      chunks.push(current);
      current = [];
      currentLength = 0;
    }
    current.push(item);
    currentLength += text.length + (current.length > 1 ? 1 : 0);
  });
  if (current.length > 0) {
    chunks.push(current);
  }

  for (const chunk of chunks) {
    const joined = chunk.map((c) => c.text).join('\n');
    const segments = await fetchGtxSegments(joined, source, target);
    if (segments === null) {
      return null;
    }

    // Rebuild the full translated text, then split back on newlines. Each item
    // contributes as many lines as its source text, so multi-line values stay
    // aligned even though they were joined into a single `q`.
    let combined = '';
    for (const segment of segments) {
      if (Array.isArray(segment) && typeof segment[0] === 'string') {
        combined += segment[0];
      }
    }
    const parts = combined.split('\n');
    let partIndex = 0;
    chunk.forEach(({ index, text }) => {
      const lineCount = text.split('\n').length;
      const lines: string[] = [];
      for (let k = 0; k < lineCount && partIndex < parts.length; k += 1) {
        lines.push(parts[partIndex]);
        partIndex += 1;
      }
      while (lines.length > 0 && lines[lines.length - 1] === '') {
        lines.pop();
      }
      const value = lines.join('\n').trim();
      if (value !== '') {
        output[index] = value;
      }
    });
  }

  return output;
}

async function translateWith(
  provider: Provider,
  text: string,
  source: string,
  target: string,
): Promise<string | null> {
  try {
    switch (provider) {
      case 'mymemory':
        return await translateWithMyMemory(text, source, target);
      case 'google':
        return await translateWithGoogle(text, source, target);
      case 'libretranslate':
        return await translateWithLibreTranslate(text, source, target);
      default:
        return null;
    }
  } catch {
    return null;
  }
}

async function translateWithMyMemory(
  text: string,
  source: string,
  target: string,
): Promise<string | null> {
  const url = new URL('https://api.mymemory.translated.net/get');
  url.searchParams.set('q', text);
  url.searchParams.set('langpair', `${source}|${target}`);

  const response = await fetchWithTimeout(url.toString());
  if (!response.ok) {
    return null;
  }

  const json = (await response.json()) as {
    responseData?: { translatedText?: unknown };
  };
  const translated = json?.responseData?.translatedText;

  if (typeof translated !== 'string') {
    return null;
  }

  const value = translated.trim();
  if (value === '' || value.toUpperCase().startsWith('MYMEMORY WARNING')) {
    return null;
  }

  return value;
}

async function translateWithGoogle(
  text: string,
  source: string,
  target: string,
): Promise<string | null> {
  const segments = await fetchGtxSegments(text, source, target);
  const translated = segments?.[0]?.[0];
  return typeof translated === 'string' && translated.trim() !== ''
    ? translated.trim()
    : null;
}

async function translateWithLibreTranslate(
  text: string,
  source: string,
  target: string,
): Promise<string | null> {
  const response = await fetchWithTimeout('https://libretranslate.com/translate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ q: text, source, target, format: 'text' }),
  });
  if (!response.ok) {
    return null;
  }

  const json = (await response.json()) as { translatedText?: unknown };
  const translated = json?.translatedText;
  return typeof translated === 'string' && translated.trim() !== ''
    ? translated.trim()
    : null;
}

async function fetchWithTimeout(
  url: string,
  init?: RequestInit,
): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}
