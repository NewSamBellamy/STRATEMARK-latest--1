import { describe, expect, it, vi } from 'vitest';
import type { ShareSnapshot } from '@mi/contracts';
import {
  HostedShareError, createHostedShare, findReusableShare, forgetShare, rememberShare, stopHostedShare, viewerUrlForThisApp, type RememberedShare,
} from './hostedShare';
import { unpackSnapshotText } from './wire';

const snapshot = {
  v: 1, kind: 'deck', focusCardId: null, sharedAt: '2026-10-19T10:00:00.000Z',
  markets: [{ id: 'mkt_meal', name: 'Meal kits' }], decks: [{ id: 'deck_1' }], companies: [{ id: 'c1', name: 'HelloFresh' }, { id: 'c2', name: 'Gousto' }],
  metrics: [], cards: [{ id: 'k1', cardType: 'company', title: 'HelloFresh' }], viceClaims: [], dashboards: {},
} as unknown as ShareSnapshot;

const created = { id: 'abcdefghijklmnop', url: 'https://api.example.workers.dev/s/abcdefghijklmnop', imageUrl: 'https://api.example.workers.dev/s/abcdefghijklmnop/og.png', expiresAt: 9_999_999_999_999, deleteToken: 'tok_abcdefghijklmnopqrstuvwx' };

function reply(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

describe('creating a hosted share', () => {
  it('sends the packed snapshot, the preview picture and the viewer address, and nothing that identifies the visitor', async () => {
    const fetcher = vi.fn(async () => reply(201, created));
    const png = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 1, 2, 3]);
    const share = await createHostedShare(snapshot, {
      apiUrl: 'https://api.example.workers.dev/', viewerUrl: 'https://app.example.com/share.html', fetcher: fetcher as unknown as typeof fetch, renderImage: async () => png,
    });
    expect(share).toEqual(created);
    expect(fetcher).toHaveBeenCalledTimes(1);
    const [url, init] = fetcher.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://api.example.workers.dev/v1/share');
    expect(init.method).toBe('POST');
    expect(init.credentials).toBe('omit');
    const sent = JSON.parse(init.body as string) as Record<string, string | number | null>;
    expect(sent).toMatchObject({ v: 1, kind: 'deck', viewer: 'https://app.example.com/share.html' });
    expect(String(sent.title)).toContain('Meal kits');
    expect(sent.og).toBe('iVBORw0KGgoBAgM=');
    expect(JSON.parse((await unpackSnapshotText(String(sent.data)))!)).toEqual(snapshot);
    expect(Object.keys(sent).sort()).toEqual(['data', 'description', 'kind', 'og', 'title', 'v', 'viewer']);
  });

  it('still makes the link when no picture could be drawn', async () => {
    const fetcher = vi.fn(async () => reply(201, { ...created, imageUrl: null }));
    const withNull = await createHostedShare(snapshot, { apiUrl: 'https://a.example', viewerUrl: 'https://app.example.com/share.html', fetcher: fetcher as unknown as typeof fetch, renderImage: async () => null });
    expect(withNull.imageUrl).toBeNull();
    expect(JSON.parse((fetcher.mock.calls[0] as unknown as [string, RequestInit])[1].body as string).og).toBeNull();
    const throwing = vi.fn(async () => reply(201, created));
    await createHostedShare(snapshot, { apiUrl: 'https://a.example', viewerUrl: 'https://app.example.com/share.html', fetcher: throwing as unknown as typeof fetch, renderImage: async () => { throw new Error('no canvas'); } });
    expect(JSON.parse((throwing.mock.calls[0] as unknown as [string, RequestInit])[1].body as string).og).toBeNull();
  });

  it('says what went wrong in words a person can act on', async () => {
    const run = (status: number, body: unknown) => createHostedShare(snapshot, { apiUrl: 'https://a.example', viewerUrl: 'https://app.example.com/share.html', fetcher: (async () => reply(status, body)) as unknown as typeof fetch });
    await expect(run(429, { error: 'You have made today’s share links. Try again tomorrow.' })).rejects.toMatchObject({ status: 429, message: 'You have made today’s share links. Try again tomorrow.' });
    await expect(run(413, { error: 'This share is too large to host.' })).rejects.toMatchObject({ status: 413, message: 'This share is too large to host.' });
    await expect(run(403, { error: 'Origin not allowed.' })).rejects.toThrow(/not set up for this address/);
    await expect(run(500, { error: 'boom <script>' })).rejects.toThrow(/could not make the link/);
    await expect(run(502, null)).rejects.toBeInstanceOf(HostedShareError);
    const offline = createHostedShare(snapshot, { apiUrl: 'https://a.example', viewerUrl: 'https://app.example.com/share.html', fetcher: (async () => { throw new TypeError('Failed to fetch'); }) as unknown as typeof fetch });
    await expect(offline).rejects.toThrow(/Could not reach the sharing service/);
  });

  it('does not repeat a server body it did not write, however long', async () => {
    const run = createHostedShare(snapshot, { apiUrl: 'https://a.example', viewerUrl: 'https://app.example.com/share.html', fetcher: (async () => reply(429, { error: 'x'.repeat(5000) })) as unknown as typeof fetch });
    await expect(run).rejects.toThrow(/Try again later/);
  });

  it('refuses an answer that is not a share', async () => {
    const run = (body: unknown) => createHostedShare(snapshot, { apiUrl: 'https://a.example', viewerUrl: 'https://app.example.com/share.html', fetcher: (async () => reply(201, body)) as unknown as typeof fetch });
    await expect(run({ id: 'x' })).rejects.toThrow(/could not make the link/);
    await expect(run(null)).rejects.toThrow(/could not make the link/);
  });

  it('points the viewer at this app\'s own share.html', () => {
    expect(viewerUrlForThisApp('https://app.example.com/beta/')).toBe('https://app.example.com/beta/share.html');
    expect(viewerUrlForThisApp('https://app.example.com/deep/route?x=1#/y')).toBe('https://app.example.com/deep/share.html');
  });
});

describe('stopping a share', () => {
  it('sends the token the Worker gave back, and treats an already-gone share as stopped', async () => {
    const fetcher = vi.fn(async () => reply(200, { ok: true }));
    await stopHostedShare({ id: 'abcdefghijklmnop', deleteToken: 'tok_abcdefghijklmnopqrstuvwx' }, { apiUrl: 'https://a.example', fetcher: fetcher as unknown as typeof fetch });
    const [url, init] = fetcher.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://a.example/v1/share/abcdefghijklmnop');
    expect(init.method).toBe('DELETE');
    expect((init.headers as Record<string, string>)['X-Share-Token']).toBe('tok_abcdefghijklmnopqrstuvwx');
    await expect(stopHostedShare({ id: 'abcdefghijklmnop', deleteToken: 't' }, { apiUrl: 'https://a.example', fetcher: (async () => reply(404, {})) as unknown as typeof fetch })).resolves.toBeUndefined();
  });

  it('reports a failure to stop instead of pretending it worked', async () => {
    await expect(stopHostedShare({ id: 'abcdefghijklmnop', deleteToken: 't' }, { apiUrl: 'https://a.example', fetcher: (async () => reply(403, {})) as unknown as typeof fetch })).rejects.toThrow(/Could not stop sharing/);
    await expect(stopHostedShare({ id: 'abcdefghijklmnop', deleteToken: 't' }, { apiUrl: 'https://a.example', fetcher: (async () => { throw new TypeError('offline'); }) as unknown as typeof fetch })).rejects.toThrow(/Could not reach/);
  });
});

describe('links made from this browser', () => {
  function memoryStorage() {
    const map = new Map<string, string>();
    return { map, getItem: (k: string) => map.get(k) ?? null, setItem: (k: string, v: string) => { map.set(k, v); } };
  }
  const remembered = (over: Partial<RememberedShare> = {}): RememberedShare => ({ ...created, subject: 'deck:d1', fingerprint: 'fp1', title: 'Meal kits', ...over });

  it('finds an unchanged deck\'s link and ignores one for different research, another deck, or one about to expire', () => {
    const storage = memoryStorage();
    const now = 1_000_000;
    rememberShare(remembered({ expiresAt: now + 10 * 86_400_000 }), storage);
    expect(findReusableShare('deck:d1', 'fp1', now, storage)?.id).toBe('abcdefghijklmnop');
    expect(findReusableShare('deck:d1', 'changed', now, storage)).toBeNull();
    expect(findReusableShare('deck:d2', 'fp1', now, storage)).toBeNull();
    expect(findReusableShare('deck:d1', 'fp1', now + 9.5 * 86_400_000, storage)).toBeNull();
  });

  it('forgets a link that was stopped, and keeps the newest fifty', () => {
    const storage = memoryStorage();
    rememberShare(remembered(), storage);
    forgetShare('abcdefghijklmnop', storage);
    expect(findReusableShare('deck:d1', 'fp1', 0, storage)).toBeNull();
    for (let i = 0; i < 60; i++) rememberShare(remembered({ id: `id${String(i).padStart(14, '0')}` }), storage);
    expect(JSON.parse(storage.map.get('mi.shares')!)).toHaveLength(50);
  });

  it('survives storage that is missing, full, or holds junk', () => {
    expect(() => rememberShare(remembered(), null)).not.toThrow();
    expect(findReusableShare('deck:d1', 'fp1', 0, null)).toBeNull();
    const junk = { getItem: () => '{not json', setItem: () => { throw new Error('quota'); } };
    expect(findReusableShare('deck:d1', 'fp1', 0, junk)).toBeNull();
    expect(() => rememberShare(remembered(), junk)).not.toThrow();
    expect(findReusableShare('deck:d1', 'fp1', 0, { getItem: () => JSON.stringify([{ nope: 1 }, 7, null]) })).toBeNull();
  });
});
