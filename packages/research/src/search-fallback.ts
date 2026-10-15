/**
 * When the key's Google-Search grounding quota is spent, research does not
 * have to stop: plain model calls usually still answer, and the user's own
 * search key (or the free news lane) can find the sources instead.
 *
 * The fallback answers ONLY from the search results it was handed and cites
 * them by number; the citations are the real result URLs. Anything that
 * becomes a figure still passes the original-read and verbatim gates
 * downstream, exactly as a grounded answer would.
 */
import { z } from 'zod';
import type { LlmClient } from './types';
import type { WebSearchFn, WebSearchResult } from './web-search';
import type { OriginalSourceReceipt } from './original-source';
import type { ProviderGrounding } from './types';

const MAX_RESULTS = 8;
const MAX_RESULTS_WITH_HINTS = 12;
/** Snippets rarely name the players ("market size $47B…"); reading the top
 * pages gives the model what grounding would have. */
const PAGES_TO_READ = 3;
const PAGE_EXCERPT_CHARS = 5000;
const PAGE_READ_TIMEOUT_MS = 10_000;
const querySchema = z.object({ query: z.string().min(2).max(300) });
const answerSchema = z.object({
  text: z.string(),
  // Trimmed, never rejected: an over-long list must not fail the whole answer.
  quotes: z.array(z.object({ source: z.number().int(), quote: z.string() })).catch([]).default([])
    .transform((rows) => rows.slice(0, 30)),
});
const PASSAGES_HEADING = 'Verbatim source passages:';

/** The gemini client's "every line's quota is spent" signal. */
export function isQuotaExhausted(error: unknown): boolean {
  return (error as { status?: unknown } | null)?.status === 402;
}

/** Readable text of an HTML page: scripts, styles and markup removed. */
export function pageText(html: string): string {
  return html
    .replace(/<(script|style|noscript|svg|template|head)\b[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ').replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'")
    .replace(/&#x([0-9a-f]{1,6});/gi, (_, hex: string) => String.fromCodePoint(Number.parseInt(hex, 16)))
    .replace(/&#(\d{1,7});/g, (_, dec: string) => String.fromCodePoint(Number(dec)))
    .replace(/&rsquo;|&lsquo;/g, "'").replace(/&rdquo;|&ldquo;/g, '"').replace(/&ndash;|&mdash;/g, '-')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim();
}

export function searchResultsBlock(results: WebSearchResult[], excerpts: Array<string | null> = []): string {
  return results.map((r, i) => [
    `[${i + 1}] ${r.title}${r.publisher ? ` (${r.publisher})` : ''}${r.published ? `, ${r.published}` : ''}`,
    r.url,
    r.snippet,
    excerpts[i] ? `Page text: ${excerpts[i]}` : '',
  ].filter(Boolean).join('\n')).join('\n\n');
}

async function readExcerpt(read: (url: string) => Promise<OriginalSourceReceipt>, url: string): Promise<string | null> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const receipt = await Promise.race([
      read(url),
      new Promise<null>((resolve) => { timer = setTimeout(() => resolve(null), PAGE_READ_TIMEOUT_MS); }),
    ]);
    if (!receipt || receipt.status !== 'retrieved' || !receipt.text) return null;
    const text = pageText(receipt.text);
    return text.length > 200 ? text.slice(0, PAGE_EXCERPT_CHARS) : null;
  } catch { return null; } finally { clearTimeout(timer); }
}

const flat = (value: string) => value
  .replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/[–—]/g, '-')
  .replace(/\s+/g, ' ').trim();

/**
 * The answer, plus the model's quotes that really appear in the page text or
 * snippet of the result they name. Only those become supports: a figure can
 * enter the pipeline only from a sentence that is literally on its source.
 */
export function quoteGrounding(answer: string, quotes: Array<{ source: number; quote: string }>,
  results: WebSearchResult[], excerpts: Array<string | null>): { text: string; grounding?: ProviderGrounding } {
  const verified: Array<{ quote: string; index: number }> = [];
  const seen = new Set<string>();
  for (const { source, quote } of quotes) {
    const index = source - 1;
    const result = results[index];
    const clean = flat(quote).replace(/^["']|["']$/g, '');
    if (!result || clean.length < 20 || seen.has(clean)) continue;
    const haystack = flat(`${result.title} ${result.snippet} ${excerpts[index] ?? ''}`);
    if (!haystack.includes(clean)) continue;
    seen.add(clean);
    verified.push({ quote: clean, index });
  }
  const body = answer.trim();
  if (!verified.length) return { text: body };
  const text = `${body}\n\n${PASSAGES_HEADING}\n${verified.map((v) => v.quote).join('\n')}`;
  const supports: ProviderGrounding['supports'] = verified.map((v, supportIndex) => {
    const r = results[v.index]!;
    return { supportIndex, text: v.quote, sources: [{ chunkIndex: v.index, url: r.url, title: r.title || r.url }] };
  });
  return { text, grounding: { provider: 'page-quote', answerText: text, supports } };
}

export function withSearchFallback(client: LlmClient, searches: () => WebSearchFn[],
  readPage?: (url: string) => Promise<OriginalSourceReceipt>, onGroundingSpent?: () => void): LlmClient {
  return {
    ...client,
    async ground(prompt, opts) {
      try {
        return await client.ground(prompt, opts);
      } catch (error) {
        if (!isQuotaExhausted(error) || opts?.signal?.aborted) throw error;
        const lanes = searches();
        if (lanes.length === 0) throw error;
        // A fallback really is about to run: tell the app so it can say plainly why research just got slower.
        // (With no search lane the quota error itself reaches the user; claiming a fallback would be false.)
        try { onGroundingSpent?.(); } catch { /* a notice must never break research */ }
        const context = opts?.researchContext;
        const fallbackQuery = [context?.companyName, context?.topic].filter(Boolean).join(' ').trim();
        const query = await client.structure(
          `Write one web search query (at most 12 words) that would find published sources answering this research request. Return JSON {"query": "..."}.\n\nRequest:\n${prompt.slice(0, 4000)}`,
          querySchema, { signal: opts?.signal, priority: opts?.priority },
        ).then((r) => r.query.trim()).catch(() => fallbackQuery);
        const hints = (opts?.searchHints ?? []).map((h) => h.trim()).filter(Boolean).slice(0, 3);
        const queries = [...new Set([...hints, query].filter(Boolean))];
        if (queries.length === 0) throw error;
        const runQuery = async (q: string): Promise<WebSearchResult[]> => {
          for (const search of lanes) {
            const found = await search(q).catch(() => []);
            if (found.length > 0) return found;
          }
          return [];
        };
        const perQuery = await Promise.all(queries.map(runQuery));
        // Round-robin across queries so every angle is represented in the
        // results the model is allowed to answer from.
        const merged: WebSearchResult[] = [];
        for (let rank = 0; perQuery.some((list) => rank < list.length); rank += 1) {
          for (const list of perQuery) if (list[rank]) merged.push(list[rank]!);
        }
        const seen = new Set<string>();
        const results = merged.filter((r) => r.url && !seen.has(r.url) && seen.add(r.url))
          .slice(0, hints.length ? MAX_RESULTS_WITH_HINTS : MAX_RESULTS);
        if (results.length === 0) throw error;
        const excerpts = readPage
          ? await Promise.all(results.map((r, i) => i < PAGES_TO_READ ? readExcerpt(readPage, r.url) : Promise.resolve(null)))
          : [];
        const answer = await client.structure([
          prompt,
          'You cannot search the web yourself right now. Answer using ONLY the search results below, citing each fact with its result number like [2].',
          'Where the results do not say something, say it is unknown. Never fill a gap from memory, and never invent a figure, date or name.',
          'Also copy, character for character, every sentence from the results that states a fact you used (figures, dates, names, roles, products), with its result number. Copy exactly; do not shorten or reword.',
          'Return JSON {"text": "your full answer", "quotes": [{"source": 2, "quote": "exact sentence"}]}.',
          `Search results:\n${searchResultsBlock(results, excerpts)}`,
        ].join('\n\n'), answerSchema, { system: opts?.system, signal: opts?.signal, priority: opts?.priority });
        const { text, grounding } = quoteGrounding(answer.text, answer.quotes ?? [], results, excerpts);
        return {
          text,
          citations: results.map((r) => ({ title: r.title || r.url, url: r.url })),
          queries,
          ...(grounding ? { grounding } : {}),
        };
      }
    },
  };
}
