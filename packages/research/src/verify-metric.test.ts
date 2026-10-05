/**
 * Live metric verification — the write-back primitive behind the living deck.
 *
 * The video audit that motivated this feature caught the failure exactly:
 * OpenAI's card showed ARR $990M while the fact-check box under it said
 * "Contradicted — the real figure is $40B". The verdict lived in throwaway
 * component state; nothing ever revised the stored metric. These tests pin the
 * new contract: grounded evidence + citations → the stored figure REVISES,
 * freshness stamps, the company re-tiers, and a deck event fires. No evidence →
 * no successful-verification timestamp advances; only the attempt is recorded.
 */
import { describe, expect, it, vi } from 'vitest';
import type { Citation, DeckRefreshEvent } from '@mi/contracts';
import { GeminiRepository, type RepoSnapshot, type ResearchStore } from './repository';
import type { LlmClient } from './types';

describe('local verification original-source handoff', () => {
  it('spends its two original reads on priority sources, not the first two search links', async () => {
    const { store } = memoryStore(seededSnapshot());
    const client = stubClient({ citations: [
      { url: 'https://reddit.com/r/example', title: 'SEC filing', credibility: 'primary' },
      { url: 'https://retailer.example/report', title: 'Reuters', credibility: 'primary' },
      { url: 'https://reuters.com/report', title: 'Reporting' },
      { url: 'https://sec.gov/Archives/report', title: 'Filing' },
    ], structured: {} });
    const retrieve = vi.fn(async (url: string) => ({ requestedUrl: url, status: 'unavailable' as const, retrievedAt: new Date().toISOString() }));
    const repo = new GeminiRepository({ apiKey: 'k', store, client, originalSources: { retrieve, save: async () => {}, list: async () => [] } });
    await repo.verifyMetric({ companyId: 'cmp_openai', metricType: 'arr' });
    expect(retrieve.mock.calls.map(([url]) => url)).toEqual(['https://sec.gov/Archives/report', 'https://reuters.com/report']);
    expect(client.ground).toHaveBeenCalledTimes(1);
    expect(client.structure).not.toHaveBeenCalled();
  });
  it('returns retained source failures for inspection without another model call', async () => {
    const { store } = memoryStore(seededSnapshot());
    const client = stubClient({ citations: CITED, structured: {} });
    const receipt = { requestedUrl: CITED[0]!.url, status: 'blocked' as const,
      retrievedAt: '2026-10-05T00:00:00.000Z', reason: 'Browser source requires protected desktop retrieval.' };
    const repo = new GeminiRepository({ apiKey: 'k', store, client, originalSourceReader: async () => receipt });
    const result = await repo.verifyMetric({ companyId: 'cmp_openai', metricType: 'arr' });
    expect(result).toHaveProperty('originalSources', [receipt]);
    expect(client.structure).not.toHaveBeenCalled();
    const reopened = new GeminiRepository({ apiKey: 'k', store, client });
    expect((await reopened.getOriginalSourceEvidence({ companyId: 'cmp_openai', metricType: 'arr' }))[0]!.receipts).toEqual([receipt]);
  });
  it('retains browser-reader originals before synthesis and reloads detached scoped evidence', async () => {
    let committed = seededSnapshot();
    const quote = 'OpenAI reports ARR of USD 40 billion as of 2026-10-01.';
    const url = CITED[0]!.url;
    const store: ResearchStore = { read: () => structuredClone(committed), write: async snapshot => { committed = structuredClone(snapshot); } };
    const client = stubClient({ structured: { verdict: 'contradicted', currentValue: 40_000_000_000,
      passageSupport: { sourceUrl: url, quote, asOf: '2026-10-01', basis: 'arr', unit: 'USD' } } });
    const structure = client.structure;
    client.structure = vi.fn(async (prompt, schema, options) => {
      expect((committed as RepoSnapshot & { originalSourceAttempts?: unknown[] }).originalSourceAttempts).toHaveLength(1);
      return structure(prompt, schema, options);
    }) as LlmClient['structure'];
    const repo = new GeminiRepository({ apiKey: 'k', store, client, originalSourceReader: async () => ({ requestedUrl: url, finalUrl: url, status: 'retrieved', httpStatus: 200, contentHash: 'a'.repeat(64), text: quote, retrievedAt: '2026-10-03T00:00:00.000Z' }) });
    expect((await repo.verifyMetric({ companyId: 'cmp_openai', metricType: 'arr' })).metric.value).toBe(40_000_000_000);
    const reopened = new GeminiRepository({ apiKey: 'k', store, client, originalSourceReader: async () => { throw new Error('Offline reads must not fetch'); } });
    const evidence = await reopened.getOriginalSourceEvidence({ companyId: 'cmp_openai', metricType: 'arr' });
    expect(evidence).toHaveLength(1);
    expect(evidence[0]!.receipts[0]!.text).toBe(quote);
    evidence[0]!.receipts[0]!.text = 'External mutation';
    expect((await reopened.getOriginalSourceEvidence({ companyId: 'cmp_openai' }))[0]!.receipts[0]!.text).toBe(quote);
    expect(await reopened.getOriginalSourceEvidence({ companyId: 'other' })).toEqual([]);
  });
  it('refuses browser synthesis if local original retention fails', async () => {
    let committed = seededSnapshot();
    const store: ResearchStore = { read: () => structuredClone(committed), write: async snapshot => {
      if ((snapshot as RepoSnapshot & { originalSourceAttempts?: unknown[] }).originalSourceAttempts?.length) throw new Error('Original storage full');
      committed = structuredClone(snapshot);
    } };
    const client = stubClient({ structured: { verdict: 'contradicted', currentValue: 123 } });
    const repo = new GeminiRepository({ apiKey: 'k', store, client, originalSourceReader: async url => ({ requestedUrl: url, status: 'unavailable', retrievedAt: new Date().toISOString() }) });
    await expect(repo.verifyMetric({ companyId: 'cmp_openai', metricType: 'arr' })).rejects.toThrow('Original storage full');
    expect(client.structure).not.toHaveBeenCalled();
    expect((await repo.getCompanyMetrics('cmp_openai')).find(metric => metric.metricType === 'arr')!.value).toBe(990_000_000);
  });
  it('writes a supported native correction with its original URL and reported date', async () => {
    const { store } = memoryStore(seededSnapshot());
    const quote = 'OpenAI reports ARR of USD 40 billion as of 2026-10-01.';
    const url = CITED[0]!.url;
    const client = stubClient({ structured: { verdict: 'contradicted', currentValue: 40_000_000_000,
      passageSupport: { sourceUrl: url, quote, asOf: '2026-10-01', basis: 'arr', unit: 'USD' } } });
    const repo = new GeminiRepository({ apiKey: 'k', store, client, originalSources: {
      retrieve: async () => ({ requestedUrl: url, finalUrl: url, status: 'retrieved', httpStatus: 200, contentHash: 'a'.repeat(64), text: quote, retrievedAt: '2026-10-03T00:00:00.000Z' }),
      save: async () => {}, list: async () => [],
    } });
    const result = await repo.verifyMetric({ companyId: 'cmp_openai', metricType: 'arr' });
    expect(result.metric.value).toBe(40_000_000_000);
    expect(result.metric.source).toBe(url);
    expect(result.metric.methodNote).toContain('2026-10-01');
    expect(client.ground).toHaveBeenCalledTimes(1);
    expect(client.structure).toHaveBeenCalledTimes(1);
  });
  it('does not promote a credible citation without literal original passage support', async () => {
    const { store } = memoryStore(seededSnapshot());
    const client = stubClient({ structured: { verdict: 'contradicted', currentValue: 40_000_000_000 } });
    const repo = new GeminiRepository({ apiKey: 'k', store, client, originalSources: {
      retrieve: async (url) => ({ requestedUrl: url, status: 'unavailable', retrievedAt: new Date().toISOString() }),
      save: async () => {}, list: async () => [],
    } });
    const result = await repo.verifyMetric({ companyId: 'cmp_openai', metricType: 'arr', correction: { value: 40_000_000_000, citations: CITED } });
    expect(result.verdict).toBe('unverified');
    expect(result.metric.value).toBe(990_000_000);
    expect(client.ground).toHaveBeenCalledTimes(1);
    expect(client.structure).not.toHaveBeenCalled();
    expect(result.metric.lastVerificationAttemptAt).toBeTruthy();
  });
  it.each(['empty', 'unavailable', 'blank'] as const)('skips synthesis for %s originals and retains the attempt across reopen', async (kind) => {
    const { store } = memoryStore(seededSnapshot());
    const client = stubClient({ citations: kind === 'empty' ? [] : CITED,
      structured: { verdict: 'contradicted', currentValue: 123 } });
    const repo = new GeminiRepository({ apiKey: 'k', store, client,
      originalSourceReader: async url => ({ requestedUrl: url,
        status: kind === 'blank' ? 'retrieved' : 'unavailable',
        ...(kind === 'blank' ? { text: '   ', finalUrl: url, httpStatus: 200, contentHash: 'a'.repeat(64) } : {}),
        retrievedAt: new Date().toISOString() }) });
    const result = await repo.verifyMetric({ companyId: 'cmp_openai', metricType: 'arr' });
    expect(result.verdict).toBe('unverified');
    expect(result.metric.value).toBe(990_000_000);
    expect(client.ground).toHaveBeenCalledTimes(1);
    expect(client.structure).not.toHaveBeenCalled();
    const reopened = new GeminiRepository({ apiKey: 'k', store, client });
    expect(await reopened.getOriginalSourceEvidence({ companyId: 'cmp_openai', metricType: 'arr' })).toHaveLength(1);
    expect((await reopened.getCompanyMetrics('cmp_openai')).find(metric => metric.metricType === 'arr')!.lastVerificationAttemptAt).toBeTruthy();
  });
  it('saves company-scoped originals before interpretation and supplies their text', async () => {
    const { store } = memoryStore(seededSnapshot());
    const client = stubClient({ structured: { verdict: 'unverified', currentValue: null } });
    const save = vi.fn(async () => {});
    const retrieve = vi.fn(async (url: string) => ({ requestedUrl: url, finalUrl: url, status: 'retrieved' as const, retrievedAt: new Date().toISOString(), contentHash: 'a'.repeat(64), text: 'Original reported revenue passage.' }));
    const repo = new GeminiRepository({ apiKey: 'k', store, client, originalSources: { retrieve, save, list: async () => [] } });
    await repo.verifyMetric({ companyId: 'cmp_openai', metricType: 'arr' });
    expect(save).toHaveBeenCalledWith(expect.objectContaining({ companyId: 'cmp_openai', metricType: 'arr', receipts: [expect.objectContaining({ text: 'Original reported revenue passage.' })] }));
    expect(retrieve).toHaveBeenCalledWith(expect.any(String), { companyId: 'cmp_openai', companyName: 'OpenAI', metricType: 'arr' });
    expect(save.mock.invocationCallOrder[0]).toBeLessThan(vi.mocked(client.structure).mock.invocationCallOrder[0]!);
    expect(vi.mocked(client.structure).mock.calls[0]![0]).toContain('UNTRUSTED ORIGINAL EXTRACTS');
    expect(vi.mocked(client.structure).mock.calls[0]![0]).toContain('Original reported revenue passage.');
  });

  it('does not interpret or revise a metric when the artifact cannot be saved', async () => {
    const { store } = memoryStore(seededSnapshot());
    const client = stubClient({ structured: { verdict: 'contradicted', currentValue: 123 } });
    const repo = new GeminiRepository({ apiKey: 'k', store, client, originalSources: {
      retrieve: async (url) => ({ requestedUrl: url, status: 'unavailable', retrievedAt: new Date().toISOString() }),
      save: async () => { throw new Error('Cannot save original evidence'); }, list: async () => [],
    } });
    await expect(repo.verifyMetric({ companyId: 'cmp_openai', metricType: 'arr' })).rejects.toThrow('Cannot save original evidence');
    expect(client.structure).not.toHaveBeenCalled();
    expect((await repo.getCompanyMetrics('cmp_openai')).find((m) => m.metricType === 'arr')!.value).toBe(990_000_000);
  });
});

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
  it('retains scoped grounded notes even when structuring fails', async () => {
    const { store } = memoryStore(seededSnapshot());
    const client = stubClient({ groundText: 'An original report needs further review.', structured: {} });
    vi.mocked(client.structure).mockRejectedValueOnce(new Error('Invalid structured response'));
    const repo = new GeminiRepository({ apiKey: 'k', store, client });
    await expect(repo.verifyMetric({ companyId: 'cmp_openai', metricType: 'arr' })).rejects.toThrow('Invalid structured response');
    const persisted = store.read()!;
    expect(persisted.researchEvidence).toEqual(expect.arrayContaining([
      expect.objectContaining({ companyId: 'cmp_openai', companyName: 'OpenAI', topic: 'verify:arr',
        text: 'An original report needs further review.' }),
    ]));
    expect(persisted.metrics.find((m) => m.metricType === 'arr')!.value).toBe(990_000_000);
  });

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

  it('confirms an estimated figure: support attaches, value stays, and views reconcile', async () => {
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

    expect(result.changed).toBe(true);
    expect(result.metric.value).toBe(990_000_000);
    expect(result.metric.confidence).toBe('verified');
    expect(result.metric.citations).toEqual(CITED);
    expect(result.metric.lastVerifiedAt).toBeTruthy();
    expect(events).toHaveLength(1);
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

  it('does not revise from a forged high-credibility citation', async () => {
    const { store } = memoryStore(seededSnapshot());
    const client = stubClient({ citations: [{ url: 'https://reddit.com/r/stocks/example', title: 'SEC filing', credibility: 'primary' }],
      structured: { verdict: 'contradicted', currentValue: 40_000_000_000, rationale: 'Claimed correction', methodNote: null } });
    const repo = new GeminiRepository({ apiKey: 'k', store, client });
    const result = await repo.verifyMetric({ companyId: 'cmp_openai', metricType: 'arr' });
    expect(result.verdict).toBe('unverified');
    expect(result.changed).toBe(false);
    expect(result.metric.value).toBe(990_000_000);
    expect(result.metric.lastVerifiedAt).toBeFalsy();
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

  it('records an inconclusive attempt without claiming successful verification', async () => {
    const { store } = memoryStore(seededSnapshot());
    const client = stubClient({
      structured: { verdict: 'unverified', currentValue: null, rationale: 'No reliable figure.', methodNote: null },
    });
    const repo = new GeminiRepository({ apiKey: 'k', store, client });

    const result = await repo.verifyMetric({ companyId: 'cmp_openai', metricType: 'arr' });

    expect(result.changed).toBe(false);
    expect(result.verdict).toBe('unverified');
    expect(result.metric.value).toBe(990_000_000);
    expect(result.metric.lastVerifiedAt).toBeFalsy();
    expect(result.metric).toHaveProperty('lastVerificationAttemptAt', expect.any(String));
  });

  it.each([
    { verdict: 'unverified', currentValue: 40_000_000_000, citations: CITED },
    { verdict: 'supported', currentValue: null, citations: CITED },
    { verdict: 'supported', currentValue: 990_000_000, citations: [] },
    { verdict: 'supported', currentValue: 40_000_000_000, citations: CITED },
    { verdict: 'contradicted', currentValue: -10, citations: CITED },
  ])('rejects an unsupported verification outcome: $verdict / $currentValue', async ({ verdict, currentValue, citations }) => {
    const snap = seededSnapshot();
    const arr = snap.metrics.find((m) => m.metricType === 'arr')!;
    const priorCapture = arr.capturedAt;
    const priorVerification = '2026-01-01T00:00:00.000Z';
    arr.lastVerifiedAt = priorVerification;
    const { store } = memoryStore(snap);
    const client = stubClient({ citations, structured: { verdict, currentValue, rationale: 'Inconclusive', methodNote: null } });
    const repo = new GeminiRepository({ apiKey: 'k', store, client });

    const result = await repo.verifyMetric({ companyId: 'cmp_openai', metricType: 'arr' });

    expect(result.metric.value).toBe(990_000_000);
    expect(result.metric.confidence).toBe('estimated');
    expect(result.metric.capturedAt).toBe(priorCapture);
    expect(result.metric.lastVerifiedAt).toBe(priorVerification);
    expect(result.verdict).toBe('unverified');
    expect(result.changed).toBe(false);
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
  it.each([-1, Number.NaN, Number.POSITIVE_INFINITY])('rejects invalid shortcut values: %s', async (value) => {
    const { store } = memoryStore(seededSnapshot());
    const client = stubClient({ structured: { verdict: 'unverified', currentValue: null } });
    const repo = new GeminiRepository({ apiKey: 'k', store, client });
    const result = await repo.verifyMetric({ companyId: 'cmp_openai', metricType: 'arr',
      correction: { value, citations: CITED } });
    expect(result.metric.value).toBe(990_000_000);
    expect(result.verdict).toBe('unverified');
    expect(client.ground).toHaveBeenCalledTimes(1);
  });

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
