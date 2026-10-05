import { describe, expect, it, vi } from 'vitest';
import { coalesceOriginalSources } from './original-source';
const receipt = (url: string) => ({ requestedUrl: url, status: 'retrieved' as const, retrievedAt: '2026-10-03T00:00:00.000Z', text: 'Original extract' });
describe('bounded original read coalescing', () => {
  it('captures scope before an asynchronous caller can change its cache identity', async () => {
    const read = vi.fn(async (url: string, scope?: { companyName: string }) => ({ ...receipt(url), text: scope!.companyName }));
    const cached = coalesceOriginalSources(read);
    const scope = { companyId: 'a', companyName: 'Acme', metricType: 'employees' };
    const pending = cached('https://sec.gov/shared', scope);
    scope.companyName = 'Other';
    expect((await pending).text).toBe('Acme');
  });
  it('does not reuse a different company or metric excerpt for the same URL', async () => {
    const read = vi.fn(async (url: string, scope?: { companyName: string; metricType?: string }) => ({ ...receipt(url), text: `${scope?.companyName}:${scope?.metricType}` }));
    const cached = coalesceOriginalSources(read);
    const a = { companyId: 'a', companyName: 'Acme', metricType: 'employees' };
    const b = { companyId: 'b', companyName: 'Other', metricType: 'employees' };
    const url = 'https://sec.gov/shared';
    expect((await cached(url, a)).text).toBe('Acme:employees');
    expect((await cached(url, b)).text).toBe('Other:employees');
    expect((await cached(url, { ...a, metricType: 'arr' })).text).toBe('Acme:arr');
    await cached(url, { ...a });
    expect(read).toHaveBeenCalledTimes(3);
  });
  it('coalesces concurrent reads and returns isolated copies', async () => {
    const read = vi.fn(async (url: string) => receipt(url));
    const cached = coalesceOriginalSources(read);
    const [a, b] = await Promise.all([cached('https://sec.gov/a'), cached('https://sec.gov/a')]);
    expect(read).toHaveBeenCalledTimes(1);
    a.text = 'modified';
    expect(b.text).toBe('Original extract');
  });
  it('reuses a successful receipt briefly without changing its retrieval date', async () => {
    let now = 0;
    const read = vi.fn(async (url: string) => receipt(url));
    const cached = coalesceOriginalSources(read, () => now);
    await cached('https://sec.gov/a');
    expect((await cached('https://sec.gov/a')).retrievedAt).toBe('2026-10-03T00:00:00.000Z');
    expect(read).toHaveBeenCalledTimes(1);
    now = 30001;
    await cached('https://sec.gov/a');
    expect(read).toHaveBeenCalledTimes(2);
  });
  it('does not cache unavailable sources or rejected operations', async () => {
    const read = vi.fn().mockRejectedValueOnce(new Error('temporary')).mockResolvedValue({ requestedUrl: 'https://sec.gov/a', status: 'unavailable', retrievedAt: '2026-10-03T00:00:00.000Z' });
    const cached = coalesceOriginalSources(read);
    await expect(cached('https://sec.gov/a')).rejects.toThrow('temporary');
    await cached('https://sec.gov/a');
    await cached('https://sec.gov/a');
    expect(read).toHaveBeenCalledTimes(3);
  });
  it('bounds cached entries instead of keeping every researched URL', async () => {
    const read = vi.fn(async (url: string) => receipt(url));
    const cached = coalesceOriginalSources(read);
    for (let i = 0; i < 33; i++) await cached(`https://sec.gov/${i}`);
    await cached('https://sec.gov/0');
    expect(read).toHaveBeenCalledTimes(34);
    await cached('https://sec.gov/32');
    expect(read).toHaveBeenCalledTimes(34);
  });
});
