import { describe, expect, it, vi } from 'vitest';
import { findProductNews, gateNewsRow, isRumour, namesProduct, productNewsQueries } from './product-news';
import type { WebSearchResult } from './web-search';

const now = new Date('2026-10-22T09:00:00Z');
const anthropic = { id: 'anthropic', name: 'Anthropic, PBC', websiteUrl: 'https://www.anthropic.com' };
const siblings = ['Claude', 'Claude Code', 'Claude Cowork'];
const row = (o: Partial<WebSearchResult> & { title: string }): WebSearchResult => ({
  url: `https://news.example/${encodeURIComponent(o.title).slice(0, 30)}`, snippet: '', published: '2026-10-15T08:00:00Z', ...o,
});

describe('namesProduct', () => {
  it('matches whole words only', () => {
    expect(namesProduct('Anthropic ships Claude Code 2', 'Claude Code')).toBe(true);
    expect(namesProduct('Claudette wins an award', 'Claude')).toBe(false);
    expect(namesProduct('Claude\'s new model', 'Claude')).toBe(true);
    expect(namesProduct('Go ahead and ship', 'Go')).toBe(false); // under 3 letters is never a match
  });
  it('a longer sibling that contains the name does not count for the shorter product', () => {
    expect(namesProduct('Anthropic launches Claude Code on the web', 'Claude', siblings)).toBe(false);
    expect(namesProduct('Anthropic launches Claude Code, and Claude gets memory', 'Claude', siblings)).toBe(true);
    expect(namesProduct('Anthropic launches Claude Code on the web', 'Claude Code', siblings)).toBe(true);
  });
});

describe('isRumour', () => {
  it.each(['Anthropic reportedly plans Claude 6', 'Leaked: the next Claude', 'Claude could launch a browser', 'Sources say Claude is coming'])('%s', (t) => {
    expect(isRumour(t)).toBe(true);
  });
  it('plain reporting is not', () => { expect(isRumour('Anthropic launches Claude Cowork for teams')).toBe(false); });
});

describe('gateNewsRow', () => {
  const gate = (r: WebSearchResult, productName = 'Claude') => gateNewsRow(r, { company: anthropic, productName, siblings }, now);
  it('keeps a dated recent story naming the company and the product, with the publisher\'s headline verbatim', () => {
    const item = gate(row({ title: 'Anthropic adds memory to Claude', publisher: 'The Verge' }));
    expect(item).toMatchObject({ title: 'Anthropic adds memory to Claude', publisher: 'The Verge', publishedAt: '2026-10-15T08:00:00.000Z' });
  });
  it('rejects a story about another product of the company', () => {
    expect(gate(row({ title: 'Anthropic launches Claude Code on the web' }))).toBeNull();
  });
  it('rejects rumours, leaks and speculation', () => {
    expect(gate(row({ title: 'Anthropic reportedly readying Claude update' }))).toBeNull();
    expect(gate(row({ title: 'Anthropic Claude update', snippet: 'A leak suggests a new tier.' }))).toBeNull();
  });
  it('rejects undated, future-dated and stale stories', () => {
    expect(gate(row({ title: 'Anthropic updates Claude', published: undefined }))).toBeNull();
    expect(gate(row({ title: 'Anthropic updates Claude', published: '2026-12-01T00:00:00Z' }))).toBeNull();
    expect(gate(row({ title: 'Anthropic updates Claude', published: '2025-01-01T00:00:00Z' }))).toBeNull();
  });
  it('needs the product in the headline, not only in the summary', () => {
    expect(gate(row({ title: 'Anthropic raises money', snippet: 'Claude revenue is growing.' }))).toBeNull();
  });
  it('needs the company named (a namesake product is not news)', () => {
    expect(gate(row({ title: 'Claude Monet exhibition opens' }))).toBeNull();
    expect(gate(row({ title: 'Claude Monet exhibition opens', snippet: 'Anthropic is not involved.' }))?.title).toBe('Claude Monet exhibition opens');
  });
  it('keeps only https links', () => {
    expect(gate(row({ title: 'Anthropic updates Claude', url: 'http://news.example/a' }))).toBeNull();
  });
});

describe('findProductNews', () => {
  it('merges lanes, dedupes by address and headline, orders newest first, caps the list', async () => {
    const news = vi.fn(async () => [
      row({ url: 'https://a.example/1?utm_source=x', title: 'Anthropic updates Claude memory', published: '2026-10-10T00:00:00Z' }),
      row({ url: 'https://a.example/2', title: 'Anthropic Claude gets voice', published: '2026-10-20T00:00:00Z' }),
    ]);
    const web = vi.fn(async () => [
      row({ url: 'https://a.example/1', title: 'Anthropic updates Claude memory', published: '2026-10-10T00:00:00Z' }),
      row({ url: 'https://b.example/3', title: 'Anthropic updates Claude memory!', published: '2026-10-11T00:00:00Z' }),
      row({ url: 'https://b.example/4', title: 'Anthropic Claude Code goes GA', published: '2026-10-21T00:00:00Z' }),
    ]);
    const out = await findProductNews({ company: anthropic, productName: 'Claude', siblings, searches: [news, web], now });
    expect(out.searched).toBe(true);
    expect(out.items.map((i) => i.title)).toEqual(['Anthropic Claude gets voice', 'Anthropic updates Claude memory']);
  });
  it('a lane that fails is not "no news": searched stays false', async () => {
    const out = await findProductNews({ company: anthropic, productName: 'Claude', searches: [async () => { throw new Error('429'); }], now });
    expect(out).toEqual({ items: [], searched: false });
  });
  it('a lane that answered with nothing is a real "none found"', async () => {
    const out = await findProductNews({ company: anthropic, productName: 'Claude', searches: [async () => []], now });
    expect(out).toEqual({ items: [], searched: true });
  });
  it('queries name the company and the product, quoted', () => {
    expect(productNewsQueries(anthropic, 'Claude Code')[1]).toBe('"Anthropic" "Claude Code"');
  });
});
