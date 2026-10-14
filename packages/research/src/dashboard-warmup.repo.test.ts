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

function client(): LlmClient & { ground: ReturnType<typeof vi.fn> } {
  return {
    ground: vi.fn(async () => ({ text: 'Acme Robotics was founded in 2014 in Oakland.', citations: CITATIONS, queries: ['q'] })),
    structure: (async (_prompt: string, schema: ZodType<unknown>) => schema.parse(structuredClone(TAB_ANSWER))) as LlmClient['structure'],
  };
}

function fixtureRepo(options: { wikidataJson?: (url: string) => Promise<unknown>; saved?: RepoSnapshot | null; llm?: LlmClient } = {}) {
  let saved: RepoSnapshot = options.saved ?? ({ ...completenessFixture(), viceClaims: [], reports: [], briefings: [], savedCards: [],
    opportunity: {}, researchJobs: [], threads: [] } as unknown as RepoSnapshot);
  const llm = options.llm ?? client();
  const repo = new GeminiRepository({ apiKey: 'test', client: llm, wikidataJson: options.wikidataJson,
    // Offline readers: no page or news lane may reach the network from a unit test.
    originalSourceReader: async (url) => ({ requestedUrl: url, status: 'unavailable', retrievedAt: new Date().toISOString(), reason: 'offline' }),
    store: { read: () => structuredClone(saved), write: async (next) => { saved = structuredClone(next); } } });
  return { repo, llm, saved: () => saved };
}

const slot = (company: CompanyCompletenessReport, key: string) => company.slots.find((row) => row.key === key)!;
const TAB_SLOTS = ['team', 'history', 'products', 'news'];

describe('dashboard warm-up in the repository', () => {
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
    // Asked once per company per session.
    await repo.fillFoundedYear('acme');
    expect(wikidataJson).toHaveBeenCalledTimes(2);
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
});
