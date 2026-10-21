/**
 * Card-face fallbacks that stay honest: a headcount BAND is stored as a band
 * (value null, estimated), an undated distribution needs the company named
 * beside the figure, and the face sweep's hunt asks only for slot types.
 */
import { describe, expect, it, vi } from 'vitest';
import { GeminiRepository, type RepoSnapshot, type ResearchStore } from './repository';
import { employeeBandIn, reportedBandCitations, reportedEmployeeBandRow, reportedMetricCitations } from './reported-metrics';
import { cardFactsHuntRequest } from './prompts';
import type { LlmClient, ProviderGrounding } from './types';

const URL_A = 'https://www.reuters.com/business/zenith-2026';

function grounding(text: string, support = text): ProviderGrounding {
  return { provider: 'google-search', answerText: text,
    supports: [{ supportIndex: 0, text: support, sources: [{ chunkIndex: 0, url: URL_A, title: 'Reuters' }] }] };
}
const bandRow = (text: string, others: string[] = []) => reportedEmployeeBandRow({ companyId: 'cmp_z', companyName: 'Zenith', website: 'https://zenith.example',
  text, grounding: grounding(text), capturedAt: new Date().toISOString(), identity: { answerText: text, otherCompanies: others } });

describe('employee band gate', () => {
  it('reads a single band, never one end of it or a point value', () => {
    expect(employeeBandIn('Zenith has 51 to 100 employees.')).toEqual({ low: 51, high: 100 });
    expect(employeeBandIn('Zenith has 11–50 employees.')).toEqual({ low: 11, high: 50 });
    expect(employeeBandIn('Employees: 1,001-5,000')).toEqual({ low: 1001, high: 5000 });
    expect(employeeBandIn('Zenith has 127 employees.')).toBeNull();
    expect(employeeBandIn('Zenith has 11-50 employees, or perhaps 51-100 employees.')).toBeNull();
    expect(employeeBandIn('Zenith employees worked 2019-2023 on it.')).toBeNull();
  });

  it('stores a company-named band as value null, estimated, with a band and a citation', () => {
    const row = bandRow('Zenith has 51 to 100 employees.');
    expect(row).toMatchObject({ metricType: 'employees', value: null, confidence: 'estimated', reportedBand: { low: 51, high: 100, asOf: null } });
    expect(row?.citations[0]?.url).toBe(URL_A);
    expect(row?.methodNote).toContain('undated; reporting date not published');
    expect(row?.reportedSupport ?? null).toBeNull();
    expect(reportedBandCitations('Zenith', 'https://zenith.example', row!)).toHaveLength(1);
  });

  it('rejects bands that do not name the company, name a rival, or look forward', () => {
    expect(bandRow('The company has 51 to 100 employees.')).toBeNull();
    expect(bandRow('Rivalco has 51 to 100 employees.')).toBeNull();
    expect(bandRow('Zenith and Rivalco have 51 to 100 employees.', ['Rivalco'])).toBeNull();
    expect(bandRow('Zenith plans to reach 51 to 100 employees.')).toBeNull();
    expect(bandRow('Zenith has 51 to 100 employees including contractors.')).toBeNull();
  });

  it('display gate fails when the stored sentence is altered or the company differs', () => {
    const row = bandRow('Zenith has 51 to 100 employees.')!;
    expect(reportedBandCitations('Other Co', null, row)).toEqual([]);
    expect(reportedBandCitations('Zenith', null, { ...row, reportedBand: { ...row.reportedBand!, high: 250 } })).toEqual([]);
    expect(reportedBandCitations('Zenith', null, { ...row, value: 75 })).toEqual([]);
  });
});

describe('undated distribution', () => {
  const proof = (text: string, asOf: string | null = null) => ({ metricType: 'distribution' as const, value: 60,
    reportedSupport: { provider: 'google-search' as const, companyName: 'Zenith', basis: 'distribution' as const, value: 60, unit: 'count' as const,
      definition: 'distribution' as const, asOf, support: { supportIndex: 0, text, sources: [{ chunkIndex: 0, url: URL_A, title: 'Reuters' }] } } });
  it('is accepted undated only when the sentence names the company and states the number', () => {
    expect(reportedMetricCitations('Zenith', null, proof('Zenith is sold in 60+ countries.'))).toHaveLength(1);
    expect(reportedMetricCitations('Zenith', null, proof('Distribution spans 60+ countries.'))).toEqual([]);
    expect(reportedMetricCitations('Zenith', null, proof('Zenith is sold in about 60 countries.'))).toEqual([]);
  });
  it('revenue stays always-dated', () => {
    const revenue = { metricType: 'revenue' as const, value: 5_000_000, reportedSupport: { provider: 'google-search' as const, companyName: 'Zenith',
      basis: 'revenue' as const, value: 5_000_000, unit: 'USD' as const, definition: 'revenue' as const, asOf: null,
      support: { supportIndex: 0, text: 'Zenith had annual revenue of USD 5 million for the year ended June 30, 2025.', sources: [{ chunkIndex: 0, url: URL_A, title: 'Reuters' }] } } };
    expect(reportedMetricCitations('Zenith', null, revenue)).toEqual([]);
  });
});

describe('face-sweep hunt', () => {
  it('asks only for slot types and stores a headcount band for an open employees slot', async () => {
    const now = new Date().toISOString();
    const snap = { schemaVersion: 2, markets: [], decks: [{ id: 'deck_1', marketId: 'mkt_1' }],
      companies: [{ id: 'cmp_z', name: 'Zenith', oneLiner: 'Zenith makes skincare.', websiteUrl: 'https://zenith.example', logoUrl: null, hqLocation: 'Leeds', brandTheme: null }],
      metrics: [], cards: [{ id: 'card_z', deckId: 'deck_1', cardType: 'company', companyId: 'cmp_z' }], viceClaims: [], dashboards: {},
      companyMarket: { cmp_z: 'Beauty' }, opportunity: {}, reports: [], savedCards: [], researchJobs: [], threads: [], capturedAt: now } as unknown as RepoSnapshot;
    let data: RepoSnapshot | null = snap;
    const store: ResearchStore = { read: () => data, write: (s) => { data = s; } };
    const text = 'Zenith has 51 to 100 employees.';
    const ground = vi.fn().mockResolvedValue({ text, citations: [], queries: [], grounding: grounding(text) });
    const structure = vi.fn().mockResolvedValue({ figures: [] });
    const repo = new GeminiRepository({ apiKey: 'k', store, client: { ground, structure } as unknown as LlmClient,
      originalSourceReader: async (url: string) => ({ requestedUrl: url, status: 'unavailable' as const, retrievedAt: now, reason: 'n/a' }) });
    const result = await repo.huntCompanyMetrics('cmp_z', { faceSlotsOnly: true });
    expect(result.filledTypes).toContain('employees');
    const prompt = String(ground.mock.calls[0]![0]);
    expect(prompt).toContain('headcount range');
    // market_share is not a face-slot type: the sweep never asks for it.
    expect(prompt).not.toContain('- Market Share');
    const row = (await repo.getCompanyMetrics('cmp_z')).find((m) => m.metricType === 'employees');
    expect(row).toMatchObject({ value: null, confidence: 'estimated', reportedBand: { low: 51, high: 100 } });
    // The accepted-facts projection (what the card face reads) keeps the band, still point-less.
    const fact = (await repo.getCompanyFacts('cmp_z')).find((m) => m.metricType === 'employees');
    expect(fact).toMatchObject({ value: null, confidence: 'estimated', reportedBand: { low: 51, high: 100 } });
  });

  it('cardFactsHuntRequest adds the headcount line only for a face sweep', () => {
    expect(cardFactsHuntRequest('Zenith', ['employees', 'distribution']).join('\n')).not.toContain('headcount range');
    expect(cardFactsHuntRequest('Zenith', ['employees'], { faceSweep: true }).join('\n')).toContain('headcount range');
  });
});
