import { describe, expect, it, vi } from 'vitest';
import { hydrateCompanyCard } from './company-agent';
import type { LlmClient, CompanyCandidate, MarketPlan } from './types';
import type { OriginalSourceServices } from './original-source';
import { discoverDeckStubs, runDeckResearch } from './pipeline';

vi.mock('./logos', () => ({ faviconUrl: () => null, resolveLogo: async () => ({ url: null }) }));
const url = 'https://sec.gov/Archives/acme';
const quote = 'Acme Inc. reported 45 employees as of 2026-10-01.';
const candidate: CompanyCandidate = { name: 'Acme Inc.', domain: 'acme.com', descriptor: 'Business software', cardTypes: ['company'] };
const plan: MarketPlan = { marketName: 'Software', vertical: 'SaaS', geography: null, notes: null, searchThemes: [] };

function fixture(proof = true, text = quote) {
  const client: LlmClient = {
    ground: vi.fn(async () => ({ text: 'Provider says 45 employees.', citations: [{ title: 'SEC', url }], queries: [] })),
    structure: vi.fn(async (_prompt, schema) => schema.parse({
      oneLiner: 'Business software', website: 'https://acme.com',
      metrics: { employees: { value: 45, confidence: 'verified', sourceIndex: 0,
        ...(proof ? { passageSupport: { sourceUrl: url, quote, asOf: '2026-10-01', basis: 'employees', unit: 'count' } } : {}) } },
      facts: { headcount: 45, publicUserFootprint: 1000 },
    })) as LlmClient['structure'],
  };
  const originals: OriginalSourceServices = {
    retrieve: vi.fn(async (requestedUrl: string) => ({ requestedUrl, finalUrl: requestedUrl, status: 'retrieved' as const, httpStatus: 200, contentHash: 'a'.repeat(64), text, retrievedAt: '2026-10-04T00:00:00.000Z' })),
    save: vi.fn(async () => {}), list: async () => [],
  };
  return { client, originals };
}

describe('initial company original-evidence publication', () => {
  it.each([
    'Acme Inc. partners with Beta. Beta reported 45 employees as of 2026-10-01.',
    'Acme Inc. reported 45 employees in an article published on 2026-10-01.',
  ])('keeps ambiguous original claims unknown on both card and retained memory: %s', async (text) => {
    const { client, originals } = fixture(true, text);
    client.structure = vi.fn(async (_prompt, schema) => schema.parse({ metrics: {
      employees: { value: 45, confidence: 'verified', sourceIndex: 0, passageSupport: {
        sourceUrl: url, quote: text, asOf: '2026-10-01', basis: 'employees', unit: 'count',
      } },
    } })) as LlmClient['structure'];
    const result = await hydrateCompanyCard({ candidate, client, plan, originalSources: originals });
    expect(result.metrics.find((metric) => metric.metricType === 'employees')).toMatchObject({ value: null, confidence: 'unknown' });
    expect(result.primaryCard.metrics).toEqual(result.metrics);
    expect(result.memory.card.metrics).toEqual(result.metrics);
    expect(originals.save).toHaveBeenCalledTimes(1);
    expect(client.ground).toHaveBeenCalledTimes(1);
    expect(client.structure).toHaveBeenCalledTimes(1);
  });
  it('does not publish citation-only model figures on the protected path', async () => {
    const { client, originals } = fixture(false);
    const result = await hydrateCompanyCard({ candidate, client, plan, originalSources: originals });
    expect(result.metrics.find((m) => m.metricType === 'employees')).toMatchObject({ value: null, confidence: 'unknown' });
  });
  it('publishes supported figures consistently without filling missing ARR from headcount', async () => {
    const { client, originals } = fixture();
    const result = await hydrateCompanyCard({ candidate, client, plan, originalSources: originals });
    expect(result.metrics.find((m) => m.metricType === 'employees')).toMatchObject({ value: 45, confidence: 'verified', source: url });
    expect(result.metrics.find((m) => m.metricType === 'employees')!.methodNote).toContain('2026-10-01');
    expect(result.metrics.find((m) => m.metricType === 'arr')).toMatchObject({ value: null, confidence: 'unknown' });
    expect(result.primaryCard.metrics).toEqual(result.metrics);
    expect(result.memory.card.metrics).toEqual(result.metrics);
    expect(client.ground).toHaveBeenCalledTimes(1);
    expect(client.structure).toHaveBeenCalledTimes(1);
  });
  it('keeps a supported zero ARR instead of replacing it with a headcount proxy', async () => {
    const zeroQuote = 'Acme Inc. reported ARR of USD 0 as of 2026-10-01.';
    const { client, originals } = fixture(true, zeroQuote);
    client.structure = (async (_prompt, schema) => schema.parse({ metrics: {
      arr: { value: 0, confidence: 'verified', sourceIndex: 0, passageSupport: {
        sourceUrl: url, quote: zeroQuote, asOf: '2026-10-01', basis: 'arr', unit: 'USD',
      } },
    }, facts: { headcount: 45 } })) as LlmClient['structure'];
    const result = await hydrateCompanyCard({ candidate, client, plan, originalSources: originals });
    expect(result.metrics.find((metric) => metric.metricType === 'arr')).toMatchObject({ value: 0, confidence: 'verified' });
  });
  it.each(['Publisher homepage.', quote.replace('Acme Inc.', 'Other Inc.')])('rejects missing or wrong-company original text: %s', async (text) => {
    const { client, originals } = fixture(true, text);
    const result = await hydrateCompanyCard({ candidate, client, plan, originalSources: originals });
    expect(result.metrics.every((m) => m.value === null && m.confidence === 'unknown')).toBe(true);
  });
  it('persists scoped originals before interpretation and includes them as untrusted data', async () => {
    const { client, originals } = fixture();
    await hydrateCompanyCard({ candidate, client, plan, originalSources: originals, companyId: 'cmp_acme' });
    expect(originals.save).toHaveBeenCalledWith(expect.objectContaining({ companyId: 'cmp_acme', metricType: 'company_profile', receipts: [expect.objectContaining({ text: quote })] }));
    expect(vi.mocked(originals.save).mock.invocationCallOrder[0]).toBeLessThan(vi.mocked(client.structure).mock.invocationCallOrder[0]!);
    expect(vi.mocked(client.structure).mock.calls[0]![0]).toContain('UNTRUSTED ORIGINAL EXTRACTS');
    expect(vi.mocked(client.structure).mock.calls[0]![0]).toContain(quote);
  });
  it('does not interpret or publish when original evidence cannot be saved', async () => {
    const { client, originals } = fixture();
    originals.save = vi.fn(async () => { throw new Error('Disk full'); });
    await expect(hydrateCompanyCard({ candidate, client, plan, originalSources: originals })).rejects.toThrow('Disk full');
    expect(client.structure).not.toHaveBeenCalled();
  });
  it('does not expose discovery headline numbers before original checking', async () => {
    const { client, originals } = fixture();
    client.structure = (async (prompt, schema) => schema.parse(prompt.includes('market definition')
      ? plan : { companies: [{ ...candidate, reportedArr: 9000000000, reportedHeadcount: 45 }] })) as LlmClient['structure'];
    const result = await discoverDeckStubs({ prompt: 'Software', region: null }, client, {
      apiKey: '', originalSources: originals, catalogMax: 1, catalogPasses: 0,
      coverage: { companies: { min: 1, target: 1, max: 1 } },
    });
    expect(result.cards).toHaveLength(1);
    expect(result.cards[0]!.metrics).toEqual([]);
  });
  it('retains original checking when a deck resumes from its saved catalog', async () => {
    const { client, originals } = fixture(false);
    const timestamp = new Date().toISOString();
    const result = await runDeckResearch({ prompt: 'Software', region: null }, client, {
      apiKey: '', originalSources: originals,
      resume: { plan, candidates: [candidate], completedCards: [],
        market: { id: 'mkt_test', name: 'Software', scopeDefinition: { vertical: 'SaaS', geography: null, notes: null }, refreshCadence: 'weekly', createdAt: timestamp },
        deck: { id: 'dck_test', marketId: 'mkt_test', createdAt: timestamp, lastRefreshedAt: null } },
    });
    const card = result.cards.find((entry) => entry.company?.name === candidate.name)!;
    expect(card.metrics.length).toBeGreaterThan(0);
    expect(card.metrics.every((metric) => metric.value === null && metric.confidence === 'unknown')).toBe(true);
    expect(originals.save).toHaveBeenCalledTimes(1);
  });
});
