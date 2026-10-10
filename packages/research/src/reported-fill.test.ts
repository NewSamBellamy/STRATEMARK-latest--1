/**
 * Reported-estimate fills (batch + hunt): a figure is stored as `estimated`
 * only when the provider support sentence itself states it for that company
 * under the same gate the card projection runs. Anything else stays Unknown.
 */
import { describe, expect, it, vi } from 'vitest';
import { GeminiRepository, type RepoSnapshot, type ResearchStore } from './repository';
import type { LlmClient, ProviderGrounding } from './types';

const URL_A = 'https://www.reuters.com/technology/wingtra-skydio-2026';

function company(id: string, name: string, site: string) {
  return { id, name, oneLiner: `${name} builds drones.`, websiteUrl: site, logoUrl: null, hqLocation: 'Zurich', brandTheme: null };
}

function snap(): RepoSnapshot {
  const now = new Date().toISOString();
  return {
    schemaVersion: 2, markets: [], decks: [{ id: 'deck_1', marketId: 'mkt_1' }],
    companies: [company('cmp_w', 'Wingtra', 'https://wingtra.com'), company('cmp_s', 'Skydio', 'https://skydio.com')],
    metrics: [], cards: [
      { id: 'card_w', deckId: 'deck_1', cardType: 'company', companyId: 'cmp_w' },
      { id: 'card_s', deckId: 'deck_1', cardType: 'company', companyId: 'cmp_s' },
    ],
    viceClaims: [], dashboards: {}, companyMarket: { cmp_w: 'Drones', cmp_s: 'Drones' },
    opportunity: {}, reports: [], savedCards: [], researchJobs: [], threads: [], capturedAt: now,
  } as unknown as RepoSnapshot;
}

function store(initial: RepoSnapshot): ResearchStore {
  let data: RepoSnapshot | null = initial;
  return { read: () => data, write: (s: RepoSnapshot) => { data = s; } };
}

function grounded(text: string, supports: Array<{ text: string }>): { text: string; citations: []; queries: []; grounding: ProviderGrounding } {
  return { text, citations: [], queries: [], grounding: { provider: 'google-search', answerText: text,
    supports: supports.map((s, i) => ({ supportIndex: i, text: s.text, sources: [{ chunkIndex: 0, url: URL_A, title: 'Reuters' }] })) } };
}

describe('fillMissingMarketEstimates — only projectable rows are stored', () => {
  const wingtraSupport = 'Wingtra AG\n* **Employees:** 127 employees, as of October 2026, reported in Dealroom\'s company data profile';
  const skydioSupport = 'Skydio\'s valuation was $4.4 billion as of April 23, 2026.';
  const answer = `${wingtraSupport}\n\n${skydioSupport}`;
  const estimates = { estimates: [
    { companyName: 'Wingtra', metricType: 'valuation', value: 180_000_000, unit: 'USD', asOf: '2026-10-01', methodNote: 'Dealroom' },
    { companyName: 'Skydio', metricType: 'valuation', value: 4_400_000_000, unit: 'USD', asOf: '2026-04-23', methodNote: 'Reuters' },
  ] };

  it('rejects a figure paired with an unrelated support sentence and stores the supported one', async () => {
    const client = { ground: vi.fn().mockResolvedValue(grounded(answer, [{ text: wingtraSupport }, { text: skydioSupport }])),
      structure: vi.fn().mockResolvedValue(estimates) } as unknown as LlmClient;
    const repo = new GeminiRepository({ apiKey: 'k', store: store(snap()), client });
    const result = await repo.fillMissingMarketEstimates('deck_1');
    expect(result.filledTypes).toBe(1);
    expect(result.rejected).toBeGreaterThanOrEqual(1);
    const metrics = await repo.getCompanyMetrics('cmp_w');
    expect(metrics.find((m) => m.metricType === 'valuation' && m.value != null)).toBeUndefined();
    const skydio = (await repo.getCompanyMetrics('cmp_s')).find((m) => m.metricType === 'valuation');
    expect(skydio).toMatchObject({ value: 4_400_000_000, confidence: 'estimated' });
    expect(skydio?.reportedSupport?.value).toBe(4_400_000_000);
    expect(skydio?.reportedSupport?.support.text).toContain('$4.4 billion');
  });
});

describe('huntCompanyMetrics — reported-estimate lane', () => {
  const unreadable = async (url: string) => ({ requestedUrl: url, status: 'unavailable' as const,
    retrievedAt: new Date().toISOString(), reason: 'Public page unavailable' });
  const run = async (supportText: string) => {
    const s = snap();
    const text = supportText;
    const ground = vi.fn().mockResolvedValue(grounded(text, [{ text: supportText }]));
    const structure = vi.fn().mockResolvedValue({ figures: [] });
    const repo = new GeminiRepository({ apiKey: 'k', store: store(s), client: { ground, structure } as unknown as LlmClient,
      originalSourceReader: unreadable });
    return { repo, result: await repo.huntCompanyMetrics('cmp_s') };
  };

  it('fills employees as estimated when originals are unreadable but the support states the figure', async () => {
    const { repo, result } = await run('Skydio had 900 employees as of 2026-04-23.');
    expect(result.filledTypes).toContain('employees');
    const row = (await repo.getCompanyMetrics('cmp_s')).find((m) => m.metricType === 'employees');
    expect(row).toMatchObject({ value: 900, confidence: 'estimated' });
    expect(row?.reportedSupport?.support.text).toContain('900');
  });

  it('fills nothing when the support does not contain the figure', async () => {
    const { repo, result } = await run('Skydio is a drone maker headquartered in San Mateo.');
    expect(result.filledTypes).toEqual([]);
    expect((await repo.getCompanyMetrics('cmp_s')).filter((m) => m.value != null)).toEqual([]);
  });
});
