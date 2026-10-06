import { describe, expect, it, vi } from 'vitest';
import { hydrateCompanyCard } from './company-agent';
import type { LlmClient } from './types';
import type { OriginalSourceServices } from './original-source';

vi.mock('./logos', () => ({ faviconUrl: () => null, resolveLogo: async () => ({ url: null }) }));
const website = 'https://acme.com';
const url = `${website}/reports/current`;
const asOf = new Date().toISOString().slice(0, 10);
const claims = [
  ['employees', 45, `Acme Inc. reported 45 employees as of ${asOf}.`, 'count'],
  ['arr', 4000000, `Acme Inc. reported ARR of USD 4 million as of ${asOf}.`, 'USD'],
  ['users', 120, `Acme Inc. reported 120 customers as of ${asOf}.`, 'count'],
  ['valuation', 20000000, `Acme Inc. reported valuation of USD 20 million as of ${asOf}.`, 'USD'],
] as const;
function setup(complete = false) {
  const figures = claims.map(([metricType, value, quote, unit]) => ({ metricType, value,
    passageSupport: { sourceUrl: url, quote, asOf, basis: metricType, unit,
      definition: metricType === 'users' ? 'customers' : metricType } }));
  const client: LlmClient = {
    ground: vi.fn(async () => ({ text: `Original source: ${url}`, citations: [{ title: 'Issuer report', url }], queries: [] })),
    structure: vi.fn(async (_prompt, schema) => schema.parse({ metrics: Object.fromEntries(
      (complete ? figures : figures.slice(0, 1)).map(figure => [figure.metricType, { ...figure, confidence: 'verified' }])) })) as LlmClient['structure'],
  };
  const originals: OriginalSourceServices = {
    retrieve: vi.fn(async requestedUrl => ({ requestedUrl, finalUrl: requestedUrl, status: 'retrieved' as const,
      httpStatus: 200, contentHash: 'a'.repeat(64), text: claims.map(claim => claim[2]).join(' '), retrievedAt: new Date().toISOString() })),
    save: vi.fn(async () => {}), list: async () => [],
  };
  const run = () => hydrateCompanyCard({ candidate: { name: 'Acme Inc.', domain: 'acme.com', descriptor: 'Software', cardTypes: ['company'] },
    plan: { marketName: 'Software', vertical: 'Software', geography: null, notes: null, searchThemes: [] },
    client, originalSources: originals, recoverMissingMetrics: true });
  return { client, originals, figures, run };
}
describe('automatic initial metric recovery', () => {
  it('fills all four supported card figures before returning, without a manual hunt', async () => {
    const { client, originals, figures, run } = setup();
    vi.mocked(client.structure).mockImplementationOnce(async (_prompt, schema) => schema.parse({ metrics: {
      employees: { ...figures[0], confidence: 'verified' },
    } }) as never).mockImplementationOnce(async (_prompt, schema) => schema.parse({ figures }) as never);
    const result = await run();
    for (const figure of figures) expect(result.metrics.find(row => row.metricType === figure.metricType))
      .toMatchObject({ value: figure.value, confidence: 'verified', passageSupport: figure.passageSupport });
    expect(result.primaryCard.metrics).toEqual(result.metrics);
    expect(result.memory.card.metrics).toEqual(result.metrics);
    expect(client.ground).toHaveBeenCalledTimes(2);
    expect(client.structure).toHaveBeenCalledTimes(2);
    expect(originals.save).toHaveBeenCalledTimes(2);
    expect(vi.mocked(originals.save).mock.calls[0]![0].receipts).toHaveLength(1);
    expect(vi.mocked(originals.save).mock.calls.every(([attempt]) => attempt.receipts.length <= 2)).toBe(true);
    const prompt = vi.mocked(client.ground).mock.calls[1]![0];
    expect(prompt).toContain('arr, users, valuation');
    expect(prompt).not.toContain('Missing card figures: employees');
    expect(vi.mocked(originals.retrieve).mock.calls.length).toBeLessThanOrEqual(4);
  });
  it('does not spend another search when all four card slots already have accepted evidence', async () => {
    const { client, run } = setup(true);
    await run();
    expect(client.ground).toHaveBeenCalledTimes(1);
    expect(client.structure).toHaveBeenCalledTimes(1);
  });
  it('preserves initial supported figures when the follow-up provider fails', async () => {
    const { client, run } = setup();
    // Only the recovery call fails, not the initial research.
    vi.mocked(client.ground).mockReset().mockResolvedValueOnce({ text: '', citations: [{ title: 'Report', url }], queries: [] })
      .mockRejectedValueOnce(new Error('Provider unavailable'));
    const result = await run();
    expect(result.metrics.find(row => row.metricType === 'employees')?.value).toBe(45);
    expect(result.metrics.find(row => row.metricType === 'arr')?.value).toBeNull();
    expect(client.ground).toHaveBeenCalledTimes(2);
  });
  it('does not accept invented follow-up figures or loop indefinitely', async () => {
    const { client, figures, run } = setup();
    vi.mocked(client.structure).mockImplementationOnce(async (_prompt, schema) => schema.parse({ metrics: {} }) as never)
      .mockImplementationOnce(async (_prompt, schema) => schema.parse({ figures: figures.map(figure => ({ ...figure, value: 999 })) }) as never);
    const result = await run();
    expect(result.metrics.every(row => row.value === null)).toBe(true);
    expect(client.ground).toHaveBeenCalledTimes(2);
    expect(client.structure).toHaveBeenCalledTimes(2);
  });
  it('does not overwrite already accepted headcount during recovery', async () => {
    const { client, figures, run } = setup();
    vi.mocked(client.structure).mockImplementationOnce(async (_prompt, schema) => schema.parse({ metrics: {
      employees: { ...figures[0], confidence: 'verified' },
    } }) as never).mockImplementationOnce(async (_prompt, schema) => schema.parse({ figures: [
      { ...figures[0], value: 999 }, ...figures.slice(1),
    ] }) as never);
    const result = await run();
    expect(result.metrics.find(row => row.metricType === 'employees')?.value).toBe(45);
    expect(result.metrics.find(row => row.metricType === 'arr')?.value).toBe(4000000);
  });
  it('does not swallow a failed evidence write in the follow-up', async () => {
    const { originals, client, run } = setup();
    vi.mocked(originals.save).mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error('Disk full'));
    await expect(run()).rejects.toThrow('Disk full');
    expect(client.structure).toHaveBeenCalledTimes(1);
  });
  it('retains discovered original leads when follow-up search returns no usable citations', async () => {
    const { client, originals, run } = setup();
    vi.mocked(client.ground).mockResolvedValueOnce({ text: '', citations: [{ title: 'Issuer report', url }], queries: [] })
      .mockResolvedValueOnce({ text: 'No new direct locator.', citations: [], queries: [] });
    await run();
    expect(vi.mocked(originals.save).mock.calls[1]![0].receipts).toContainEqual(expect.objectContaining({ requestedUrl: url }));
  });
});
