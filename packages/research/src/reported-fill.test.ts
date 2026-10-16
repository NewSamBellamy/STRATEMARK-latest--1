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

describe('huntFaceSlotsBatch — one search for several companies, per-company gates', () => {
  const unreadable = async (url: string) => ({ requestedUrl: url, status: 'unavailable' as const,
    retrievedAt: new Date().toISOString(), reason: 'Public page unavailable' });
  const setup = (answer: string, supports: string[], reader: typeof unreadable | null = unreadable) => {
    const ground = vi.fn().mockResolvedValue(grounded(answer, supports.map((text) => ({ text }))));
    const structure = vi.fn().mockResolvedValue({ figures: [] });
    const repo = new GeminiRepository({ apiKey: 'k', store: store(snap()), client: { ground, structure } as unknown as LlmClient,
      ...(reader ? { originalSourceReader: reader } : {}) });
    return { repo, ground };
  };

  it('asks one grounded search for every company and fills each only from a sentence naming it', async () => {
    const skydio = 'Skydio had 900 employees as of 2026-04-23.';
    const { repo, ground } = setup(`### Skydio\n${skydio}\n\n### Wingtra\nWingtra headcount is not disclosed.`, [skydio]);
    const results = await repo.huntFaceSlotsBatch(['cmp_w', 'cmp_s']);
    expect(ground).toHaveBeenCalledTimes(1);
    const prompt = ground.mock.calls[0]![0] as string;
    expect(prompt).toContain('- Wingtra (https://wingtra.com)');
    expect(prompt).toContain('- Skydio (https://skydio.com)');
    expect(ground.mock.calls[0]![1]).toMatchObject({ researchContext: { topic: 'metrics_hunt_batch' } });
    expect(results.cmp_s?.filledTypes).toContain('employees');
    expect(results.cmp_w?.filledTypes).toEqual([]);
    expect((await repo.getCompanyMetrics('cmp_s')).find((m) => m.metricType === 'employees')).toMatchObject({ value: 900, confidence: 'estimated' });
    expect((await repo.getCompanyMetrics('cmp_w')).filter((m) => m.value != null)).toEqual([]);
  });

  it('never gives a figure stated alongside a rival to either company', async () => {
    const mixed = 'Wingtra and Skydio had 900 employees as of 2026-04-23.';
    const { repo } = setup(mixed, [mixed]);
    await repo.huntFaceSlotsBatch(['cmp_w', 'cmp_s']);
    for (const id of ['cmp_w', 'cmp_s']) {
      expect((await repo.getCompanyMetrics(id)).filter((m) => m.value != null)).toEqual([]);
    }
  });

  it('batches nothing without an original-source reader, leaving each company to its own hunt', async () => {
    const { repo, ground } = setup('Skydio had 900 employees as of 2026-04-23.', ['Skydio had 900 employees as of 2026-04-23.'], null);
    expect(await repo.huntFaceSlotsBatch(['cmp_w', 'cmp_s'])).toEqual({});
    expect(ground).not.toHaveBeenCalled();
  });

  it('is joined by a face hunt asked for while it runs, instead of paying a second search', async () => {
    const skydio = 'Skydio had 900 employees as of 2026-04-23.';
    const { repo, ground } = setup(`### Skydio\n${skydio}`, [skydio]);
    const batch = repo.huntFaceSlotsBatch(['cmp_s']);
    const joined = await repo.huntCompanyMetrics('cmp_s', { faceSlotsOnly: true });
    await batch;
    expect(ground).toHaveBeenCalledTimes(1);
    expect(joined.filledTypes).toContain('employees');
  });

  it('a failed search leaves the companies out for the caller to hunt alone', async () => {
    const ground = vi.fn().mockRejectedValue(new Error('quota'));
    const repo = new GeminiRepository({ apiKey: 'k', store: store(snap()),
      client: { ground, structure: vi.fn() } as unknown as LlmClient, originalSourceReader: unreadable });
    expect(await repo.huntFaceSlotsBatch(['cmp_w', 'cmp_s'])).toEqual({});
  });
});

describe('companySection', () => {
  it('returns only the named company\'s part of a batched answer', async () => {
    const { companySection } = await import('./repository');
    const text = '### Wingtra\nWingtra had 127 employees.\nOriginal source: https://wingtra.com/a\n### **Skydio**\nSkydio had 900 employees.';
    expect(companySection(text, 'Skydio')).toBe('### **Skydio**\nSkydio had 900 employees.');
    expect(companySection(text, 'Wingtra')).not.toContain('Skydio');
    expect(companySection('No headings here.', 'Skydio')).toBe('No headings here.');
  });
});
