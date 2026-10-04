import { describe, expect, it, vi } from 'vitest';
import type { ZodType } from 'zod';
import type { Deck, DeckRefreshEvent } from '@mi/contracts';
import type { CompanyCandidate, LlmClient } from './types';
import {
  discoverDeckStubs,
  discoverWithCoverage,
  hydrateDeckCards,
  runDeckResearch,
  selectCandidates,
} from './pipeline';
import { GeminiRepository, type ResearchStore, type RepoSnapshot } from './repository';
import { discoveryMinimumOutSchema } from './schemas';

/**
 * A fake LLM that returns canned grounded text + citations and canned structured
 * objects (validated through the real Zod schema the pipeline passes in). Lets us
 * verify the entire orchestration — discovery, enrichment, citation threading,
 * CMS scoring, vice-claim sourcing, barrier cards — with zero network.
 */
function fakeClient(): LlmClient {
  const citations = [
    { title: 'techcrunch.com', url: 'https://tc.example/a' },
    { title: 'sec.gov', url: 'https://sec.example/b' },
  ];
  return {
    ground: vi.fn(async () => ({ text: 'grounded notes', citations, queries: ['q'] })),
    structure: (async (prompt: string, schema: ZodType<unknown>) => {
      let obj: unknown;
      if (prompt.includes('market definition')) {
        obj = {
          marketName: 'Test Market',
          vertical: 'Testing',
          geography: 'CA',
          notes: null,
          searchThemes: ['a', 'b'],
        };
      } else if (prompt.includes('"companies"')) {
        obj = {
          companies: [
            {
              name: 'Alpha Inc',
              domain: 'alpha.com',
              descriptor: 'big co',
              cardTypes: ['company'],
            },
            {
              name: 'Beta LLC',
              domain: 'beta.com',
              descriptor: 'risky co',
              cardTypes: ['company', 'vice'],
            },
            // The audit's defect, reproduced in shape: discovery hands back a
            // TOPIC dressed as a company, tagged only as a signal.
            {
              name: 'Alpha Inc / Safety / Governance Controversy Entity',
              domain: null,
              descriptor: 'governance concerns',
              cardTypes: ['vice'],
            },
            // A REAL business whose newsworthy angle is a controversy. Live data
            // produced exactly this (Civitai): signal-only tag, real domain.
            {
              name: 'Gamma Media',
              domain: 'gamma.com',
              descriptor: 'contested platform',
              cardTypes: ['vice'],
            },
            {
              name: 'Delta Labs',
              domain: 'delta.com',
              descriptor: 'research lab',
              cardTypes: ['company'],
            },
            {
              name: 'Lambda AI',
              domain: 'lambda.com',
              descriptor: 'model lab',
              cardTypes: ['company'],
            },
            {
              name: 'Mu Research',
              domain: 'mu.com',
              descriptor: 'research lab',
              cardTypes: ['company'],
            },
            {
              name: 'Nu Models',
              domain: 'nu.com',
              descriptor: 'model company',
              cardTypes: ['company'],
            },
            {
              name: 'Xi Intelligence',
              domain: 'xi.com',
              descriptor: 'intelligence company',
              cardTypes: ['company'],
            },
            {
              name: 'Omicron Labs',
              domain: 'omicron.com',
              descriptor: 'model lab',
              cardTypes: ['company'],
            },
            {
              name: 'Pi Systems',
              domain: 'pi.com',
              descriptor: 'software company',
              cardTypes: ['company'],
            },
            { name: 'Rho AI', domain: 'rho.com', descriptor: 'AI company', cardTypes: ['company'] },
            {
              name: 'Epsilon Systems',
              domain: 'epsilon.com',
              descriptor: 'infrastructure',
              cardTypes: ['infrastructure'],
            },
            {
              name: 'Zeta Cloud',
              domain: 'zeta.com',
              descriptor: 'infrastructure',
              cardTypes: ['infrastructure'],
            },
            {
              name: 'Eta Compute',
              domain: 'eta.com',
              descriptor: 'infrastructure',
              cardTypes: ['infrastructure'],
            },
            {
              name: 'Theta Hardware',
              domain: 'theta.com',
              descriptor: 'infrastructure',
              cardTypes: ['infrastructure'],
            },
            {
              name: 'Iota Market',
              domain: 'iota.com',
              descriptor: 'distribution',
              cardTypes: ['distribution'],
            },
            {
              name: 'Kappa Channel',
              domain: 'kappa.com',
              descriptor: 'distribution',
              cardTypes: ['distribution'],
            },
          ],
        };
      } else if (prompt.includes('Convert the research notes on "Alpha Inc"')) {
        obj = {
          oneLiner: 'Alpha does things',
          hqLocation: 'SF, CA',
          website: 'https://alpha.com',
          brand: { primary: '#111', secondary: '#222', accent: '#333' },
          metrics: {
            market_cap: {
              value: 120_000_000_000,
              confidence: 'verified',
              sourceIndex: 1,
              method: null,
            },
            arr: { value: 6_000_000_000, confidence: 'verified', sourceIndex: 1, method: null },
            employees: { value: 60_000, confidence: 'verified', sourceIndex: 0, method: null },
            users: {
              value: 40_000_000,
              confidence: 'estimated',
              sourceIndex: 0,
              method: 'app installs',
            },
            market_share: { value: 45, confidence: 'verified', sourceIndex: 0, method: null },
          },
          viceClaims: [],
          cultureNote: null,
        };
      } else if (prompt.includes('Convert the research notes on "Gamma Media"')) {
        obj = {
          oneLiner: 'Gamma hosts user models',
          hqLocation: 'Austin, TX',
          website: 'https://gamma.com',
          brand: null,
          metrics: {
            valuation: {
              value: 40_000_000,
              confidence: 'estimated',
              sourceIndex: 0,
              method: 'press reports',
            },
            employees: { value: 30, confidence: 'verified', sourceIndex: 0, method: null },
          },
          viceClaims: [{ text: 'Named in a 2026 copyright suit', sourceIndex: 0 }],
          cultureNote: null,
        };
      } else if (prompt.includes('Convert the research notes on "Beta LLC"')) {
        obj = {
          oneLiner: 'Beta does risky things',
          hqLocation: 'LA, CA',
          website: 'https://beta.com',
          brand: null,
          metrics: {
            valuation: {
              value: 8_000_000,
              confidence: 'estimated',
              sourceIndex: 0,
              method: 'seed round',
            },
            arr: { value: 400_000, confidence: 'estimated', sourceIndex: 0, method: 'proxy' },
            employees: { value: 12, confidence: 'verified', sourceIndex: 0, method: null },
            users: { value: 1_000, confidence: 'estimated', sourceIndex: 0, method: 'followers' },
          },
          viceClaims: [
            { text: 'Sued in 2025', sourceIndex: 0 },
            { text: 'Unsourced rumor', sourceIndex: null }, // must be dropped
          ],
          cultureNote: null,
        };
      } else if (prompt.includes('"barriers"')) {
        obj = {
          barriers: [
            { title: 'Capital intensity', summary: 'Expensive to enter.', sourceIndex: 0 },
          ],
          insights: [
            {
              title: 'Margins are shifting',
              summary: 'Compute costs falling fast.',
              sourceIndex: 1,
            },
          ],
        };
      } else if (prompt.includes('"markdown"')) {
        obj = { markdown: '# Overview\n\n## What they do\nStuff.\n\n## Why it matters\nReasons.' };
      } else if (prompt.includes('"verdict"')) {
        obj = { verdict: 'supported', rationale: 'Multiple filings state this figure.' };
      } else if (prompt.includes('nudge')) {
        obj = { nudge: 0, reason: null };
      } else {
        obj = {};
      }
      return schema.parse(obj);
    }) as LlmClient['structure'],
  };
}

const testCoverage = {
  companies: { min: 3, target: 3, max: 3 },
  infrastructure: { min: 0, target: 0, max: 0 },
  distribution: { min: 0, target: 0, max: 0 },
  vice: { min: 0, target: 0, max: 3 },
  culture: { min: 0, target: 0, max: 3 },
  barrier: { min: 1, target: 1, max: 1 },
  insight: { min: 1, target: 1, max: 1 },
};

describe('runDeckResearch (full orchestration, fake LLM)', () => {
  it('keeps unsupported initial figures unknown through stored deck, card and reader queries', async () => {
    let snapshot: RepoSnapshot | null = null;
    const save = vi.fn(async () => {});
    const repo = new GeminiRepository({
      apiKey: 'test-key', client: fakeClient(), coverage: testCoverage, catalogMax: 3, catalogPasses: 0,
      store: { read: () => snapshot, write: (next) => { snapshot = next; } },
      originalSources: {
        retrieve: async (url) => ({ requestedUrl: url, status: 'unavailable', retrievedAt: new Date().toISOString() }),
        save, list: async () => [],
      },
    });
    const { market, deck } = await repo.createResearchedDeck({ prompt: 'Software', region: null });
    await repo.waitForBackgroundJobs();
    const entries = (await repo.listCards(deck.id)).filter((entry) => entry.company);
    expect(entries.length).toBeGreaterThanOrEqual(3);
    expect(save.mock.calls.length).toBeGreaterThanOrEqual(3);
    expect((await repo.getDeckByMarket(market.id) as Deck & { status?: string }).status).toBe('ready');
    for (const entry of entries) {
      expect(entry.metrics.length).toBeGreaterThan(0);
      expect(entry.metrics.every((metric) => metric.value === null && metric.confidence === 'unknown')).toBe(true);
      expect((await repo.getCard(entry.card.id))!.metrics).toEqual(entry.metrics);
      expect(await repo.getCompanyMetrics(entry.company!.id)).toEqual(entry.metrics);
      expect(entry.card.tier).toBeNull();
    }
  }, 20000);

  it(
    'produces company, vice, and barrier cards with grounded sources',
    async () => {
      const events: string[] = [];
      const result = await runDeckResearch(
        { prompt: 'test market', region: 'CA' },
        fakeClient(),
        {
          apiKey: '',
          coverage: testCoverage,
          catalogMax: 3,
          catalogPasses: 0,
          onEvent: (e) => events.push(e.type),
        },
      );

      expect(result.market.name).toBe('Test Market');
      // Alpha, Beta, and Gamma Media (promoted from a signal-only tag because it
      // has a real domain). The pseudo-entity with no domain is not among them.
      const companyCards = result.cards.filter((c) => c.card.cardType === 'company');
      expect(companyCards).toHaveLength(3);

      // Alpha should score as a top-tier titan; Beta near the bottom.
      const alpha = companyCards.find((c) => c.company?.name === 'Alpha Inc')!;
      const beta = companyCards.find((c) => c.company?.name === 'Beta LLC')!;
      expect(alpha.card.tier).toBeGreaterThanOrEqual(6);
      expect(beta.card.tier).toBeLessThanOrEqual(3);

      // Metrics carry citation URLs from grounding.
      const cap = alpha.metrics.find((m) => m.metricType === 'market_cap');
      expect(cap?.source).toBe('https://sec.example/b');

      // Logos resolved from the domain.
      expect(alpha.company?.logoUrl).toContain('faviconV2');

      // Vice card: sourced claim kept, unsourced claim dropped.
      const vice = result.cards.find((c) => c.card.cardType === 'vice')!;
      expect(vice.viceClaims).toHaveLength(1);
      expect(vice.viceClaims[0]!.sourceUrl).toBe('https://tc.example/a');

      // Barrier card is company-agnostic.
      const barrier = result.cards.find((c) => c.card.cardType === 'barrier')!;
      expect(barrier.company).toBeNull();
      expect(barrier.card.title).toBe('Capital intensity');

      // Insight card rides along on the same market-level pass, with its source.
      const insight = result.cards.find((c) => c.card.cardType === 'insight')!;
      expect(insight.company).toBeNull();
      expect(insight.card.citations[0]?.url).toBe('https://sec.example/b');
      expect(barrier.card.citations[0]?.url).toBe('https://tc.example/a');

      expect(events).toContain('market');
      expect(events).toContain('done');
    },
    20000,
  );

  it(
    'refuses to mint a company from a topic, and warns instead of failing silently',
    async () => {
      const warnings: string[] = [];
      const result = await runDeckResearch(
        { prompt: 'test market', region: 'CA' },
        fakeClient(),
        {
          apiKey: '',
          coverage: testCoverage,
          catalogMax: 3,
          catalogPasses: 0,
          onEvent: (e) => {
            if (e.type === 'warning') warnings.push(e.message);
          },
        },
      );

      // Audit Finding 1.2: this pseudo-entity used to become a card AND inherit a
      // real company's valuation/ARR/users as unsourced "verified" figures.
      const names = result.cards.map((c) => c.company?.name ?? c.card.title ?? '');
      expect(names.some((n) => /Controversy Entity/.test(n))).toBe(false);
      expect(warnings.join(' ')).toMatch(/topic rather than a company/i);
      expect(warnings.join(' ')).toMatch(/Controversy Entity/);
    },
    20000,
  );

  it(
    'keeps a real business that discovery tagged only as a controversy',
    async () => {
      // "Controversial" and "not a company" are different things. A resolvable
      // domain is evidence of an operating entity, so a signal-only tag on one is
      // a mis-tag to correct, not a topic to discard. The first version of the
      // entity rule conflated them and threw away a real company.
      const result = await runDeckResearch(
        { prompt: 'test market', region: 'CA' },
        fakeClient(),
        {
          apiKey: '',
          coverage: testCoverage,
          catalogMax: 3,
          catalogPasses: 0,
        },
      );
      const gammaCards = result.cards.filter((c) => c.company?.name === 'Gamma Media');
      expect(gammaCards.map((c) => c.card.cardType).sort()).toEqual(['company', 'vice']);
      // Promotion must not smuggle figures onto the signal facet.
      expect(gammaCards.find((c) => c.card.cardType === 'vice')!.metrics).toEqual([]);
      // The company card is scored even though discovery never said "company".
      expect(gammaCards.find((c) => c.card.cardType === 'company')!.card.tier).not.toBeNull();
    },
    20000,
  );

  it('mints one entity card per company, never one per role', async () => {
    // Discovery legitimately reports several roles for one business. Emitting a
    // card each printed the same four figures under three headings and padded a
    // 17-card deck to 47 on live data.
    const result = await runDeckResearch({ prompt: 'test market', region: 'CA' }, fakeClient(), {
      apiKey: '',
      coverage: testCoverage,
      catalogMax: 3,
      catalogPasses: 0,
    });
    for (const name of ['Alpha Inc', 'Beta LLC', 'Gamma Media']) {
      const entityCards = result.cards.filter(
        (c) => c.company?.name === name && c.metrics.length > 0,
      );
      expect(entityCards).toHaveLength(1);
    }
  });

  it('does not mint a signal card that has no signal', async () => {
    // Alpha has neither a sourced controversy nor a culture note, so it must not
    // get an empty Vice or Culture card. On a live run every one of the ten
    // companies was tagged culture or vice and every such card came back blank.
    const result = await runDeckResearch({ prompt: 'test market', region: 'CA' }, fakeClient(), {
      apiKey: '',
      coverage: testCoverage,
      catalogMax: 3,
      catalogPasses: 0,
    });
    const alpha = result.cards.filter((c) => c.company?.name === 'Alpha Inc');
    expect(alpha.map((c) => c.card.cardType)).toEqual(['company']);
    // And no signal card anywhere in the deck is empty.
    for (const c of result.cards) {
      if (c.card.cardType === 'vice') expect(c.viceClaims.length).toBeGreaterThan(0);
      if (c.card.cardType === 'culture') expect((c.card.summary ?? '').length).toBeGreaterThan(0);
    }
  });

  it('never lends a company figure to a signal card', async () => {
    const result = await runDeckResearch({ prompt: 'test market', region: 'CA' }, fakeClient(), {
      apiKey: '',
      coverage: testCoverage,
      catalogMax: 3,
      catalogPasses: 0,
    });

    // Beta LLC is legitimately both a company and a vice facet. The company
    // card owns the numbers; the vice card owns the sourced claim. If both
    // carried metrics, one figure would appear twice under two provenance
    // stories — which is how a wrong number becomes credible.
    const betaCompany = result.cards.find(
      (c) => c.card.cardType === 'company' && c.company?.name === 'Beta LLC',
    )!;
    const betaVice = result.cards.find((c) => c.card.cardType === 'vice')!;
    expect(betaCompany.metrics.length).toBeGreaterThan(0);
    expect(betaVice.metrics).toEqual([]);
    expect(betaVice.viceClaims.length).toBeGreaterThan(0);
  });

  it('populates card.summary for minted entity and facet cards from candidate descriptor or oneLiner', async () => {
    const result = await runDeckResearch({ prompt: 'test market', region: 'CA' }, fakeClient(), {
      apiKey: '',
      coverage: testCoverage,
      catalogMax: 3,
      catalogPasses: 0,
    });

    for (const cwc of result.cards) {
      // Barrier and insight cards have their own summary from researchMarketSignals
      // Entity and signal cards should have summary populated rather than null
      if (cwc.card.cardType !== 'barrier' && cwc.card.cardType !== 'insight') {
        expect(cwc.card.summary).not.toBeNull();
        expect((cwc.card.summary ?? '').length).toBeGreaterThan(0);
      }
    }
  });
});

describe('GeminiRepository (fake client + in-memory store)', () => {
  function memStore(): ResearchStore {
    let s: RepoSnapshot | null = null;
    return { read: () => s, write: (snap) => (s = snap) };
  }

  it('persists a researched deck and serves its cards + lazy dashboard tabs', async () => {
    const holder: { value: RepoSnapshot | null } = { value: null };
    const store: ResearchStore = {
      read: () => holder.value,
      write: (snapshot) => (holder.value = snapshot),
    };
    const repo = new GeminiRepository({
      apiKey: 'x',
      client: fakeClient(),
      coverage: testCoverage,
      catalogMax: 3,
      catalogPasses: 0,
      store,
    });

    const { market, deck } = await repo.createResearchedDeck({ prompt: 'test', region: 'CA' });
    expect((await repo.listMarkets())[0]!.id).toBe(market.id);

    const cards = await repo.listCards(deck.id);
    expect(cards.length).toBeGreaterThan(0);

    const company = cards.find((c) => c.company)!.company!;
    const overview = await repo.getDashboardTab(company.id, 'overview');
    // metrics tab is built locally from stored figures (no fabricated series).
    const metrics = await repo.getDashboardTab(company.id, 'metrics');
    expect(overview?.tab).toBe('overview');
    expect(metrics?.tab).toBe('metrics');

    // Wait for continual background hydration to finish
    await repo.waitForBackgroundJobs();

    // A fresh repo backed by the same store rehydrates the deck (persistence).
    const repo2 = new GeminiRepository({
      apiKey: 'x',
      client: fakeClient(),
      coverage: testCoverage,
      catalogMax: 3,
      catalogPasses: 0,
      store,
    });
    expect((await repo2.listMarkets()).length).toBe(1);
    expect(holder.value?.researchJobs.at(-1)?.status).toBe('completed');
    expect(holder.value?.researchJobs.at(-1)?.catalogNames.length).toBeGreaterThan(0);
    expect(holder.value?.researchJobs.at(-1)?.completedEntityNames.length).toBeGreaterThan(0);
    expect(holder.value?.researchJobs.at(-1)?.partialCards.length).toBeGreaterThan(0);
    const jobId = holder.value!.researchJobs.at(-1)!.id;
    holder.value!.researchJobs.at(-1)!.status = 'cancelled';
    const resumed = await repo.resumeResearchJob(jobId);
    expect(resumed?.status).toBe('completed');
    expect(resumed?.partialCards.length).toBeGreaterThan(0);
  });

  it('marks a persisted running job interrupted so it can be resumed', async () => {
    const holder: { value: RepoSnapshot | null } = {
      value: {
        markets: [],
        decks: [],
        companies: [],
        metrics: [],
        cards: [],
        viceClaims: [],
        dashboards: {},
        companyMarket: {},
        reports: [],
        briefings: [],
        savedCards: [],
        opportunity: {},
        researchJobs: [
          {
            id: 'job_interrupted',
            status: 'running',
            stage: 'summary',
            brief: { prompt: 'test', region: 'CA' },
            catalogNames: ['Alpha Inc'],
            completedEntityNames: [],
            partialCards: [],
            warnings: [],
            error: null,
            createdAt: '2026-08-12T00:00:00.000Z',
            updatedAt: '2026-08-12T00:00:00.000Z',
          },
        ],
        threads: [],
      },
    };
    const store: ResearchStore = {
      read: () => holder.value,
      write: (snapshot) => (holder.value = snapshot),
    };
    const repo = new GeminiRepository({
      apiKey: 'x',
      client: fakeClient(),
      coverage: testCoverage,
      catalogMax: 3,
      catalogPasses: 0,
      store,
    });
    const job = await repo.getResearchJob('job_interrupted');
    expect(job?.status).toBe('failed');
    expect(job?.error).toBe('Interrupted by restart.');
  });

  it('resumes catalog placeholders as unfinished research without duplicating or losing saved cards', async () => {
    const brief = { prompt: 'test market', region: 'CA' };
    const stubs = await discoverDeckStubs(brief, fakeClient(), {
      apiKey: '', coverage: testCoverage, catalogMax: 3, catalogPasses: 0,
    });
    const first = stubs.cards.find((entry) => entry.company?.name === 'Alpha Inc')!;
    const snapshot: RepoSnapshot = {
      markets: [stubs.market], decks: [stubs.deck],
      companies: stubs.cards.flatMap((entry) => entry.company ? [entry.company] : []),
      metrics: stubs.cards.flatMap((entry) => entry.metrics),
      cards: stubs.cards.map((entry) => entry.card),
      viceClaims: [], dashboards: {}, companyMarket: {}, reports: [], briefings: [],
      savedCards: [{ cardId: first.card.id, savedAt: '2026-08-12T00:00:00.000Z' }],
      opportunity: {}, threads: [],
      researchJobs: [{
        id: 'job_catalog_interrupted', status: 'failed', stage: 'summary', brief,
        catalogNames: stubs.candidates.map((candidate) => candidate.name),
        completedEntityNames: [], partialCards: stubs.cards, warnings: [],
        error: 'Interrupted by restart.', createdAt: '2026-08-12T00:00:00.000Z',
        updatedAt: '2026-08-12T00:00:00.000Z', marketPlan: stubs.plan,
        catalog: stubs.candidates, market: stubs.market, deck: stubs.deck,
      }],
    };
    const store: ResearchStore = { read: () => snapshot, write: (value) => Object.assign(snapshot, value) };
    const repo = new GeminiRepository({ apiKey: 'x', client: fakeClient(), coverage: testCoverage,
      catalogMax: 3, catalogPasses: 0, store });
    const resumed = await repo.resumeResearchJob('job_catalog_interrupted');
    const cards = await repo.listCards(stubs.deck.id);
    const alpha = cards.filter((entry) => entry.company?.name === 'Alpha Inc' && entry.card.cardType === 'company');
    expect(resumed?.status).toBe('completed');
    expect(alpha.some((entry) => entry.metrics.length > 0 && entry.card.tier != null)).toBe(true);
    expect(alpha).toHaveLength(1);
    expect(alpha[0]!.card.id).toBe(first.card.id);
    expect(alpha[0]!.metrics.length).toBeGreaterThan(0);
    expect(alpha[0]!.card.tier).not.toBeNull();
    expect((await repo.listSavedCards()).map((entry) => entry.card.id)).toContain(first.card.id);
  });

  it('fact-checks a claim with a grounded verdict + citations', async () => {
    const repo = new GeminiRepository({
      apiKey: 'x',
      client: fakeClient(),
      coverage: testCoverage,
      catalogMax: 3,
      catalogPasses: 0,
      store: memStore(),
    });
    const result = await repo.factCheck({
      claim: 'Alpha Inc market cap is $120B',
      companyName: 'Alpha Inc',
    });
    expect(result.verdict).toBe('supported');
    expect(result.rationale).toContain('filings');
    expect(result.citations.length).toBeGreaterThan(0);
  });

  it('generates a deck report from stored evidence and persists it in the library', async () => {
    const store = memStore();
    const repo = new GeminiRepository({
      apiKey: 'x',
      client: fakeClient(),
      coverage: testCoverage,
      catalogMax: 3,
      catalogPasses: 0,
      store,
    });
    const { deck } = await repo.createResearchedDeck({ prompt: 'test', region: 'CA' });
    // Deck reports gate on a settled deck now: wait out the background
    // enrichment job before composing (the gate under test in site-audit.test).
    await vi.waitFor(async () => {
      const jobs = (await repo.listResearchJobs?.()) ?? [];
      expect(jobs.every((j) => j.status !== 'running' && j.status !== 'queued')).toBe(true);
    });
    const report = await repo.generateReport({ kind: 'deck', subjectId: deck.id });
    expect(report.title).toContain('Market Report');
    expect(report.citations.length).toBeGreaterThan(0);
    expect(report.evidenceDigest).toContain('MARKET:');
    expect(report.evidenceCitations?.length).toBeGreaterThan(0);
    expect((await repo.listReports()).length).toBeGreaterThanOrEqual(1);
    expect((await repo.getReport(report.id))?.id).toBe(report.id);
    // Survives a restart (persisted through the store).
    const repo2 = new GeminiRepository({
      apiKey: 'x',
      client: fakeClient(),
      coverage: testCoverage,
      catalogMax: 3,
      catalogPasses: 0,
      store,
    });
    expect((await repo2.listReports()).length).toBeGreaterThanOrEqual(1);
  });
});

describe('discovery coverage contract', () => {
  it('uses bounded fallback passes to fill underfilled entity roles', async () => {
    const client: LlmClient = {
      ground: vi.fn(async () => ({ text: 'grounded', citations: [], queries: [] })),
      structure: (async (prompt: string, schema: ZodType<unknown>) => {
        const focused = prompt.match(/This pass is focused on ([a-z]+)/)?.[1];
        const role = focused ?? 'company';
        const count =
          role === 'company' ? 10 : role === 'infrastructure' ? 4 : role === 'distribution' ? 2 : 0;
        const cardTypes = role === 'company' ? ['company'] : [role];
        return schema.parse({
          companies: Array.from({ length: count }, (_, i) => ({
            name: `${role} fallback ${i}`,
            domain: `${role}-fallback-${i}.example`,
            descriptor: role,
            cardTypes,
          })),
        });
      }) as LlmClient['structure'],
    };
    const result = await discoverWithCoverage(
      client,
      { marketName: 'Test', vertical: 'Testing', geography: null, notes: null, searchThemes: [] },
      {
        companies: { min: 10, target: 10, max: 20 },
        infrastructure: { min: 4, target: 4, max: 10 },
        distribution: { min: 2, target: 2, max: 10 },
        vice: { min: 0, target: 0, max: 10 },
        culture: { min: 0, target: 0, max: 10 },
        barrier: { min: 4, target: 4, max: 10 },
        insight: { min: 4, target: 4, max: 10 },
      },
    );
    expect(result.minimumCompaniesSatisfied).toBe(true);
    expect(
      result.candidates.filter((c) => c.cardTypes.includes('company')).length,
    ).toBeGreaterThanOrEqual(10);
    expect(result.candidates.filter((c) => c.cardTypes.includes('infrastructure')).length).toBe(4);
    expect(result.candidates.filter((c) => c.cardTypes.includes('distribution')).length).toBe(2);
    expect(client.ground).toHaveBeenCalledTimes(3);
  });

  it('selects the requested entity and signal coverage without duplicates', () => {
    const candidates = [
      ...Array.from({ length: 12 }, (_, i) => ({
        name: `Company ${i}`,
        domain: `company-${i}.example`,
        descriptor: '',
        cardTypes: ['company'],
      })),
      ...Array.from({ length: 6 }, (_, i) => ({
        name: `Infra ${i}`,
        domain: `infra-${i}.example`,
        descriptor: '',
        cardTypes: ['infrastructure'],
      })),
      ...Array.from({ length: 4 }, (_, i) => ({
        name: `Distribution ${i}`,
        domain: `distribution-${i}.example`,
        descriptor: '',
        cardTypes: ['distribution'],
      })),
      ...Array.from({ length: 4 }, (_, i) => ({
        name: `Vice ${i}`,
        domain: `vice-${i}.example`,
        descriptor: '',
        cardTypes: ['company', 'vice'],
      })),
      ...Array.from({ length: 4 }, (_, i) => ({
        name: `Culture ${i}`,
        domain: `culture-${i}.example`,
        descriptor: '',
        cardTypes: ['company', 'culture'],
      })),
    ] as CompanyCandidate[];
    const selected = selectCandidates(candidates, {
      companies: { min: 10, target: 12, max: 20 },
      infrastructure: { min: 4, target: 6, max: 10 },
      distribution: { min: 2, target: 4, max: 10 },
      vice: { min: 4, target: 4, max: 10 },
      culture: { min: 4, target: 4, max: 10 },
      barrier: { min: 4, target: 6, max: 10 },
      insight: { min: 4, target: 6, max: 10 },
    });
    expect(selected.filter((c) => c.cardTypes.includes('company')).length).toBeGreaterThanOrEqual(
      10,
    );
    expect(
      selected.filter((c) => c.cardTypes.includes('infrastructure')).length,
    ).toBeGreaterThanOrEqual(4);
    expect(
      selected.filter((c) => c.cardTypes.includes('distribution')).length,
    ).toBeGreaterThanOrEqual(2);
    expect(selected.filter((c) => c.cardTypes.includes('vice')).length).toBe(4);
    expect(selected.filter((c) => c.cardTypes.includes('culture')).length).toBe(4);
    expect(new Set(selected.map((c) => c.name)).size).toBe(selected.length);
  });

  it('rejects fewer than ten unique primary discovery companies', () => {
    const result = discoveryMinimumOutSchema.safeParse({
      companies: Array.from({ length: 9 }, (_, i) => ({
        name: `Company ${i}`,
        domain: `company-${i}.example`,
        descriptor: 'operating company',
        cardTypes: ['company'],
      })),
    });
    expect(result.success).toBe(false);
  });

  it('accepts ten unique companies', () => {
    const result = discoveryMinimumOutSchema.safeParse({
      companies: Array.from({ length: 10 }, (_, i) => ({
        name: `Company ${i}`,
        domain: `company-${i}.example`,
        descriptor: 'operating company',
        cardTypes: ['company'],
      })),
    });
    expect(result.success).toBe(true);
  });
});

describe('Progressive Fast-Boot & Continual Background Research Architecture', () => {
  it('discoverDeckStubs generates unhydrated stub cards with names, logos, and domains', async () => {
    const events: string[] = [];
    const result = await discoverDeckStubs(
      { prompt: 'AI developer tools', region: 'CA' },
      fakeClient(),
      {
        apiKey: '',
        coverage: testCoverage,
        catalogMax: 3,
        catalogPasses: 0,
        onEvent: (e) => events.push(e.type === 'status' ? e.step : e.type),
      },
    );

    expect(result.market.name).toBe('Test Market');
    expect(result.deck.marketId).toBe(result.market.id);
    expect(result.candidates.length).toBeGreaterThanOrEqual(3);
    expect(result.cards.length).toBeGreaterThanOrEqual(3);

    for (const cwc of result.cards) {
      expect(cwc.company).not.toBeNull();
      expect(cwc.company!.name).toBeTruthy();
      expect(cwc.company!.logoUrl).toContain('faviconV2');
      expect(cwc.card.deckId).toBe(result.deck.id);
      // Clean-metrics policy: a fast-boot stub is explicitly unranked and
      // unhydrated. A tier here would be a guess, so it stays null until a
      // background subagent has actually scored the company.
      expect(cwc.card.tier).toBeNull();
      expect(cwc.card.tierReason).toBeNull();
      // A stub may only carry figures the grounding pass actually reported —
      // never a placeholder, default, or zero-fill.
      for (const metric of cwc.metrics) {
        expect(metric.value).not.toBeNull();
        expect(metric.source).toBeTruthy();
      }
      expect(cwc.viceClaims).toEqual([]);
    }

    expect(events).toContain('interpret');
    expect(events).toContain('market');
    expect(events).toContain('discover');
    expect(events).toContain('candidates');
  });

  it('hydrateDeckCards concurrently enriches entity cards and triggers onCardHydrated callbacks', async () => {
    const client = fakeClient();
    const stubsResult = await discoverDeckStubs(
      { prompt: 'AI developer tools', region: 'CA' },
      client,
      {
        apiKey: '',
        coverage: testCoverage,
        catalogMax: 3,
        catalogPasses: 0,
      },
    );

    const hydratedNames: string[] = [];
    const hydratedCards = await hydrateDeckCards(
      stubsResult.plan,
      stubsResult.deck,
      stubsResult.candidates,
      client,
      {
        concurrency: 3,
        coverage: testCoverage,
        onCardHydrated: (res) => {
          hydratedNames.push(res.company.name);
        },
      },
    );

    expect(hydratedNames.length).toBeGreaterThanOrEqual(3);
    const companyCards = hydratedCards.filter((c) => c.card.cardType === 'company');
    expect(companyCards.length).toBeGreaterThanOrEqual(3);

    // Cards should now be scored with tiers and populated metrics
    for (const cwc of companyCards) {
      expect(cwc.card.tier).not.toBeNull();
      expect(cwc.metrics.length).toBeGreaterThan(0);
    }

    // Macro signal cards (barriers and insights) are produced
    const barrierCards = hydratedCards.filter((c) => c.card.cardType === 'barrier');
    const insightCards = hydratedCards.filter((c) => c.card.cardType === 'insight');
    expect(barrierCards.length).toBeGreaterThan(0);
    expect(insightCards.length).toBeGreaterThan(0);
  });

  it('createResearchedDeck returns immediately with stubs and hydrates progressively with live events', async () => {
    const storeState: { value: RepoSnapshot | null } = { value: null };
    const store: ResearchStore = {
      read: () => storeState.value,
      write: (snap) => (storeState.value = snap),
    };

    const repo = new GeminiRepository({
      apiKey: 'test-key',
      client: fakeClient(),
      coverage: testCoverage,
      catalogMax: 3,
      catalogPasses: 0,
      store,
    });

    const refreshEvents: DeckRefreshEvent[] = [];
    repo.subscribeDeckRefresh((evt) => {
      refreshEvents.push(evt);
    });

    // 1. Fast-boot invocation: returns immediately
    const { market, deck } = await repo.createResearchedDeck({
      prompt: 'AI developer tools',
      region: 'CA',
    });

    expect(market.id).toBeTruthy();
    expect(deck.id).toBeTruthy();
    expect((await repo.getDeckByMarket(market.id) as Deck & { status?: string }).status).toBe('running');

    // 2. Initial state in store: stub cards are already stored and accessible
    const initialCards = await repo.listCards(deck.id);
    expect(initialCards.length).toBeGreaterThanOrEqual(3);

    // Stubs are unhydrated initially
    const stubCompanyCards = initialCards.filter((c) => c.card.cardType === 'company');
    expect(stubCompanyCards.length).toBeGreaterThanOrEqual(3);
    for (const stub of stubCompanyCards) {
      expect(stub.company?.name).toBeTruthy();
      expect(stub.company?.logoUrl).toContain('faviconV2');
      // Unhydrated means unranked — see the clean-metrics policy above.
      expect(stub.card.tier).toBeNull();
      for (const metric of stub.metrics) {
        expect(metric.value).not.toBeNull();
        expect(metric.source).toBeTruthy();
      }
    }

    // 3. Wait for continual background worker pool to finish
    await repo.waitForBackgroundJobs();
    expect((await repo.getDeckByMarket(market.id) as Deck & { status?: string }).status).toBe('ready');

    // 4. Verify live DeckRefreshEvent emissions were fired
    expect(refreshEvents.length).toBeGreaterThanOrEqual(1);
    const updatedCardIds = refreshEvents.flatMap((e) => e.updatedCardIds);
    const addedCardIds = refreshEvents.flatMap((e) => e.addedCardIds);
    expect(updatedCardIds.length + addedCardIds.length).toBeGreaterThan(0);

    // 5. Hydrated state in store: cards now have scores, metrics, and macro signals
    const finalCards = await repo.listCards(deck.id);
    const finalCompanyCards = finalCards.filter((c) => c.card.cardType === 'company');
    for (const card of finalCompanyCards) {
      expect(card.card.tier).not.toBeNull();
      expect(card.metrics.length).toBeGreaterThan(0);
    }

    // Macro signal cards exist
    const barriers = finalCards.filter((c) => c.card.cardType === 'barrier');
    const insights = finalCards.filter((c) => c.card.cardType === 'insight');
    expect(barriers.length).toBeGreaterThan(0);
    expect(insights.length).toBeGreaterThan(0);

    // A settled run with an unhydrated company is partial, never silently ready.
    const finishedJob = storeState.value!.researchJobs.at(-1)!;
    finishedJob.completedEntityNames = finishedJob.completedEntityNames.slice(1);
    expect((await repo.getDeckByMarket(market.id) as Deck & { status?: string }).status).toBe('partial');
  });
});
