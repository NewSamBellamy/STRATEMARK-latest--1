import { expect, it, vi } from 'vitest';
import { GeminiRepository, migrateSnapshot, type ResearchStore } from './repository';
import type { LlmClient } from './types';
import { selectOriginalSourceAttempts, type OriginalSourceAttempt } from './original-source';

const url = 'https://example.com/products';
const note = 'Example supplies Atlas 2 for analysts and enterprise research teams.';
function setup() {
  let saved = migrateSnapshot(null).snapshot;
  saved.companies.push({ id: 'cmp', name: 'Example', websiteUrl: 'https://example.com', oneLiner: 'Unattributed legacy copy',
    logoUrl: null, hqLocation: null, brandTheme: null });
  const store: ResearchStore = { read: () => structuredClone(saved), write: async value => { saved = structuredClone(value); } };
  const ground = vi.fn().mockResolvedValue({ text: note, queries: [], citations: [{ title: 'Example products', url }],
    grounding: { provider: 'google-search', answerText: note, supports: [{ supportIndex: 0, text: note,
      sources: [{ chunkIndex: 0, title: 'Example products', url }] }] } });
  const structure = vi.fn().mockResolvedValue({ paragraphs: [{ section: 'products', text: 'Atlas 2 supports analysts and enterprise research teams.', sourceUrls: [url], supportIndices: [0] }] });
  const repo = () => new GeminiRepository({ apiKey: 'test-placeholder', store, client: { ground, structure } as unknown as LlmClient });
  return { store, ground, structure, repo };
}

it('stores explicit version-3 attribution and reopens it without paid work or trusting cached markdown', async () => {
  const s = setup();
  const first = await s.repo().getDashboardTab('cmp', 'overview');
  expect(first!.content.markdown).toContain('Atlas 2');
  expect(s.store.read()!.dashboards.cmp!.overview).toMatchObject({ overviewEvidenceVersion: 3,
    overviewNarrative: { companyId: 'cmp', basis: 'google-search', paragraphs: [expect.objectContaining({ supportIndices: [0] })] } });
  const snapshot = s.store.read()!;
  snapshot.dashboards.cmp!.overview!.content = { markdown: 'Injected $999B verified valuation' };
  await s.store.write(snapshot);
  const reopened = await s.repo().getDashboardTab('cmp', 'overview');
  expect(reopened).toEqual(first);
  expect(reopened!.content.markdown).not.toContain('999B');
  expect(s.ground).toHaveBeenCalledTimes(1);
  expect(s.structure).toHaveBeenCalledTimes(1);
});

it('persists and reopens the literal Google-support fallback after synthesis failure', async () => {
  const s = setup();
  const fallback = '**Company Description**\nExample supplies Atlas 2 for analysts and enterprise research teams.';
  s.ground.mockResolvedValue({ text: fallback, queries: [], citations: [{ title: 'Example products', url }], grounding: {
    provider: 'google-search', answerText: fallback, supports: [{ supportIndex: 0, text: fallback,
      sources: [{ chunkIndex: 0, title: 'Example products', url }] }],
  } });
  s.structure.mockRejectedValue(new Error('model returned malformed selectors'));

  const first = await s.repo().getDashboardTab('cmp', 'overview');

  expect(first!.content.markdown).toContain('Example supplies Atlas 2');
  expect(first!.content.markdown).not.toContain('**Company Description**');
  const snapshot = s.store.read()!;
  const cached = snapshot.dashboards.cmp!.overview!;
  expect(cached.overviewNarrative).toMatchObject({ basis: 'google-search', grounding: { supports: [expect.objectContaining({ text: fallback })] } });
  cached.content = { markdown: 'Injected, ungrounded cache text' };
  await s.store.write(snapshot);

  const reopened = await s.repo().getDashboardTab('cmp', 'overview');

  expect(reopened).toEqual(first);
  expect(reopened!.content.markdown).not.toContain('Injected');
  expect(s.ground).toHaveBeenCalledTimes(1);
  expect(s.structure).toHaveBeenCalledTimes(1);
});

it('preserves the previous cached report as history on an explicit overview refresh', async () => {
  const s = setup(); const snapshot = s.store.read()!;
  snapshot.dashboards.cmp = { overview: { content: { markdown: 'Old source-reported research' },
    lastRefreshedAt: '2026-09-01T00:00:00.000Z', overviewEvidenceVersion: 1, overviewBackground: 'Saved old background' } };
  await s.store.write(snapshot);
  const old = structuredClone(snapshot.dashboards.cmp.overview);
  const before = await s.repo().getDashboardTab('cmp', 'overview');
  expect(before!.content.markdown).toContain('evidence-backed refresh');
  expect(s.store.read()!.dashboards.cmp!.overview).toEqual(old);
  const current = await s.repo().getDashboardTab('cmp', 'overview', true);
  expect(current!.content.markdown).toContain('Atlas 2');
  expect(s.store.read()!.dashboards.cmp!.overview).toHaveProperty('overviewHistory', [old]);
});

it('rejects wrong-company attribution and corrupted cached support bindings', async () => {
  const s = setup(); await s.repo().getDashboardTab('cmp', 'overview');
  const snapshot = s.store.read()!;
  const cached = snapshot.dashboards.cmp!.overview! as unknown as { overviewNarrative: { companyId: string } };
  expect(cached.overviewNarrative).toBeDefined();
  cached.overviewNarrative.companyId = 'other-company';
  await s.store.write(snapshot);
  const result = await s.repo().getDashboardTab('cmp', 'overview');
  expect(result!.content.markdown).toContain('Background unavailable');
  expect(result!.content.markdown).not.toContain('Atlas 2');
  expect(s.ground).toHaveBeenCalledTimes(1);
});

it.each([1, 2, 3, 'new', 'refresh'] as const)('overview %s shares saved external original evidence with card facts after newer failed reads', async version => {
  const s = setup();
  if (version !== 'new') await s.repo().getDashboardTab('cmp', 'overview');
  const snapshot = s.store.read()!;
  const sourceUrl = 'https://example.com/report';
  const quote = 'Example reported 45 employees as of 2026-10-01.';
  snapshot.originalSourceAttempts = [];
  snapshot.metrics = [{ id: 'employees', companyId: 'cmp', metricType: 'employees', value: 45, confidence: 'verified',
    source: sourceUrl, citations: [{ title: 'Report', url: sourceUrl }], capturedAt: '2026-10-02T00:00:00.000Z', methodNote: null,
    passageSupport: { sourceUrl, quote, asOf: '2026-10-01', basis: 'employees', unit: 'count' } }];
  if (typeof version === 'number') snapshot.dashboards.cmp!.overview!.overviewEvidenceVersion = version;
  await s.store.write(snapshot);
  const retained: OriginalSourceAttempt[] = [{ id: 'original', companyId: 'cmp', metricType: 'company_profile',
    capturedAt: '2026-10-02T00:00:00.000Z', receipts: [{ requestedUrl: sourceUrl, finalUrl: sourceUrl, text: quote,
      status: 'retrieved', httpStatus: 200, contentHash: 'a'.repeat(64), retrievedAt: '2026-10-02T00:00:00.000Z' }] },
    ...Array.from({ length: 30 }, (_, index): OriginalSourceAttempt => ({ id: `failed-${index}`, companyId: 'cmp',
      metricType: 'company_profile', capturedAt: `2026-10-03T00:00:${String(index).padStart(2, '0')}.000Z`,
      receipts: [{ requestedUrl: sourceUrl, status: 'unavailable', retrievedAt: '2026-10-03T00:00:00.000Z' }] }))];
  const list = vi.fn(async input => selectOriginalSourceAttempts(retained, input));
  const retrieve = vi.fn(), save = vi.fn();
  const repo = new GeminiRepository({ apiKey: 'test-placeholder', store: s.store,
    client: { ground: s.ground, structure: s.structure } as unknown as LlmClient, originalSources: { list, retrieve, save } });
  expect(await repo.getCompanyFacts('cmp')).toMatchObject([{ value: 45, confidence: 'verified' }]);
  const overview = await repo.getDashboardTab('cmp', 'overview', version === 'refresh');
  expect(overview!.content.markdown).toContain('Employees: 45');
  expect(list.mock.calls.at(-1)?.[0]).toMatchObject({ companyId: 'cmp', support: [{ sourceUrl, quote }] });
  expect(retrieve).not.toHaveBeenCalled(); expect(save).not.toHaveBeenCalled();
  expect(s.ground).toHaveBeenCalledTimes(version === 'refresh' ? 2 : 1);
  expect(s.structure).toHaveBeenCalledTimes(version === 'refresh' ? 2 : 1);
});
