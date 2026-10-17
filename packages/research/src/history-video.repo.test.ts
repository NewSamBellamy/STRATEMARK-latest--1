/**
 * History video wired into GeminiRepository: found after the timeline exists,
 * stored on history.content.video, reused (not searched again), never blocking.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ZodType } from 'zod';
import { completenessFixture } from './completeness-report.fixture';
import { GeminiRepository, type RepoSnapshot } from './repository';
import type { LlmClient } from './types';
import type { WebSearchFn } from './web-search';

afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

const ID = 'AcmeStory01';
const watch = `https://www.youtube.com/watch?v=${ID}`;

function setup(over: { search?: ReturnType<typeof vi.fn<WebSearchFn>>; withJson?: boolean; noLane?: boolean } = {}) {
  const scores = { value: 9 };
  let saved: RepoSnapshot = { ...completenessFixture(), viceClaims: [], reports: [], briefings: [], savedCards: [],
    opportunity: {}, researchJobs: [], threads: [] } as unknown as RepoSnapshot;
  const structure = vi.fn(async (prompt: string, schema: ZodType<unknown>) => {
    const listed = JSON.parse(prompt.slice(prompt.lastIndexOf('\n') + 1)) as Array<{ id: string }>;
    return schema.parse({ verdicts: listed.map((c) => ({ id: c.id, accept: true, score: scores.value, reason: 'Tells the Acme Robotics founding story.' })) });
  });
  const client: LlmClient = { ground: vi.fn(async () => ({ text: '', citations: [], queries: [] })), structure: structure as unknown as LlmClient['structure'] };
  const search = over.search ?? vi.fn<WebSearchFn>(async () => [{ url: watch, title: 't', snippet: '' }]);
  const videoJson = vi.fn(async (url: string) => {
    const id = new URL(new URL(url).searchParams.get('url')!).searchParams.get('v')!;
    return { title: 'The Story of Acme Robotics', author_name: 'Acme Robotics', author_url: 'https://www.youtube.com/@acme', html: `<iframe src="https://www.youtube.com/embed/${id}"></iframe>` };
  });
  const repo = new GeminiRepository({ apiKey: 'test', client, dashboardWarmup: false,
    ...(over.withJson === false ? {} : { videoJson }), webSearch: () => (over.noLane ? null : search),
    originalSourceReader: async (url) => ({ requestedUrl: url, status: 'unavailable', retrievedAt: new Date().toISOString(), reason: 'offline' }),
    store: { read: () => structuredClone(saved), write: async (next) => { saved = structuredClone(next); } } });
  return { repo, client, search, videoJson, scores, saved: () => saved };
}

const videoOf = (snap: RepoSnapshot) => (snap.dashboards.acme?.history?.content as { video?: { id: string } | null }).video;

describe('History video in the repository', () => {
  it('stores a checked video on the cached History tab without blocking the read, then reuses it', async () => {
    const { repo, search, videoJson, saved } = setup();
    const tab = await repo.getDashboardTab('acme', 'history');
    expect(tab?.tab).toBe('history'); // the read did not wait for the video
    await repo.waitForDashboardWarmup();
    expect(videoOf(saved())?.id).toBe(ID);
    expect(saved().dashboards.acme!.history!.citations?.some((c) => c.url === watch)).toBe(true);

    const searches = search.mock.calls.length;
    const again = await repo.getDashboardTab('acme', 'history');
    await repo.waitForDashboardWarmup();
    expect(search.mock.calls.length).toBe(searches); // stored video: no second search
    expect(videoJson).toHaveBeenCalledTimes(1);
    expect((again?.content as { video?: { id: string } }).video?.id).toBe(ID);
  });

  it('a forced search that finds nothing keeps the stored video; one that finds a video replaces it', async () => {
    const rows: Array<{ url: string; title: string; snippet: string }> = [{ url: watch, title: 't', snippet: '' }];
    const { repo, saved } = setup({ search: vi.fn<WebSearchFn>(async () => rows) });
    await repo.getDashboardTab('acme', 'history');
    await repo.waitForDashboardWarmup();
    const stored = videoOf(saved());
    expect(stored?.id).toBe(ID);
    rows.length = 0;
    await repo.fillHistoryVideo('acme', { force: true });
    expect(videoOf(saved())).toEqual(stored);
  });

  it('a re-researched History tab keeps the video already chosen', async () => {
    const { repo, client, saved } = setup();
    await repo.getDashboardTab('acme', 'history');
    await repo.waitForDashboardWarmup();
    const stored = videoOf(saved());
    const real = client.structure;
    (client as { structure: LlmClient['structure'] }).structure = (async (prompt: string, schema: ZodType<unknown>, opts: unknown) => {
      if (prompt.includes('UNTRUSTED CANDIDATES')) return (real as (...a: unknown[]) => Promise<unknown>)(prompt, schema, opts);
      return schema.parse({ founderStory: 'Two engineers started it.', quotes: [], timeline: [{ date: '2014', title: 'Company founded', detail: 'Founded in Oakland.' }] });
    }) as LlmClient['structure'];
    (client.ground as ReturnType<typeof vi.fn>).mockResolvedValue({ text: 'Acme Robotics was founded in 2014 in Oakland.', citations: [{ title: 'Acme', url: 'https://acme.example/about' }], queries: [] });
    const fresh = await repo.getDashboardTab('acme', 'history', true);
    await repo.waitForDashboardWarmup();
    expect((fresh?.content as { timeline: unknown[] }).timeline).toHaveLength(1); // really re-researched
    expect((fresh?.content as { video?: { id: string } }).video?.id).toBe(stored?.id);
    expect(videoOf(saved())?.id).toBe(ID);
  });

  it('stores nothing (absent, never a guess) when no lane finds a candidate, and a miss is not retried at once', async () => {
    const empty = vi.fn<WebSearchFn>(async () => []);
    const { repo, client, saved } = setup({ search: empty });
    await repo.getDashboardTab('acme', 'history'); // cached-open path: free lanes only, no grounded spend
    await repo.waitForDashboardWarmup();
    expect(videoOf(saved())).toBeUndefined();
    expect(client.ground).not.toHaveBeenCalled();
    const calls = empty.mock.calls.length;
    await repo.getDashboardTab('acme', 'history');
    await repo.waitForDashboardWarmup();
    expect(empty.mock.calls.length).toBe(calls);
  });

  it('is off without an oEmbed transport', async () => {
    const { repo, search, saved } = setup({ withJson: false });
    await repo.getDashboardTab('acme', 'history');
    await repo.waitForDashboardWarmup();
    expect(search).not.toHaveBeenCalled();
    expect(videoOf(saved())).toBeUndefined();
  });
});

describe('History video: the miss window, modes and queueing', () => {
  it('a free-only run that could not search never blocks a later grounded run', async () => {
    const { repo, client } = setup({ noLane: true });
    await repo.getDashboardTab('acme', 'history'); // free-only, and there is no search lane: a no-op
    await repo.waitForDashboardWarmup();
    expect(client.ground).not.toHaveBeenCalled();
    await repo.fillHistoryVideo('acme', { grounded: true });
    expect(client.ground).toHaveBeenCalledTimes(1);
  });

  it('a transient search failure does not start the six-hour window; a real empty answer does, per mode', async () => {
    const lane = vi.fn<WebSearchFn>(async () => { throw new Error('network'); });
    const { repo, client } = setup({ search: lane });
    await repo.fillHistoryVideo('acme', { grounded: false });
    const first = lane.mock.calls.length;
    expect(first).toBeGreaterThan(0);
    await repo.fillHistoryVideo('acme', { grounded: false });
    expect(lane.mock.calls.length).toBeGreaterThan(first); // asked again: no window after an error

    lane.mockImplementation(async () => []);
    await repo.fillHistoryVideo('acme', { grounded: false }); // a real search that found nothing
    const afterMiss = lane.mock.calls.length;
    await repo.fillHistoryVideo('acme', { grounded: false });
    expect(lane.mock.calls.length).toBe(afterMiss); // window holds for free-only...
    expect(client.ground).not.toHaveBeenCalled();
    await repo.fillHistoryVideo('acme', { grounded: true });
    expect(client.ground).toHaveBeenCalledTimes(1); // ...but a grounded run is a different question
  });

  it('a forced or grounded request that arrives during a weaker run is queued after it, not dropped', async () => {
    let release: (rows: Array<{ url: string; title: string; snippet: string }>) => void = () => undefined;
    const gate = new Promise<Array<{ url: string; title: string; snippet: string }>>((resolve) => { release = resolve; });
    const lane = vi.fn<WebSearchFn>(() => gate);
    const { repo, client } = setup({ search: lane });
    const free = repo.fillHistoryVideo('acme', { grounded: false });
    const grounded = repo.fillHistoryVideo('acme', { grounded: true });
    expect(grounded).not.toBe(free);
    expect(repo.fillHistoryVideo('acme', { grounded: false })).toBe(grounded); // covered by the queued, stronger run
    expect(client.ground).not.toHaveBeenCalled(); // not before the free run is done
    release([]);
    await grounded;
    expect(client.ground).toHaveBeenCalledTimes(1);
  });

  it('a forced re-search replaces the stored video only if the new one scored at least as high', async () => {
    const rows: Array<{ url: string; title: string; snippet: string }> = [{ url: watch, title: 't', snippet: '' }];
    const { repo, scores, saved } = setup({ search: vi.fn<WebSearchFn>(async () => rows) });
    await repo.getDashboardTab('acme', 'history');
    await repo.waitForDashboardWarmup();
    expect(videoOf(saved())?.id).toBe(ID);

    const OTHER = 'AcmeOther02';
    rows.splice(0, rows.length, { url: `https://www.youtube.com/watch?v=${OTHER}`, title: 't', snippet: '' });
    scores.value = 8;
    await repo.fillHistoryVideo('acme', { force: true });
    expect(videoOf(saved())?.id).toBe(ID); // worse: kept
    scores.value = 9;
    await repo.fillHistoryVideo('acme', { force: true });
    expect(videoOf(saved())?.id).toBe(OTHER); // as good: replaced
  });
});
