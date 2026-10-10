import { describe, expect, it, vi } from 'vitest';
import { recordResearchEvidence, searchResearchEvidence, type ResearchEvidence } from './research-evidence';
import { companySourceTargets } from './source-policy';
import { GeminiRepository, migrateSnapshot, type ResearchStore } from './repository';
import type { LlmClient } from './types';

const citation = { url: 'https://example.com/annual-report', title: 'Annual report' };
const receipt = (companyId: string, text: string, date = '2026-10-01'): ResearchEvidence => ({
  id: `ev_${companyId}_${date}`, companyId, companyName: companyId, topic: 'overview',
  capturedAt: date, text, citations: [citation], queries: ['annual report'],
});

describe('source-first research evidence', () => {
  it('records only sourced, scoped notes without an extra provider call', async () => {
    const ground = vi.fn().mockResolvedValue({ text: 'Research notes', citations: [citation], queries: ['test'] });
    const record = vi.fn();
    const client = recordResearchEvidence({ ground, structure: vi.fn() } as unknown as LlmClient, record);
    await client.ground('unscoped');
    const context = { researchContext: { companyId: 'cmp_a', topic: 'overview' } };
    await client.ground('scoped', context);
    expect(record).toHaveBeenCalledTimes(1);
    expect(record.mock.calls[0]![0]).toMatchObject({ companyId: 'cmp_a', topic: 'overview', citations: [expect.objectContaining(citation)] });
    ground.mockResolvedValueOnce({ text: 'Unsourced notes', citations: [], queries: [] });
    await client.ground('unsourced', context);
    expect(record).toHaveBeenCalledTimes(1);
    expect(ground).toHaveBeenCalledTimes(3);
  });

  it('scopes retrieval to one company, ranks relevance, and protects stored receipts', () => {
    const records = [receipt('cmp_a', 'Revenue grew'), receipt('cmp_b', 'Revenue grew'), receipt('cmp_a', 'Team expanded', '2026-10-02')];
    expect(searchResearchEvidence(records, { query: 'revenue' })).toEqual([]);
    const hits = searchResearchEvidence(records, { companyId: 'cmp_a', query: 'revenue' });
    expect(hits).toHaveLength(1);
    hits[0]!.citations[0]!.title = 'changed';
    hits[0]!.queries.push('changed');
    expect(records[0]!.citations[0]!.title).toBe('Annual report');
    expect(records[0]!.queries).toEqual(['annual report']);
    expect(searchResearchEvidence(records, { companyId: 'cmp_a' })[0]!.text).toBe('Team expanded');
  });

  it('persists new dashboard research and exposes it to Ask after reopening', async () => {
    let snapshot = migrateSnapshot(null).snapshot;
    snapshot.companies.push({ id: 'cmp_a', name: 'Example', oneLiner: 'Example company', websiteUrl: 'https://example.com', logoUrl: null, hqLocation: null, brandTheme: null });
    snapshot.companyMarket.cmp_a = 'Example market';
    const store: ResearchStore = { read: () => snapshot, write: (value) => { snapshot = value as typeof snapshot; } };
    const ground = vi.fn().mockResolvedValue({ text: 'Revenue grew according to the annual report.', citations: [citation], queries: ['annual report'] });
    const client = { ground, structure: vi.fn().mockResolvedValue({ markdown: 'Company overview.' }) } as unknown as LlmClient;
    const first = new GeminiRepository({ apiKey: 'test', store, client,
      originalSourceReader: async url => ({ requestedUrl: url, status: 'unavailable', retrievedAt: new Date().toISOString() }) });
    await first.getDashboardTab('cmp_a', 'overview');
    expect(first.getResearchEvidence({ companyId: 'cmp_a', query: 'revenue' })).toHaveLength(1);
    snapshot.researchEvidence!.push(receipt('cmp_b', 'Revenue unrelated confidential details'));
    const reopened = new GeminiRepository({ apiKey: 'test', store, client });
    expect(reopened.getResearchEvidence({ companyId: 'cmp_a' })[0]!.citations[0]!.url).toBe(citation.url);
    expect(ground).toHaveBeenCalledTimes(1); // querying saved evidence is free
    ground.mockResolvedValueOnce({ text: 'Answer without citing stored source.', citations: [], queries: [] });
    const answer = await reopened.askResearch({ scope: { kind: 'company', deckId: 'deck_a', companyId: 'cmp_a' }, question: 'What changed in revenue?' });
    const prompt = ground.mock.calls[1]![0] as string;
    expect(prompt).toContain('LOCAL RESEARCH ARCHIVE');
    expect(prompt).toContain('Revenue grew according');
    expect(prompt).not.toContain('unrelated confidential');
    expect(answer.messages.at(-1)!.citations).toEqual([]); // unused sources aren't answer citations
  });

  it('targets official domains without guessing or accepting non-web protocols', () => {
    expect(companySourceTargets('https://www.example.com/team')).toContain('site:example.com');
    expect(companySourceTargets('javascript:alert(1)')).not.toContain('site:');
    expect(companySourceTargets(null)).toContain('do not guess');
  });
});
