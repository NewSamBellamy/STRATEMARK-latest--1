import { describe, expect, it, vi } from 'vitest';
import type { Company, CompanyMetric, MetricType } from '@mi/contracts';
import { projectCompanyFacts } from './company-facts';
import { hydrateCompanyCard } from './company-agent';
import { extractProviderGrounding } from './grounding-support';
import type { LlmClient, MarketPlan } from './types';

vi.mock('./logos', () => ({ faviconUrl: () => null, resolveLogo: async () => ({ url: null }) }));

const SOURCE = 'https://www.reuters.com/business/acme-2026';
const company: Company = { id: 'cmp_acme', name: 'Acme', oneLiner: 'Acme makes gin.', logoUrl: null, hqLocation: null,
  websiteUrl: 'https://acme.com', brandTheme: null };

function row(type: MetricType, value: number, unit: 'USD' | 'count', text: string, asOf: string): CompanyMetric {
  return { id: `met_${type}`, companyId: company.id, metricType: type, value, confidence: 'estimated', source: SOURCE,
    citations: [{ title: 'reuters.com', url: SOURCE }], methodNote: 'stored', capturedAt: '2026-10-05T00:00:00.000Z',
    lastVerifiedAt: null, passageSupport: null,
    reportedSupport: { provider: 'google-search', companyName: 'Acme', basis: type, value, unit, asOf, definition: type,
      support: { supportIndex: 0, text, sources: [{ chunkIndex: 0, url: SOURCE, title: 'reuters.com' }] } } };
}

describe('projectCompanyFacts: card-fact types', () => {
  it('keeps a supported figure with its source statement and drops an unsupported one to Unknown', () => {
    const good = row('funding_total', 53_000_000, 'USD', 'Acme has raised $53 million as of October 1, 2026.', '2026-10-01');
    const roundOk = row('last_round', 5_000_000, 'USD', 'Acme raised $5 million in a Series A round on October 1, 2026.', '2026-10-01');
    const foreign = row('distribution', 60, 'count', 'Zenith is sold in 60 countries as of October 1, 2026.', '2026-10-01');
    const undated = row('revenue', 40_000_000, 'USD', 'Acme reported revenue of $40 million.', '2026-09-30');
    const projected = projectCompanyFacts(company, [good, roundOk, foreign, undated], []);
    const by = (type: MetricType) => projected.find(m => m.metricType === type)!;
    expect(by('funding_total')).toMatchObject({ value: 53_000_000, confidence: 'estimated' });
    expect(by('funding_total').methodNote).toContain('Acme has raised $53 million as of October 1, 2026.');
    expect(by('last_round')).toMatchObject({ value: 5_000_000 });
    expect(by('last_round').methodNote).toContain('Series A');
    expect(by('distribution')).toMatchObject({ value: null, confidence: 'unknown' });
    expect(by('revenue')).toMatchObject({ value: null, confidence: 'unknown' });
  });
});

describe('card-figures hydration prompt', () => {
  it('asks for each card figure with the no-estimate rule and parses new-type claims end to end', async () => {
    const text = [
      'Acme makes premium gin.',
      'Acme has raised a total of USD 53 million as of October 1, 2026.',
    ].join('\n');
    const grounding = extractProviderGrounding(text, {
      groundingChunks: [{ web: { uri: SOURCE, title: 'reuters.com' } }],
      groundingSupports: text.split('\n').map((passage) => {
        const start = text.indexOf(passage);
        return { segment: { text: passage, startIndex: start, endIndex: start + passage.length }, groundingChunkIndices: [0] };
      }),
    });
    const client: LlmClient = {
      ground: vi.fn(async () => ({ text, citations: [{ url: SOURCE, title: 'reuters.com' }], queries: [], grounding })),
      structure: vi.fn(async (_prompt, schema) => schema.parse({ website: 'https://acme.com', metrics: {
        funding_total: { value: 53_000_000, confidence: 'estimated', reportedClaim: { sourceUrl: SOURCE,
          quote: 'Acme has raised a total of USD 53 million as of October 1, 2026.', asOf: '2026-10-01',
          basis: 'funding_total', definition: 'funding_total', unit: 'USD' } },
      } })) as LlmClient['structure'],
    };
    const plan: MarketPlan = { marketName: 'Spirits', vertical: 'Beverage', geography: null, notes: null, searchThemes: [] };
    const result = await hydrateCompanyCard({ candidate: { name: 'Acme', domain: 'acme.com', descriptor: '', cardTypes: ['company'] }, client, plan });
    const groundPrompt = String(vi.mocked(client.ground).mock.calls[0]![0]);
    for (const needle of ['employees', 'annual revenue', 'total funding raised', 'latest funding round', 'countries', 'stockists',
      'not disclosed', 'no estimates of your own', 'names the company']) expect(groundPrompt).toContain(needle);
    const funding = result.metrics.find(m => m.metricType === 'funding_total');
    expect(funding).toMatchObject({ value: 53_000_000, confidence: 'estimated' });
    expect(funding?.citations.length).toBeGreaterThan(0);
  });
});
