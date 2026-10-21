/**
 * Deck-completeness invariants: a whole deck run through the real pipeline and
 * repository with a fake model, then checked from the saved snapshot, the way
 * a user (or the completeness scoreboard) would meet it afterwards.
 *
 * "Complete" here never means "every slot has a figure": figures come only
 * from sources (Rule 9). It means every roster company has a researched card,
 * every empty slot was ATTEMPTED (so it is a stated gap, not a skipped one),
 * every signal lane has cards or a recorded reason, every dashboard tab has
 * content or a recorded attempt, and no job is left running behind a deck that
 * says it is done. A run cut short and resumed must end up in the same place.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ZodType } from 'zod';
import { isEntityCardType } from '@mi/contracts';
import { buildCompletenessReport } from './completeness-report';
import { WARM_TABS } from './dashboard-warmup';
import { discoverDeckStubs } from './pipeline';
import { GeminiRepository, type RepoSnapshot, type ResearchStore } from './repository';
import type { LlmClient } from './types';

afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

const CITATIONS = [
  { title: 'techcrunch.com', url: 'https://tc.example/a' },
  { title: 'reuters.com', url: 'https://reuters.example/b' },
];

const ROSTER = [
  { name: 'Alpha Inc', domain: 'alpha.com', descriptor: 'big co', cardTypes: ['company'] },
  { name: 'Beta LLC', domain: 'beta.com', descriptor: 'small co', cardTypes: ['company'] },
  { name: 'Delta Labs', domain: 'delta.com', descriptor: 'research lab', cardTypes: ['company'] },
  { name: 'Epsilon Systems', domain: 'epsilon.com', descriptor: 'infrastructure', cardTypes: ['infrastructure'] },
  { name: 'Iota Market', domain: 'iota.com', descriptor: 'distribution', cardTypes: ['distribution'] },
];

const TAB_ANSWER = {
  markdown: '## What they do\nThings.\n\n## Why it matters\nReasons.',
  founderStory: 'Two engineers started the company.',
  timeline: [{ date: '2014', title: 'Company founded', detail: 'Founded by two engineers.' }],
  quotes: [],
  nodes: [{ id: 'p1', name: 'Pat Lee', role: 'CEO', group: 'exec', parentId: null, bio: 'Co-founder.' }],
  products: [{ name: 'Picker', description: 'A product.', revenueNote: 'not disclosed', url: null, status: 'live' }],
  roadmap: [], items: [], cadence: 'weekly', lastRefreshedAt: null,
};

const coverage = {
  companies: { min: 3, target: 3, max: 3 },
  infrastructure: { min: 0, target: 0, max: 0 },
  distribution: { min: 0, target: 0, max: 0 },
  vice: { min: 0, target: 0, max: 3 },
  culture: { min: 0, target: 0, max: 3 },
  barrier: { min: 1, target: 1, max: 1 },
  insight: { min: 1, target: 1, max: 1 },
};

/** A model that knows a five-company market, reports no figures and finds one barrier and one insight. */
function fakeClient(options: { failGroundFor?: string; outage?: { over: boolean } } = {}): LlmClient {
  const barrierText = 'Capital intensity is a barrier because expensive plants and equipment make market entry costly.';
  const insightText = 'Compute costs falling fast are shifting margins across providers this year.';
  return {
    ground: vi.fn(async (prompt: string) => {
      if (options.failGroundFor && !options.outage?.over && prompt.includes(options.failGroundFor)) throw new Error('fake provider outage');
      return { text: 'grounded notes', citations: CITATIONS, queries: ['q'], grounding: { provider: 'google-search' as const, answerText: 'notes',
        supports: [
          { supportIndex: 0, text: barrierText, sources: [{ chunkIndex: 0, url: CITATIONS[0]!.url, title: 'Market structure' }] },
          { supportIndex: 1, text: insightText, sources: [{ chunkIndex: 1, url: CITATIONS[1]!.url, title: 'Market margins' }] },
        ] } };
    }),
    structure: (async (prompt: string, schema: ZodType<unknown>) => {
      let obj: unknown;
      if (prompt.includes('market definition')) obj = { marketName: 'Test Market', vertical: 'Testing', geography: 'CA', notes: null, searchThemes: ['a', 'b'] };
      else if (prompt.includes('"companies"')) obj = { companies: ROSTER };
      else if (prompt.includes('Convert the research notes on')) {
        obj = { oneLiner: 'Does things', hqLocation: 'SF, CA', website: null, brand: null, metrics: {}, viceClaims: [], cultureNote: null };
      } else if (prompt.includes('"barriers"')) {
        obj = {
          barriers: [{ title: 'Capital intensity', summary: 'Expensive to enter, with costly plants and equipment.', sourceIndex: 0 }],
          insights: [{ title: 'Margins are shifting', summary: 'Compute costs falling fast.', sourceIndex: 1 }],
        };
      } else if (prompt.includes('nudge')) obj = { nudge: 0, reason: null };
      else obj = structuredClone(TAB_ANSWER);
      return schema.parse(obj);
    }) as LlmClient['structure'],
  };
}

function memStore(initial: RepoSnapshot | null = null): { store: ResearchStore; read: () => RepoSnapshot | null } {
  let snapshot: RepoSnapshot | null = initial;
  return { store: { read: () => (snapshot ? structuredClone(snapshot) : null), write: (next) => { snapshot = structuredClone(next); } }, read: () => snapshot };
}

const newRepo = (store: ResearchStore, client: LlmClient = fakeClient()) =>
  new GeminiRepository({ apiKey: 'fake-key', client, coverage, catalogMax: 5, catalogPasses: 0, store });

/** Everything the invariants say about a settled deck, as failure messages (empty = holds). */
function violations(snapshot: RepoSnapshot, deckId: string): string[] {
  const out: string[] = [];
  const job = snapshot.researchJobs.find((j) => j.deck?.id === deckId);
  if (!job) return ['no research job recorded for the deck'];
  if (job.status === 'running' || job.status === 'queued') out.push(`job left ${job.status}`);
  const cards = snapshot.cards.filter((c) => c.deckId === deckId);
  const entityCards = cards.filter((c) => isEntityCardType(c.cardType));
  const companyOf = (id: string | null) => snapshot.companies.find((c) => c.id === id);
  // 1. Every roster company has a card, researched rather than left as a placeholder stub. (A tier is not the test:
  // a company with no sourced figure is an honest blank, not an unfinished card.)
  for (const name of job.catalogNames) {
    if (!entityCards.some((c) => companyOf(c.companyId)?.name === name)) out.push(`roster company without a card: ${name}`);
    else if (!job.completedEntityNames.includes(name)) out.push(`roster card never researched (stub only): ${name}`);
  }
  // 2. Every empty slot was attempted: a gap is stated, never skipped.
  const report = buildCompletenessReport(snapshot, { deckIds: [deckId] });
  for (const company of report.decks[0]?.companies ?? []) {
    for (const slot of company.slots) {
      if (slot.status === 'unknown_never_attempted') out.push(`slot never attempted: ${company.name} / ${slot.key}`);
    }
  }
  // 3. Every dashboard tab has content or a recorded attempt.
  for (const card of entityCards) {
    for (const tab of WARM_TABS) {
      if (!snapshot.dashboards[card.companyId!]?.[tab] && !snapshot.dashboardWarmup?.[card.companyId!]?.[tab]) {
        out.push(`dashboard tab neither assembled nor attempted: ${companyOf(card.companyId)?.name} / ${tab}`);
      }
    }
  }
  // 4. Every signal lane has sourced cards or a recorded reason (a rest stamp from a search that ran, or a job warning).
  const rest = snapshot.signalRest?.[deckId] ?? {};
  for (const kind of ['barrier', 'insight', 'vice', 'culture'] as const) {
    if (cards.some((c) => c.cardType === kind)) continue;
    const reason = Boolean(rest[kind]) || job.warnings.some((w) => /barrier|insight|signal/i.test(w));
    if (!reason) out.push(`signal lane empty with no recorded reason: ${kind}`);
  }
  return out;
}

describe('deck completeness invariants (fake model)', () => {
  it('a full run leaves every roster company researched, every slot attempted, every lane and tab accounted for, and no job running', async () => {
    vi.stubGlobal('fetch', async () => { throw new Error('offline'); });
    const { store, read } = memStore();
    const repo = newRepo(store);
    const { deck } = await repo.createResearchedDeck({ prompt: 'test', region: 'CA' });
    await repo.waitForBackgroundJobs();
    await repo.waitForDashboardWarmup();
    // The creation path starts the signal ensure itself; the explicit call below only waits for it to finish.
    await vi.waitFor(() => expect(read()!.signalRest?.[deck.id]).toBeDefined());
    await repo.ensureSignalCards(deck.id);
    await repo.waitForDashboardWarmup();
    expect(violations(read()!, deck.id)).toEqual([]);
  }, 30000);

  it('a company that fails every research attempt is never silent: the job says so, the deck reads partial, and the rest of the roster is still complete', async () => {
    vi.stubGlobal('fetch', async () => { throw new Error('offline'); });
    vi.useFakeTimers({ toFake: ['setTimeout'] });
    try {
      const { store, read } = memStore();
      const outage = { over: false };
      const repo = newRepo(store, fakeClient({ failGroundFor: 'Delta Labs', outage }));
      const created = repo.createResearchedDeck({ prompt: 'test', region: 'CA' });
      const settled = async (): Promise<boolean> => {
        const job = read()?.researchJobs[0];
        return job?.status === 'completed' || job?.status === 'failed';
      };
      // The retry back-offs are real 45s waits; walk the clock through them.
      for (let i = 0; i < 400 && !(await settled()); i += 1) await vi.advanceTimersByTimeAsync(10_000);
      const { market, deck } = await created;
      const snapshot = read()!;
      const job = snapshot.researchJobs[0]!;
      expect(job.status).toBe('completed');
      expect(job.warnings.some((w) => w.includes('Could not enrich Delta Labs'))).toBe(true);
      expect(job.completedEntityNames).not.toContain('Delta Labs');
      for (const name of ['Alpha Inc', 'Beta LLC', 'Epsilon Systems', 'Iota Market']) expect(job.completedEntityNames).toContain(name);
      expect(((await repo.getDeckByMarket(market.id)) as { status?: string } | null)?.status).toBe('partial');
      // The unfinished company is offered for another pass (the job is what the Resume button runs), and once
      // the provider is back that pass researches it without redoing the rest of the roster.
      outage.over = true;
      await repo.resumeResearchJob(job.id);
      await repo.waitForBackgroundJobs();
      expect(read()!.researchJobs[0]!.completedEntityNames).toContain('Delta Labs');
      expect(((await repo.getDeckByMarket(market.id)) as { status?: string } | null)?.status).toBe('ready');
      expect(deck.id).toBe(read()!.decks[0]!.id);
    } finally {
      vi.useRealTimers();
    }
  }, 60000);

  it('a run interrupted by a restart and resumed ends in the same place as an uninterrupted one', async () => {
    vi.stubGlobal('fetch', async () => { throw new Error('offline'); });
    const brief = { prompt: 'test', region: 'CA' };
    const stubs = await discoverDeckStubs(brief, fakeClient(), { apiKey: '', coverage, catalogMax: 5, catalogPasses: 0 });
    const interrupted: RepoSnapshot = {
      markets: [stubs.market], decks: [stubs.deck],
      companies: stubs.cards.flatMap((entry) => entry.company ? [entry.company] : []),
      metrics: stubs.cards.flatMap((entry) => entry.metrics),
      cards: stubs.cards.map((entry) => entry.card),
      viceClaims: [], dashboards: {}, companyMarket: {}, reports: [], briefings: [], savedCards: [], opportunity: {}, threads: [],
      researchJobs: [{
        id: 'job_restart', status: 'running', stage: 'summary', brief,
        catalogNames: stubs.candidates.map((candidate) => candidate.name),
        completedEntityNames: [], partialCards: stubs.cards, warnings: [], error: null,
        createdAt: '2026-08-12T00:00:00.000Z', updatedAt: '2026-08-12T00:00:00.000Z',
        marketPlan: stubs.plan, catalog: stubs.candidates, market: stubs.market, deck: stubs.deck,
      }],
    };
    const { store, read } = memStore(interrupted);
    const repo = newRepo(store);
    // The restart marks the job failed, never leaves it "running" with nothing behind it.
    expect((await repo.getResearchJob('job_restart'))?.status).toBe('failed');
    const resumed = await repo.resumeResearchJob('job_restart');
    expect(resumed?.status).toBe('completed');
    await repo.waitForBackgroundJobs();
    await repo.waitForDashboardWarmup();
    // The resume path starts the signal ensure itself (it used to leave vice/culture lanes unsearched).
    await vi.waitFor(() => expect(read()!.signalRest?.[stubs.deck.id]).toBeDefined());
    await repo.ensureSignalCards(stubs.deck.id);
    await repo.waitForDashboardWarmup();
    expect(violations(read()!, stubs.deck.id)).toEqual([]);
  }, 30000);
});
