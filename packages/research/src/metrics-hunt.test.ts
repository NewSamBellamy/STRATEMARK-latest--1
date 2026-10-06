/**
 * huntCompanyMetrics — the "find more metrics" button.
 *
 * One grounded pass hunts every SOFT figure (missing rows, unknowns,
 * unverified estimates), writes back only what verification-grade sources
 * support, and never touches human- or machine-verified rows.
 */
import { describe, expect, it, vi } from 'vitest';
import { GeminiRepository, type RepoSnapshot, type ResearchStore } from './repository';
import type { LlmClient } from './types';
import type { OriginalSourceReceipt } from './original-source';

function snapshot(): RepoSnapshot {
  const now = new Date().toISOString();
  return {
    schemaVersion: 2,
    markets: [],
    decks: [],
    companies: [
      {
        id: 'cmp_1',
        name: 'OpenAI',
        oneLiner: 'Frontier AI research and deployment company.',
        websiteUrl: 'https://openai.com',
        logoUrl: null,
        hqLocation: 'San Francisco, CA',
        brandTheme: null,
      },
    ],
    metrics: [
      {
        id: 'met_arr',
        companyId: 'cmp_1',
        metricType: 'arr',
        value: 13_000_000_000,
        confidence: 'verified', // verified → NOT a hunt target
        source: 'https://reuters.com/x',
        citations: [{ title: 'reuters.com', url: 'https://reuters.com/x' }],
        methodNote: null,
        capturedAt: now,
        lastVerifiedAt: now,
        staleAfterSeconds: 86_400,
      },
      {
        id: 'met_users',
        companyId: 'cmp_1',
        metricType: 'users',
        value: 700_000_000,
        confidence: 'user_verified', // human ground truth → never touched
        source: 'Analyst confirmed',
        citations: [],
        methodNote: null,
        capturedAt: now,
      },
      {
        id: 'met_emp',
        companyId: 'cmp_1',
        metricType: 'employees',
        value: null,
        confidence: 'unknown', // unknown → hunt target
        source: null,
        citations: [],
        methodNote: null,
        capturedAt: now,
      },
      // market_cap, valuation, market_share rows MISSING entirely → hunt targets
    ],
    cards: [],
    viceClaims: [],
    dashboards: {},
    companyMarket: { cmp_1: 'Frontier AI' },
    opportunity: {},
    reports: [],
    savedCards: [],
    researchJobs: [],
    threads: [],
  } as unknown as RepoSnapshot;
}

function memoryStore(initial: RepoSnapshot): ResearchStore {
  let data: RepoSnapshot | null = initial;
  return {
    read: () => data,
    write: (snap: RepoSnapshot) => {
      data = snap;
    },
  };
}

function repoWith(client: LlmClient): GeminiRepository {
  return new GeminiRepository({ apiKey: 'k', store: memoryStore(snapshot()), client });
}

it('keeps annual filing routing for missing workforce even when revenue is already protected', async () => {
  const snap = snapshot();
  snap.companies[0]!.name = 'Microsoft Corporation';
  snap.companies[0]!.websiteUrl = 'https://microsoft.com';
  snap.metrics[0]!.confidence = 'user_verified';
  const concept = 'https://data.sec.gov/api/xbrl/companyconcept/CIK0000789019/us-gaap/RevenueFromContractWithCustomerExcludingAssessedTax.json';
  const index = 'https://www.sec.gov/Archives/edgar/data/789019/000119312526323660/0001193125-26-323660-index.htm';
  const document = index.replace('0001193125-26-323660-index.htm', 'msft-20260630.htm');
  const read = vi.fn(async (url: string): Promise<OriginalSourceReceipt> => ({ requestedUrl: url, finalUrl: url,
    status: 'retrieved', httpStatus: 200, contentHash: 'a'.repeat(64), retrievedAt: '2026-10-06T00:00:00.000Z',
    ...(url === concept ? { format: 'sec-companyconcept', truncated: false, text: JSON.stringify({
      cik: 789019, entityName: 'MICROSOFT CORPORATION', taxonomy: 'us-gaap', tag: 'RevenueFromContractWithCustomerExcludingAssessedTax',
      units: { USD: [{ start: '2025-07-01', end: '2026-06-30', val: 331839000000, accn: '0001193125-26-323660',
        form: '10-K', filed: '2026-07-29', fp: 'FY' }] } }) }
      : url === index ? { finalUrl: document, format: 'sec-filing', truncated: false, issuerName: 'MICROSOFT CORPORATION',
        text: 'As of June 30, 2026, we employed approximately 223,000 people on a full-time basis, 121,000 in the U.S. and 102,000 internationally.' }
        : { text: 'Investor navigation. No current disclosure here.' }) }));
  const ground = vi.fn(async () => ({ text: 'Original source: https://www.sec.gov/edgar/browse/?CIK=0000789019',
    citations: Array.from({ length: 4 }, (_, i) => ({ url: `https://microsoft.com/investor/page-${i}`, title: 'Investor menu' })), queries: [] }));
  const client: LlmClient = { ground, structure: async (_prompt, schema) => schema.parse({ figures: [] }) };
  const repo = new GeminiRepository({ apiKey: 'k', store: memoryStore(snap), client, originalSourceReader: read });
  const result = await repo.huntCompanyMetrics('cmp_1');
  expect(result.filledTypes).toEqual(['employees']);
  expect(read.mock.calls.map(([url]) => url)).toContain(index);
  expect(read).toHaveBeenCalledTimes(4);
  expect((await repo.getCompanyFacts('cmp_1')).find(m => m.metricType === 'employees'))
    .toMatchObject({ value: 223000, confidence: 'verified' });
});

describe('huntCompanyMetrics — one pass fills every soft figure', () => {
  it('retains a full-sized regulator receipt and publishes its annual observation after reopening', async () => {
    const snap = snapshot();
    snap.companies[0]!.name = 'Microsoft Corporation';
    snap.companies[0]!.websiteUrl = 'https://microsoft.com';
    snap.metrics = [];
    const filing = 'https://www.sec.gov/Archives/edgar/data/789019/000119312526323660/msft.htm';
    snap.originalSourceAttempts = [{ id: 'prior_financial', companyId: 'cmp_1', metricType: 'metrics_hunt',
      capturedAt: '2026-10-01T00:00:00.000Z', receipts: [{ requestedUrl: filing, finalUrl: filing,
        status: 'retrieved', httpStatus: 200, text: 'Previous filing locator, not current proof.',
        contentHash: 'b'.repeat(64), retrievedAt: '2026-10-01T00:00:00.000Z' }] }];
    const conceptUrl = 'https://data.sec.gov/api/xbrl/companyconcept/CIK0000789019/us-gaap/RevenueFromContractWithCustomerExcludingAssessedTax.json';
    const text = JSON.stringify({ cik: 789019, entityName: 'MICROSOFT CORPORATION', taxonomy: 'us-gaap',
      tag: 'RevenueFromContractWithCustomerExcludingAssessedTax', description: 'Public concept metadata. '.repeat(1000),
      units: { USD: [{ start: '2025-07-01', end: '2026-06-30', val: 331839000000,
        accn: '0001193125-26-323660', fy: 2026, fp: 'FY', form: '10-K', filed: '2026-07-29' }] } });
    expect(text.length).toBeGreaterThan(20000);
    const ground = vi.fn(async () => ({ text: 'Search hub only.', citations: [{ title: 'SEC', url: 'https://www.sec.gov/edgar/searchedgar/companysearch' }], queries: [] }));
    const structure = vi.fn(async (_prompt, schema) => schema.parse({ figures: [] })) as LlmClient['structure'];
    const store = memoryStore(snap);
    const reader = vi.fn(async (url: string) => url === conceptUrl ? ({ requestedUrl: url, finalUrl: conceptUrl, status: 'retrieved' as const,
      httpStatus: 200, text, format: 'sec-companyconcept' as const, contentHash: 'a'.repeat(64), retrievedAt: new Date().toISOString() })
      : ({ requestedUrl: url, status: 'unavailable' as const, retrievedAt: new Date().toISOString() }));
    const repo = new GeminiRepository({ apiKey: 'k', store, client: { ground, structure }, originalSourceReader: reader });
    expect((await repo.huntCompanyMetrics('cmp_1')).filledTypes).toEqual(['arr']);
    expect(reader.mock.calls.map(call => call[0])).toContain(conceptUrl);
    expect(reader.mock.calls.length).toBeLessThanOrEqual(4);
    const reopened = new GeminiRepository({ apiKey: 'k', store, client: { ground, structure }, originalSourceReader: reader });
    expect((await reopened.getCompanyFacts('cmp_1')).find(row => row.metricType === 'arr')).toMatchObject({
      value: 331839000000, confidence: 'verified', passageSupport: { definition: 'annual_revenue' },
    });
    expect(ground).toHaveBeenCalledTimes(1);
  });
  it('does not spend a hunt on accepted original-backed facts or human corrections', async () => {
    const snap = snapshot();
    const url = 'https://reuters.com/report';
    const quote = 'OpenAI reported 3500 employees as of 2026-10-01.';
    snap.metrics = (['arr', 'users', 'employees', 'valuation', 'market_cap', 'market_share'] as const).map(metricType => ({
      ...snap.metrics[2]!, id: `supported_${metricType}`, metricType,
      value: metricType === 'market_share' ? 20 : 3500,
      confidence: metricType === 'employees' ? 'verified' as const : 'user_verified' as const,
      ...(metricType === 'employees' ? { passageSupport: {
        sourceUrl: url, quote, asOf: '2026-10-01', basis: 'employees' as const, unit: 'count' as const,
      } } : {}),
    }));
    snap.originalSourceAttempts = [{ id: 'src_supported', companyId: 'cmp_1', metricType: 'employees',
      capturedAt: '2026-10-06T00:00:00.000Z', receipts: [{ requestedUrl: url, finalUrl: url, status: 'retrieved',
        httpStatus: 200, text: quote, contentHash: 'a'.repeat(64), retrievedAt: '2026-10-06T00:00:00.000Z' }] }];
    const ground = vi.fn();
    const structure = vi.fn();
    const reader = vi.fn();
    const repo = new GeminiRepository({ apiKey: 'k', store: memoryStore(snap), client: { ground, structure }, originalSourceReader: reader });
    expect((await repo.getCompanyFacts('cmp_1')).find(row => row.metricType === 'employees')?.value).toBe(3500);
    expect((await repo.huntCompanyMetrics('cmp_1')).filledTypes).toEqual([]);
    expect(ground).not.toHaveBeenCalled();
    expect(reader).not.toHaveBeenCalled();
  });
  it('repairs legacy verified rows that the original-backed display correctly rejects', async () => {
    const snap = snapshot();
    const base = snap.metrics[2]!;
    snap.metrics = (['arr', 'users', 'employees', 'valuation', 'market_cap', 'market_share'] as const).map(metricType => ({
      ...base, id: `legacy_${metricType}`, metricType, value: metricType === 'market_share' ? 20 : 4000,
      confidence: metricType === 'users' ? 'user_verified' as const : 'verified' as const,
    }));
    const url = 'https://reuters.com/report';
    const quote = 'OpenAI reported 3500 employees as of 2026-10-01.';
    const ground = vi.fn(async (_prompt: string) => ({ text: 'Research', citations: [{ title: 'Reuters', url }], queries: [] }));
    const structure = vi.fn(async (_prompt, schema) => schema.parse({ figures: [{
      metricType: 'employees', value: 3500,
      passageSupport: { sourceUrl: url, quote, asOf: '2026-10-01', basis: 'employees', unit: 'count' },
    }] })) as LlmClient['structure'];
    const repo = new GeminiRepository({ apiKey: 'k', store: memoryStore(snap), client: { ground, structure },
      originalSourceReader: async requestedUrl => ({ requestedUrl, finalUrl: url, status: 'retrieved',
        httpStatus: 200, text: quote, contentHash: 'a'.repeat(64), retrievedAt: '2026-10-06T00:00:00.000Z' }),
    });
    expect((await repo.getCompanyFacts('cmp_1')).find(row => row.metricType === 'employees')?.value).toBeNull();
    const result = await repo.huntCompanyMetrics('cmp_1');
    expect(ground).toHaveBeenCalledTimes(1);
    expect(ground.mock.calls[0]![0]).not.toContain('- Users');
    expect(result.filledTypes).toEqual(['employees']);
    expect((await repo.getCompanyFacts('cmp_1')).find(row => row.metricType === 'employees')).toMatchObject({ value: 3500, confidence: 'verified' });
    expect(result.metrics.find(row => row.metricType === 'users')).toMatchObject({ value: 4000, confidence: 'user_verified' });
  });
  it('excludes human-protected duplicates while still filling an unrelated soft field', async () => {
    const snap = snapshot();
    snap.metrics.push({ ...snap.metrics[2]!, id: 'human_employees', value: 4000, confidence: 'user_verified' });
    const ground = vi.fn().mockResolvedValue({ text: 'Research', citations: [{ url: 'https://reuters.com/report', title: 'Reuters' }], queries: [] });
    const structure = vi.fn().mockResolvedValue({ figures: [{ metricType: 'employees', value: 3500 }, { metricType: 'valuation', value: 5e11 }] });
    const repo = new GeminiRepository({ apiKey: 'k', store: memoryStore(snap), client: { ground, structure } as unknown as LlmClient });
    const result = await repo.huntCompanyMetrics('cmp_1');
    expect(result.filledTypes).toEqual(['valuation']);
    expect(result.metrics.find(m => m.id === 'met_emp')!.value).toBeNull();
    expect(result.metrics.find(m => m.id === 'human_employees')!.value).toBe(4000);
    expect(ground.mock.calls[0]![0]).not.toContain('- Employees');
  });

  it('does not refill a figure cleared while a hunt was in flight', async () => {
    const client = { ground: vi.fn().mockResolvedValue({ text: 'Research', citations: [{ url: 'https://reuters.com/report', title: 'Reuters' }], queries: [] }),
      structure: vi.fn() } as unknown as LlmClient;
    const repo = repoWith(client);
    vi.mocked(client.structure).mockImplementationOnce(async () => {
      await repo.overrideMetric({ companyId: 'cmp_1', metricType: 'employees', value: null, note: 'Wrong company' });
      return { figures: [{ metricType: 'employees', value: 3500, methodNote: 'Old request' }] };
    });
    const result = await repo.huntCompanyMetrics('cmp_1');
    expect(result.filledTypes).toEqual([]);
    expect(result.metrics.find(m => m.metricType === 'employees')!.value).toBeNull();
  });

  it('retains unavailable originals and skips interpretation without promoting figures', async () => {
    const store = memoryStore(snapshot());
    const ground = vi.fn().mockResolvedValue({ text: 'OpenAI has 3500 employees.',
      citations: [{ title: 'Reuters', url: 'https://reuters.com/report' }], queries: [] });
    const structure = vi.fn().mockResolvedValue({ figures: [{ metricType: 'employees', value: 3500 }] });
    const read = vi.fn(async (url: string) => ({ requestedUrl: url, status: 'unavailable' as const,
      retrievedAt: new Date().toISOString(), reason: 'Public page unavailable' }));
    const repo = new GeminiRepository({ apiKey: 'k', store, client: { ground, structure } as unknown as LlmClient,
      originalSourceReader: read });
    const result = await repo.huntCompanyMetrics('cmp_1');
    expect(result.filledTypes).toEqual([]);
    expect(structure).not.toHaveBeenCalled();
    expect(read).toHaveBeenCalledTimes(1);
    expect(result.metrics.find(m => m.metricType === 'employees')?.value).toBeNull();
    const reopened = new GeminiRepository({ apiKey: 'k', store, client: { ground, structure } as unknown as LlmClient });
    expect((await reopened.getOriginalSourceEvidence({ companyId: 'cmp_1' }))[0]?.receipts[0]?.reason)
      .toBe('Public page unavailable');
  });
  it('accepts each figure from its own retained passage, not from an unrelated citation', async () => {
    const store = memoryStore(snapshot());
    const url = 'https://reuters.com/report';
    const quote = 'OpenAI reported 3500 employees as of 2026-10-01.';
    const ground = vi.fn().mockResolvedValue({ text: 'Provider notes contain multiple proposed metrics.',
      citations: [{ title: 'Reuters', url }], queries: [] });
    const structure = vi.fn(async (_prompt, schema) => {
      expect((store.read() as RepoSnapshot).originalSourceAttempts).toHaveLength(1);
      return schema.parse({ figures: [
        { metricType: 'employees', value: 3500, passageSupport: { sourceUrl: url, quote,
          asOf: '2026-10-01', basis: 'employees', unit: 'count' } },
        { metricType: 'valuation', value: 500_000_000_000, methodNote: 'Trust the provider' },
        { metricType: 'market_cap', value: 99, passageSupport: { sourceUrl: url,
          quote: 'Other Company reported market cap of USD 99 as of 2026-10-01.',
          asOf: '2026-10-01', basis: 'market_cap', unit: 'USD' } },
      ] });
    }) as LlmClient['structure'];
    const reader = vi.fn(async (requestedUrl: string) => ({ requestedUrl, finalUrl: url, status: 'retrieved' as const,
      httpStatus: 200, contentHash: 'a'.repeat(64), text: quote, retrievedAt: '2026-10-05T00:00:00.000Z' }));
    const client = { ground, structure } as LlmClient;
    const repo = new GeminiRepository({ apiKey: 'k', store, client, originalSourceReader: reader });
    const result = await repo.huntCompanyMetrics('cmp_1');
    expect(result.filledTypes).toEqual(['employees']);
    expect(ground).toHaveBeenCalledTimes(1);
    expect(structure).toHaveBeenCalledTimes(1);
    expect(reader).toHaveBeenCalledTimes(1);
    const reopened = new GeminiRepository({ apiKey: 'k', store, client });
    const metrics = await reopened.getCompanyMetrics('cmp_1');
    expect(metrics.find(m => m.metricType === 'employees')).toMatchObject({ value: 3500,
      confidence: 'verified', source: url, methodNote: 'Original reported employees as of 2026-10-01.' });
    expect(metrics.find(m => m.metricType === 'valuation')).toBeUndefined();
    expect(metrics.find(m => m.metricType === 'market_cap')).toBeUndefined();
    expect(reopened.getResearchEvidence({ companyId: 'cmp_1' })).toHaveLength(1);
  });
  it('does not overwrite a human correction made while the hunt is in flight', async () => {
    const url = 'https://reuters.com/report';
    const quote = 'OpenAI reported 3500 employees as of 2026-10-01.';
    const ground = vi.fn().mockResolvedValue({ text: quote, citations: [{ title: 'Reuters', url }], queries: [] });
    const structure = vi.fn(async (_prompt, schema) => {
      await repo.overrideMetric({ companyId: 'cmp_1', metricType: 'employees', value: 4000, note: 'HR confirmed' });
      return schema.parse({ figures: [{ metricType: 'employees', value: 3500,
        passageSupport: { sourceUrl: url, quote, asOf: '2026-10-01', basis: 'employees', unit: 'count' } }] });
    }) as LlmClient['structure'];
    const repo = new GeminiRepository({ apiKey: 'k', store: memoryStore(snapshot()), client: { ground, structure } as LlmClient,
      originalSourceReader: async requestedUrl => ({ requestedUrl, finalUrl: url, status: 'retrieved',
        httpStatus: 200, contentHash: 'a'.repeat(64), text: quote, retrievedAt: '2026-10-05T00:00:00.000Z' }) });
    const result = await repo.huntCompanyMetrics('cmp_1');
    expect(result.filledTypes).toEqual([]);
    expect(result.metrics.find(m => m.metricType === 'employees')).toMatchObject({ value: 4000, confidence: 'user_verified' });
  });
  it('does not interpret or publish if saving original evidence fails', async () => {
    const url = 'https://reuters.com/report';
    const ground = vi.fn().mockResolvedValue({ text: 'Notes', citations: [{ title: 'Reuters', url }], queries: [] });
    const structure = vi.fn();
    const repo = new GeminiRepository({ apiKey: 'k', store: memoryStore(snapshot()), client: { ground, structure } as LlmClient,
      originalSources: {
        retrieve: async requestedUrl => ({ requestedUrl, finalUrl: url, status: 'retrieved', httpStatus: 200,
          contentHash: 'a'.repeat(64), text: 'Original text', retrievedAt: new Date().toISOString() }),
        save: async () => { throw new Error('Evidence storage unavailable'); }, list: async () => [],
      } });
    await expect(repo.huntCompanyMetrics('cmp_1')).rejects.toThrow('Evidence storage unavailable');
    expect(structure).not.toHaveBeenCalled();
    expect((await repo.getCompanyMetrics('cmp_1')).find(m => m.metricType === 'employees')?.value).toBeNull();
  });
  it('fills missing + unknown figures from a verification-grade pass; verified/user rows untouched', async () => {
    const ground = vi.fn().mockResolvedValue({
      text: 'notes',
      citations: [{ title: 'Reuters', url: 'https://reuters.com/openai-figures' }],
      queries: [],
    });
    const structure = vi.fn().mockResolvedValue({
      figures: [
        { metricType: 'valuation', value: 500_000_000_000, methodNote: 'Reuters, Aug 2026' },
        { metricType: 'employees', value: 3_500, methodNote: 'Company careers page via coverage' },
        // The model trying to "help" with figures we did NOT ask for:
        { metricType: 'arr', value: 99, methodNote: 'noise' },
        { metricType: 'users', value: 1, methodNote: 'noise' },
      ],
    });
    const repo = repoWith({ ground, structure } as unknown as LlmClient);

    const result = await repo.huntCompanyMetrics('cmp_1');

    expect(ground).toHaveBeenCalledTimes(1); // ONE research pass for everything
    expect(result.filledTypes.sort()).toEqual(['employees', 'valuation']);

    const metrics = await repo.getCompanyMetrics('cmp_1');
    const byType = (t: string) => metrics.find((m) => m.metricType === t)!;
    expect(byType('valuation').value).toBe(500_000_000_000);
    expect(byType('valuation').confidence).toBe('verified');
    expect(byType('valuation').citations.length).toBeGreaterThan(0);
    expect(byType('employees').value).toBe(3_500);
    // Hard rows were never in the hunt and were not overwritten by the noise:
    expect(byType('arr').value).toBe(13_000_000_000);
    expect(byType('users').value).toBe(700_000_000);
    expect(byType('users').confidence).toBe('user_verified');
  });

  it('writes NOTHING when the only citations are junk domains', async () => {
    const ground = vi.fn().mockResolvedValue({
      text: 'notes',
      citations: [{ title: 'fatjoe.com', url: 'https://fatjoe.com/seo-blog/openai' }],
      queries: [],
    });
    const structure = vi.fn().mockResolvedValue({
      figures: [{ metricType: 'valuation', value: 500_000_000_000, methodNote: 'junk' }],
    });
    const repo = repoWith({ ground, structure } as unknown as LlmClient);

    const result = await repo.huntCompanyMetrics('cmp_1');
    expect(result.filledTypes).toEqual([]);
    const metrics = await repo.getCompanyMetrics('cmp_1');
    expect(metrics.find((m) => m.metricType === 'valuation')).toBeUndefined();
  });

  it('skips research entirely when no soft figures exist', async () => {
    const ground = vi.fn();
    const structure = vi.fn();
    const repo = repoWith({ ground, structure } as unknown as LlmClient);
    // Harden every row first: hunt the two soft ones via a normal pass…
    // …simpler: build a snapshot where everything is verified/user_verified.
    const snap = snapshot() as unknown as { metrics: Array<Record<string, unknown>> };
    void snap;
    // Direct check: after one successful hunt fills everything findable, a
    // second hunt still runs only for what stayed soft — here we simulate the
    // all-hard case by pre-verifying rows through overrideMetric.
    await repo.overrideMetric({ companyId: 'cmp_1', metricType: 'employees', value: 3200, note: 'HR' });
    await repo.overrideMetric({ companyId: 'cmp_1', metricType: 'valuation', value: 5e11, note: 'board' });
    await repo.overrideMetric({ companyId: 'cmp_1', metricType: 'market_cap', value: 5e11, note: 'board' });
    await repo.overrideMetric({ companyId: 'cmp_1', metricType: 'market_share', value: 40, note: 'analyst' });
    const result = await repo.huntCompanyMetrics('cmp_1');
    expect(ground).not.toHaveBeenCalled();
    expect(result.filledTypes).toEqual([]);
  });
});
