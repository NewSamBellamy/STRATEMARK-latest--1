/**
 * The warm-up wired into GeminiRepository: it researches through the on-open
 * path (getDashboardTab), persists its attempts so a reload resumes, stores a
 * cited founded year, and moves the completeness scoreboard from "never
 * attempted" to attempted / filled.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ZodType } from 'zod';
import { buildCompletenessReport, type CompanyCompletenessReport } from './completeness-report';
import { completenessFixture } from './completeness-report.fixture';
import { companyStoryPart } from './company-team';
import { WARM_TABS } from './dashboard-warmup';
import { GeminiRepository, type RepoSnapshot } from './repository';
import type { LlmClient } from './types';

afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

const CITATIONS = [
  { title: 'Acme history — acme.example', url: 'https://acme.example/about/history' },
  { title: 'Founding profile — press.example', url: 'https://press.example/acme-founded' },
];

/**
 * One structured answer every tab schema accepts (zod strips the keys a tab
 * does not use). Fixture data, not research.
 */
const TAB_ANSWER = {
  markdown: '## What they do\nWarehouse robots.\n\n## Why it matters\nLabour shortages.',
  founderStory: 'Two engineers started the company in a garage.',
  timeline: [
    { date: '2019', title: 'Series B', detail: 'Raised a Series B.' },
    { date: '2014', title: 'Company founded', detail: 'Founded in Oakland by two engineers.' },
  ],
  quotes: [],
  nodes: [{ id: 'p1', name: 'Pat Lee', role: 'CEO', group: 'exec', parentId: null, bio: 'Co-founder.' }],
  products: [{ name: 'Picker', description: 'A picking robot.', revenueNote: 'not disclosed', url: null, status: 'live' }],
  roadmap: [],
  items: [],
  cadence: 'weekly',
  lastRefreshedAt: null,
};

/** A shared Team + History answer: team half, the COMPANY STORY line, story half, each half grounded on its own source. */
function storyAnswer(team: string, story: string, teamUrl: string, storyUrl: string) {
  const text = `${team}\nCOMPANY STORY\n${story}`;
  return { text, citations: [{ title: 'Team', url: teamUrl }, { title: 'Story', url: storyUrl }], queries: [], grounding: {
    provider: 'google-search' as const, answerText: text, supports: [
      { supportIndex: 0, text: team, sources: [{ chunkIndex: 0, url: teamUrl, title: 'Team' }] },
      { supportIndex: 1, text: story, sources: [{ chunkIndex: 1, url: storyUrl, title: 'Story' }] },
    ] } };
}

function client(): LlmClient & { ground: ReturnType<typeof vi.fn> } {
  return {
    ground: vi.fn(async () => ({ text: 'Acme Robotics was founded in 2014 in Oakland.', citations: CITATIONS, queries: ['q'] })),
    structure: (async (_prompt: string, schema: ZodType<unknown>) => schema.parse(structuredClone(TAB_ANSWER))) as LlmClient['structure'],
  };
}

function fixtureRepo(options: { wikidataJson?: (url: string) => Promise<unknown>; saved?: RepoSnapshot | null; llm?: LlmClient; backfill?: boolean; allowed?: () => boolean; resumeDelayMs?: number } = {}) {
  let saved: RepoSnapshot = options.saved ?? ({ ...completenessFixture(), viceClaims: [], reports: [], briefings: [], savedCards: [],
    opportunity: {}, researchJobs: [], threads: [] } as unknown as RepoSnapshot);
  const llm = options.llm ?? client();
  const repo = new GeminiRepository({ apiKey: 'test', client: llm, wikidataJson: options.wikidataJson,
    ...(options.backfill !== undefined || options.allowed || options.resumeDelayMs !== undefined
      ? { dashboardWarmup: { backfill: options.backfill ?? false, startupDelayMs: 0, resumeDelayMs: options.resumeDelayMs ?? 3_600_000, ...(options.allowed ? { allowed: options.allowed } : {}) } } : {}),
    // Offline readers: no page or news lane may reach the network from a unit test.
    originalSourceReader: async (url) => ({ requestedUrl: url, status: 'unavailable', retrievedAt: new Date().toISOString(), reason: 'offline' }),
    store: { read: () => structuredClone(saved), write: async (next) => { saved = structuredClone(next); } } });
  return { repo, llm, saved: () => saved };
}

const slot = (company: CompanyCompletenessReport, key: string) => company.slots.find((row) => row.key === key)!;
const TAB_SLOTS = ['team', 'history', 'products', 'news'];

describe('dashboard warm-up in the repository', () => {
  it('never warms an archived deck, and warms it again once restored', async () => {
    vi.stubGlobal('fetch', async () => { throw new Error('offline'); });
    const { repo, llm, saved } = fixtureRepo();
    const marketId = saved().decks.find((deck) => deck.id === 'deck_fx')!.marketId;
    await repo.setMarketArchived(marketId, true);

    expect(repo.warmDeckDashboards('deck_fx', 'open')).toBe(0);
    expect(repo.warmStoredDecks()).toBe(0);
    expect(repo.resumeInterruptedWarmups()).toBe(0);
    await repo.getDeckByMarket(marketId);
    await repo.waitForDashboardWarmup();
    expect(llm.ground).not.toHaveBeenCalled();

    await repo.setMarketArchived(marketId, false);
    expect(repo.warmDeckDashboards('deck_fx', 'backfill')).toBe(3);
  });

  it('archiving drops warm-ups already queued for the deck, without marking them tried', async () => {
    vi.stubGlobal('fetch', async () => { throw new Error('offline'); });
    let open = false;
    const { repo, llm, saved } = fixtureRepo({ allowed: () => open });
    const marketId = saved().decks.find((deck) => deck.id === 'deck_fx')!.marketId;
    expect(repo.warmDeckDashboards('deck_fx', 'creation')).toBe(3); // queued behind a closed gate
    await repo.setMarketArchived(marketId, true);

    open = true;
    (repo as unknown as { warmup: { kick(): void } }).warmup.kick();
    await repo.waitForDashboardWarmup();
    expect(llm.ground).not.toHaveBeenCalled();
    expect(repo.pendingDashboardWarmup()).toEqual([]);
    expect(saved().dashboardWarmup ?? {}).toEqual({});

    // Restored, the deck warms in full: nothing was recorded as attempted.
    await repo.setMarketArchived(marketId, false);
    expect(repo.warmDeckDashboards('deck_fx', 'open')).toBe(3);
  });

  it('moves every tab slot of a stored deck out of "never attempted" and stores a cited founded year', async () => {
    vi.stubGlobal('fetch', async () => { throw new Error('offline'); });
    const { repo, saved } = fixtureRepo();
    const before = buildCompletenessReport(saved()).decks[0]!;
    const neverBefore = before.companies.flatMap((company) => TAB_SLOTS
      .filter((key) => slot(company, key).status === 'unknown_never_attempted').map((key) => `${company.companyId}:${key}`));
    // The fixture starts with most tab slots never tried (the owner scoreboard's shape).
    expect(neverBefore).toEqual(expect.arrayContaining(['beta:history', 'beta:products', 'gamma:team', 'gamma:history', 'gamma:products', 'gamma:news']));

    expect(repo.warmDeckDashboards('deck_fx', 'backfill')).toBe(3);
    await repo.waitForDashboardWarmup();

    const after = buildCompletenessReport(saved()).decks[0]!;
    for (const company of after.companies) {
      for (const key of TAB_SLOTS) expect(slot(company, key).status, `${company.companyId}:${key}`).not.toBe('unknown_never_attempted');
      // History is rich now, and the founded year is stored with its citations.
      expect(slot(company, 'history').status).toBe('filled');
    }
    // The signal-only company is never warmed.
    expect(saved().dashboards.vice_entity).toBeUndefined();
    const gamma = saved().companies.find((company) => company.id === 'gamma')!;
    expect(gamma.founded).toMatchObject({ year: 2014, source: 'history', evidence: expect.stringContaining('Founded in Oakland') });
    expect(gamma.founded!.citations.map((citation) => citation.url)).toEqual(CITATIONS.map((citation) => citation.url));
    expect(slot(after.companies.find((company) => company.companyId === 'gamma')!, 'identity.founded').value).toBe('2014 (history tab)');
    // Every attempt is persisted with a timestamp (resumable, back-off aware).
    for (const companyId of ['acme', 'beta', 'gamma']) {
      for (const tab of WARM_TABS) {
        const cached = saved().dashboards[companyId]?.[tab];
        const attempt = saved().dashboardWarmup?.[companyId]?.[tab];
        // Acme's team tab was cached EMPTY on Oct 1: that counts as one empty attempt, its
        // back-off has elapsed, so it got exactly one forced re-research.
        if (companyId === 'acme' && tab === 'team_org') { expect(attempt).toMatchObject({ count: 2 }); continue; }
        if (companyId === 'acme' && tab === 'history') continue; // cached before: never redone
        expect(cached ?? attempt, `${companyId}:${tab}`).toBeDefined();
        if (attempt) expect(Date.parse(attempt.at)).not.toBeNaN();
      }
    }
  });

  it('resumes after a reload without redoing cached tabs', async () => {
    vi.stubGlobal('fetch', async () => { throw new Error('offline'); });
    const first = fixtureRepo();
    first.repo.warmDeckDashboards('deck_fx', 'creation');
    await first.repo.waitForDashboardWarmup();
    const groundCalls = first.llm.ground as ReturnType<typeof vi.fn>;
    expect(groundCalls.mock.calls.length).toBeGreaterThan(0);

    const reloaded = fixtureRepo({ saved: first.saved() });
    expect(reloaded.repo.warmDeckDashboards('deck_fx', 'open')).toBe(0);
    await reloaded.repo.waitForDashboardWarmup();
    expect(reloaded.llm.ground).not.toHaveBeenCalled();
  });

  it('prefers the company\'s own Wikidata item for the founded year, cited to it', async () => {
    const wikidataJson = vi.fn(async (url: string) => url.includes('wbsearchentities')
      ? { search: [{ id: 'Q42' }] }
      : { entities: { Q42: { labels: { en: { value: 'Acme Robotics' } }, claims: {
        P856: [{ mainsnak: { datavalue: { value: 'https://www.acme.example/' } } }],
        P571: [{ mainsnak: { datavalue: { value: { time: '+2013-05-01T00:00:00Z', precision: 11 } } } }],
      } } } });
    const { repo, saved } = fixtureRepo({ wikidataJson });
    await repo.fillFoundedYear('acme');
    expect(saved().companies.find((company) => company.id === 'acme')!.founded).toMatchObject({
      year: 2013, source: 'wikidata', citations: [{ url: 'https://www.wikidata.org/wiki/Q42' }] });
    // Asked once per company per session: name search, brand-word search, entity fetch.
    await repo.fillFoundedYear('acme');
    expect(wikidataJson).toHaveBeenCalledTimes(3);
    // The scoreboard reads the stored year.
    const acme = buildCompletenessReport(saved()).decks[0]!.companies.find((company) => company.companyId === 'acme')!;
    expect(slot(acme, 'identity.founded').value).toBe('2013 (Wikidata)');
  });

  it('stores no founded year when the history tab carries no usable citation', async () => {
    const { repo, saved } = fixtureRepo();
    // Acme's fixture history tab states a founding in 2015 but holds no citations.
    await repo.fillFoundedYear('acme');
    expect(saved().companies.find((company) => company.id === 'acme')!.founded).toBeUndefined();
  });

  it('a figure change drops only the figure-built Overview; researched tabs survive', async () => {
    const { repo, saved } = fixtureRepo();
    const seeded = saved();
    seeded.dashboards.acme = { ...seeded.dashboards.acme, overview: { content: { markdown: 'old' }, lastRefreshedAt: '2026-10-01T00:00:00.000Z', citations: [] } } as RepoSnapshot['dashboards'][string];
    const fresh = fixtureRepo({ saved: seeded });
    await fresh.repo.overrideMetric({ companyId: 'acme', metricType: 'employees', value: 1300, note: 'analyst count' });
    expect(fresh.saved().dashboards.acme?.overview).toBeUndefined();
    expect(fresh.saved().dashboards.acme?.history).toBeDefined();
    expect(fresh.saved().dashboards.acme?.live_intel).toBeDefined();
    void repo;
  });

  it('a figure change keeps a current Overview: its narrative holds no figures and they are projected on read', async () => {
    const seeded = fixtureRepo().saved();
    seeded.dashboards.acme = { ...seeded.dashboards.acme, overview: { content: { markdown: 'rendered' }, lastRefreshedAt: '2026-10-01T00:00:00.000Z', citations: [],
      overviewEvidenceVersion: 3, overviewNarrative: { companyId: 'acme', basis: 'google-search', answerText: 'Acme builds warehouse robots.', citations: [], paragraphs: [] } } } as RepoSnapshot['dashboards'][string];
    const fresh = fixtureRepo({ saved: seeded });
    await fresh.repo.overrideMetric({ companyId: 'acme', metricType: 'employees', value: 1300, note: 'analyst count' });
    expect(fresh.saved().dashboards.acme?.overview?.overviewNarrative?.answerText).toBe('Acme builds warehouse robots.');
    // Reading it again spends nothing.
    await fresh.repo.getDashboardTab('acme', 'overview');
    expect(fresh.llm.ground).not.toHaveBeenCalled();
  });

  it('Overview and Products share one search per company; a forced refresh or a failed search starts a new one', async () => {
    vi.stubGlobal('fetch', async () => { throw new Error('offline'); });
    const llm = client();
    const { repo } = fixtureRepo({ llm });
    await repo.getDashboardTab('acme', 'overview');
    await repo.getDashboardTab('acme', 'products_roadmap');
    expect(llm.ground).toHaveBeenCalledTimes(1);
    expect(llm.ground.mock.calls[0]![1]).toMatchObject({ label: 'company_briefing', researchContext: { companyId: 'acme', topic: 'company_briefing' } });
    // Another company gets its own search.
    await repo.getDashboardTab('beta', 'overview');
    expect(llm.ground).toHaveBeenCalledTimes(2);
    // Refresh asks Google again rather than replaying the shared answer.
    await repo.getDashboardTab('acme', 'products_roadmap', true);
    expect(llm.ground).toHaveBeenCalledTimes(3);

    const failingLlm = client();
    failingLlm.ground.mockRejectedValueOnce(new Error('quota'));
    const failing = fixtureRepo({ llm: failingLlm });
    await failing.repo.getDashboardTab('acme', 'overview');
    await failing.repo.getDashboardTab('acme', 'products_roadmap');
    expect(failingLlm.ground).toHaveBeenCalledTimes(2);
  });

  it('History and Team share one search per company, and History keeps that search sources', async () => {
    vi.stubGlobal('fetch', async () => { throw new Error('offline'); });
    const llm = client();
    llm.ground.mockImplementation(async (prompt: string) => prompt.includes('COMPANY STORY')
      ? storyAnswer('Gamma Shop is led by its founder.', 'Gamma Shop was founded in 2014.', 'https://gamma.example/team', CITATIONS[0]!.url)
      : { text: 'Gamma Shop sells robot gadgets.', citations: CITATIONS, queries: ['q'] });
    const { repo } = fixtureRepo({ llm });
    const history = await repo.getDashboardTab('gamma', 'history');
    await repo.getDashboardTab('gamma', 'team_org');
    expect(llm.ground).toHaveBeenCalledTimes(1);
    expect(llm.ground.mock.calls[0]![1]).toMatchObject({ label: 'company_story', researchContext: { companyId: 'gamma', topic: 'company_story' } });
    // History cites the story half's source, never the team page.
    expect((history?.citations ?? []).map((c) => c.url)).toEqual([CITATIONS[0]!.url]);
    // Overview + Products are a different search.
    await repo.getDashboardTab('gamma', 'overview');
    expect(llm.ground).toHaveBeenCalledTimes(2);
    // Refresh asks Google again rather than replaying the shared answer.
    await repo.getDashboardTab('gamma', 'history', true);
    expect(llm.ground).toHaveBeenCalledTimes(3);
  });

  it('each tab reads only its half of the shared answer, and an unmarked answer is not shared', () => {
    const shared = storyAnswer('Ada Lovelace currently serves as Chief Executive Officer of Gamma Shop.',
      '2023 Nov: Emmett Shear was named as interim CEO of Gamma Shop.', 'https://gamma.example/team', 'https://news.example/story');
    const team = companyStoryPart(shared, 'team')!;
    expect(team.text).toBe('Ada Lovelace currently serves as Chief Executive Officer of Gamma Shop.');
    expect(team.text).not.toContain('Emmett');
    expect(team.grounding!.supports.map((s) => s.text)).toEqual([team.text]);
    expect(team.citations.map((c) => c.url)).toEqual(['https://gamma.example/team']);
    const story = companyStoryPart(shared, 'story')!;
    expect(story.text).not.toContain('Ada Lovelace');
    expect(story.citations.map((c) => c.url)).toEqual(['https://news.example/story']);
    // Without exactly one marker line, or without grounding, the halves cannot be told apart.
    expect(companyStoryPart({ ...shared, text: shared.text.replace('COMPANY STORY', 'Story') }, 'team')).toBeNull();
    expect(companyStoryPart({ ...shared, text: `${shared.text}\nCOMPANY STORY` }, 'story')).toBeNull();
    expect(companyStoryPart({ text: shared.text, citations: shared.citations, queries: [] }, 'team')).toBeNull();
    // A support straddling the marker belongs to neither half; a half left without sources is not used.
    const straddling = { ...shared, grounding: { ...shared.grounding, supports: [{ supportIndex: 0,
      text: shared.text, sources: [{ chunkIndex: 0, url: 'https://gamma.example/team', title: 'Team' }] }] } };
    expect(companyStoryPart(straddling, 'team')).toBeNull();
    expect(companyStoryPart(straddling, 'story')).toBeNull();
    // A marker first leaves no team half: History must not read the team text as its story.
    expect(companyStoryPart({ ...shared, text: `COMPANY STORY\n${shared.text.replace('\nCOMPANY STORY', '')}` }, 'story')).toBeNull();
  });

  it('a tab that joins the shared search late and outlives it caches nothing, so the next open asks again', async () => {
    vi.stubGlobal('fetch', async () => { throw new Error('offline'); });
    vi.useFakeTimers();
    try {
      const llm = client();
      // The shared search hangs until its own deadline aborts it.
      llm.ground.mockImplementationOnce((_prompt: string, opts?: { signal?: AbortSignal }) => new Promise((_resolve, reject) => {
        opts?.signal?.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })));
      }));
      const { repo, saved } = fixtureRepo({ llm });
      const products = repo.getDashboardTab('acme', 'products_roadmap').catch((error: Error) => error);
      await vi.advanceTimersByTimeAsync(50_000);
      const overview = repo.getDashboardTab('acme', 'overview').catch((error: Error) => error);
      await vi.advanceTimersByTimeAsync(41_000);
      expect(await overview).toMatchObject({ name: 'TimeoutError' });
      await products;
      expect(saved().dashboards.acme?.overview).toBeUndefined();
      expect(llm.ground).toHaveBeenCalledTimes(1);
      // Reopening asks Google again instead of showing a cached "background unavailable".
      await repo.getDashboardTab('acme', 'overview');
      expect(llm.ground).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it('never backfills stored decks unless explicitly enabled (one-time spend needs approval)', async () => {
    vi.stubGlobal('fetch', async () => { throw new Error('offline'); });
    for (const backfill of [undefined, false]) {
      const off = fixtureRepo(backfill === undefined ? {} : { backfill });
      await new Promise((resolve) => setTimeout(resolve, 5));
      await off.repo.getDeckByMarket('mkt_fx');
      await off.repo.waitForDashboardWarmup();
      expect(off.llm.ground, `backfill=${String(backfill)}`).not.toHaveBeenCalled();
    }
    const on = fixtureRepo({ backfill: true });
    await new Promise((resolve) => setTimeout(resolve, 5));
    await on.repo.getDeckByMarket('mkt_fx');
    await on.repo.waitForDashboardWarmup();
    expect(on.llm.ground).toHaveBeenCalled();
  });

  describe('deck-level resume (started, never completed)', () => {
    const started = (snap: RepoSnapshot): RepoSnapshot => ({ ...structuredClone(snap), deckWarmup: { deck_fx: { startedAt: '2026-10-14T00:00:00.000Z' } } });
    const fresh = (): RepoSnapshot => ({ ...completenessFixture(), viceClaims: [], reports: [], briefings: [], savedCards: [],
      opportunity: {}, researchJobs: [], threads: [], dashboards: {}, dashboardWarmup: {} } as unknown as RepoSnapshot);

    it('an interrupted warm-up resumes on a new instance, does only the remaining work, then marks itself complete', async () => {
      vi.stubGlobal('fetch', async () => { throw new Error('offline'); });
      let gate = 0;
      const first = fixtureRepo({ saved: started(fresh()), allowed: () => ++gate <= 4, backfill: false });
      first.repo.warmDeckDashboards('deck_fx', 'creation');
      await first.repo.waitForDashboardWarmup();
      // "Reload": only four tabs were researched; the deck is still marked pending.
      expect(first.saved().deckWarmup?.deck_fx?.completedAt).toBeUndefined();
      const doneTabs = Object.values(first.saved().dashboards).reduce((n, tabs) => n + Object.keys(tabs ?? {}).length, 0);
      expect(doneTabs).toBeGreaterThan(0);

      const reloaded = fixtureRepo({ saved: first.saved(), resumeDelayMs: 0 });
      // The startup timer resumes it with NO backfill flag.
      await vi.waitFor(() => expect(reloaded.saved().deckWarmup?.deck_fx?.completedAt).toBeDefined(), { timeout: 5000 });
      await reloaded.repo.waitForDashboardWarmup();
      const researched = (reloaded.repo as unknown as { warmup: { researched: Array<{ companyId: string; tab: string }> } }).warmup.researched;
      const before = new Set(Object.entries(first.saved().dashboards).flatMap(([id, tabs]) => Object.keys(tabs ?? {}).map((tab) => id + ':' + tab)));
      // Nothing already cached was researched again.
      for (const row of researched) expect(before.has(row.companyId + ':' + row.tab), row.companyId + ':' + row.tab).toBe(false);
      expect(researched.length).toBeGreaterThan(0);
      for (const id of ['acme', 'beta', 'gamma']) expect(reloaded.saved().dashboards[id]?.history, id).toBeDefined();
    });

    it('stamps when the warm-up of a measured deck finished, once', async () => {
      vi.stubGlobal('fetch', async () => { throw new Error('offline'); });
      const measured = { ...started(fresh()), deckRun: { deck_fx: { submittedAt: '2026-10-14T20:00:00.000Z', deckReadyAt: '2026-10-14T20:03:00.000Z' } } } as RepoSnapshot;
      const first = fixtureRepo({ saved: measured, backfill: false });
      first.repo.warmDeckDashboards('deck_fx', 'creation');
      await first.repo.waitForDashboardWarmup();
      await vi.waitFor(() => expect(first.saved().deckRun?.deck_fx?.warmupDoneAt).toBeDefined());
      expect(first.saved().deckRun?.deck_fx?.submittedAt).toBe('2026-10-14T20:00:00.000Z');
    });

    it('a deck measured before an app restart is marked partial when its resumed warm-up finishes', async () => {
      vi.stubGlobal('fetch', async () => { throw new Error('offline'); });
      const usage = { calls: 30, inputTokens: 3000, outputTokens: 300, searchQueries: 5, estCostUsd: 0.4 };
      const measured = { ...started(fresh()), deckRun: { deck_fx: { submittedAt: '2026-10-14T20:00:00.000Z', deckReadyAt: '2026-10-14T20:03:00.000Z', usage } } } as RepoSnapshot;
      const first = fixtureRepo({ saved: measured, backfill: false });
      first.repo.warmDeckDashboards('deck_fx', 'creation');
      await first.repo.waitForDashboardWarmup();
      await vi.waitFor(() => expect(first.saved().deckRun?.deck_fx?.warmupDoneAt).toBeDefined());
      expect(first.saved().deckRun?.deck_fx).toMatchObject({ usage, usagePartial: true });
    });

    it('a completed deck does not warm again, even after dashboards are invalidated', async () => {
      vi.stubGlobal('fetch', async () => { throw new Error('offline'); });
      const first = fixtureRepo({ saved: started(fresh()), backfill: false });
      first.repo.warmDeckDashboards('deck_fx', 'creation');
      await first.repo.waitForDashboardWarmup();
      await vi.waitFor(() => expect(first.saved().deckWarmup?.deck_fx?.completedAt).toBeDefined());
      // A full invalidation empties the cache; a completed deck must not re-warm by itself.
      const wiped = { ...first.saved(), dashboards: {} } as RepoSnapshot;
      const again = fixtureRepo({ saved: wiped });
      expect(again.repo.resumeInterruptedWarmups()).toBe(0);
      await again.repo.getDeckByMarket('mkt_fx');
      await again.repo.waitForDashboardWarmup();
      expect(again.llm.ground).not.toHaveBeenCalled();
    });

    it('an old deck that never had a warm-up stays governed by the opt-in flag', async () => {
      vi.stubGlobal('fetch', async () => { throw new Error('offline'); });
      const old = fixtureRepo({ saved: fresh(), resumeDelayMs: 0 });
      expect(old.repo.resumeInterruptedWarmups()).toBe(0);
      await old.repo.getDeckByMarket('mkt_fx');
      await old.repo.waitForDashboardWarmup();
      expect(old.llm.ground).not.toHaveBeenCalled();
      expect(old.saved().deckWarmup).toBeUndefined();
    });

    it('failures do not loop: a pass that cannot fill tabs still completes and never retries in-session', async () => {
      vi.stubGlobal('fetch', async () => { throw new Error('offline'); });
      const failing = client();
      (failing as { structure: unknown }).structure = async () => { throw new Error('provider down'); };
      const first = fixtureRepo({ saved: started(fresh()), llm: failing });
      first.repo.warmDeckDashboards('deck_fx', 'creation');
      await first.repo.waitForDashboardWarmup();
      await vi.waitFor(() => expect(first.saved().deckWarmup?.deck_fx?.completedAt).toBeDefined());
      const calls = (failing.ground as ReturnType<typeof vi.fn>).mock.calls.length;
      expect(first.repo.resumeInterruptedWarmups()).toBe(0);
      await first.repo.waitForDashboardWarmup();
      expect((failing.ground as ReturnType<typeof vi.fn>).mock.calls.length).toBe(calls);
    });
  });
});
