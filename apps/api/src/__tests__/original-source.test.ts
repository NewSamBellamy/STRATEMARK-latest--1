import { describe, expect, it, vi } from 'vitest';
import { retrieveOriginalSource } from '../lib/original-source';
import { acceptedMetricPassage } from '@mi/research';

const url = 'https://www.sec.gov/Archives/report';
const lookup = vi.fn(async () => ['8.8.8.8']);
const read = vi.fn(async () => ({ status: 200, headers: { 'content-type': 'text/html' }, body: Buffer.from('<h1>Company</h1><script>ignore</script><p>Revenue &amp; customers</p>') }));

describe('bounded original-source retrieval', () => {
  it('retains complete bounded SEC concept JSON with the original byte hash, but does not enable arbitrary JSON sources', async () => {
    const target = 'https://data.sec.gov/api/xbrl/companyconcept/CIK0000789019/us-gaap/RevenueFromContractWithCustomerExcludingAssessedTax.json';
    const body = Buffer.from(JSON.stringify({ cik: 789019, entityName: 'MICROSOFT CORPORATION', padding: 'x'.repeat(6000) }));
    const jsonRead = vi.fn(async () => ({ status: 200, headers: { 'content-type': 'application/json' }, body }));
    const receipt = await retrieveOriginalSource(target, { lookup, read: jsonRead });
    expect(receipt).toMatchObject({ status: 'retrieved', format: 'sec-companyconcept', text: body.toString('utf8'), truncated: false });
    expect(receipt.contentHash).toMatch(/^[a-f0-9]{64}$/);
    expect((await retrieveOriginalSource('https://example.com/data.json', { lookup, read: jsonRead })).status).toBe('unavailable');
    const tooBig = vi.fn(async () => ({ status: 200, headers: { 'content-type': 'application/json' }, body: Buffer.from(' '.repeat(32001)) }));
    expect((await retrieveOriginalSource(target, { lookup, read: tooBig })).status).toBe('unavailable');
  });
  it('resolves grounding through the existing pinned transport and accepts only the final publisher passage', async () => {
    const redirect = 'https://vertexaisearch.cloud.google.com/grounding-api-redirect/report';
    const publisher = 'https://reuters.com/company-report';
    const quote = 'Acme Inc. reported 45 employees as of 2026-10-01.';
    const pageRead = vi.fn(async ({ url: target }: { url: URL }) => target.hostname === 'vertexaisearch.cloud.google.com'
      ? { status: 302, headers: { location: publisher }, body: Buffer.alloc(0) }
      : { status: 200, headers: { 'content-type': 'text/plain' }, body: Buffer.from(quote) });
    const receipt = await retrieveOriginalSource(redirect, { lookup, read: pageRead });
    expect(receipt).toMatchObject({ requestedUrl: redirect, finalUrl: publisher, status: 'retrieved', text: quote });
    expect(pageRead).toHaveBeenCalledTimes(2);
    expect(acceptedMetricPassage({ companyName: 'Acme Inc.', metricType: 'employees', value: 45, originals: [receipt],
      support: { sourceUrl: redirect, quote, asOf: '2026-09-30', basis: 'employees', unit: 'count' } })).toEqual([]);
    expect(acceptedMetricPassage({ companyName: 'Acme Inc.', metricType: 'employees', value: 45, originals: [receipt],
      support: { sourceUrl: redirect, quote, asOf: '2026-10-01', basis: 'employees', unit: 'count' } })[0]?.url).toBe(publisher);
  });
  it('retains a distinct original-text receipt and pins the resolved address', async () => {
    const result = await retrieveOriginalSource(url, { lookup, read });
    expect(result.status).toBe('retrieved');
    expect(result.text).toBe('Company Revenue & customers');
    expect(result.contentHash).toMatch(/^[a-f0-9]{64}$/);
    expect(result.finalUrl).toBe(url);
    expect(read).toHaveBeenCalledWith(expect.objectContaining({ address: '8.8.8.8', url: expect.any(URL), signal: expect.any(AbortSignal) }));
  });

  it.each(['http://sec.gov/', 'https://u:p@sec.gov/', 'https://127.0.0.1/', 'https://[::1]/', 'https://sec.gov:444/', 'https://localhost/'])('blocks unsafe URLs before reading: %s', async (target) => {
    const unsafeRead = vi.fn();
    expect((await retrieveOriginalSource(target, { lookup, read: unsafeRead })).status).toBe('blocked');
    expect(unsafeRead).not.toHaveBeenCalled();
  });

  it.each(['127.0.0.1', '10.1.1.1', '169.254.169.254', '100.64.0.1', '192.168.1.1', '198.18.0.1', '224.0.0.1', '::ffff:127.0.0.1'])('blocks a private or unsupported DNS answer: %s', async (address) => {
    const unsafeRead = vi.fn();
    expect((await retrieveOriginalSource(url, { lookup: async () => ['8.8.8.8', address], read: unsafeRead })).status).toBe('blocked');
    expect(unsafeRead).not.toHaveBeenCalled();
  });

  it('revalidates redirects and never reads their private destination', async () => {
    const redirectedRead = vi.fn(async () => ({ status: 302, headers: { location: 'https://internal.example/' }, body: Buffer.alloc(0) }));
    const result = await retrieveOriginalSource(url, { lookup: async (host) => host === 'internal.example' ? ['10.0.0.1'] : ['8.8.8.8'], read: redirectedRead });
    expect(result.status).toBe('blocked');
    expect(redirectedRead).toHaveBeenCalledTimes(1);
  });

  it('bounds redirect loops', async () => {
    const redirect = vi.fn(async () => ({ status: 302, headers: { location: url }, body: Buffer.alloc(0) }));
    expect((await retrieveOriginalSource(url, { lookup, read: redirect })).status).toBe('unavailable');
    expect(redirect).toHaveBeenCalledTimes(4);
  });

  it.each([
    { status: 403, headers: { 'content-type': 'text/html' }, body: Buffer.from('Paywall') },
    { status: 200, headers: { 'content-type': 'application/pdf' }, body: Buffer.from('PDF') },
    { status: 200, headers: { 'content-type': 'text/html', 'x-robots-tag': 'noarchive' }, body: Buffer.from('Do not retain') },
    { status: 200, headers: { 'content-type': 'text/html' }, body: Buffer.from('<meta name="robots" content="noarchive"><p>Private</p>') },
    { status: 200, headers: { 'content-type': 'text/html' }, body: Buffer.alloc(2 * 1024 * 1024 + 1, 'a') },
  ])('does not turn blocked/unsupported content into evidence', async (response) => {
    const result = await retrieveOriginalSource(url, { lookup, read: async () => response });
    expect(result.status).not.toBe('retrieved');
    expect(result.text).toBeUndefined();
  });

  it('reports network failure without exposing transport details', async () => {
    const result = await retrieveOriginalSource(url, { lookup, read: async () => { throw new Error('internal secret'); } });
    expect(result.status).toBe('unavailable');
    expect(JSON.stringify(result)).not.toContain('internal secret');
  });

  it('reads a bounded annual-report-sized page and retains only the relevant excerpt', async () => {
    const quote = 'Acme Inc. reported 450 employees on October 1, 2026.';
    const body = `${'Navigation. '.repeat(50000)}${quote}${' Appendix.'.repeat(10000)}`;
    const pageRead = vi.fn(async () => ({ status: 200, headers: { 'content-type': 'text/html' }, body: Buffer.from(body) }));
    const receipt = await retrieveOriginalSource(url, { lookup, read: pageRead },
      { companyId: 'acme', companyName: 'Acme Inc.', metricType: 'employees' });
    expect(receipt).toMatchObject({ status: 'retrieved', truncated: true });
    expect(receipt.text).toHaveLength(4000);
    expect(receipt.text).toContain(quote);
    expect(receipt.contentHash).toMatch(/^[a-f0-9]{64}$/);
    expect(pageRead).toHaveBeenCalledTimes(1);
    expect(acceptedMetricPassage({ companyName: 'Acme Inc.', metricType: 'employees', value: 450, originals: [receipt],
      support: { sourceUrl: url, quote, asOf: '2026-10-01', basis: 'employees', unit: 'count' } })).toHaveLength(1);
  });

  it('explains streamed oversize failures without leaking transport errors or partial evidence', async () => {
    const result = await retrieveOriginalSource(url, { lookup, read: async () => {
      throw Object.assign(new Error('internal secret'), { code: 'SOURCE_TOO_LARGE' });
    } });
    expect(result).toMatchObject({ status: 'unavailable', reason: 'Source exceeds the 2 MB document limit' });
    expect(result.text).toBeUndefined();
    expect(result.contentHash).toBeUndefined();
    expect(JSON.stringify(result)).not.toContain('internal secret');
  });

  it('bounds even a stalled DNS lookup', async () => {
    vi.useFakeTimers();
    try {
      const pending = retrieveOriginalSource(url, { lookup: () => new Promise(() => {}), read });
      await vi.advanceTimersByTimeAsync(6000);
      expect((await pending).reason).toBe('Source retrieval timed out');
    } finally { vi.useRealTimers(); }
  });

  it('retains a bounded extract and marks truncation rather than pretending completeness', async () => {
    const result = await retrieveOriginalSource(url, { lookup, read: async () => ({ status: 200, headers: { 'content-type': 'text/plain' }, body: Buffer.from('a'.repeat(5000)) }) });
    expect(result.text).toHaveLength(4000);
    expect(result.truncated).toBe(true);
  });
  it('passes scope into the shared native transport without another network request', async () => {
    const quote = 'Acme Inc. reported 45 employees as of 2026-10-01.';
    const body = `Other Inc. reported 900 employees, USD 50 million ARR and 100 active users.${' filler '.repeat(1100)}${quote}${' appendix '.repeat(600)}`;
    const pageRead = vi.fn(async () => ({ status: 200, headers: { 'content-type': 'text/plain' }, body: Buffer.from(body) }));
    const receipt = await retrieveOriginalSource(url, { lookup, read: pageRead }, { companyId: 'acme', companyName: 'Acme Inc.', metricType: 'employees' });
    expect(receipt.text).toContain(quote);
    expect(receipt.text).not.toContain('Other Inc.');
    expect(body.replace(/\s+/g, ' ').trim()).toContain(receipt.text);
    expect(pageRead).toHaveBeenCalledTimes(1);
    const support = { sourceUrl: url, quote, asOf: '2026-10-01', basis: 'employees' as const, unit: 'count' as const };
    const claim = { companyName: 'Acme Inc.', metricType: 'employees' as const, value: 45, originals: [receipt], support };
    expect(acceptedMetricPassage(claim)).toHaveLength(1);
    expect(acceptedMetricPassage({ ...claim, companyName: 'Other Inc.' })).toEqual([]);
  });

  it('retains business evidence beyond a long navigation prefix without another fetch', async () => {
    const passage = 'Acme Inc. reported 450 employees on October 1, 2026.';
    const body = `${'Navigation links and legal menus. '.repeat(240)}${passage}${' Appendix text.'.repeat(500)}`;
    const pageRead = vi.fn(async () => ({ status: 200, headers: { 'content-type': 'text/plain' }, body: Buffer.from(body) }));
    const result = await retrieveOriginalSource(url, { lookup, read: pageRead });
    expect(result.text).toContain(passage);
    expect(body).toContain(result.text);
    expect(result.text).toHaveLength(4000);
    expect(result.truncated).toBe(true);
    expect(pageRead).toHaveBeenCalledTimes(1);
  });

  it('feeds an intact late original passage into the shared verification gate', async () => {
    const quote = 'Acme Inc. reported 450 employees on October 1, 2026.';
    const body = `${'Menu. '.repeat(1500)}${quote}${' Appendix.'.repeat(500)}`;
    const receipt = await retrieveOriginalSource(url, { lookup, read: async () => ({ status: 200, headers: { 'content-type': 'text/plain' }, body: Buffer.from(body) }) });
    const input = { companyName: 'Acme Inc.', metricType: 'employees' as const, value: 450, originals: [receipt], support: { sourceUrl: url, quote, asOf: '2026-10-01', basis: 'employees' as const, unit: 'count' as const } };
    expect(acceptedMetricPassage(input)).toHaveLength(1);
    expect(acceptedMetricPassage({ ...input, companyName: 'Other Inc.' })).toEqual([]);
    expect(acceptedMetricPassage({ ...input, value: 451 })).toEqual([]);
  });

  it('does not select business figures hidden in scripts, styles or comments', async () => {
    const hidden = 'Acme Inc. reported 450 employees on October 1, 2026.';
    const body = `<p>${'Menu. '.repeat(1000)}</p><script>${hidden}</script><style>${hidden}</style><!-- ${hidden} --><p>Visible narrative.</p>`;
    const result = await retrieveOriginalSource(url, { lookup, read: async () => ({ status: 200, headers: { 'content-type': 'text/html' }, body: Buffer.from(body) }) });
    expect(result.text).not.toContain('450 employees');
    expect(result.text).toBe('Menu. '.repeat(1000).trim().slice(0, 4000));
  });
});
