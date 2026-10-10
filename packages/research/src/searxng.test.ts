/** searxng — free discovery lane, feature-detected and degrade-safe. */
import { describe, expect, it, vi } from 'vitest';
import { probeSearxng, searxngNotes, searxngSearch, searxngUrl } from './searxng';

const jsonResponse = (body: unknown, status = 200): Promise<Response> => Promise.resolve(new Response(JSON.stringify(body), { status }));

const searxPayload = {
  results: [
    { url: 'https://adviserinfo.sec.gov/firm/summary/160489', title: 'ANDREESSEN HOROWITZ', content: 'Form ADV summary.' },
    { url: 'https://a16z.com/disclosures', title: 'a16z disclosures', content: 'AUM reported at $18B.' },
    { url: 'javascript:alert(1)', title: 'bad', content: 'non-http result is dropped' },
    { url: 'https://a16z.com/disclosures#dup', title: 'dupe', content: 'same host path — distinct URL kept' },
  ],
  infoboxes: [],
};

describe('probeSearxng', () => {
  it('accepts a JSON-capable instance', async () => {
    const fetchImpl = vi.fn((url: string) => jsonResponse(searxPayload).then(r => (void url, r)));
    await expect(probeSearxng('http://localhost:8888', fetchImpl as unknown as typeof fetch)).resolves.toBe(true);
    expect(String(fetchImpl.mock.calls[0]?.[0])).toContain('format=json');
  });

  it('rejects html-only instances and unreachable ones', async () => {
    expect(await probeSearxng('http://localhost:8888', vi.fn(() => jsonResponse('<html>', 200)))).toBe(false);
    expect(await probeSearxng('http://localhost:8888', vi.fn(() => jsonResponse({}, 403)))).toBe(false);
    expect(await probeSearxng('http://localhost:8888', vi.fn(() => Promise.reject(new Error('down'))))).toBe(false);
  });
});

describe('searxngSearch', () => {
  it('returns https-only, deduped results capped at eight', async () => {
    const many = Array.from({ length: 12 }, (_, i) => ({ url: `https://example.com/${i}`, title: `r${i}`, content: 'x' }));
    const results = await searxngSearch('http://localhost:8888/', 'aum', vi.fn(() => jsonResponse({ results: many })));
    expect(results).toHaveLength(8);
    const mixed = await searxngSearch('http://localhost:8888/', 'aum', vi.fn(() => jsonResponse(searxPayload)));
    expect(mixed.map((r) => r.url)).toEqual([
      'https://adviserinfo.sec.gov/firm/summary/160489',
      'https://a16z.com/disclosures',
      'https://a16z.com/disclosures#dup',
    ]);
  });

  it('degrades to empty on transport failure', async () => {
    expect(await searxngSearch('http://localhost:8888', 'q', vi.fn(() => Promise.reject(new Error('down'))))).toEqual([]);
    expect(await searxngSearch('http://localhost:8888', 'q', vi.fn(() => jsonResponse('nope')))).toEqual([]);
  });
});

describe('searxngNotes', () => {
  it('builds notes with citations and no provider grounding', () => {
    const notes = searxngNotes('a16z AUM', [
      { url: 'https://a16z.com/disclosures', title: 'a16z', snippet: 'AUM of $18 billion.' },
    ]);
    expect(notes.text).toContain('AUM of $18 billion.');
    expect(notes.citations).toEqual([{ title: 'a16z', url: 'https://a16z.com/disclosures' }]);
    expect(notes.queries).toEqual(['a16z AUM']);
    expect(notes.grounding).toBeUndefined();
  });

  it('says plainly when nothing was found', () => {
    expect(searxngNotes('q', []).text).toContain('No search results');
  });
});

describe('searxngUrl', () => {
  it('normalizes the base and encodes the query', () => {
    expect(searxngUrl('http://localhost:8888/', 'a16z AUM')).toBe('http://localhost:8888/search?q=a16z%20AUM&format=json&language=en');
  });
});
