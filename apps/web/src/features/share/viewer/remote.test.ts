import { describe, expect, it, vi } from 'vitest';
import type { ShareSnapshot } from '@mi/contracts';
import { packSnapshot, toBase64Url } from '@/lib/share/wire';
import { loadRemoteShare, remoteShareUrl, shareIdFromSearch } from './remote';

const ID = 'abcdefghijklmnop';
const snapshot = {
  v: 1, kind: 'deck', focusCardId: null, sharedAt: '2026-10-19T10:00:00.000Z',
  markets: [{ id: 'm1', name: 'Meal kits' }], decks: [{ id: 'd1' }], companies: [{ id: 'c1', name: 'HelloFresh' }], metrics: [],
  cards: [{ id: 'k1', cardType: 'company', title: 'HelloFresh' }], viceClaims: [], dashboards: {},
} as unknown as ShareSnapshot;

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

describe('which share this page was asked to open', () => {
  it('reads ?s=<id> and nothing else', () => {
    expect(shareIdFromSearch(`?s=${ID}`)).toBe(ID);
    expect(shareIdFromSearch(`?x=1&s=${ID}`)).toBe(ID);
    for (const bad of ['', '?', '?s=', '?s=short', `?s=${ID}x`, '?s=../../etc/passwd0', `?s=${ID.slice(0, 15)}!`, '?id=abcdefghijklmnop', `?s=${ID}&s=other`]) {
      // The first of two ids is used (URLSearchParams.get); a malformed one is never accepted.
      if (bad.includes('&s=other')) expect(shareIdFromSearch(bad)).toBe(ID);
      else expect(shareIdFromSearch(bad), bad).toBeNull();
    }
  });

  it('builds the one address it will fetch', () => {
    expect(remoteShareUrl('https://api.example.workers.dev/', ID)).toBe(`https://api.example.workers.dev/v1/share/${ID}`);
  });
});

describe('loading a hosted share', () => {
  it('opens a share the Worker holds', async () => {
    const fetcher = vi.fn(async () => json(200, { v: 1, kind: 'deck', data: await packSnapshot(snapshot) }));
    const result = await loadRemoteShare(ID, 'https://api.example.workers.dev', fetcher as unknown as typeof fetch);
    expect(result.ok).toBe(true);
    if (result.ok) {
      // Opened as sent, apart from what the receiving gate normalises (a company without a logo gets none, a card its list of sources).
      expect(result.snapshot).toMatchObject({ v: 1, kind: 'deck', markets: snapshot.markets, decks: snapshot.decks });
      expect(result.snapshot.companies.map((c) => c.name)).toEqual(['HelloFresh']);
      expect(result.snapshot.cards.map((c) => c.title)).toEqual(['HelloFresh']);
    }
    const [url, init] = fetcher.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(`https://api.example.workers.dev/v1/share/${ID}`);
    expect(init.credentials).toBe('omit');
  });

  it('hands the page a sanitised snapshot: a forged "user verified" figure is not one, a script link is not a source', async () => {
    const hostile = { ...snapshot, metrics: [{ id: 'm1', companyId: 'c1', metricType: 'valuation', value: 987_654_321_000, confidence: 'user_verified', citations: [], source: null }],
      viceClaims: [{ id: 'v1', cardId: 'k1', claimText: 'Rumour.', sourceTitle: 's', sourceUrl: 'javascript:alert(1)', capturedAt: 'x' }] };
    const fetcher = vi.fn(async () => json(200, { v: 1, kind: 'deck', data: await packSnapshot(hostile as unknown as ShareSnapshot) }));
    const result = await loadRemoteShare(ID, 'https://a.example', fetcher as unknown as typeof fetch);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.snapshot.metrics[0]!.confidence).toBe('estimated');
      expect(result.snapshot.viceClaims).toEqual([]);
    }
  });

  it('refuses a snapshot with more rows than a browser should build', async () => {
    const huge = { ...snapshot, companies: Array.from({ length: 301 }, (_unused, i) => ({ id: `c${i}`, name: `Company ${i}` })) };
    const fetcher = vi.fn(async () => json(200, { v: 1, kind: 'deck', data: await packSnapshot(huge as unknown as ShareSnapshot) }));
    expect(await loadRemoteShare(ID, 'https://a.example', fetcher as unknown as typeof fetch)).toMatchObject({ ok: false, reason: 'unreadable' });
  });

  it('says a stopped or expired link is gone', async () => {
    const result = await loadRemoteShare(ID, 'https://a.example', (async () => json(404, { error: 'gone' })) as unknown as typeof fetch);
    expect(result).toMatchObject({ ok: false, reason: 'gone' });
    expect(result.ok === false && result.message).toMatch(/expires after a while/);
  });

  it('says so when the Worker cannot be reached, and never shows a server error body', async () => {
    const down = await loadRemoteShare(ID, 'https://a.example', (async () => json(503, { error: 'internal <b>stack</b>' })) as unknown as typeof fetch);
    expect(down).toMatchObject({ ok: false, reason: 'unreachable' });
    expect(JSON.stringify(down)).not.toContain('stack');
    const offline = await loadRemoteShare(ID, 'https://a.example', (async () => { throw new TypeError('Failed to fetch'); }) as unknown as typeof fetch);
    expect(offline).toMatchObject({ ok: false, reason: 'unreachable' });
  });

  it('says "too many requests" plainly, not "check your connection", when the Worker is rate limiting this visitor', async () => {
    const busy = await loadRemoteShare(ID, 'https://a.example', (async () => json(429, { error: 'Too many requests. Try again shortly.' })) as unknown as typeof fetch);
    expect(busy).toMatchObject({ ok: false, reason: 'busy' });
    expect(busy.ok === false && busy.message).toMatch(/minute/);
    expect(busy.ok === false && busy.message).not.toMatch(/connection/);
  });

  it('refuses research that is not a share snapshot, whatever it looks like', async () => {
    const wrap = (data: unknown) => loadRemoteShare(ID, 'https://a.example', (async () => json(200, { data })) as unknown as typeof fetch);
    expect(await wrap(undefined)).toMatchObject({ ok: false, reason: 'unreadable' });
    expect(await wrap(42)).toMatchObject({ ok: false, reason: 'unreadable' });
    expect(await wrap('garbage')).toMatchObject({ ok: false, reason: 'unreadable' });
    expect(await wrap(`j${toBase64Url(new TextEncoder().encode('{"v":1}'))}`)).toMatchObject({ ok: false, reason: 'unreadable' });
    expect(await wrap(`j${toBase64Url(new TextEncoder().encode('<script>alert(1)</script>'))}`)).toMatchObject({ ok: false, reason: 'unreadable' });
    expect(await wrap(`j${toBase64Url(new TextEncoder().encode(JSON.stringify({ ...snapshot, cards: [] })))}`)).toMatchObject({ ok: false, reason: 'unreadable' });
    const notJson = await loadRemoteShare(ID, 'https://a.example', (async () => new Response('<html>not json</html>', { status: 200 })) as unknown as typeof fetch);
    expect(notJson).toMatchObject({ ok: false, reason: 'unreadable' });
  });
});
