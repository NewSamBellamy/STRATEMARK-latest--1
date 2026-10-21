/**
 * The "where research is looking" feed: only what really happened, only sites.
 */
import { describe, expect, it, vi } from 'vitest';
import { GeminiRepository, migrateSnapshot, type RepoSnapshot, type ResearchStore } from './repository';
import { SOURCE_ACTIVITY_CAP, SourceActivityLog, observeSearch, reduceToHostname } from './source-activity';
import type { LlmClient } from './types';
import type { OriginalSourceReceipt } from './original-source';

function clock(start = 1_700_000_000_000) {
  let t = start;
  return { now: () => t, advance: (ms: number) => { t += ms; } };
}

describe('host reduction', () => {
  const table: Array<[string, string | null]> = [
    ['https://www.Example.com/path/page?token=abc#frag', 'example.com'],
    ['HTTP://WWW.SEC.GOV/Archives/edgar/data/1', 'sec.gov'],
    ['https://news.example.co.uk:8443/a', 'news.example.co.uk'],
    ['https://user:secret@www.example.com:8443/a?x=1', 'example.com'],
    ['www.Example.com/a/b', 'example.com'],
    ['example.com:8080/x', 'example.com'],
    ['//cdn.example.com/x.js', 'cdn.example.com'],
    ['https://example.com./', 'example.com'],
    ['http://192.168.1.10/admin', null],
    ['https://8.8.8.8/', null],
    ['http://[::1]:3000/', null],
    ['http://localhost:5173/', null],
    ['https://printer.local/', null],
    ['https://intranet/', null],
    ['https://app.localhost/', null],
    ['ftp://example.com/file', null],
    ['file:///C:/secret.txt', null],
    ['mailto:a@example.com', null],
    ['javascript:alert(1)', null],
    ['data:text/html,hi', null],
    ['', null],
    ['not a url at all', null],
    ['https://vertexaisearch.cloud.google.com/grounding-api-redirect/AbC123', null],
    ['https://foo.grounding-api-redirect.example.com/x', null],
    ['https://www.google.com/url?sa=t&url=notaurl', null],
    ['https://www.google.com/search?q=acme+revenue', null],
    ['https://news.google.com/rss/articles/CBMi', null],
    ['https://t.co/abc', null],
  ];
  it.each(table)('%s -> %s', (input, expected) => {
    expect(reduceToHostname(input)).toBe(expected);
  });

  it('unwraps a Google click wrapper only when its real target is a real site', () => {
    expect(reduceToHostname('https://www.google.com/url?q=https%3A%2F%2Fwww.reuters.com%2Fa%3Fb%3D1')).toBe('reuters.com');
    expect(reduceToHostname('https://www.google.com/url?q=http%3A%2F%2Flocalhost%2Fx')).toBeNull();
  });

  it('still records an ordinary google.com page', () => {
    expect(reduceToHostname('https://www.google.com/finance/quote/GOOG')).toBe('google.com');
  });
});

describe('SourceActivityLog', () => {
  it('starts empty with lastId 0', () => {
    expect(new SourceActivityLog().list()).toEqual({ items: [], lastId: 0 });
  });

  it('issues ids from 1, in order, newest last', () => {
    const c = clock();
    const log = new SourceActivityLog(c.now);
    log.record('read', 'https://a.com/x', 'Acme');
    log.record('found', 'https://b.com/y', null);
    const { items, lastId } = log.list();
    expect(items.map((i) => i.id)).toEqual([1, 2]);
    expect(items[0]).toEqual({ id: 1, at: new Date(c.now()).toISOString(), domain: 'a.com', kind: 'read', company: 'Acme' });
    expect(items[1]).toMatchObject({ domain: 'b.com', kind: 'found', company: null });
    expect(lastId).toBe(2);
  });

  it('keeps only the newest 300 and never reuses an id', () => {
    const c = clock();
    const log = new SourceActivityLog(c.now);
    for (let i = 0; i < SOURCE_ACTIVITY_CAP + 20; i += 1) {
      log.record('read', `https://site${i}.com/`, null);
      c.advance(10);
    }
    const { items, lastId } = log.list();
    expect(items).toHaveLength(SOURCE_ACTIVITY_CAP);
    expect(items[0]!.id).toBe(21);
    expect(items[items.length - 1]!.id).toBe(SOURCE_ACTIVITY_CAP + 20);
    expect(lastId).toBe(SOURCE_ACTIVITY_CAP + 20);
  });

  it('returns only rows after sinceId, and clamps a bad sinceId', () => {
    const c = clock();
    const log = new SourceActivityLog(c.now);
    for (const host of ['a.com', 'b.com', 'c.com']) { log.record('read', host); c.advance(5000); }
    expect(log.list(1).items.map((i) => i.domain)).toEqual(['b.com', 'c.com']);
    expect(log.list(3)).toEqual({ items: [], lastId: 3 });
    expect(log.list(99)).toEqual({ items: [], lastId: 3 });
    expect(log.list(-5).items).toHaveLength(3);
    expect(log.list(Number.NaN).items).toHaveLength(3);
    expect(log.list(1.9).items.map((i) => i.id)).toEqual([2, 3]);
  });

  it('collapses the same kind, site and company inside two seconds, not otherwise', () => {
    const c = clock();
    const log = new SourceActivityLog(c.now);
    expect(log.record('read', 'https://a.com/1', 'Acme')).toBe(true);
    c.advance(1500);
    expect(log.record('read', 'https://www.a.com/2?x=1', 'Acme')).toBe(false);
    expect(log.record('searched', 'https://a.com/1', 'Acme')).toBe(true); // different kind
    expect(log.record('read', 'https://a.com/1', 'Beta')).toBe(true); // different company
    expect(log.record('read', 'https://a.com/1', null)).toBe(true); // no company
    c.advance(600);
    expect(log.record('read', 'https://a.com/3', 'Acme')).toBe(true); // 2.1s after the first
    expect(log.list().items).toHaveLength(5);
  });

  it('ignores inputs that are not a public site', () => {
    const log = new SourceActivityLog();
    for (const input of ['http://localhost/', 'http://10.0.0.2/', 'ftp://a.com', 'https://vertexaisearch.cloud.google.com/grounding-api-redirect/x']) {
      expect(log.record('found', input)).toBe(false);
    }
    expect(log.list().lastId).toBe(0);
  });

  it('stores nothing but the bare site: no path, query, credentials or port', () => {
    const log = new SourceActivityLog();
    log.record('read', 'https://user:pw@www.Example.com:8443/private/doc?token=abc&k=secret#frag', 'Acme');
    const stored = JSON.stringify(log.list());
    for (const leak of ['token', 'abc', 'secret', 'private', 'doc', 'pw', 'user', '8443', 'frag', 'https', 'www.']) {
      expect(stored).not.toContain(leak);
    }
    expect(stored).toContain('example.com');
  });
});

describe('what the lanes report', () => {
  it('a search reports the result sites, never the query', async () => {
    const log = new SourceActivityLog();
    const lane = Object.assign(vi.fn(async (_query: string) => [
      { url: 'https://www.reuters.com/a?utm=1', title: 't', snippet: '' },
      { url: 'https://news.google.com/rss/articles/xyz', title: 'wrapped', snippet: '' },
    ]), { used: () => 7 });
    const observed = observeSearch(lane, log) as typeof lane;
    await observed('acme secret revenue query');
    expect(log.list().items.map((i) => [i.kind, i.domain])).toEqual([['searched', 'reuters.com']]);
    expect(JSON.stringify(log.list())).not.toContain('secret');
    expect(observed.used()).toBe(7);
  });
});

// ---- repository wiring -------------------------------------------------------------------------

const NOW = new Date().toISOString();

function receipt(url: string): OriginalSourceReceipt {
  return { requestedUrl: url, finalUrl: url, status: 'retrieved', retrievedAt: NOW, text: 'page', title: 't', contentType: 'text/html' } as unknown as OriginalSourceReceipt;
}

function makeRepo(extra: Record<string, unknown> = {}, ground: LlmClient['ground'] = vi.fn(async () => ({ text: 'ok', citations: [], queries: [] }))) {
  let data: RepoSnapshot = migrateSnapshot(null).snapshot;
  const store: ResearchStore = { read: () => data, write: (s: RepoSnapshot) => { data = structuredClone(s); } };
  const client = { ground, structure: vi.fn() } as unknown as LlmClient;
  return new GeminiRepository({ apiKey: 'k', store, client, dashboardWarmup: false, ...extra });
}

describe('GeminiRepository.listSourceActivity', () => {
  it('is an empty list before research touches anything', async () => {
    expect(await makeRepo().listSourceActivity!()).toEqual({ items: [], lastId: 0 });
  });

  it('turns a grounded answer\'s citations into found rows, skipping redirect wrappers and non-https', async () => {
    const ground = vi.fn(async () => ({
      text: 'x', queries: [],
      citations: [
        { title: 'a', url: 'https://www.sec.gov/Archives/edgar/data/1/x.htm?token=abc' },
        { title: 'b', url: 'https://vertexaisearch.cloud.google.com/grounding-api-redirect/AbCd' },
        { title: 'c', url: 'http://insecure.example.org/page' },
        { title: 'd', url: 'https://techcrunch.com/2026/a' },
      ],
    })) as unknown as LlmClient['ground'];
    const repo = makeRepo({}, ground);
    await (repo as unknown as { client: LlmClient }).client.ground('q', { researchContext: { companyName: 'Acme', topic: 'funding' } });
    const out = await repo.listSourceActivity!();
    expect(out.items.map((i) => [i.kind, i.domain, i.company])).toEqual([['found', 'sec.gov', 'Acme'], ['found', 'techcrunch.com', 'Acme']]);
    expect(out.lastId).toBe(2);
    const json = JSON.stringify(out);
    expect(json).not.toContain('token');
    expect(json).not.toContain('vertexaisearch');
    expect(json).not.toContain('/');
  });

  it('turns a page read through the original-source reader into a read row for that company', async () => {
    const reader = vi.fn(async (url: string) => receipt(url));
    const repo = makeRepo({ originalSourceReader: reader });
    const sources = (repo as unknown as { originalSources: { retrieve: (u: string, s?: object) => Promise<OriginalSourceReceipt> } }).originalSources;
    await sources.retrieve('https://www.acme.com/about?session=zzz', { companyId: 'c1', companyName: 'Acme' });
    const out = await repo.listSourceActivity!();
    expect(out.items).toMatchObject([{ kind: 'read', domain: 'acme.com', company: 'Acme' }]);
    expect(JSON.stringify(out)).not.toContain('session');
    expect(reader).toHaveBeenCalledTimes(1);
  });

  it('reports a supplied original-source service, the asset reader and a free search lane', async () => {
    const originalSources = {
      retrieve: vi.fn(async (url: string, _scope?: object) => receipt(url)),
      save: vi.fn(async () => undefined),
      list: vi.fn(async () => []),
    };
    const assetSourceReader = vi.fn(async (url: string) => receipt(url));
    const newsSearch = () => async () => [{ url: 'https://www.ft.com/content/abc?x=1', title: 't', snippet: '' }];
    const repo = makeRepo({ originalSources, assetSourceReader, newsSearch });
    const internals = repo as unknown as {
      originalSources: typeof originalSources; assetSourceReader: typeof assetSourceReader; newsSearch: () => (q: string) => Promise<unknown>;
    };
    await internals.originalSources.retrieve('https://sec.gov/a', { companyId: 'c', companyName: 'Beta' } as never);
    await internals.assetSourceReader('https://beta.io/logo');
    await internals.newsSearch()('anything');
    const out = await repo.listSourceActivity!();
    expect(out.items.map((i) => [i.kind, i.domain, i.company])).toEqual([
      ['read', 'sec.gov', 'Beta'], ['read', 'beta.io', null], ['searched', 'ft.com', null],
    ]);
    expect((await repo.listSourceActivity!(2)).items.map((i) => i.id)).toEqual([3]);
    expect((await repo.listSourceActivity!(-4)).items).toHaveLength(3);
  });

  it('never breaks the read when reporting fails', async () => {
    const repo = makeRepo({ assetSourceReader: async (url: string) => receipt(url) });
    const reader = (repo as unknown as { assetSourceReader: (u: string) => Promise<OriginalSourceReceipt> }).assetSourceReader;
    await expect(reader('not a url')).resolves.toMatchObject({ status: 'retrieved' });
    expect((await repo.listSourceActivity!()).items).toEqual([]);
  });
});
