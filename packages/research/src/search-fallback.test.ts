import { describe, expect, it, vi } from 'vitest';
import { withSearchFallback } from './search-fallback';
import type { LlmClient } from './types';

const spent = () => Object.assign(new Error('quota'), { status: 402 });

describe('withSearchFallback', () => {
  it('answers from search results, citing their real URLs, when grounding quota is spent', async () => {
    const structure = vi.fn()
      .mockResolvedValueOnce({ query: 'Cursor founders' })
      .mockResolvedValueOnce({ text: 'Anysphere makes Cursor [1].' });
    const client = { ground: vi.fn().mockRejectedValue(spent()), structure } as unknown as LlmClient;
    const search = vi.fn().mockResolvedValue([
      { url: 'https://a.com/x', title: 'Cursor maker Anysphere', snippet: 'Anysphere, the maker of Cursor…' },
      { url: 'https://a.com/x', title: 'dup', snippet: '' },
    ]);
    const out = await withSearchFallback(client, () => [search]).ground('Who makes Cursor?');
    expect(search).toHaveBeenCalledWith('Cursor founders');
    expect(out).toEqual({ text: 'Anysphere makes Cursor [1].', citations: [{ title: 'Cursor maker Anysphere', url: 'https://a.com/x' }], queries: ['Cursor founders'] });
    expect(structure.mock.calls[1]![0]).toContain('ONLY the search results');
  });

  it('tries the next lane when the first finds nothing', async () => {
    const client = { ground: vi.fn().mockRejectedValue(spent()),
      structure: vi.fn().mockResolvedValueOnce({ query: 'q' }).mockResolvedValueOnce({ text: 't' }) } as unknown as LlmClient;
    const empty = vi.fn().mockResolvedValue([]);
    const news = vi.fn().mockResolvedValue([{ url: 'https://n.com', title: 'n', snippet: '' }]);
    expect((await withSearchFallback(client, () => [empty, news]).ground('p')).citations).toHaveLength(1);
  });

  it('tells the app grounding is spent, only for a spent quota, and a failing listener never breaks research', async () => {
    const structure = vi.fn().mockResolvedValueOnce({ query: 'q' }).mockResolvedValueOnce({ text: 't' });
    const spentClient = { ground: vi.fn().mockRejectedValue(spent()), structure } as unknown as LlmClient;
    const search = vi.fn().mockResolvedValue([{ url: 'https://a.com/x', title: 'a', snippet: '' }]);
    const onSpent = vi.fn(() => { throw new Error('listener bug'); });
    await expect(withSearchFallback(spentClient, () => [search], undefined, onSpent).ground('p')).resolves.toMatchObject({ text: 't' });
    expect(onSpent).toHaveBeenCalledTimes(1);

    const onOther = vi.fn();
    const other = { ground: vi.fn().mockRejectedValue(new Error('blocked')), structure: vi.fn() } as unknown as LlmClient;
    await expect(withSearchFallback(other, () => [search], undefined, onOther).ground('p')).rejects.toThrow('blocked');
    expect(onOther).not.toHaveBeenCalled();
  });

  it('leaves every other failure, and a quota failure with no search, untouched', async () => {
    const other = new Error('blocked');
    const a = { ground: vi.fn().mockRejectedValue(other), structure: vi.fn() } as unknown as LlmClient;
    await expect(withSearchFallback(a, () => [vi.fn()]).ground('p')).rejects.toBe(other);
    const quota = spent();
    const b = { ground: vi.fn().mockRejectedValue(quota), structure: vi.fn() } as unknown as LlmClient;
    await expect(withSearchFallback(b, () => []).ground('p')).rejects.toBe(quota);
  });
});

describe('page reading', () => {
  it('feeds the readable text of the top pages to the answer', async () => {
    const structure = vi.fn().mockResolvedValueOnce({ query: 'q' }).mockResolvedValueOnce({ text: 't' });
    const client = { ground: vi.fn().mockRejectedValue(Object.assign(new Error('q'), { status: 402 })), structure } as unknown as LlmClient;
    const search = vi.fn().mockResolvedValue([{ url: 'https://r.com', title: 'Report', snippet: 'Market size…' }]);
    const html = `<html><head><title>x</title></head><body><script>var a=1</script><p>Leaders include Cursor &amp; GitHub Copilot.</p>${' filler'.repeat(60)}</body></html>`;
    const readPage = vi.fn().mockResolvedValue({ requestedUrl: 'https://r.com', status: 'retrieved', retrievedAt: '', text: html });
    await withSearchFallback(client, () => [search], readPage).ground('p');
    const prompt = structure.mock.calls[1]![0] as string;
    expect(prompt).toContain('Page text: Leaders include Cursor & GitHub Copilot.');
    expect(prompt).not.toContain('var a=1');
  });
});

describe('quoteGrounding', () => {
  const results = [{ url: 'https://r.com/a', title: 'Skydio raises', snippet: 'Skydio raised $230 million in Series E funding in 2023.' }];
  it('keeps only quotes that are literally on their source, as page-quote supports', async () => {
    const { quoteGrounding } = await import('./search-fallback');
    const out = quoteGrounding('Skydio raised $230M [1].', [
      { source: 1, quote: 'Skydio raised $230 million in Series E funding in 2023.' },
      { source: 1, quote: 'Skydio raised $500 million in Series F funding in 2025.' },
      { source: 2, quote: 'A quote naming a result that does not exist at all.' },
    ], results, []);
    expect(out.grounding?.provider).toBe('page-quote');
    expect(out.grounding?.supports.map((s) => s.text)).toEqual(['Skydio raised $230 million in Series E funding in 2023.']);
    expect(out.grounding?.answerText).toBe(out.text);
    expect(out.text).toContain('Verbatim source passages:');
  });
  it('returns plain text with no attribution when nothing verifies', async () => {
    const { quoteGrounding } = await import('./search-fallback');
    expect(quoteGrounding('answer', [{ source: 1, quote: 'Invented sentence that is not on the page.' }], results, [])).toEqual({ text: 'answer' });
  });
});

describe('search hints', () => {
  it('always runs the hint queries beside its own and interleaves their results', async () => {
    const structure = vi.fn().mockResolvedValueOnce({ query: 'IT asset disposition data destruction' })
      .mockResolvedValueOnce({ text: 'answer' });
    const client = { ground: vi.fn().mockRejectedValue(spent()), structure } as unknown as LlmClient;
    const search = vi.fn(async (q: string) => q.startsWith('top')
      ? [{ url: 'https://a.com/leaders', title: 'Top cybersecurity companies', snippet: 'CrowdStrike, Palo Alto Networks' }]
      : [{ url: 'https://b.com/itad', title: 'ITAD vendors', snippet: 'Iron Mountain' }]);
    const out = await withSearchFallback(client, () => [search]).ground('Find companies',
      { searchHints: ['top cybersecurity companies'] });
    expect(search).toHaveBeenCalledWith('top cybersecurity companies');
    expect(out.queries).toEqual(['top cybersecurity companies', 'IT asset disposition data destruction']);
    expect(out.citations.map((c) => c.url)).toEqual(['https://a.com/leaders', 'https://b.com/itad']);
  });
});
