import { describe, expect, it, vi } from 'vitest';
import { readCompanyOriginals } from './core-source-coverage';
import { isOriginalSourceAttempt, type OriginalSourceServices } from './original-source';

describe('bounded company source coverage', () => {
  it('uses the retained annual fact accession to read headcount before spending the remaining slots on navigation', async () => {
    const concept = 'https://data.sec.gov/api/xbrl/companyconcept/CIK0000789019/us-gaap/RevenueFromContractWithCustomerExcludingAssessedTax.json';
    const filing = 'https://www.sec.gov/Archives/edgar/data/789019/000119312526323660/0001193125-26-323660-index.htm';
    const sources: OriginalSourceServices = {
      retrieve: vi.fn(async url => ({ requestedUrl: url, finalUrl: url, status: 'retrieved' as const, httpStatus: 200,
        contentHash: 'a'.repeat(64), retrievedAt: '2026-10-06T00:00:00.000Z', truncated: false,
        ...(url === concept ? { format: 'sec-companyconcept' as const, text: JSON.stringify({ cik: 789019,
          entityName: 'MICROSOFT CORPORATION', taxonomy: 'us-gaap', tag: 'RevenueFromContractWithCustomerExcludingAssessedTax',
          units: { USD: [{ start: '2025-07-01', end: '2026-06-30', val: 331839000000,
            accn: '0001193125-26-323660', form: '10-K', filed: '2026-07-29', fp: 'FY' }] } }) } : { text: 'Source text' }) })),
      save: vi.fn(async () => {}), list: async () => [],
    };
    await readCompanyOriginals({ sources, companyId: 'msft', companyName: 'Microsoft Corporation', topic: 'metrics_hunt',
      missing: ['employees', 'arr'], maxSources: 4, citations: [concept, 'https://microsoft.com/earnings',
        'https://microsoft.com/investor', 'https://microsoft.com/stock'].map(url => ({ url, title: '' })) });
    expect(vi.mocked(sources.retrieve).mock.calls.map(([url]) => url)).toEqual([concept, 'https://microsoft.com/earnings', filing, 'https://microsoft.com/stock']);
    expect(sources.save).toHaveBeenCalledTimes(2);
  });
  it('retains four separate disclosures without exceeding two concurrent reads or two receipts per write', async () => {
    let active = 0;
    let peak = 0;
    const sources: OriginalSourceServices = {
      retrieve: vi.fn(async url => {
        peak = Math.max(peak, ++active);
        await Promise.resolve();
        active--;
        return { requestedUrl: url, finalUrl: url, status: 'retrieved' as const, httpStatus: 200,
          text: 'Actual disclosed company information.', contentHash: 'a'.repeat(64), retrievedAt: new Date().toISOString() };
      }), save: vi.fn(async () => {}), list: async () => [],
    };
    const result = await readCompanyOriginals({ sources, companyId: 'acme', companyName: 'Acme Inc.',
      topic: 'metrics_hunt', citations: ['employees', 'revenue', 'customers', 'valuation'].map(type => ({
        url: `https://acme.com/reports/${type}`, title: type,
      })), maxSources: 4, missing: ['employees', 'arr', 'users', 'valuation'] });
    expect(result).toHaveLength(4);
    expect(peak).toBe(2);
    expect(sources.save).toHaveBeenCalledTimes(2);
    expect(vi.mocked(sources.save).mock.calls.every(([attempt]) => isOriginalSourceAttempt(attempt))).toBe(true);
    expect(vi.mocked(sources.retrieve).mock.calls.map(([, scope]) => scope?.metricType))
      .toEqual(['employees', 'arr', 'users', 'valuation']);
  });
  it('does not read the next batch when retaining the first originals fails', async () => {
    const sources: OriginalSourceServices = {
      retrieve: vi.fn(async url => ({ requestedUrl: url, status: 'unavailable' as const, retrievedAt: new Date().toISOString() })),
      save: vi.fn(async () => { throw new Error('Disk full'); }), list: async () => [],
    };
    await expect(readCompanyOriginals({ sources, companyId: 'acme', companyName: 'Acme Inc.', topic: 'metrics_hunt',
      citations: Array.from({ length: 4 }, (_, i) => ({ title: '', url: `https://acme.com/${i}` })), maxSources: 4 }))
      .rejects.toThrow('Disk full');
    expect(sources.retrieve).toHaveBeenCalledTimes(2);
  });
  it('degrades a hung retrieval to an unavailable receipt instead of hanging forever', async () => {
    vi.useFakeTimers();
    try {
      const sources: OriginalSourceServices = {
        retrieve: vi.fn(() => new Promise<never>(() => {})),
        save: vi.fn(async () => {}), list: async () => [],
      };
      const pending = readCompanyOriginals({ sources, companyId: 'acme', companyName: 'Acme Inc.',
        topic: 'metrics_hunt', citations: [{ title: '', url: 'https://acme.com/report' }], maxSources: 1 });
      await vi.advanceTimersByTimeAsync(20_500);
      const receipts = await pending;
      expect(receipts).toHaveLength(1);
      expect(receipts[0]!.status).toBe('unavailable');
      expect(receipts[0]!.reason).toMatch(/20s/);
      expect(sources.save).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });
  it('keeps a retrieval that finishes inside the timeout window', async () => {
    vi.useFakeTimers();
    try {
      const sources: OriginalSourceServices = {
        retrieve: vi.fn(async url => ({ requestedUrl: url, finalUrl: url, status: 'retrieved' as const, httpStatus: 200,
          text: 'Actual disclosed company information.', contentHash: 'a'.repeat(64), retrievedAt: new Date().toISOString() })),
        save: vi.fn(async () => {}), list: async () => [],
      };
      const pending = readCompanyOriginals({ sources, companyId: 'acme', companyName: 'Acme Inc.',
        topic: 'metrics_hunt', citations: [{ title: '', url: 'https://acme.com/report' }], maxSources: 1 });
      await vi.advanceTimersByTimeAsync(100);
      const receipts = await pending;
      expect(receipts).toHaveLength(1);
      expect(receipts[0]!.status).toBe('retrieved');
    } finally {
      vi.useRealTimers();
    }
  });
});
