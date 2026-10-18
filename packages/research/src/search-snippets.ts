/**
 * Search-first face hunt, the mechanical half: turn what a search engine
 * already returned (titles and snippets) into provider-style supports, so the
 * SAME reported-claim gate that checks a grounded answer can check them, with
 * no model call and no paid search.
 *
 * A support is a sentence copied verbatim from a result's title or snippet. It
 * is kept only when it names this company and carries a number; whether it
 * states a usable figure (right definition, a date, no rival, no plan or
 * forecast) is decided by the gate, never here. Labelled 'page-quote' because
 * the sentence really is on the cited result, never passed off as Google grounding.
 */
import type { MetricType } from '@mi/contracts';
import { namesCompany } from './reported-metrics';
import type { ProviderGrounding } from './types';
import type { WebSearchResult } from './web-search';

/**
 * Figures a news-style snippet can state about the company as a whole.
 * Users and Distribution are left out on purpose: a 'page-quote' reach row is
 * worded as "the company's own site states…", which a third-party snippet is not.
 */
export const SEARCH_SNIPPET_TYPES: readonly MetricType[] = [
  'employees', 'arr', 'revenue', 'valuation', 'market_cap', 'funding_total', 'last_round', 'aum',
];

const SENTENCE_BREAK = /(?<=[.!?])\s+(?=[A-Z"“])/;
const MIN_LENGTH = 25;
const MAX_LENGTH = 400;
const MAX_PER_RESULT = 3;
const MAX_SUPPORTS = 24;

/** Supports for one company from a set of search results; undefined when none qualifies. */
export function snippetGrounding(results: readonly WebSearchResult[], companyName: string): ProviderGrounding | undefined {
  const supports: ProviderGrounding['supports'] = [];
  const seen = new Set<string>();
  results.forEach((result, chunkIndex) => {
    let taken = 0;
    for (const field of [result.title, result.snippet]) {
      for (const piece of field.split(SENTENCE_BREAK)) {
        if (taken >= MAX_PER_RESULT || supports.length >= MAX_SUPPORTS) return;
        const sentence = piece.trim();
        if (sentence.length < MIN_LENGTH || sentence.length > MAX_LENGTH || seen.has(sentence)) continue;
        if (!/\d/.test(sentence) || !namesCompany(sentence, companyName)) continue;
        seen.add(sentence);
        taken += 1;
        supports.push({ supportIndex: supports.length, text: sentence,
          sources: [{ chunkIndex, url: result.url, title: result.title || result.url }] });
      }
    }
  });
  if (supports.length === 0) return undefined;
  return { provider: 'page-quote', answerText: supports.map((s) => s.text).join('\n'), supports };
}
