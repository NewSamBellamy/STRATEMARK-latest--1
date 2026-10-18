import { describe, expect, it } from 'vitest';
import { snippetGrounding, SEARCH_SNIPPET_TYPES } from './search-snippets';
import type { WebSearchResult } from './web-search';

const row = (url: string, title: string, snippet: string): WebSearchResult => ({ url, title, snippet });

describe('snippetGrounding', () => {
  it('keeps only sentences that name the company and carry a number, verbatim', () => {
    const results = [
      row('https://www.reuters.com/a', 'Zenith raises $80 million at a $600 million valuation',
        'Zenith has approximately 450 employees, according to the company. The skincare market is crowded. Rivalco has 900 employees.'),
    ];
    const g = snippetGrounding(results, 'Zenith')!;
    expect(g.provider).toBe('page-quote');
    expect(g.supports.map((s) => s.text)).toEqual([
      'Zenith raises $80 million at a $600 million valuation',
      'Zenith has approximately 450 employees, according to the company.',
    ]);
    // Each support is literally on its cited result, so the gates can re-check it.
    for (const s of g.supports) {
      const source = results[s.sources[0]!.chunkIndex]!;
      expect(`${source.title} ${source.snippet}`).toContain(s.text);
      expect(s.sources[0]!.url).toBe('https://www.reuters.com/a');
    }
    expect(g.answerText).toBe(g.supports.map((s) => s.text).join('\n'));
  });

  it('returns nothing when no sentence names the company with a figure', () => {
    expect(snippetGrounding([row('https://x.example/a', 'Market overview', 'The company raised $50 million.')], 'Zenith')).toBeUndefined();
    expect(snippetGrounding([row('https://x.example/b', 'Zenith news', 'Zenith opened a new office in Leeds last week.')], 'Zenith')).toBeUndefined();
    expect(snippetGrounding([], 'Zenith')).toBeUndefined();
  });

  it('bounds how much one result and the whole set can contribute, and drops duplicates', () => {
    const many = Array.from({ length: 8 }, (_, i) => `Zenith reported ${100 + i} employees in the filing number ${i}.`).join(' ');
    const g = snippetGrounding([row('https://x.example/c', 'Zenith', many)], 'Zenith')!;
    expect(g.supports).toHaveLength(3);
    const dup = snippetGrounding([
      row('https://x.example/d', 'Zenith has 450 employees worldwide today', ''),
      row('https://y.example/e', 'Zenith has 450 employees worldwide today', ''),
    ], 'Zenith')!;
    expect(dup.supports).toHaveLength(1);
  });

  it('never asks for reach figures, whose page-quote wording says "own site states"', () => {
    expect(SEARCH_SNIPPET_TYPES).not.toContain('users');
    expect(SEARCH_SNIPPET_TYPES).not.toContain('distribution');
    expect(SEARCH_SNIPPET_TYPES).toEqual(expect.arrayContaining(['employees', 'valuation', 'revenue', 'arr']));
  });
});
