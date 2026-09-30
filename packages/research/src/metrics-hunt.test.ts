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

describe('huntCompanyMetrics — one pass fills every soft figure', () => {
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

  it('stores an explicit basis for a newly discovered user-footprint metric', async () => {
    const initial = snapshot();
    initial.metrics = initial.metrics.filter((metric) => metric.metricType !== 'users');
    const ground = vi.fn().mockResolvedValue({
      text: 'OpenAI reported monthly active users.',
      citations: [{ title: 'Reuters', url: 'https://reuters.com/openai-users' }],
      queries: [],
    });
    const structure = vi.fn().mockResolvedValue({
      figures: [
        {
          metricType: 'users',
          value: 700_000_000,
          methodNote: 'Reuters, monthly active users, Aug 2026',
          userBasis: 'monthly_active_users',
        },
      ],
    });
    const repo = new GeminiRepository({
      apiKey: 'k',
      store: memoryStore(initial),
      client: { ground, structure } as unknown as LlmClient,
    });

    await repo.huntCompanyMetrics('cmp_1');

    const users = (await repo.getCompanyMetrics('cmp_1')).find((metric) => metric.metricType === 'users');
    expect(users?.userBasis).toBe('monthly_active_users');
  });

  it('keeps an explicitly supplied basis when a user corrects a footprint metric', async () => {
    const repo = repoWith({} as LlmClient);
    await repo.overrideMetric({
      companyId: 'cmp_1',
      metricType: 'users',
      value: 120,
      note: 'Manually confirmed by operations',
      userBasis: 'paying_business_accounts',
    });

    const users = (await repo.getCompanyMetrics('cmp_1')).find((metric) => metric.metricType === 'users');
    expect(users?.userBasis).toBe('paying_business_accounts');
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
