import { describe, expect, it, vi } from 'vitest';
import type { CompanyMetric, CompanyReport } from '@mi/contracts';
import { readCompanyReport, writeCompanyReport, type ReportHost } from './living-report-store';
import type { ResearchEvidence } from './research-evidence';

const OVERVIEW = [
  '## Source-reported background', '', 'Acme builds warehouse robots for mid-sized retailers on a subscription.', '[reuters.com](https://reuters.com/acme)', '',
  '## Market position', '', 'Acme competes with Locus Robotics across retail warehouses.', '[acme.com](https://acme.com/about)',
].join('\n');

function host(over: Partial<ReportHost> = {}, state: { kept?: unknown; evidence?: ResearchEvidence[] } = {}): ReportHost & { state: typeof state } {
  const metrics: CompanyMetric[] = [];
  return {
    state,
    company: (id) => (id === 'c1' ? { id: 'c1', name: 'Acme', oneLiner: 'Acme builds warehouse robots.', websiteUrl: null, hqLocation: null, founded: null } : null),
    tab: async (_id, tab) => (tab === 'overview' ? { content: { markdown: OVERVIEW } } : tab === 'live_intel'
      ? { content: { items: [{ id: 'i1', source: 'news', title: 'Acme opens a plant', url: 'https://reuters.com/p', summary: 'More capacity.', detail: null, publishedDate: '2026-09-30', sentiment: 'neutral', publishedAt: '2026-10-01T00:00:00.000Z', stale: false }], lastRefreshedAt: null, cadence: 'weekly' } } : null),
    metrics: async () => metrics,
    evidence: () => state.evidence ?? [],
    kept: () => state.kept,
    keep: async (_id, report) => { state.kept = report; },
    client: null,
    now: () => new Date('2026-10-22T10:00:00.000Z'),
    ...over,
  };
}

const writing = (sources: () => string[]) => ({
  structure: vi.fn(async () => {
    const [a, b, c] = sources();
    return {
      headline: 'Acme sells warehouse robots on subscription', abstract: 'Acme builds warehouse robots for retailers on a subscription.', abstractCites: [a],
      sections: [
        { id: 'executive_summary', blocks: [{ type: 'paragraph', text: 'Acme builds warehouse robots for mid-sized retailers on a subscription.', cites: [a] }] },
        { id: 'market_position', blocks: [{ type: 'paragraph', text: 'Acme competes with Locus Robotics across retail warehouses.', cites: [b] }] },
        { id: 'momentum', blocks: [{ type: 'paragraph', text: 'Acme opened a plant, which adds capacity for the company.', cites: [c] }] },
      ],
    };
  }),
});

describe('the living report store', () => {
  it('read: an unknown company is null; with nothing kept it is the stored-data report (free, never kept)', async () => {
    expect(await readCompanyReport(host(), 'nope')).toBeNull();
    const h = host();
    const got = await readCompanyReport(h, 'c1');
    expect(got?.report.status).toBe('stored_data');
    expect(got?.stale).toBe(false);
    expect(got?.notice).toMatch(/stored research/);
    expect(h.state.kept).toBeUndefined();
  });

  it('write without a model keeps nothing and says why; the report still renders', async () => {
    const h = host();
    const got = await writeCompanyReport(h, 'c1');
    expect(got.report.status).toBe('stored_data');
    expect(got.notice).toMatch(/No AI model/);
    expect(h.state.kept).toBeUndefined();
  });

  it('write with a model keeps a gated report; a second write with unchanged data spends nothing; new data marks it stale', async () => {
    const h = host();
    // overview:0, overview:1 and the news item are s2, s3 and s4 (s1 is the company profile line)
    const client = writing(() => ['s2', 's3', 's4']);
    h.client = client as never;
    const first = await writeCompanyReport(h, 'c1');
    expect(first.report.status).toBe('ai');
    expect(client.structure).toHaveBeenCalledTimes(1);
    expect((h.state.kept as CompanyReport).basedOn.dataHash).toBe(first.report.basedOn.dataHash);

    const again = await writeCompanyReport(h, 'c1');
    expect(again.stale).toBe(false);
    expect(client.structure).toHaveBeenCalledTimes(1);

    h.state.evidence = [{ id: 'n1', companyId: 'c1', topic: 'user_note', capturedAt: '2026-10-22T00:00:00.000Z', text: 'My note: a buyer said delivery is slow.', citations: [], queries: [] }];
    const peeked = await readCompanyReport(h, 'c1');
    expect(peeked?.stale).toBe(true);
    expect(peeked?.report.status).toBe('ai');
    // never silently spent by a read
    expect(client.structure).toHaveBeenCalledTimes(1);
  });

  it('a failed update keeps the earlier model report and says so', async () => {
    const h = host();
    h.client = writing(() => ['s2', 's3', 's4']) as never;
    const first = await writeCompanyReport(h, 'c1');
    h.client = { structure: vi.fn(async () => { throw new Error('quota'); }) } as never;
    const got = await writeCompanyReport(h, 'c1', { force: true });
    expect(got.report.generatedAt).toBe(first.report.generatedAt);
    expect(got.report.status).toBe('ai');
    expect(got.notice).toMatch(/could not be updated/);
  });

  it('a malformed kept report is ignored, not shown', async () => {
    const h = host({}, { kept: { companyId: 'c1', nonsense: true } });
    expect((await readCompanyReport(h, 'c1'))?.report.status).toBe('stored_data');
  });
});
