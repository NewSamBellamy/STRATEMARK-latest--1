import { describe, expect, it, vi } from 'vitest';
import type { CompanyMetric, DashboardTab } from '@mi/contracts';
import { GeminiRepository, migrateSnapshot, type ResearchStore } from './repository';
import { mergeTeamOrgNodes } from './dashboard';
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
    nodes: Array.from({ length: 5 }, (_, i) => ({ id: String(i), name: `Leader ${i}`, role: 'Executive', group: 'exec', parentId: null,
      bio: `Leader ${i} is reported in the test fixture.`, tenure: null, priorCompany: null, notableProject: null })),
    board: [], fundingRounds: [{ round: 'Seed' }], products: [{ name: 'Atlas', status: 'live', sourceUrl: url,
      quote: 'Atlas is now available for company research.' }], roadmap: [], timeline: [], items: [] });
  const client = { ground, structure } as unknown as LlmClient;
  const repo = () => new GeminiRepository({ apiKey: 'test', client, store,
    // These cases exercise SEARCH lineage. Make the direct homepage explicitly
    // unreadable so the fallback must discover the actual report selected below.
    originalSourceReader: async sourceUrl => sourceUrl === 'https://example.com'
      ? { requestedUrl: sourceUrl, status: 'unavailable', retrievedAt: new Date().toISOString() }
      : ({ requestedUrl: sourceUrl, finalUrl: sourceUrl,
      status: 'retrieved', httpStatus: 200, contentHash: 'a'.repeat(64), text: 'Example sells research software. Atlas is now available for company research.', retrievedAt: new Date().toISOString() }) });
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
  it.each(['overview', 'live_intel', 'mission_governance', 'history', 'products_roadmap'] as DashboardTab[])(
    'retains actual search citations through %s synthesis and reopen without another paid pass', async tab => {
      const { repo, ground, structure } = setup();
      const result = await repo().getDashboardTab('cmp', tab);
      expect(result).toHaveProperty('citations', [expect.objectContaining({ url })]);
      expect(structure.mock.calls[0]![0]).toContain(url);
      expect(structure.mock.calls[0]![0]).toContain(['overview', 'products_roadmap'].includes(tab) ? 'UNTRUSTED ORIGINAL EXTRACTS' : 'not independent claim verification');
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

});

describe('team and org gap-fill merge', () => {
  const leader = (id: string, name: string, overrides: Record<string, unknown> = {}) => ({
    id, name, role: 'Chief Executive Officer', group: 'exec' as const, parentId: null,
    bio: `${name} leads the company.`, tenure: null, priorCompany: null, notableProject: null, ...overrides,
  });

  it('preserves first-pass people when a larger gap-fill response omits one, and adds genuinely new people', () => {
    const first = [leader('founder', 'Avery Founder'), leader('research', 'Jordan Researcher')];
    const gap = [leader('ceo', 'Avery Founder'), leader('product', 'Morgan Product', { role: 'Chief Product Officer' }),
      leader('board', 'Riley Board')];
    const merged = mergeTeamOrgNodes(first, gap);
    expect(merged.map(node => node.name)).toEqual(['Avery Founder', 'Jordan Researcher', 'Morgan Product', 'Riley Board']);
    expect(merged[0]).toMatchObject({ id: 'founder', role: 'Chief Executive Officer' });
  });

  it('deduplicates normalized names, fills only unknown fields, and remaps gap-fill manager IDs', () => {
    const first = [leader('founder', 'Avery Founder', { bio: 'Reported founder biography.' }),
      leader('chief', 'Jordan Chief', { role: 'Unknown', bio: 'Unknown' })];
    const gap = [leader('avery', ' AVERY   FOUNDER ', { role: 'Different title', bio: 'Conflicting rewrite.' }),
      leader('jordan', 'Jordan Chief', { role: 'Chief Research Officer', bio: 'Source-reported biography.', parentId: 'avery' })];
    const merged = mergeTeamOrgNodes(first, gap);
    expect(merged).toHaveLength(2);
    expect(merged[0]).toMatchObject({ id: 'founder', bio: 'Reported founder biography.' });
    expect(merged[1]).toMatchObject({ role: 'Chief Research Officer', bio: 'Source-reported biography.', parentId: 'founder' });
  });

  it('breaks self-references and multi-person reporting cycles', () => {
    const first = [leader('a', 'Avery Founder', { parentId: 'b' }), leader('b', 'Jordan Chief', { parentId: 'a' }),
      leader('self', 'Morgan Product', { parentId: 'self' })];
    const merged = mergeTeamOrgNodes(first, []);
    expect(merged.map(node => node.parentId)).toEqual(['b', null, null]);
  });

  it('does not re-display legacy unsourced people after a no-spend cache reopen', async () => {
    const { repo, store, ground } = setup();
    const snapshot = store.read()!;
    snapshot.dashboards.cmp = { team_org: { content: { nodes: [
      leader('a', 'Avery Founder', { parentId: 'b' }), leader('b', 'Jordan Chief', { parentId: 'a' }),
    ] }, lastRefreshedAt: new Date().toISOString(), citations: [{ title: 'Team page', url }] } };
    await store.write(snapshot);
    const result = await repo().getDashboardTab('cmp', 'team_org');
    expect(result!.content.nodes).toEqual([]);
    expect(result!.citations).toEqual([]);
    expect(ground).not.toHaveBeenCalled();
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
