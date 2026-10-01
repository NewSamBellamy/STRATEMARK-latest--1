import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  cardSchema,
  companyMetricSchema,
  type Card,
  type Company,
  type Deck,
  type Market,
  type ResearchJob,
} from '@mi/contracts';
import type { HydrateCompanyCardResult } from './company-agent';
import { GeminiRepository, migrateSnapshot, type RepoSnapshot } from './repository';
import type { CompanyCandidate, GroundedResult, LlmClient } from './types';

const pipeline = vi.hoisted(() => ({ run: vi.fn(), discover: vi.fn(), review: vi.fn() }));
const hydration = vi.hoisted(() => ({ run: vi.fn() }));
const signals = vi.hoisted(() => ({ run: vi.fn() }));
const dashboard = vi.hoisted(() => ({ run: vi.fn() }));
vi.mock('./pipeline', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  runDeckResearch: pipeline.run,
  discoverDeckStubs: pipeline.discover,
  reviewTiersBatch: pipeline.review,
}));
vi.mock('./company-agent', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  hydrateCompanyCard: hydration.run,
}));
vi.mock('./signal-agents', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  researchMarketSignals: signals.run,
}));
vi.mock('./dashboard', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  researchDashboardTab: dashboard.run,
}));

const AT = '2026-09-30T12:00:00.000Z';

function market(id: string, name: string): Market {
  return {
    id,
    name,
    createdAt: AT,
    refreshCadence: 'daily',
    scopeDefinition: { vertical: 'Synthetic', geography: null, notes: null },
  };
}

function deck(id: string, marketId: string): Deck {
  return { id, marketId, createdAt: AT, lastRefreshedAt: null };
}

function company(id: string, name: string, websiteUrl: string | null): Company {
  return {
    id,
    name,
    oneLiner: 'Synthetic company',
    logoUrl: null,
    websiteUrl,
    hqLocation: null,
    brandTheme: null,
  };
}

function card(id: string, deckId: string, companyId: string): Card {
  return cardSchema.parse({
    id,
    deckId,
    companyId,
    createdAt: AT,
    cardType: 'company',
    tier: null,
    tierReason: null,
    title: null,
    summary: null,
    citations: [],
  });
}

function job(targetMarket: Market, targetDeck: Deck): ResearchJob {
  return {
    id: 'run_identity_fixture',
    status: 'failed',
    stage: 'scope',
    brief: { prompt: 'Synthetic identity refresh', region: null },
    marketPlan: {
      marketName: targetMarket.name,
      vertical: 'Synthetic',
      geography: null,
      notes: null,
      searchThemes: [],
    },
    market: targetMarket,
    deck: targetDeck,
    catalog: [],
    catalogNames: [],
    completedEntityNames: [],
    partialCards: [],
    warnings: [],
    error: null,
    createdAt: AT,
    updatedAt: AT,
  };
}

function snapshot(
  companies: Company[],
  existingCards: Card[],
  targetMarket: Market,
  targetDeck: Deck,
  existingMarkets: Market[] = [],
  existingDecks: Deck[] = [],
): RepoSnapshot {
  return {
    ...migrateSnapshot(null).snapshot,
    markets: [...existingMarkets, targetMarket],
    decks: [...existingDecks, targetDeck],
    companies,
    cards: existingCards,
    companyMarket: Object.fromEntries(companies.map((item) => [item.id, 'Synthetic original'])),
    researchJobs: [job(targetMarket, targetDeck)],
  };
}

function memory(initial: RepoSnapshot) {
  let current = structuredClone(initial);
  return {
    store: {
      read: () => structuredClone(current),
      write: (next: RepoSnapshot) => {
        current = structuredClone(next);
      },
    },
    read: () => structuredClone(current),
  };
}

function client(): LlmClient {
  return {
    ground: async (): Promise<GroundedResult> => ({
      text: 'Synthetic notes',
      citations: [],
      queries: [],
    }),
    structure: async (_prompt, schema) => schema.parse({ markdown: 'Synthetic overview' }),
  };
}

async function refresh(source: RepoSnapshot, incoming: { card: Card; company: Company }[]) {
  const targetJob = source.researchJobs[0]!;
  const targetMarket = targetJob.market!;
  const targetDeck = targetJob.deck!;
  pipeline.run.mockResolvedValueOnce({
    market: targetMarket,
    deck: targetDeck,
    cards: incoming.map((item) => ({
      ...item,
      metrics: [],
      viceClaims: [],
    })),
  });
  const data = memory(source);
  const repo = new GeminiRepository({ client: client(), store: data.store });
  await repo.resumeResearchJob(targetJob.id);
  return { repo, data };
}

function stubResult(
  targetMarket: Market,
  targetDeck: Deck,
  candidate: CompanyCandidate,
  placeholder: Company,
  metrics: RepoSnapshot['metrics'] = [],
) {
  return {
    plan: {
      marketName: targetMarket.name,
      vertical: 'Synthetic',
      geography: null,
      notes: null,
      searchThemes: [],
    },
    market: targetMarket,
    deck: targetDeck,
    candidates: [candidate],
    cards: [
      {
        card: card(`card_${placeholder.id}`, targetDeck.id, placeholder.id),
        company: placeholder,
        metrics,
        viceClaims: [],
      },
    ],
    rejected: [],
    minimumCompaniesSatisfied: true,
  };
}

function hydratedResult(
  candidate: CompanyCandidate,
  hydratedCompany: Company,
  targetDeck: Deck,
): HydrateCompanyCardResult {
  const hydratedCard = card(`hydrated_${hydratedCompany.id}`, targetDeck.id, hydratedCompany.id);
  const primaryCard = {
    card: hydratedCard,
    company: hydratedCompany,
    metrics: [],
    viceClaims: [],
  };
  return {
    candidate,
    company: hydratedCompany,
    metrics: [],
    enrichment: {},
    citations: [],
    card: hydratedCard,
    cards: [primaryCard],
    primaryCard,
    cmsResult: {},
    viceClaims: [],
    cultureNote: null,
    memory: {},
  } as unknown as HydrateCompanyCardResult;
}

async function createDeckWithStubs(
  source: RepoSnapshot,
  stubs: ReturnType<typeof stubResult>,
  waitForBackground = true,
) {
  pipeline.discover.mockResolvedValueOnce(stubs);
  const data = memory(source);
  const repo = new GeminiRepository({ client: client(), store: data.store });
  await repo.createResearchedDeck({ prompt: 'Synthetic identity review', region: null });
  const activeJob = (await repo.listResearchJobs())[0];
  if (waitForBackground && activeJob) await repo.waitForBackgroundJobs(activeJob.id);
  return { repo, data };
}

describe('legacy repository company identity', () => {
  beforeEach(() => {
    pipeline.run.mockReset();
    pipeline.discover.mockReset();
    pipeline.review.mockReset().mockResolvedValue(new Map());
    hydration.run.mockReset();
    signals.run.mockReset().mockResolvedValue([]);
    dashboard.run.mockReset().mockRejectedValue(new Error('Synthetic dashboard unavailable'));
  });

  it('keeps same-name companies with distinct domains and IDs separate on refresh', async () => {
    const targetMarket = market('market_refresh', 'Synthetic refresh');
    const targetDeck = deck('deck_refresh', targetMarket.id);
    const first = company('co_one', 'Acme Systems', 'https://one.fixture.test');
    const second = company('co_two', 'Acme Systems', 'https://two.fixture.test');
    const source = snapshot(
      [first, second],
      [
        card('card_one_old', targetDeck.id, first.id),
        card('card_two_old', targetDeck.id, second.id),
      ],
      targetMarket,
      targetDeck,
    );

    const { repo } = await refresh(source, [
      {
        card: card('card_one_new', targetDeck.id, 'co_one_new'),
        company: { ...first, id: 'co_one_new' },
      },
      {
        card: card('card_two_new', targetDeck.id, 'co_two_new'),
        company: { ...second, id: 'co_two_new' },
      },
    ]);

    const cards = await repo.listCards(targetDeck.id);
    expect(cards.map((item) => [item.company?.id, item.company?.websiteUrl])).toEqual([
      ['co_one', 'https://one.fixture.test'],
      ['co_two', 'https://two.fixture.test'],
    ]);
  });

  it('reuses one exact-domain dossier across markets while retaining its ID and old market link', async () => {
    const oldMarket = market('market_old', 'Synthetic old market');
    const oldDeck = deck('deck_old', oldMarket.id);
    const targetMarket = market('market_new', 'Synthetic new market');
    const targetDeck = deck('deck_new', targetMarket.id);
    const existing = company('co_stable', 'Shared Labs', 'https://www.shared.fixture.test/about');
    const incoming = company('co_generated', 'Shared Labs', 'http://shared.fixture.test/research');
    const source = snapshot(
      [existing],
      [card('card_old', oldDeck.id, existing.id)],
      targetMarket,
      targetDeck,
      [oldMarket],
      [oldDeck],
    );

    const { repo, data } = await refresh(source, [
      { card: card('card_new', targetDeck.id, incoming.id), company: incoming },
    ]);

    const oldCards = await repo.listCards(oldDeck.id);
    const newCards = await repo.listCards(targetDeck.id);
    expect(oldCards.map((item) => item.company?.id)).toEqual(['co_stable']);
    expect(newCards.map((item) => item.company?.id)).toEqual(['co_stable']);
    expect(data.read().companies.map((item) => item.id)).toEqual(['co_stable']);
  });

  it('does not overwrite an existing ID when the incoming domain conflicts', async () => {
    const targetMarket = market('market_conflict', 'Synthetic conflict');
    const targetDeck = deck('deck_conflict', targetMarket.id);
    const existing = company('co_conflict', 'Same Name', 'one.fixture.test');
    const incoming = company('co_conflict', 'Same Name', 'two.fixture.test');
    const source = snapshot(
      [existing],
      [card('card_existing', targetDeck.id, existing.id)],
      targetMarket,
      targetDeck,
    );

    const { repo, data } = await refresh(source, [
      { card: card('card_incoming', targetDeck.id, incoming.id), company: incoming },
    ]);

    const saved = data.read();
    expect(saved.companies.find((item) => item.id === 'co_conflict')?.websiteUrl).toBe(
      'one.fixture.test',
    );
    const cards = await repo.listCards(targetDeck.id);
    expect(new Set(cards.map((item) => item.company?.id)).size).toBe(2);
    expect(cards.find((item) => item.card.id === 'card_incoming')?.company?.websiteUrl).toBe(
      'two.fixture.test',
    );
  });

  it('allocates a bounded stable ID for a conflicting candidate with a very long name', async () => {
    const targetMarket = market('market_long_identity', 'Synthetic long identity');
    const targetDeck = deck('deck_long_identity', targetMarket.id);
    const existing = company('co_collision', 'Original', 'https://one.fixture.test');
    const incoming = company('co_collision', 'Long'.repeat(200), 'https://two.fixture.test');
    const source = snapshot(
      [existing],
      [card('card_original', targetDeck.id, existing.id)],
      targetMarket,
      targetDeck,
    );
    const { data } = await refresh(source, [
      { card: card('card_long', targetDeck.id, incoming.id), company: incoming },
    ]);
    const saved = data.read();
    const distinct = saved.companies.find((item) => item.websiteUrl === incoming.websiteUrl)!;
    expect(distinct.id).not.toBe(existing.id);
    expect(distinct.id.length).toBeLessThanOrEqual(128);
    expect(distinct.id).toMatch(/^[A-Za-z0-9][A-Za-z0-9_-]*$/);
    expect(saved.cards.find((item) => item.id === 'card_long')?.companyId).toBe(distinct.id);
  });

  it('keeps a published provisional ID and its dashboard/evidence when hydration finds a domain match', async () => {
    const oldMarket = market('market_old_identity', 'Synthetic old market');
    const oldDeck = deck('deck_old_identity', oldMarket.id);
    const targetMarket = market('market_hydration', 'Synthetic hydration');
    const targetDeck = deck('deck_hydration', targetMarket.id);
    const existing = company('co_canonical', 'Shared Labs', 'shared.fixture.test');
    const candidate: CompanyCandidate = {
      name: 'Shared Labs',
      domain: null,
      descriptor: 'Synthetic descriptor',
      cardTypes: ['company'],
    };
    const placeholder = company('co_provisional', 'Shared Labs', null);
    const source = snapshot([existing], [], targetMarket, targetDeck, [oldMarket], [oldDeck]);
    const evidence = companyMetricSchema.parse({
      id: 'metric_published',
      companyId: placeholder.id,
      metricType: 'arr',
      value: 10,
      confidence: 'estimated',
      source: 'https://evidence.fixture.test/report',
      citations: [
        {
          title: 'Synthetic evidence',
          url: 'https://evidence.fixture.test/report',
          credibility: 'primary',
        },
      ],
      methodNote: 'Synthetic retained evidence',
      capturedAt: AT,
    });
    let beginHydration!: () => void;
    const hydrationStarted = new Promise<void>((resolve) => {
      beginHydration = resolve;
    });
    let finishHydration!: () => void;
    const hydrationGate = new Promise<void>((resolve) => {
      finishHydration = resolve;
    });
    hydration.run.mockImplementationOnce(async () => {
      beginHydration();
      await hydrationGate;
      return hydratedResult(
        candidate,
        { ...placeholder, websiteUrl: 'https://shared.fixture.test' },
        targetDeck,
      );
    });
    dashboard.run.mockResolvedValueOnce({ markdown: 'Published synthetic dashboard' });

    const { repo, data } = await createDeckWithStubs(
      source,
      stubResult(targetMarket, targetDeck, candidate, placeholder, [evidence]),
      false,
    );
    await hydrationStarted;
    await repo.getDashboardTab(placeholder.id, 'overview', true);
    finishHydration();
    const activeJob = (await repo.listResearchJobs())[0];
    if (activeJob) await repo.waitForBackgroundJobs(activeJob.id);

    const saved = data.read();
    expect(saved.companies.map((item) => item.id)).toContain('co_provisional');
    expect(saved.companies.map((item) => item.id)).toContain('co_canonical');
    expect(saved.cards.find((item) => item.id === `card_${placeholder.id}`)?.companyId).toBe(
      'co_provisional',
    );
    expect(saved.metrics.find((item) => item.id === evidence.id)?.companyId).toBe('co_provisional');
    expect(saved.dashboards.co_provisional?.overview?.content).toEqual({
      markdown: 'Published synthetic dashboard',
    });
    expect(
      saved.researchJobs
        .flatMap((researchJob) => researchJob.partialCards)
        .find((item) => item.company?.id === 'co_provisional')?.company?.id,
    ).toBe('co_provisional');
  });

  it('does not match a stub by unique name when an explicit candidate domain differs', async () => {
    const targetMarket = market('market_domain_mismatch', 'Synthetic domain mismatch');
    const targetDeck = deck('deck_domain_mismatch', targetMarket.id);
    const candidate: CompanyCandidate = {
      name: 'Shared Labs',
      domain: 'candidate.fixture.test',
      descriptor: 'Synthetic descriptor',
      cardTypes: ['company'],
    };
    const placeholder = company('co_wrong_domain', 'Shared Labs', 'stub.fixture.test');
    const source = snapshot([], [], targetMarket, targetDeck);
    hydration.run.mockImplementationOnce(async (input: { companyId?: string }) =>
      hydratedResult(
        candidate,
        company(input.companyId ?? 'co_unmatched', 'Shared Labs', 'candidate.fixture.test'),
        targetDeck,
      ),
    );

    await createDeckWithStubs(source, stubResult(targetMarket, targetDeck, candidate, placeholder));

    expect(hydration.run).toHaveBeenCalledWith(expect.objectContaining({ companyId: undefined }));
  });

  it('keeps distinct profile URLs on a shared host as separate companies', async () => {
    const targetMarket = market('market_shared_host', 'Synthetic shared host');
    const targetDeck = deck('deck_shared_host', targetMarket.id);
    const existing = company('co_team_one', 'Team One', 'https://github.com/team-one');
    const incoming = company('co_team_two', 'Team Two', 'https://github.com/team-two');
    const source = snapshot(
      [existing],
      [card('card_team_one', targetDeck.id, existing.id)],
      targetMarket,
      targetDeck,
    );

    const { repo } = await refresh(source, [
      { card: card('card_team_two', targetDeck.id, incoming.id), company: incoming },
    ]);

    const cards = await repo.listCards(targetDeck.id);
    expect(cards.map((item) => item.company?.id)).toEqual(['co_team_one', 'co_team_two']);
  });

  it.each([
    {
      label: 'no domain evidence',
      existing: [company('co_existing', 'Same Name', null)],
      incoming: company('co_incoming', 'Same Name', null),
    },
    {
      label: 'only one side has a domain',
      existing: [company('co_existing', 'Same Name', 'one.fixture.test')],
      incoming: company('co_incoming', 'Same Name', null),
    },
    {
      label: 'different domains',
      existing: [company('co_existing', 'Same Name', 'one.fixture.test')],
      incoming: company('co_incoming', 'Same Name', 'two.fixture.test'),
    },
    {
      label: 'multiple dossiers share the candidate domain',
      existing: [
        company('co_existing_one', 'Same Name', 'shared.fixture.test'),
        company('co_existing_two', 'Same Name', 'https://www.shared.fixture.test/'),
      ],
      incoming: company('co_incoming', 'Same Name', 'http://shared.fixture.test/new'),
    },
  ])('keeps ambiguous identity distinct when $label', async ({ existing, incoming }) => {
    const targetMarket = market('market_ambiguous', 'Synthetic ambiguous market');
    const targetDeck = deck('deck_ambiguous', targetMarket.id);
    const source = snapshot(
      existing,
      existing.map((item, index) => card(`card_existing_${index}`, targetDeck.id, item.id)),
      targetMarket,
      targetDeck,
    );

    const { repo } = await refresh(source, [
      { card: card('card_incoming', targetDeck.id, incoming.id), company: incoming },
    ]);

    const cards = await repo.listCards(targetDeck.id);
    expect(cards.find((item) => item.card.id === 'card_incoming')?.company?.id).toBe('co_incoming');
    expect(new Set(cards.map((item) => item.company?.id))).toEqual(
      new Set([...existing.map((item) => item.id), 'co_incoming']),
    );
  });
});
