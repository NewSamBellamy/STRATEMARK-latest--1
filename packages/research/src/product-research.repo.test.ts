/**
 * "Research this product" fan-out in the repository: the grounded brief, product news
 * and product videos are stored together; a stored, fresh brief spends nothing; a stored
 * brief without news/videos only runs those; a failed brief survives on news or videos.
 */
import { describe, expect, it, vi } from 'vitest';
import type { ZodType } from 'zod';
import { completenessFixture } from './completeness-report.fixture';
import { GeminiRepository, type RepoSnapshot } from './repository';
import type { LlmClient } from './types';
import type { WebSearchFn } from './web-search';

const SITE = 'https://acme.example/fleet-manager';
const V = 'vvvvvvvvvvv';
const RAW = { overview: 'Fleet Manager is control software for Acme robots.', metrics: [], sentiment: null, timeline: [{ date: 'Nov 2022', title: 'Launch', detail: '', sourceUrl: SITE }] };
const TEXT = 'Fleet Manager launched in November 2022.';

function setup(opts: { groundFails?: boolean; news?: WebSearchFn | null; web?: WebSearchFn | null; initial?: (s: RepoSnapshot) => RepoSnapshot } = {}) {
  const base = { ...completenessFixture(), viceClaims: [], reports: [], briefings: [], savedCards: [], opportunity: {}, researchJobs: [], threads: [] } as unknown as RepoSnapshot;
  let saved: RepoSnapshot = opts.initial ? opts.initial(base) : base;
  const ground = vi.fn(async () => {
    if (opts.groundFails) throw new Error('offline');
    return { text: TEXT, queries: [], citations: [{ title: 'Fleet Manager', url: SITE }] };
  });
  const structure = vi.fn(async (_p: string, schema: ZodType<unknown>) => schema.parse(RAW));
  const client: LlmClient = { ground, structure: structure as unknown as LlmClient['structure'] };
  const news = opts.news === undefined ? vi.fn(async () => [
    { url: 'https://news.example/fm', title: 'Acme Robotics updates Fleet Manager', snippet: '', published: new Date(Date.now() - 2 * 86_400_000).toISOString(), publisher: 'Wire' },
    { url: 'https://news.example/other', title: 'Acme Robotics hires a CFO', snippet: '', published: new Date(Date.now() - 86_400_000).toISOString() },
  ]) : opts.news;
  const web = opts.web === undefined ? vi.fn(async () => [{ url: `https://www.youtube.com/watch?v=${V}`, title: 't', snippet: '' }]) : opts.web;
  const videoJson = vi.fn(async () => ({ title: 'Fleet Manager walkthrough', author_name: 'Acme Robotics', html: `<iframe src="https://www.youtube.com/embed/${V}"></iframe>` }));
  const repo = new GeminiRepository({ apiKey: 'test', client, dashboardWarmup: false,
    originalSourceReader: async (url) => ({ requestedUrl: url, status: 'unavailable', retrievedAt: new Date().toISOString(), reason: 'offline' }),
    newsSearch: () => news ?? null, webSearch: () => web ?? null, videoJson,
    store: { read: () => structuredClone(saved), write: async (next) => { saved = structuredClone(next); } } });
  return { repo, ground, structure, news, web, videoJson, saved: () => saved };
}

describe('product research fan-out', () => {
  it('stores the brief with product-gated news and verified videos', async () => {
    const h = setup();
    const brief = await h.repo.researchProductBrief({ companyId: 'acme', productName: 'Fleet Manager' });
    expect(brief.overview).toContain('Fleet Manager');
    expect(brief.news?.map((n) => n.title)).toEqual(['Acme Robotics updates Fleet Manager']);
    expect(brief.newsCheckedAt).toBeTruthy();
    expect(brief.videos?.map((v) => [v.id, v.official])).toEqual([[V, true]]);
    expect(brief.launched).toMatchObject({ date: 'Nov 2022', title: 'Launch' });
    expect(await h.repo.peekProductBrief('acme', 'Fleet Manager')).toEqual(brief);
  });

  it('a fresh stored brief is returned without any call', async () => {
    const h = setup();
    await h.repo.researchProductBrief({ companyId: 'acme', productName: 'Fleet Manager' });
    const calls = [h.ground.mock.calls.length, (h.news as ReturnType<typeof vi.fn>).mock.calls.length, h.videoJson.mock.calls.length];
    await h.repo.researchProductBrief({ companyId: 'acme', productName: 'Fleet Manager' });
    expect([h.ground.mock.calls.length, (h.news as ReturnType<typeof vi.fn>).mock.calls.length, h.videoJson.mock.calls.length]).toEqual(calls);
  });

  it('a stored brief with stale news re-runs only the extras, not the grounded searches', async () => {
    const h = setup();
    const first = await h.repo.researchProductBrief({ companyId: 'acme', productName: 'Fleet Manager' });
    const old = new Date(Date.now() - 10 * 86_400_000).toISOString();
    const stale = setup({ initial: (s) => ({ ...s, productBriefs: { acme: { 'fleet manager': { ...first, newsCheckedAt: old, news: [] } } } }) });
    const again = await stale.repo.researchProductBrief({ companyId: 'acme', productName: 'Fleet Manager' });
    expect(stale.ground).not.toHaveBeenCalled();
    expect(again.news).toHaveLength(1);
    expect(again.overview).toBe(first.overview);
  });

  it('a failed grounded pass still stores a page when news or videos were found; with neither it throws', async () => {
    const h = setup({ groundFails: true });
    const brief = await h.repo.researchProductBrief({ companyId: 'acme', productName: 'Fleet Manager' });
    expect(brief.overview).toBe('');
    expect(brief.news).toHaveLength(1);

    const none = setup({ groundFails: true, news: async () => [], web: async () => [] });
    await expect(none.repo.researchProductBrief({ companyId: 'acme', productName: 'Fleet Manager' })).rejects.toThrow();
    expect(none.saved().productBriefs).toBeUndefined();
  });

  it('with no news lane and no video lane the brief is unchanged and news stays "never searched"', async () => {
    const h = setup({ news: null, web: null });
    const brief = await h.repo.researchProductBrief({ companyId: 'acme', productName: 'Fleet Manager' });
    expect(brief.news).toBeUndefined();
    expect(brief.videos).toBeUndefined();
  });

  it('a forced run whose lanes failed keeps the stored news', async () => {
    const h = setup();
    const first = await h.repo.researchProductBrief({ companyId: 'acme', productName: 'Fleet Manager' });
    const keep = setup({ news: async () => { throw new Error('429'); }, web: null, initial: (s) => ({ ...s, productBriefs: { acme: { 'fleet manager': first } } }) });
    const forced = await keep.repo.researchProductBrief({ companyId: 'acme', productName: 'Fleet Manager', force: true });
    expect(forced.news).toEqual(first.news);
  });
});
