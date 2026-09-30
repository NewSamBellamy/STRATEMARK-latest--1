/**
 * Live metric verification — the write-back primitive behind the living deck.
 *
 * The video audit that motivated this feature caught the failure exactly:
 * OpenAI's card showed ARR $990M while the fact-check box under it said
 * "Contradicted — the real figure is $40B". The verdict lived in throwaway
 * component state; nothing ever revised the stored metric. These tests pin the
 * new contract: grounded evidence + citations → the stored figure REVISES,
 * freshness stamps, the company re-tiers, and a deck event fires. No evidence →
 * nothing changes but the verification timestamp.
 */
import { describe, expect, it, vi } from 'vitest';
import type { Citation, DeckRefreshEvent } from '@mi/contracts';
import { GeminiRepository, type RepoSnapshot, type ResearchStore } from './repository';
import type { LlmClient } from './types';

function seededSnapshot(): RepoSnapshot {
  const now = new Date().toISOString();
  return {
    schemaVersion: 2,
    markets: [
      {
        id: 'mkt_1',
        name: 'Frontier AI',
        scopeDefinition: { vertical: 'AI', geography: 'Global', inclusions: [], exclusions: [] },
        refreshCadence: 'weekly',
        createdAt: now,
        lastRefreshedAt: now,
      },
    ],
    decks: [{ id: 'deck_1', marketId: 'mkt_1', generatedAt: now, cardCount: 1 }],
    companies: [
      {
        id: 'cmp_openai',
        name: 'OpenAI',
        oneLiner: 'Frontier AI research and deployment company.',
        websiteUrl: 'https://openai.com',
        logoUrl: null,
        hqLocation: 'San Francisco, CA',
        foundedYear: 2015,
        isPublic: false,
      },
    ],
    metrics: [
      {
        id: 'met_arr',
        companyId: 'cmp_openai',
        metricType: 'arr',
        value: 990_000_000,
        confidence: 'estimated',
        source: null,
        citations: [],
        methodNote: 'Headcount proxy estimate',
        capturedAt: now,
      },
      {
        id: 'met_users',
        companyId: 'cmp_openai',
        metricType: 'users',
        value: 1_000_000_000,
        confidence: 'user_verified',
        source: 'Confirmed by the analyst',
        citations: [],
        methodNote: null,
        capturedAt: now,
      },
    ],
    cards: [
      {
        id: 'card_openai',
        deckId: 'deck_1',
        companyId: 'cmp_openai',
        cardType: 'company',
        title: null,
        summary: null,
        tier: 5,
        tierReason: null,
        citations: [],
      },
    ],
    viceClaims: [],
    dashboards: { cmp_openai: { overview: { content: {}, lastRefreshedAt: now } } },
    companyMarket: { cmp_openai: 'Frontier AI' },
    opportunity: {},
    reports: [],
    savedCards: [],
    researchJobs: [],
    threads: [],
  } as unknown as RepoSnapshot;
}

function memoryStore(initial: RepoSnapshot): { store: ResearchStore; written: RepoSnapshot[] } {
  let data: RepoSnapshot | null = initial;
  const written: RepoSnapshot[] = [];
  return {
    written,
    store: {
      read: () => data,
      write: (snap: RepoSnapshot) => {
        data = snap;
        written.push(JSON.parse(JSON.stringify(snap)) as RepoSnapshot);
      },
    },
  };
}

const CITED: Citation[] = [
  { title: 'reuters.com', url: 'https://reuters.com/openai-arr', credibility: 'reputable_secondary' },
];

function stubClient(overrides: {
  groundText?: string;
  citations?: Citation[];
  structured: Record<string, unknown>;
}): LlmClient {
  return {
    ground: vi.fn().mockResolvedValue({
      text: overrides.groundText ?? 'notes',
      citations: overrides.citations ?? CITED,
      queries: ['q'],
    }),
    structure: vi.fn().mockResolvedValue(overrides.structured),
  } as unknown as LlmClient;
}

describe('verifyMetric', () => {
  it('revises a contradicted figure with citations, re-tiers, and emits a deck event', async () => {
    const { store } = memoryStore(seededSnapshot());
    const client = stubClient({
      structured: {
        verdict: 'contradicted',
        currentValue: 40_000_000_000,
        rationale: 'Reported ARR reached $40B by mid-2026.',
        methodNote: 'Reuters reporting, July 2026',
      },
    });
    const repo = new GeminiRepository({ apiKey: 'k', store, client });
    const events: DeckRefreshEvent[] = [];
    repo.subscribeDeckRefresh((e) => events.push(e));

    const result = await repo.verifyMetric({ companyId: 'cmp_openai', metricType: 'arr' });

    expect(result.changed).toBe(true);
    expect(result.verdict).toBe('contradicted');
    expect(result.metric.value).toBe(40_000_000_000);
    expect(result.metric.confidence).toBe('verified');
    expect(result.metric.citations.length).toBeGreaterThan(0);
    expect(result.metric.lastVerifiedAt).toBeTruthy();
    // The deck heard about it — open UIs reconcile without a manual refresh.
    expect(events).toHaveLength(1);
    expect(events[0]?.updatedCardIds.length).toBeGreaterThan(0);
    // The stale cached dashboard research was invalidated.
    const persisted = store.read() as RepoSnapshot;
    expect(persisted.dashboards['cmp_openai']).toEqual({});
  });

  it('confirms a supported figure: freshness stamps, value untouched, no event', async () => {
    const { store } = memoryStore(seededSnapshot());
    const client = stubClient({
      structured: {
        verdict: 'supported',
        currentValue: 990_000_000, // same figure → within tolerance
        rationale: 'Coverage supports the stored figure.',
        methodNote: null,
      },
    });
    const repo = new GeminiRepository({ apiKey: 'k', store, client });
    const events: DeckRefreshEvent[] = [];
    repo.subscribeDeckRefresh((e) => events.push(e));

    const result = await repo.verifyMetric({ companyId: 'cmp_openai', metricType: 'arr' });

    expect(result.changed).toBe(false);
    expect(result.metric.value).toBe(990_000_000);
    expect(result.metric.confidence).toBe('estimated'); // unchanged
    expect(result.metric.lastVerifiedAt).toBeTruthy(); // but freshness recorded
    expect(events).toHaveLength(0);
  });

  it('can correct the footprint basis even when the number itself is unchanged', async () => {
    const initial = seededSnapshot();
    const users = initial.metrics.find((metric) => metric.metricType === 'users')!;
    users.confidence = 'estimated';
    users.userBasis = 'unknown';
    const { store } = memoryStore(initial);
    const client = stubClient({
      structured: {
        verdict: 'supported',
        currentValue: 1_000_000_000,
        rationale: 'The reported count is still current.',
        methodNote: 'Reuters reports one billion monthly active users.',
        userBasis: 'monthly_active_users',
      },
    });
    const repo = new GeminiRepository({ apiKey: 'k', store, client });

    const result = await repo.verifyMetric({ companyId: 'cmp_openai', metricType: 'users' });

    expect(result.metric.value).toBe(1_000_000_000);
    expect(result.metric.userBasis).toBe('monthly_active_users');
    expect(result.changed).toBe(true);
  });

  it('NEVER revises without citations, even when a figure is offered (no-fabrication)', async () => {
    const { store } = memoryStore(seededSnapshot());
    const client = stubClient({
      citations: [], // grounded pass returned no usable sources
      structured: {
        verdict: 'contradicted',
        currentValue: 123_000_000_000,
        rationale: 'A figure with nothing behind it.',
        methodNote: null,
      },
    });
    const repo = new GeminiRepository({ apiKey: 'k', store, client });

    const result = await repo.verifyMetric({ companyId: 'cmp_openai', metricType: 'arr' });

    expect(result.changed).toBe(false);
    expect(result.metric.value).toBe(990_000_000); // untouched
  });

  it('never overwrites a user_verified figure — the human outranks the machine', async () => {
    const { store } = memoryStore(seededSnapshot());
    const client = stubClient({
      structured: {
        verdict: 'contradicted',
        currentValue: 700_000_000,
        rationale: 'Coverage names a lower figure.',
        methodNote: 'Some outlet',
      },
    });
    const repo = new GeminiRepository({ apiKey: 'k', store, client });

    const result = await repo.verifyMetric({ companyId: 'cmp_openai', metricType: 'users' });

    expect(result.changed).toBe(false);
    expect(result.metric.value).toBe(1_000_000_000);
    expect(result.metric.confidence).toBe('user_verified');
  });

  it('downgrades a stored Verified badge that live research can no longer corroborate', async () => {
    // The two-truth-systems contradiction caught on video: chip says
    // "5K ✓ Verified" while the fact-check beside it says "Unverified".
    // Rule: a verified figure that cannot be re-corroborated keeps its value
    // but honestly drops to 'estimated' with an audit note.
    const snap = seededSnapshot();
    const arr = (snap as unknown as { metrics: Array<{ metricType: string; confidence: string }> })
      .metrics.find((m) => m.metricType === 'arr')!;
    arr.confidence = 'verified';
    const { store } = memoryStore(snap);
    const client = stubClient({
      structured: { verdict: 'unverified', currentValue: null, rationale: 'No official corroboration.', methodNote: null },
    });
    const repo = new GeminiRepository({ apiKey: 'k', store, client });

    const result = await repo.verifyMetric({ companyId: 'cmp_openai', metricType: 'arr' });

    expect(result.changed).toBe(true);
    expect(result.metric.value).toBe(990_000_000); // value untouched
    expect(result.metric.confidence).toBe('estimated'); // badge honestly downgraded
    expect(result.metric.methodNote).toContain('Could not re-corroborate');
  });

  it('treats an inconclusive check as timestamp-only', async () => {
    const { store } = memoryStore(seededSnapshot());
    const client = stubClient({
      structured: { verdict: 'unverified', currentValue: null, rationale: 'No reliable figure.', methodNote: null },
    });
    const repo = new GeminiRepository({ apiKey: 'k', store, client });

    const result = await repo.verifyMetric({ companyId: 'cmp_openai', metricType: 'arr' });

    expect(result.changed).toBe(false);
    expect(result.verdict).toBe('unverified');
    expect(result.metric.value).toBe(990_000_000);
    expect(result.metric.lastVerifiedAt).toBeTruthy();
  });
});

describe('factCheck metric corrections', () => {
  it('carries a corrected value only when citations exist', async () => {
    const { store } = memoryStore(seededSnapshot());
    const client = stubClient({
      structured: {
        verdict: 'contradicted',
        rationale: 'ARR reached $40B by mid-2026.',
        correctedValue: 40_000_000_000,
        correctedAsOf: '2026-07-31',
      },
    });
    const repo = new GeminiRepository({ apiKey: 'k', store, client });
    const result = await repo.factCheck({
      claim: "OpenAI's ARR is $990.0M",
      companyName: 'OpenAI',
      companyId: 'cmp_openai',
      metricType: 'arr',
      storedValue: 990_000_000,
    });
    expect(result.verdict).toBe('contradicted');
    expect(result.correctedValue).toBe(40_000_000_000);
    expect(result.correctedAsOf).toBe('2026-07-31');
  });

  it('suppresses a correction when the grounded pass produced no citations', async () => {
    const { store } = memoryStore(seededSnapshot());
    const client = stubClient({
      citations: [],
      structured: {
        verdict: 'contradicted',
        rationale: 'Unsourced.',
        correctedValue: 40_000_000_000,
        correctedAsOf: null,
      },
    });
    const repo = new GeminiRepository({ apiKey: 'k', store, client });
    const result = await repo.factCheck({
      claim: "OpenAI's ARR is $990.0M",
      companyName: 'OpenAI',
      metricType: 'arr',
      storedValue: 990_000_000,
    });
    expect(result.correctedValue).toBeNull();
  });
});

describe('verifyMetric fast-path correction (fact-check evidence applied directly)', () => {
  it('applies a cited correction with ZERO research calls — the latency fix', async () => {
    const { store } = memoryStore(seededSnapshot());
    const client = stubClient({ structured: {} });
    const repo = new GeminiRepository({ apiKey: 'k', store, client });

    const result = await repo.verifyMetric({
      companyId: 'cmp_openai',
      metricType: 'arr',
      correction: {
        value: 40_000_000_000,
        citations: CITED,
        rationale: 'Reuters reports $40B ARR as of Aug 2026.',
        asOf: '2026-08-01',
      },
    });

    // The whole point: no second grounded hunt.
    expect((client.ground as ReturnType<typeof vi.fn>)).not.toHaveBeenCalled();
    expect((client.structure as ReturnType<typeof vi.fn>)).not.toHaveBeenCalled();
    expect(result.changed).toBe(true);
    expect(result.verdict).toBe('contradicted');
    expect(result.metric.value).toBe(40_000_000_000);
    expect(result.metric.confidence).toBe('verified');
    expect(result.metric.citations.length).toBeGreaterThan(0);
  });

  it('a junk-cited correction falls through to the FULL re-research (never applied blind)', async () => {
    const { store } = memoryStore(seededSnapshot());
    const client = stubClient({
      citations: CITED,
      structured: { verdict: 'unverified', currentValue: null, rationale: '', methodNote: null },
    });
    const repo = new GeminiRepository({ apiKey: 'k', store, client });

    await repo.verifyMetric({
      companyId: 'cmp_openai',
      metricType: 'arr',
      correction: {
        value: 123,
        citations: [{ title: 'fatjoe.com', url: 'https://fatjoe.com/seo/openai' }],
      },
    });

    // Junk evidence bought nothing: the full grounded pass ran instead.
    expect((client.ground as ReturnType<typeof vi.fn>)).toHaveBeenCalledTimes(1);
    const metrics = await repo.getCompanyMetrics('cmp_openai');
    expect(metrics.find((m) => m.metricType === 'arr')!.value).toBe(990_000_000);
  });

  it('never overwrites a user-verified figure, even with clean citations', async () => {
    const { store } = memoryStore(seededSnapshot());
    const client = stubClient({
      structured: { verdict: 'supported', currentValue: null, rationale: '', methodNote: null },
    });
    const repo = new GeminiRepository({ apiKey: 'k', store, client });

    await repo.verifyMetric({
      companyId: 'cmp_openai',
      metricType: 'users',
      correction: { value: 5, citations: CITED },
    });

    const metrics = await repo.getCompanyMetrics('cmp_openai');
    const users = metrics.find((m) => m.metricType === 'users')!;
    expect(users.value).toBe(1_000_000_000);
    expect(users.confidence).toBe('user_verified');
  });
});
