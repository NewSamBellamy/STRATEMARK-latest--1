import { describe, expect, it, vi } from 'vitest';
import type { CompanyMetric, DashboardTab } from '@mi/contracts';
import { GeminiRepository, migrateSnapshot, type ResearchStore } from './repository';
import type { LlmClient } from './types';

const url = 'https://example.com/annual-report';
function setup() {
  let saved = migrateSnapshot(null).snapshot;
  saved.companies.push({ id: 'cmp', name: 'Example', oneLiner: 'Example company', websiteUrl: 'https://example.com', logoUrl: null, hqLocation: null, brandTheme: null });
  const store: ResearchStore = { read: () => structuredClone(saved), write: async snapshot => { saved = structuredClone(snapshot); } };
  const ground = vi.fn().mockResolvedValue({ text: 'Example sells research software.', citations: [
    { title: 'Annual report', url }, { title: 'Duplicate', url }, { title: 'Bad', url: 'javascript:alert(1)' },
  ], queries: [] });
  const structure = vi.fn().mockResolvedValue({ markdown: 'Example sells research software.',
    excerpts: [{ sourceUrl: url, quote: 'Example sells research software.' }],
    citations: [{ title: 'Fabricated', url: 'https://invented.example/report' }],
    nodes: Array.from({ length: 5 }, (_, i) => ({ id: String(i), parentId: null })),
    board: [], fundingRounds: [{ round: 'Seed' }], products: [], timeline: [], items: [] });
  const client = { ground, structure } as unknown as LlmClient;
  const repo = () => new GeminiRepository({ apiKey: 'test', client, store,
    originalSourceReader: async sourceUrl => ({ requestedUrl: sourceUrl, finalUrl: sourceUrl,
      status: 'retrieved', httpStatus: 200, contentHash: 'a'.repeat(64), text: 'Example sells research software.', retrievedAt: new Date().toISOString() }) });
  return { store, ground, structure, repo };
}

describe('dashboard source lineage', () => {
  it('does not trust fabricated cached overview text or selections when the originals do not match', async () => {
    const { store, repo, ground, structure } = setup();
    const snapshot = store.read()!;
    snapshot.dashboards.cmp = { overview: { content: { markdown: 'Fabricated $999B valuation' }, lastRefreshedAt: '2026-10-01T00:00:00.000Z',
      overviewEvidenceVersion: 1, overviewBackground: 'Fabricated $999B valuation' } };
    await store.write(snapshot);
    const result = await repo().getDashboardTab('cmp', 'overview');
    expect(result!.content.markdown).not.toContain('999B');
    expect(ground).not.toHaveBeenCalled();
    expect(structure).not.toHaveBeenCalled();
  });
  it('rechecks cached selections against originals, not a claimed evidence version', async () => {
    const { store, repo, ground, structure } = setup();
    const snapshot = store.read()!;
    snapshot.dashboards.cmp = { overview: { content: { markdown: 'Fabricated $999B valuation' }, lastRefreshedAt: '2026-10-01T00:00:00.000Z',
      overviewEvidenceVersion: 2, overviewExcerpts: [{ sourceUrl: url, quote: 'Example has a fabricated business story without an original source.' }] } };
    await store.write(snapshot);
    const result = await repo().getDashboardTab('cmp', 'overview');
    expect(result!.content.markdown).not.toContain('fabricated');
    expect(result!.content.markdown).not.toContain('999B');
    expect(result!.citations).toEqual([]);
    expect(ground).not.toHaveBeenCalled();
    expect(structure).not.toHaveBeenCalled();
  });
  it.each(['overview', 'live_intel', 'team_org', 'mission_governance', 'history', 'products_roadmap'] as DashboardTab[])(
    'retains actual search citations through %s synthesis and reopen without another paid pass', async tab => {
      const { repo, ground, structure } = setup();
      const result = await repo().getDashboardTab('cmp', tab);
      expect(result).toHaveProperty('citations', [expect.objectContaining({ url })]);
      expect(structure.mock.calls[0]![0]).toContain(url);
      expect(structure.mock.calls[0]![0]).toContain(tab === 'overview' ? 'UNTRUSTED ORIGINAL EXTRACTS' : 'not independent claim verification');
      const reopened = await repo().getDashboardTab('cmp', tab);
      expect(reopened).toEqual(result);
      expect(ground).toHaveBeenCalledTimes(1);
      expect(structure).toHaveBeenCalledTimes(1);
    });

  it('detaches source/content objects returned from the cache', async () => {
    const { repo } = setup();
    const repository = repo();
    const first = await repository.getDashboardTab('cmp', 'overview');
    const caller = first as typeof first & { citations: Array<{ url: string }> };
    caller!.citations[0]!.url = 'https://wrong.example';
    caller!.content.markdown = 'Caller overwrite';
    const cached = await repository.getDashboardTab('cmp', 'overview');
    expect(cached).toHaveProperty('citations.0.url', url);
    expect(cached!.content.markdown).toContain('Example sells research software.');
    expect(cached!.content.markdown).not.toContain('Caller overwrite');
  });

  it('a forced rerun joins research already in flight and returns isolated results', async () => {
    const { repo, ground } = setup();
    let finish!: (value: { text: string; citations: Array<{ url: string; title: string }>; queries: string[] }) => void;
    ground.mockReturnValue(new Promise(resolve => { finish = resolve; }));
    const repository = repo();
    const first = repository.getDashboardTab('cmp', 'overview');
    const rerun = repository.getDashboardTab('cmp', 'overview', true);
    finish({ text: 'Notes', citations: [{ url, title: 'Official' }], queries: [] });
    const [a, b] = await Promise.all([first, rerun]);
    expect(ground).toHaveBeenCalledTimes(1);
    expect(a).toEqual(b);
    a!.content.markdown = 'Changed by caller';
    expect(b!.content.markdown).not.toBe('Changed by caller');
  });

  it('keeps legacy unsourced sections readable without silently rerunning research', async () => {
    const { store, repo, ground } = setup();
    const snapshot = store.read()!;
    snapshot.dashboards.cmp = { overview: { content: { markdown: 'Legacy notes' }, lastRefreshedAt: '2026-09-01T00:00:00.000Z' } };
    await store.write(snapshot);
    expect((await repo().getDashboardTab('cmp', 'overview'))!.content.markdown).toContain('evidence-backed refresh');
    expect(store.read()!.dashboards.cmp!.overview!.content).toEqual({ markdown: 'Legacy notes' });
    expect(ground).not.toHaveBeenCalled();
  });

  it('combines real citations from a bounded gap-fill, not model-invented sources', async () => {
    const { repo, ground, structure } = setup();
    structure.mockResolvedValueOnce({ nodes: [] }).mockResolvedValueOnce({ nodes: [{ id: 'one', parentId: null }] });
    ground.mockResolvedValueOnce({ text: 'First notes', citations: [{ title: 'First', url }], queries: [] })
      .mockResolvedValueOnce({ text: 'Second notes', citations: [{ title: 'Second', url: 'https://example.com/team' }], queries: [] });
    expect(await repo().getDashboardTab('cmp', 'team_org')).toHaveProperty('citations', [
      expect.objectContaining({ url }), expect.objectContaining({ url: 'https://example.com/team' }),
    ]);
    expect(structure.mock.calls[1]![0]).toContain(url);
    expect(structure.mock.calls[1]![0]).toContain('https://example.com/team');
  });
});

describe('current dashboard metric points', () => {
  const row: CompanyMetric = { id: 'old', companyId: 'cmp', metricType: 'arr', value: 100,
    confidence: 'user_verified', source: null, citations: [], methodNote: null, capturedAt: '2026-09-01T00:00:00.000Z' };
  it('does not serve a stale cached chart or another company’s first row', async () => {
    const { store, repo, ground, structure } = setup();
    const snapshot = store.read()!;
    snapshot.metrics = [{ ...row, companyId: 'other', value: 999 }, row,
      { ...row, id: 'current', value: 200, capturedAt: '2026-10-01T00:00:00.000Z' }];
    snapshot.dashboards.cmp = { metrics: { content: { revenue: [{ period: 'Current', value: 666 }], users: [], churn: [], nps: [], capTable: [] }, lastRefreshedAt: '2026-09-01T00:00:00.000Z' } };
    await store.write(snapshot);
    expect((await repo().getDashboardTab('cmp', 'metrics'))!.content.revenue).toEqual([{ period: 'Current', value: 200 }]);
    expect(ground).not.toHaveBeenCalled();
    expect(structure).not.toHaveBeenCalled();
    expect(store.read()!.dashboards.cmp!.metrics!.content).toHaveProperty('revenue.0.value', 666);
  });
  it.each(['ambiguous', 'estimated', 'invalid', 'zero-users'])('does not plot a %s figure as an established fact', async kind => {
    const { store, repo } = setup();
    const snapshot = store.read()!;
    snapshot.metrics = kind === 'ambiguous' ? [row, { ...row, id: 'tie', value: 200 }] : [{ ...row,
      confidence: kind === 'estimated' || kind === 'zero-users' ? 'estimated' : row.confidence,
      value: kind === 'invalid' ? -1 : kind === 'zero-users' ? 0 : row.value,
      metricType: kind === 'zero-users' ? 'users' : 'arr' }];
    await store.write(snapshot);
    const content = (await repo().getDashboardTab('cmp', 'metrics'))!.content;
    expect(content.revenue).toEqual([]);
    expect(content.users).toEqual([]);
  });
});
