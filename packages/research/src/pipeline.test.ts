import { describe, expect, it, vi } from 'vitest';
import type { ZodType } from 'zod';
import type { CardWithCompany, Deck, DeckRefreshEvent, ResearchProgress } from '@mi/contracts';
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

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

/**
 * A fake LLM that returns canned grounded text + citations and canned structured
 * objects (validated through the real Zod schema the pipeline passes in). Lets us
 * verify the entire orchestration — discovery, enrichment, citation threading,
 * CMS scoring, vice-claim sourcing, barrier cards — with zero network.
 */
function fakeClient(withProviderSupport = true): LlmClient {
  const citations = [
    { title: 'techcrunch.com', url: 'https://tc.example/a' },
    { title: 'sec.gov', url: 'https://sec.example/b' },
  ];
  const reported = [
    ['Alpha Inc', 'market_cap', 120_000_000_000, 'market cap', 'USD'],
    ['Alpha Inc', 'arr', 6_000_000_000, 'ARR', 'USD'],
    ['Alpha Inc', 'employees', 60_000, 'employees', 'count'],
    ['Alpha Inc', 'users', 40_000_000, 'users', 'count'],
    ['Beta LLC', 'valuation', 8_000_000, 'valuation', 'USD'],
    ['Beta LLC', 'employees', 12, 'employees', 'count'],
    ['Gamma Media', 'valuation', 40_000_000, 'valuation', 'USD'],
    ['Gamma Media', 'employees', 30, 'employees', 'count'],
  ] as const;
  const claims = reported.map(([name, type, value, label, unit]) => ({ name, type, value, unit,
    url: type === 'market_cap' || type === 'arr' ? citations[1]!.url : citations[0]!.url,
    text: `${name} reported ${label} of ${unit === 'USD' ? '$' : ''}${value} as of October 1, 2026.`,
  }));
  const answer = claims.map(row => row.text).join('\n');
  return {
    ground: vi.fn(async () => ({ text: withProviderSupport ? answer : 'grounded notes', citations, queries: ['q'],
      ...(withProviderSupport ? { grounding: { provider: 'google-search' as const, answerText: answer,
        supports: claims.map((row, supportIndex) => ({ supportIndex, text: row.text,
          sources: [{ chunkIndex: row.url === citations[0]!.url ? 0 : 1, url: row.url, title: 'Reported company results' }] })) } } : {}),
    })),
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
      const name = prompt.match(/Convert the research notes on "([^"]+)"/)?.[1];
      if (withProviderSupport && name && obj && typeof obj === 'object' && 'metrics' in obj) {
        const metrics = obj.metrics as Record<string, { value: number; reportedClaim?: unknown }>;
        for (const claim of claims.filter(row => row.name === name)) {
          const metric = metrics[claim.type];
          if (metric?.value === claim.value) metric.reportedClaim = { sourceUrl: claim.url, quote: claim.text,
            asOf: '2026-10-01', basis: claim.type, unit: claim.unit, definition: claim.type };
        }
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
  it('publishes unsupported figures as unknown without blocking on unavailable original readers', async () => {
    let snapshot: RepoSnapshot | null = null;
    const repo = new GeminiRepository({
      apiKey: 'test-key', client: fakeClient(false), coverage: testCoverage, catalogMax: 3, catalogPasses: 0,
      store: { read: () => snapshot ? structuredClone(snapshot) : null, write: async next => { snapshot = structuredClone(next); } },
      originalSourceReader: async url => ({ requestedUrl: url, status: 'unavailable', retrievedAt: new Date().toISOString(), reason: 'Browser CORS restriction' }),
    });
    const { deck } = await repo.createResearchedDeck({ prompt: 'Software', region: null });
    await repo.waitForBackgroundJobs();
    const entries = (await repo.listCards(deck.id)).filter(entry => entry.company);
    expect(entries.length).toBeGreaterThanOrEqual(3);
    for (const entry of entries) {
      expect(entry.metrics.every(metric => metric.value === null && metric.confidence === 'unknown')).toBe(true);
      expect((await repo.getCard(entry.card.id))!.metrics).toEqual(entry.metrics);
      const receipts = await repo.getOriginalSourceEvidence({ companyId: entry.company!.id, metricType: 'company_profile' });
      expect(receipts).toHaveLength(0);
    }
  }, 20000);
  it('keeps unsupported initial figures unknown through stored deck, card and reader queries', async () => {
    let snapshot: RepoSnapshot | null = null;
    const save = vi.fn(async () => {});
    const repo = new GeminiRepository({
      apiKey: 'test-key', client: fakeClient(false), coverage: testCoverage, catalogMax: 3, catalogPasses: 0,
      store: { read: () => snapshot, write: (next) => { snapshot = next; } },
      originalSources: {
        retrieve: async (url) => ({ requestedUrl: url, status: 'unavailable', retrievedAt: new Date().toISOString() }),
        save, list: async () => [],
      },
    });
    const { market, deck } = await repo.createResearchedDeck({ prompt: 'Software', region: null });
    await repo.waitForBackgroundJobs();
    const entries = (await repo.listCards(deck.id)).filter((entry) => entry.company && ['company', 'infrastructure', 'distribution'].includes(entry.card.cardType));
    expect(entries.length).toBeGreaterThanOrEqual(3);
    expect(save).not.toHaveBeenCalled();
    expect((await repo.getDeckByMarket(market.id) as Deck & { status?: string }).status).toBe('ready');
    for (const entry of entries) {
      expect(entry.metrics.length).toBeGreaterThan(0);
      expect(entry.metrics.every((metric) => metric.value === null && metric.confidence === 'unknown')).toBe(true);
      expect((await repo.getCard(entry.card.id))!.metrics).toEqual(entry.metrics);
      expect(await repo.getCompanyFacts(entry.company!.id)).toEqual(entry.metrics);
      expect((await repo.getCompanyMetrics(entry.company!.id)).every(metric => metric.value === null && metric.confidence === 'unknown')).toBe(true);
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

describe('resumable research (Slice B)', () => {
  it('keeps already-researched macro signals on resume instead of re-buying them', async () => {
    const ground = vi.fn(async () => { throw new Error('signals must not be re-bought on resume'); });
    const client: LlmClient = {
      ground: ground as unknown as LlmClient['ground'],
      structure: vi.fn(async () => { throw new Error('no structure calls expected'); }),
    } as unknown as LlmClient;
    const barrierCard: CardWithCompany = {
      card: { id: 'crd_barrier', deckId: 'dck_x', companyId: null, cardType: 'barrier', title: 'Barrier',
        summary: null, tier: null, tierReason: null, citations: [], keyPoints: [], createdAt: '2026-10-01T00:00:00.000Z' },
      company: null, metrics: [], viceClaims: [],
    };
    const insightCard: CardWithCompany = {
      card: { id: 'crd_insight', deckId: 'dck_x', companyId: null, cardType: 'insight', title: 'Insight',
        summary: null, tier: null, tierReason: null, citations: [], keyPoints: [], createdAt: '2026-10-01T00:00:00.000Z' },
      company: null, metrics: [], viceClaims: [],
    };
    const cards = await hydrateDeckCards(
      { marketName: 'Test', vertical: 'T', geography: null, notes: null, searchThemes: [] },
      { id: 'dck_x', marketId: 'mkt_x', createdAt: '2026-10-01T00:00:00.000Z', lastRefreshedAt: '2026-10-01T00:00:00.000Z' },
      [], client, {
        existingCompletedCards: [barrierCard, insightCard],
        coverage: {
          companies: { min: 0, target: 0, max: 0 }, infrastructure: { min: 0, target: 0, max: 0 },
          distribution: { min: 0, target: 0, max: 0 }, vice: { min: 0, target: 0, max: 0 },
          culture: { min: 0, target: 0, max: 0 }, barrier: { min: 1, target: 1, max: 1 },
          insight: { min: 1, target: 1, max: 1 },
        },
      },
    );
    expect(cards.filter((c) => c.card.cardType === 'barrier').length).toBe(1);
    expect(cards.filter((c) => c.card.cardType === 'insight').length).toBe(1);
    expect(ground).not.toHaveBeenCalled();
  });
});

describe('GeminiRepository (fake client + in-memory store)', () => {
  it('does not replace an older deck company identity when researching the same names again', async () => {
    let snapshot: RepoSnapshot | null = null;
    const store: ResearchStore = { read: () => snapshot, write: next => { snapshot = next; } };
    const repo = new GeminiRepository({ apiKey: 'fixture', client: fakeClient(), coverage: testCoverage,
      catalogMax: 3, catalogPasses: 0, store });
    const first = await repo.createResearchedDeck({ prompt: 'first market', region: 'CA' });
    await repo.waitForBackgroundJobs();
    const oldCompanies = structuredClone(snapshot!.companies);
    const oldCards = (await repo.listCards(first.deck.id)).filter(card => card.company);
    await repo.createResearchedDeck({ prompt: 'second market', region: 'CA' });
    await repo.waitForBackgroundJobs();
    for (const company of oldCompanies) expect(await repo.getCompany(company.id)).toEqual(company);
    for (const card of oldCards) expect((await repo.getCard(card.card.id))?.company?.id).toBe(card.company!.id);
    expect(new Set(snapshot!.companies.map(company => company.id)).size).toBe(snapshot!.companies.length);
  });
  function memStore(): ResearchStore {
    let s: RepoSnapshot | null = null;
    return { read: () => s, write: (snap) => (s = snap) };
  }

  it('finishes deck research without launching hidden dashboard work', async () => {
    const repo = new GeminiRepository({ apiKey: 'x', client: fakeClient(),
      coverage: testCoverage, catalogMax: 3, catalogPasses: 0, store: memStore() });
    const dashboard = vi.spyOn(repo, 'getDashboardTab');
    await repo.createResearchedDeck({ prompt: 'test', region: 'CA' });
    await repo.waitForBackgroundJobs();
    expect(dashboard).not.toHaveBeenCalled();
  });

  it('starts hydrating the first entity while fallback discovery passes are still running', async () => {
    // Slice 2c pin: discovery streams each pass's selected entities as stubs;
    // the hydration pool consumes them DURING discovery instead of after it.
    const base = fakeClient();
    const gate = deferred<void>();
    let groundCalls = 0;
    let companiesCalls = 0;
    let hydrationGrounds = 0;
    const client: LlmClient = {
      ground: async (prompt, options) => {
        groundCalls += 1;
        // Call 3 is the role-coverage fallback's grounded search (interpret and
        // the initial discovery pass are calls 1 and 2). Block it: hydration
        // must prove it overlaps by grounding while this is still pending.
        if (groundCalls === 3) await gate.promise;
        if (groundCalls > 3) hydrationGrounds += 1;
        return base.ground(prompt, options);
      },
      structure: async (prompt, schema, opts) => {
        if (typeof prompt === 'string' && prompt.includes('"companies"')) {
          companiesCalls += 1;
          if (companiesCalls === 1) {
            // Initial discovery under-delivers: a fallback pass is required.
            return schema.parse({
              companies: [{ name: 'Alpha Inc', domain: 'alpha.com', descriptor: 'big co', cardTypes: ['company'] }],
            });
          }
        }
        return base.structure(prompt, schema, opts);
      },
    } as LlmClient;

    const repo = new GeminiRepository({ apiKey: 'x', client,
      coverage: { ...testCoverage, companies: { min: 2, target: 2, max: 2 } },
      catalogMax: 2, catalogPasses: 0, store: memStore() });
    const creation = repo.createResearchedDeck({ prompt: 'test', region: 'CA' });

    // The fallback ground is blocked; the streamed stub lets Alpha's hydration
    // begin anyway — a provider call beyond discovery proves the overlap.
    for (let i = 0; i < 80 && groundCalls < 4; i++) {
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    expect(groundCalls).toBeGreaterThanOrEqual(4);
    expect(hydrationGrounds).toBeGreaterThanOrEqual(1);

    gate.resolve();
    const { deck } = await creation;
    await repo.waitForBackgroundJobs();
    const cards = await repo.listCards(deck.id);
    const companyCards = cards.filter((c) => c.card.cardType === 'company');
    expect(companyCards.length).toBeGreaterThanOrEqual(1);
    for (const card of companyCards) {
      expect(card.card.tier).not.toBeNull();
      expect(card.metrics.length).toBeGreaterThan(0);
    }
  });

  it('adds user notes to the knowledge base as user_note evidence', async () => {
    const repo = new GeminiRepository({ apiKey: 'x', client: fakeClient(),
      coverage: testCoverage, catalogMax: 3, catalogPasses: 0, store: memStore() });
    const note = await repo.addResearchNote({
      companyId: 'cmp_x', companyName: 'X Corp', text: 'Founder told us churn is 4% monthly.',
      sourceUrl: 'https://xcorp.com/blog/unit-economics',
    });
    expect(note.topic).toBe('user_note');
    expect(note.citations).toEqual([{ title: 'xcorp.com', url: 'https://xcorp.com/blog/unit-economics' }]);
    const evidence = repo.getResearchEvidence({ companyId: 'cmp_x', limit: 10 });
    expect(evidence).toHaveLength(1);
    expect(evidence[0]!.text).toContain('churn is 4%');
    await expect(repo.addResearchNote({ companyId: 'cmp_x', companyName: 'X Corp', text: '  ' })).rejects.toThrow();
  });

  it('recovers saved evidence metrics for free and never calls the provider', async () => {
    // Catalog-style retained evidence: anonymous sections, third-party source,
    // subject named only in the answer header — the Phase 1 defect shape.
    const arr = 'Revenue & Annual Recurring Revenue (ARR)\n* **Annualized Recurring Revenue (ARR):** Approaching **~$70 Billion ARR** as of September 2026, driven by a surge in enterprise contracts and multi-tier subscriptions (Axios / Reuters / Bloomberg)';
    const answer = '### Company Profile: OpenAI, Inc. / OpenAI Group PBC\n**Market Context:** Frontier AI\n\n' + arr;
    const evidence = {
      id: 'ev_openai', companyId: 'cmp_openai', companyName: 'OpenAI, Inc.', topic: 'company_profile',
      capturedAt: '2026-10-05T22:16:29.047Z', text: answer, citations: [{ title: 'axios.com', url: 'https://www.axios.com/2026/09/openai-arr' }],
      queries: ['OpenAI profile'],
      grounding: { provider: 'google-search' as const, answerText: answer, supports: [{ supportIndex: 0, text: arr,
        sources: [{ chunkIndex: 0, url: 'https://www.axios.com/2026/09/openai-arr', title: 'axios.com' }] }] },
    };
    const seed: RepoSnapshot = {
      schemaVersion: 2, markets: [], decks: [], cards: [], viceClaims: [], dashboards: {},
      companyMarket: { cmp_openai: 'mkt_frontier', cmp_anthropic: 'mkt_frontier' },
      reports: [], briefings: [], savedCards: [], opportunity: {}, researchJobs: [], threads: [],
      originalSourceAttempts: [],
      companies: [
        { id: 'cmp_openai', name: 'OpenAI, Inc.', oneLiner: 'AI research lab', logoUrl: null, hqLocation: null, websiteUrl: 'https://openai.com', brandTheme: null },
        { id: 'cmp_anthropic', name: 'Anthropic PBC', oneLiner: 'AI safety lab', logoUrl: null, hqLocation: null, websiteUrl: 'https://anthropic.com', brandTheme: null },
      ],
      metrics: [
        { id: 'met_openai_arr', companyId: 'cmp_openai', metricType: 'arr', value: null, confidence: 'unknown',
          source: null, citations: [], methodNote: 'No provider-supported reported claim.', capturedAt: '2026-10-05T22:16:29.047Z',
          lastVerifiedAt: null, passageSupport: null, reportedSupport: null },
      ],
      researchEvidence: [evidence],
    };
    let stored: RepoSnapshot | null = seed;
    let persisted = 0;
    const store: ResearchStore = { read: () => stored, write: next => { stored = next; persisted += 1; } };
    const repo = new GeminiRepository({ apiKey: 'x', client: fakeClient(),
      coverage: testCoverage, catalogMax: 3, catalogPasses: 0, store });
    const ground = vi.spyOn(repo['client'] as LlmClient, 'ground');
    const result = await repo.recoverSavedCompanyMetrics('cmp_openai');
    expect(result.filledTypes).toEqual(['arr']);
    const row = result.metrics.find(m => m.metricType === 'arr');
    expect(row).toMatchObject({ value: 70_000_000_000, confidence: 'estimated' });
    expect(row!.reportedSupport!.definition).toBe('arr');
    expect(row!.citations.length).toBeGreaterThan(0);
    expect(persisted).toBeGreaterThan(0);
    expect(ground).not.toHaveBeenCalled();
  });

  it('graduates a recovered figure to verified when a retained original confirms it', async () => {
    const arr = 'Revenue & Annual Recurring Revenue (ARR)\n* **Annualized Recurring Revenue (ARR):** Approaching **~$70 Billion ARR** as of September 2026';
    const answer = '### Company Profile: OpenAI, Inc. / OpenAI Group PBC\n\nRevenue & Annual Recurring Revenue (ARR)\n* **Annualized Recurring Revenue (ARR):** Approaching **~$70 Billion ARR** as of September 2026' + arr;
    const evidence = {
      id: 'ev_openai', companyId: 'cmp_openai', companyName: 'OpenAI, Inc.', topic: 'company_profile',
      capturedAt: '2026-10-05T22:16:29.047Z', text: answer, citations: [{ title: 'axios.com', url: 'https://www.axios.com/x' }],
      queries: [],
      grounding: { provider: 'google-search' as const, answerText: answer, supports: [{ supportIndex: 0, text: arr,
        sources: [{ chunkIndex: 0, url: 'https://www.axios.com/x', title: 'axios.com' }] }] },
    };
    const seed: RepoSnapshot = {
      schemaVersion: 2, markets: [], decks: [], cards: [], viceClaims: [], dashboards: {},
      companyMarket: { cmp_openai: 'mkt_frontier', cmp_anthropic: 'mkt_frontier' }, reports: [], briefings: [], savedCards: [],
      opportunity: {}, researchJobs: [], threads: [],
      originalSourceAttempts: [{
        id: 'osa_1', companyId: 'cmp_openai', metricType: 'arr', capturedAt: '2026-10-05T23:00:00.000Z',
        receipts: [{ requestedUrl: 'https://openai.com/index', finalUrl: 'https://openai.com/index',
          status: 'retrieved' as const, httpStatus: 200, retrievedAt: '2026-10-05T23:00:00.000Z', contentHash: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
          text: 'OpenAI announced annual recurring revenue of US$70 billion as of September 30, 2026.' }],
      }],
      companies: [
        { id: 'cmp_openai', name: 'OpenAI, Inc.', oneLiner: 'AI research lab', logoUrl: null, hqLocation: null, websiteUrl: 'https://openai.com', brandTheme: null },
        { id: 'cmp_anthropic', name: 'Anthropic PBC', oneLiner: 'AI safety lab', logoUrl: null, hqLocation: null, websiteUrl: 'https://anthropic.com', brandTheme: null },
      ],
      metrics: [], researchEvidence: [evidence],
    };
    const store: ResearchStore = { read: () => seed, write: () => {} };
    const repo = new GeminiRepository({ apiKey: 'x', client: fakeClient(),
      coverage: testCoverage, catalogMax: 3, catalogPasses: 0, store });
    const result = await repo.recoverSavedCompanyMetrics('cmp_openai');
    expect(result.filledTypes).toEqual(['arr']);
    const row = result.metrics.find((m) => m.metricType === 'arr');
    expect(row).toMatchObject({ value: 70000000000, confidence: 'verified' });
    expect(row!.citations.length).toBeGreaterThan(0);
    expect(row!.reportedSupport).toBeNull();
  });

  it('leaves already-valued and human-verified rows untouched during free recovery', async () => {
    const answer = '### Company Profile: Anthropic PBC\n\nAnthropic approaches ~$70 Billion ARR as of September 2026.';
    const evidence = {
      id: 'ev_anthropic', companyId: 'cmp_anthropic', companyName: 'Anthropic PBC', topic: 'company_profile',
      capturedAt: '2026-10-05T22:16:43.575Z', text: answer, citations: [{ title: 'axios.com', url: 'https://www.axios.com/x' }],
      queries: [],
      grounding: { provider: 'google-search' as const, answerText: answer, supports: [{ supportIndex: 0, text: answer,
        sources: [{ chunkIndex: 0, url: 'https://www.axios.com/x', title: 'axios.com' }] }] },
    };
    const valued: RepoSnapshot['metrics'][number] = { id: 'met_anthropic_arr', companyId: 'cmp_anthropic', metricType: 'arr',
      value: 45_000_000_000, confidence: 'user_verified', source: null, citations: [], methodNote: 'Human correction.',
      capturedAt: '2026-10-06T00:00:00.000Z', lastVerifiedAt: null, passageSupport: null, reportedSupport: null };
    const seed: RepoSnapshot = {
      schemaVersion: 2, markets: [], decks: [], cards: [], viceClaims: [], dashboards: {},
      companyMarket: { cmp_anthropic: 'mkt_frontier' }, reports: [], briefings: [], savedCards: [],
      opportunity: {}, researchJobs: [], threads: [], originalSourceAttempts: [],
      companies: [{ id: 'cmp_anthropic', name: 'Anthropic PBC', oneLiner: 'AI safety lab', logoUrl: null, hqLocation: null, websiteUrl: 'https://anthropic.com', brandTheme: null }],
      metrics: [valued], researchEvidence: [evidence],
    };
    const store: ResearchStore = { read: () => seed, write: () => { throw new Error('must not persist when nothing filled'); } };
    const repo = new GeminiRepository({ apiKey: 'x', client: fakeClient(),
      coverage: testCoverage, catalogMax: 3, catalogPasses: 0, store });
    const result = await repo.recoverSavedCompanyMetrics('cmp_anthropic');
    expect(result.filledTypes).toEqual([]);
    expect(result.metrics.find(m => m.metricType === 'arr')).toMatchObject({ value: 45_000_000_000, confidence: 'user_verified' });
  });

  it('ignores evidence recorded under a different company name (renames and mis-files)', async () => {
    const answer = '### Company Profile: Anthropic PBC\n\nAnthropic approaches ~$70 Billion ARR as of September 2026.';
    const evidence = {
      id: 'ev_stale', companyId: 'cmp_anthropic', companyName: 'Anthropic (old legal name)', topic: 'company_profile',
      capturedAt: '2026-10-05T22:16:43.575Z', text: answer, citations: [{ title: 'axios.com', url: 'https://www.axios.com/x' }],
      queries: [],
      grounding: { provider: 'google-search' as const, answerText: answer, supports: [{ supportIndex: 0, text: answer,
        sources: [{ chunkIndex: 0, url: 'https://www.axios.com/x', title: 'axios.com' }] }] },
    };
    const seed: RepoSnapshot = {
      schemaVersion: 2, markets: [], decks: [], cards: [], viceClaims: [], dashboards: {},
      companyMarket: { cmp_anthropic: 'mkt_frontier' }, reports: [], briefings: [], savedCards: [],
      opportunity: {}, researchJobs: [], threads: [], originalSourceAttempts: [],
      companies: [{ id: 'cmp_anthropic', name: 'Anthropic PBC', oneLiner: 'AI safety lab', logoUrl: null, hqLocation: null, websiteUrl: 'https://anthropic.com', brandTheme: null }],
      metrics: [], researchEvidence: [evidence],
    };
    const store: ResearchStore = { read: () => seed, write: () => { throw new Error('must not persist when nothing filled'); } };
    const repo = new GeminiRepository({ apiKey: 'x', client: fakeClient(),
      coverage: testCoverage, catalogMax: 3, catalogPasses: 0, store });
    const result = await repo.recoverSavedCompanyMetrics('cmp_anthropic');
    expect(result.filledTypes).toEqual([]);
  });

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
  it('honors an explicit whole-market choice over a model guess of selected-company scope', async () => {
    const structure = vi.fn(async (prompt: string, schema: ZodType<unknown>) => {
      if (prompt.includes('market definition')) {
        return schema.parse({
          marketName: 'Frontier AI labs',
          vertical: 'Frontier model companies',
          geography: null,
          notes: null,
          searchThemes: ['foundation models'],
          companyScope: { mode: 'selected_only', names: ['Meta', 'Anthropic'] },
        });
      }
      return schema.parse({
        companies: [
          { name: 'Meta Platforms, Inc.', domain: 'meta.com', descriptor: 'AI lab', cardTypes: ['company'] },
          { name: 'Anthropic, PBC', domain: 'anthropic.com', descriptor: 'AI lab', cardTypes: ['company'] },
          { name: 'OpenAI, Inc.', domain: 'openai.com', descriptor: 'AI lab', cardTypes: ['company'] },
        ],
      });
    });
    const client: LlmClient = {
      ground: vi.fn(async () => ({ text: 'grounded company evidence', citations: [], queries: [] })),
      structure: structure as LlmClient['structure'],
    };

    const result = await discoverDeckStubs(
      {
        prompt: 'Research frontier AI labs',
        region: null,
        companyScope: { mode: 'market', names: [] },
      },
      client,
      { coverage: testCoverage, catalogMax: 10, catalogPasses: 0 },
    );

    expect(result.candidates.map((candidate) => candidate.name)).toEqual([
      'Meta Platforms, Inc.',
      'Anthropic, PBC',
      'OpenAI, Inc.',
    ]);
  });

  it('keeps an explicitly selected-company deck scoped to those companies', async () => {
    const requested = ['Meta', 'Anthropic'];
    const structure = vi.fn(async (prompt: string, schema: ZodType<unknown>) => {
      if (prompt.includes('market definition')) {
        return schema.parse({
          marketName: 'Frontier AI labs',
          vertical: 'Frontier model companies',
          geography: null,
          notes: null,
          searchThemes: ['foundation models'],
          // The UI's explicit choice must win even if interpretation suggests a market scan.
          companyScope: { mode: 'market', names: [] },
        });
      }
      return schema.parse({
        companies: [
          { name: 'Meta Platforms, Inc.', domain: 'meta.com', descriptor: 'AI lab', cardTypes: ['company'] },
          { name: 'Anthropic, PBC', domain: 'anthropic.com', descriptor: 'AI lab', cardTypes: ['company'] },
          { name: 'OpenAI, Inc.', domain: 'openai.com', descriptor: 'AI lab', cardTypes: ['company'] },
        ],
      });
    });
    const ground = vi.fn(async (..._args: Parameters<LlmClient['ground']>) => ({
      text: 'grounded company evidence',
      citations: [],
      queries: [],
    }));
    const client: LlmClient = { ground, structure: structure as LlmClient['structure'] };

    const result = await discoverDeckStubs(
      {
        prompt: 'Research frontier AI labs',
        region: null,
        companyScope: { mode: 'selected_only', names: requested },
      },
      client,
      { coverage: testCoverage, catalogMax: 10, catalogPasses: 0 },
    );

    expect(result.candidates.map((candidate) => candidate.name)).toEqual([
      'Meta Platforms, Inc.',
      'Anthropic, PBC',
    ]);
    expect(ground).toHaveBeenCalledTimes(2);
    expect(ground.mock.calls[1]?.[0]).toContain('Meta');
    expect(ground.mock.calls[1]?.[0]).toContain('Anthropic');
    expect(String(structure.mock.calls[0]?.[0])).toContain('Research frontier AI labs');
  });

  it('keeps an explicitly named company when discovery correctly classifies it as infrastructure', async () => {
    const structure = vi.fn(async (prompt: string, schema: ZodType<unknown>) => {
      if (prompt.includes('market definition')) return schema.parse({
        marketName: 'Frontier AI', vertical: 'Frontier AI', geography: null, notes: null,
        searchThemes: ['frontier models'], companyScope: { mode: 'market', names: [] },
      });
      return schema.parse({ companies: [{
        name: 'Microsoft Corporation', domain: 'microsoft.com', descriptor: 'Cloud and AI infrastructure provider',
        primaryRole: 'infrastructure', cardTypes: ['infrastructure'],
      }] });
    });
    const client: LlmClient = {
      ground: vi.fn(async () => ({ text: 'Microsoft Azure provides AI infrastructure.', citations: [], queries: [] })),
      structure: structure as LlmClient['structure'],
    };

    const result = await discoverDeckStubs({
      prompt: 'Compare Microsoft Corporation in frontier AI', region: null,
      companyScope: { mode: 'selected_only', names: ['Microsoft Corporation'] },
    }, client, { coverage: testCoverage });

    expect(result.candidates).toEqual([expect.objectContaining({
      name: 'Microsoft Corporation', primaryRole: 'infrastructure', cardTypes: ['infrastructure'],
    })]);
    expect(result.minimumCompaniesSatisfied).toBe(true);
  });

  it('opens an exact-scope deck after its only requested infrastructure entity is hydrated', async () => {
    const originalFetch = globalThis.fetch;
    vi.stubGlobal('fetch', vi.fn(async () => new Response(null, { status: 404 })));
    const client = fakeClient();
    const originalStructure = client.structure.bind(client);
    client.structure = (async (
      prompt: string,
      schema: ZodType<unknown>,
      options?: Parameters<LlmClient['structure']>[2],
    ) => {
      if (prompt.includes('"companies"')) {
        return schema.parse({ companies: [{
          name: 'Alpha Inc',
          domain: 'alpha.com',
          descriptor: 'Cloud and AI infrastructure provider',
          primaryRole: 'infrastructure',
          cardTypes: ['infrastructure'],
        }] });
      }
      return originalStructure(prompt, schema, options);
    }) as LlmClient['structure'];
    let snapshot: RepoSnapshot | null = null;
    const repo = new GeminiRepository({
      apiKey: 'test-key',
      client,
      coverage: testCoverage,
      catalogMax: 3,
      catalogPasses: 0,
      store: {
        read: () => snapshot,
        write: (next) => { snapshot = next; },
      },
    });

    try {
      const { market, deck } = await repo.createResearchedDeck({
        prompt: 'Research Alpha Inc',
        region: null,
        companyScope: { mode: 'selected_only', names: ['Alpha Inc'] },
      });

      expect(market.id).toBeTruthy();
      const firstCards = await repo.listCards(deck.id);
      const leadInfrastructureCard = firstCards.find((entry) => entry.card.cardType === 'infrastructure');
      expect(leadInfrastructureCard).toBeTruthy();
      expect(leadInfrastructureCard!.metrics.length).toBeGreaterThan(0);
      await repo.waitForBackgroundJobs();
    } finally {
      vi.stubGlobal('fetch', originalFetch);
    }
  });

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

  it('skips vice and culture coverage for a financial market instead of reporting a shortfall', async () => {
    // The live failure this pins: a 10-firm VC deck died under
    // "Coverage shortfall for vice: found 0, minimum is 4" — a role that cannot
    // exist in that market. It must be silent (role not applicable), run no
    // fallback passes for it, and leave deck creation unblocked.
    const warnings: string[] = [];
    const structure = vi.fn(async (prompt: string, schema: ZodType<unknown>) => {
      if (prompt.includes('market definition')) {
        return schema.parse({
          marketName: 'Venture Capital Fund Management',
          vertical: 'Venture capital firms',
          geography: null,
          notes: null,
          searchThemes: ['vc fund managers', 'institutional investors'],
        });
      }
      // A focused vice/culture pass would honestly find nothing here; if one
      // ever runs, the ground-count assertion below fails first.
      if (prompt.includes('This pass is focused on')) return schema.parse({ companies: [] });
      return schema.parse({
        companies: [
          ...Array.from({ length: 10 }, (_, i) => ({
            name: `Fund ${i} Capital`,
            domain: `fund-${i}.example`,
            descriptor: 'venture capital firm',
            cardTypes: ['company'],
          })),
          ...Array.from({ length: 4 }, (_, i) => ({
            name: `Data Provider ${i}`,
            domain: `data-${i}.example`,
            descriptor: 'market data infrastructure',
            cardTypes: ['infrastructure'],
          })),
          ...Array.from({ length: 2 }, (_, i) => ({
            name: `Placement Agent ${i}`,
            domain: `placement-${i}.example`,
            descriptor: 'fund placement channel',
            cardTypes: ['distribution'],
          })),
        ],
      });
    }) as LlmClient['structure'];
    const client: LlmClient = {
      ground: vi.fn(async () => ({ text: 'grounded fund evidence', citations: [], queries: [] })),
      structure,
    };

    const result = await discoverDeckStubs(
      { prompt: 'Venture capital fund management', region: null },
      client,
      {
        onEvent: async (event) => {
          if (event.type === 'warning') warnings.push(event.message);
        },
      },
    );

    // Silence is the honest signal: no vice or culture shortfall, and no
    // discovery pass burned hunting entities the market cannot have.
    // (Two ground calls total: market interpretation + the initial census.)
    expect(warnings).toEqual([]);
    expect(client.ground).toHaveBeenCalledTimes(2);
    expect(result.candidates).toHaveLength(16);
    expect(result.minimumCompaniesSatisfied).toBe(true);
  });

  it('still enforces the vice and culture minimum for a consumer market', async () => {
    const warnings: string[] = [];
    const structure = vi.fn(async (prompt: string, schema: ZodType<unknown>) => {
      if (prompt.includes('market definition')) {
        return schema.parse({
          marketName: 'Christian apparel brands',
          vertical: 'Consumer apparel',
          geography: null,
          notes: null,
          searchThemes: ['faith-based clothing lines'],
        });
      }
      // A focused vice/culture pass on this market honestly finds nothing.
      if (prompt.includes('This pass is focused on')) return schema.parse({ companies: [] });
      return schema.parse({
        companies: [
          ...Array.from({ length: 10 }, (_, i) => ({
            name: `Brand ${i} Apparel`,
            domain: `brand-${i}.example`,
            descriptor: 'apparel brand',
            cardTypes: ['company'],
          })),
          ...Array.from({ length: 4 }, (_, i) => ({
            name: `Print Shop ${i}`,
            domain: `print-${i}.example`,
            descriptor: 'garment printing infrastructure',
            cardTypes: ['infrastructure'],
          })),
          ...Array.from({ length: 2 }, (_, i) => ({
            name: `Shop ${i} Marketplace`,
            domain: `shop-${i}.example`,
            descriptor: 'marketplace channel',
            cardTypes: ['distribution'],
          })),
        ],
      });
    }) as LlmClient['structure'];
    const client: LlmClient = {
      ground: vi.fn(async () => ({ text: 'grounded apparel evidence', citations: [], queries: [] })),
      structure,
    };

    const result = await discoverDeckStubs(
      { prompt: 'Christian apparel companies', region: null },
      client,
      {
        onEvent: async (event) => {
          if (event.type === 'warning') warnings.push(event.message);
        },
      },
    );

    // Consumer markets keep the quota exactly as before: the vice and culture
    // fallback passes still run and the shortfalls are still reported.
    // (Four ground calls: interpretation + census + one focused pass each.)
    expect(warnings).toEqual([
      'Coverage shortfall for vice: found 0, minimum is 4. No unsupported entities were invented.',
      'Coverage shortfall for culture: found 0, minimum is 4. No unsupported entities were invented.',
    ]);
    expect(client.ground).toHaveBeenCalledTimes(4);
    expect(result.minimumCompaniesSatisfied).toBe(true);
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

  it('waits for the lead company card before returning while other cards hydrate in the background', async () => {
    const originalFetch = globalThis.fetch;
    vi.stubGlobal('fetch', vi.fn(async () => new Response(null, { status: 404 })));
    const storeState: { value: RepoSnapshot | null } = { value: null };
    const store: ResearchStore = {
      read: () => storeState.value,
      write: (snap) => (storeState.value = snap),
    };

    const client = fakeClient();
    const alphaGate = deferred<void>();
    const otherCompaniesGate = deferred<void>();
    const alphaStarted = deferred<void>();
    const originalGround = client.ground.bind(client);
    let leadCompanyName = '';
    client.ground = async (prompt, options) => {
      if (prompt.startsWith('Research the company "')) {
        const companyName = prompt.match(/^Research the company "([^"]+)"/)?.[1] ?? '';
        if (!leadCompanyName) {
          leadCompanyName = companyName;
          alphaStarted.resolve();
          await alphaGate.promise;
        } else if (companyName !== leadCompanyName) {
          await otherCompaniesGate.promise;
        }
      }
      return originalGround(prompt, options);
    };

    const repo = new GeminiRepository({
      apiKey: 'test-key',
      client,
      coverage: testCoverage,
      catalogMax: 3,
      catalogPasses: 0,
      store,
    });

    const refreshEvents: DeckRefreshEvent[] = [];
    repo.subscribeDeckRefresh((evt) => {
      refreshEvents.push(evt);
    });

    const progress: ResearchProgress[] = [];
    let creationSettled = false;
    const creation = repo.createResearchedDeck({
      prompt: 'AI developer tools',
      region: 'CA',
    }, {
      onProgress: (event) => progress.push(event),
    });
    void creation.then(
      () => { creationSettled = true; },
      () => { creationSettled = true; },
    );

    await alphaStarted.promise;
    expect(creationSettled).toBe(false);
    alphaGate.resolve();
    const { market, deck } = await creation;

    expect(market.id).toBeTruthy();
    expect(deck.id).toBeTruthy();
    expect((await repo.getDeckByMarket(market.id) as Deck & { status?: string }).status).toBe('running');

    // The lead card has completed its first hydration before the UI can navigate.
    const initialCards = await repo.listCards(deck.id);
    expect(initialCards.length).toBeGreaterThanOrEqual(1);

    const stubCompanyCards = initialCards.filter((c) => c.card.cardType === 'company');
    expect(stubCompanyCards).toHaveLength(1);
    expect(stubCompanyCards[0]?.company?.name).toBe(leadCompanyName);
    expect(progress.some((event) => event.card?.company?.name === leadCompanyName)).toBe(true);

    // Other company research is still pending: the method does not wait for the whole deck.
    expect(
      progress.some(
        (event) => event.card?.company && event.card.company.name !== leadCompanyName,
      ),
    ).toBe(false);
    otherCompaniesGate.resolve();

    // Wait for continual background worker pool to finish.
    await repo.waitForBackgroundJobs();
    vi.stubGlobal('fetch', originalFetch);
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


describe('discovery degradation under provider outages', () => {
  it('keeps already-streamed companies when an expansion pass fails', async () => {
    let calls = 0;
    const client: LlmClient = {
      ground: vi.fn(async () => ({ text: 'grounded', citations: [], queries: [] })),
      structure: (async (_prompt: string, schema: ZodType<unknown>) => {
        calls += 1;
        if (calls > 1) throw Object.assign(new Error('Gemini 504: request failed.'), { status: 504 });
        return schema.parse({
          companies: Array.from({ length: 10 }, (_, i) => ({
            name: `Colocation provider ${i}`,
            domain: `colo-${i}.example`,
            descriptor: 'data center colocation operator',
            cardTypes: ['company'],
          })),
        });
      }) as LlmClient['structure'],
    };
    const result = await discoverWithCoverage(
      client,
      { marketName: 'Test', vertical: 'Colocation', geography: null, notes: null, searchThemes: [] },
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
    expect(result.candidates.length).toBeGreaterThanOrEqual(10);
    expect(result.minimumCompaniesSatisfied).toBe(true);
    // The failed infrastructure pass burned its ground call; the loop broke
    // before the distribution fallback could start another one.
    expect(client.ground).toHaveBeenCalledTimes(2);
  });
});
