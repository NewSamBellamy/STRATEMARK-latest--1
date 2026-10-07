import { describe, expect, it, vi } from 'vitest';
import { hydrateCompanyCard, verifyCompanyCardOriginals } from './company-agent';
import { extractProviderGrounding } from './grounding-support';
import type { LlmClient } from './types';
import type { OriginalSourceServices } from './original-source';

vi.mock('./logos', () => ({ faviconUrl: () => null, resolveLogo: async () => ({ url: null }) }));
const url = 'https://acme.com/reports/current';
const asOf = '2026-10-01';
const claims = [
  ['employees', 45, 'Acme Inc. reported 45 employees as of ' + asOf + '.', 'count'],
  ['arr', 4000000, 'Acme Inc. reported ARR of USD 4 million as of ' + asOf + '.', 'USD'],
  ['users', 120, 'Acme Inc. reported 120 customers as of ' + asOf + '.', 'count'],
  ['valuation', 20000000, 'Acme Inc. reported valuation of USD 20 million as of ' + asOf + '.', 'USD'],
] as const;
function setup(complete = false) {
  const figures = claims.map(([metricType, value, quote, unit]) => ({ metricType, value,
    passageSupport: { sourceUrl: url, quote, asOf, basis: metricType, unit,
      definition: metricType === 'users' ? 'customers' : metricType } }));
  const text = claims.map(claim => claim[2]).join('\n');
  const response = { text, citations: [{ title: 'Issuer report', url }], queries: [],
    grounding: extractProviderGrounding(text, {
      groundingChunks: [{ web: { uri: url, title: 'Issuer report' } }],
      groundingSupports: claims.map(claim => ({ segment: { text: claim[2] }, groundingChunkIndices: [0] })),
    }) };
  const client: LlmClient = {
    ground: vi.fn(async () => response),
    structure: vi.fn(async (_prompt, schema) => schema.parse({ metrics: Object.fromEntries(
      (complete ? figures : figures.slice(0, 1)).map(figure => [figure.metricType, { value: figure.value,
        confidence: 'verified', reportedClaim: figure.passageSupport, passageSupport: figure.passageSupport }])) })) as LlmClient['structure'],
  };
  const originals: OriginalSourceServices = {
    retrieve: vi.fn(async requestedUrl => ({ requestedUrl, finalUrl: requestedUrl, status: 'retrieved' as const,
      httpStatus: 200, contentHash: 'a'.repeat(64), text, retrievedAt: '2026-10-06T00:00:00.000Z' })),
    save: vi.fn(async () => {}), list: vi.fn(async () => []),
  };
  const input = { candidate: { name: 'Acme Inc.', domain: 'acme.com', descriptor: 'Software', cardTypes: ['company' as const] },
    plan: { marketName: 'Software', vertical: 'Software', geography: null, notes: null, searchThemes: [] },
    client, originalSources: originals, recoverMissingMetrics: true };
  return { client, originals, figures, response, input, run: () => hydrateCompanyCard(input) };
}

describe('fast initial publication without automatic missing-metric hunts', () => {
  it('publishes all four Google-supported reported figures in one pass without original reads or verified promotion', async () => {
    const s = setup(true); const result = await s.run();
    for (const figure of s.figures) expect(result.metrics.find(row => row.metricType === figure.metricType))
      .toMatchObject({ value: figure.value, confidence: 'estimated', passageSupport: null, lastVerifiedAt: null,
        reportedSupport: { provider: 'google-search', value: figure.value, support: { text: figure.passageSupport.quote } } });
    expect(result.primaryCard.metrics).toEqual(result.metrics); expect(result.memory.card.metrics).toEqual(result.metrics);
    expect(s.client.ground).toHaveBeenCalledTimes(1); expect(s.client.structure).toHaveBeenCalledTimes(1);
    expect(s.originals.retrieve).not.toHaveBeenCalled(); expect(s.originals.save).not.toHaveBeenCalled();
  });
  it('recovers unambiguous omitted literal figures without a missing-metric paid follow-up', async () => {
    const s = setup(); const result = await s.run();
    expect(result.metrics.find(row => row.metricType === 'employees')).toMatchObject({ value: 45, confidence: 'estimated' });
    expect(result.metrics.find(row => row.metricType === 'arr')).toMatchObject({ value: 4000000, confidence: 'estimated' });
    expect(result.metrics.find(row => row.metricType === 'users')).toMatchObject({ value: null, confidence: 'unknown' });
    expect(s.client.ground).toHaveBeenCalledTimes(1); expect(s.client.structure).toHaveBeenCalledTimes(1);
    expect(s.originals.list).not.toHaveBeenCalled(); expect(s.originals.retrieve).not.toHaveBeenCalled();
  });
  it('keeps citation-only metrics unknown even when an original reader could supply the proposed quote', async () => {
    const s = setup(true);
    vi.mocked(s.client.ground).mockResolvedValue({ ...s.response, grounding: undefined });
    const result = await s.run();
    expect(result.metrics.every(row => row.value === null && row.confidence === 'unknown')).toBe(true);
    expect(s.originals.retrieve).not.toHaveBeenCalled(); expect(s.client.ground).toHaveBeenCalledTimes(1);
  });
  it('rejects invented model figures without starting a recovery loop', async () => {
    const s = setup(true);
    vi.mocked(s.client.structure).mockImplementation(async (_prompt, schema) => schema.parse({ metrics: Object.fromEntries(
      s.figures.map(figure => [figure.metricType, { value: 999, confidence: 'verified', reportedClaim: figure.passageSupport }])) }) as never);
    expect((await s.run()).metrics.every(row => row.value === null)).toBe(true);
    expect(s.client.ground).toHaveBeenCalledTimes(1); expect(s.client.structure).toHaveBeenCalledTimes(1);
  });
});

describe('explicit supplementary original verification, not automatic publication', () => {
  it('preserves reported values when manual reads are inconclusive without another search', async () => {
    const s = setup(); const initial = await s.run();
    vi.mocked(s.originals.retrieve).mockImplementation(async requestedUrl => ({ requestedUrl, status: 'unavailable',
      retrievedAt: '2026-10-06T00:00:00.000Z' }));
    const result = await verifyCompanyCardOriginals(initial, s.client, { originalSources: s.originals });
    expect(result.metrics.find(row => row.metricType === 'employees')).toMatchObject({ value: 45, confidence: 'estimated' });
    expect(result.metrics.find(row => row.metricType === 'arr')).toMatchObject({ value: 4000000, confidence: 'estimated' });
    expect(s.originals.save).toHaveBeenCalledTimes(1); expect(s.client.ground).toHaveBeenCalledTimes(1);
  });
  it('does not interpret or publish manual verification after a failed receipt save', async () => {
    const s = setup(); const initial = await s.run(); const before = structuredClone(initial);
    vi.mocked(s.originals.save).mockRejectedValue(new Error('Disk full'));
    await expect(verifyCompanyCardOriginals(initial, s.client, { originalSources: s.originals })).rejects.toThrow('Disk full');
    expect(s.client.structure).toHaveBeenCalledTimes(1); expect(initial).toEqual(before);
  });
  it('preserves human overrides across fast hydration and explicit original checking', async () => {
    const s = setup(true); const initial = await s.run(); const memory = structuredClone(initial.memory);
    memory.card.metrics = memory.card.metrics.map(row => row.metricType === 'employees'
      ? { ...row, value: 77, confidence: 'user_verified', source: 'Analyst confirmation', citations: [], passageSupport: null, reportedSupport: null } : row);
    const refreshed = await hydrateCompanyCard({ ...s.input, existingMemory: memory });
    expect(refreshed.metrics.find(row => row.metricType === 'employees')).toMatchObject({ value: 77, confidence: 'user_verified' });
    const checked = await verifyCompanyCardOriginals(refreshed, s.client, { originalSources: s.originals });
    expect(checked.metrics.find(row => row.metricType === 'employees')).toMatchObject({ value: 77, confidence: 'user_verified' });
    expect(checked.primaryCard.metrics).toEqual(checked.metrics); expect(checked.memory.card.metrics).toEqual(checked.metrics);
  });
});
