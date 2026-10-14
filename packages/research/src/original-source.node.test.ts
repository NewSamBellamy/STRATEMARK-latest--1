/**
 * Live-verified regressions (WS7): each case mirrors a real receipt the
 * LIVE_LANES run produced against the official endpoints. The structured
 * lanes die at the reader's content gate unless these three behaviors hold:
 * JSON APIs are evidence, the ticker map accepts its lookup parameter, and
 * the ADV report arrives as application/octet-stream.
 */
import { describe, expect, it } from 'vitest';
import { retrieveOriginalSource, type SourceTransport } from './original-source.node';

function transportFor(
  respond: (url: URL) => { status: number; headers: Record<string, string | undefined>; body: Buffer },
): SourceTransport {
  return {
    lookup: async () => ['93.184.216.34'],
    read: async ({ url }) => respond(url),
  };
}

describe('structured-lane reader regressions (live-verified)', () => {
  it('retains JSON API responses as evidence, bounded and parse-validated', async () => {
    const api = 'https://query1.finance.yahoo.com/v8/finance/chart/AAPL';
    const json = '{"chart":{"result":[{"meta":{"symbol":"AAPL","regularMarketPrice":227.5}}]}}';
    const ok = await retrieveOriginalSource(api, transportFor(() => ({
      status: 200, headers: { 'content-type': 'application/json' }, body: Buffer.from(json),
    })));
    expect(ok.status).toBe('retrieved');
    expect(ok.text).toBe(json);

    const invalid = await retrieveOriginalSource(api, transportFor(() => ({
      status: 200, headers: { 'content-type': 'application/json' }, body: Buffer.from('<html>blocked</html>'),
    })));
    expect(invalid.status).toBe('unavailable');
    expect(invalid.reason).toBe('Source did not return valid JSON');

    const oversized = await retrieveOriginalSource(api, transportFor(() => ({
      status: 200, headers: { 'content-type': 'application/json' },
      body: Buffer.from(`{"x":"${'a'.repeat(33000)}"}`),
    })));
    expect(oversized.status).toBe('unavailable');
    expect(oversized.reason).toBe('JSON source exceeds the retained document limit');
  });

  it('retains the IAPD firm search as a bounded slice that keeps every firm row', async () => {
    // Apollo's live answer was 41 KB — past both the 32 KB JSON bound and the
    // 4 KB retained-attempt bound, so the whole attempt (PDF proof included)
    // used to be discarded. The slice drops relying-adviser rosters and
    // unrelated DBAs, never a competing firm.
    const iapd = 'https://api.adviserinfo.sec.gov/search/firm?query=Apollo%20Global%20Management&hl=1';
    const relying = Array.from({ length: 400 }, (_, i) => `APOLLO FUND ${i} MANAGEMENT, LLC (RELYING ADVISER)`);
    const body = JSON.stringify({ hits: { total: 2, hits: [
      { _source: { firm_source_id: '143161', firm_name: 'APOLLO CAPITAL MANAGEMENT, L.P.', firm_ia_full_sec_number: '801-67592',
        firm_ia_scope: 'ACTIVE', firm_other_names: [...relying, 'APOLLO CAPITAL MANAGEMENT, L.P.'] } },
      { _source: { firm_source_id: '151243', firm_name: 'APOLLO GLOBAL REAL ESTATE MANAGEMENT, L.P.', firm_ia_full_sec_number: '801-70669',
        firm_ia_scope: 'INACTIVE', firm_other_names: ['APOLLO GLOBAL REAL ESTATE MANAGEMENT, L.P.'] } },
    ] } });
    expect(body.length).toBeGreaterThan(20_000);
    const receipt = await retrieveOriginalSource(iapd, transportFor(() => ({
      status: 200, headers: { 'content-type': 'application/json' }, body: Buffer.from(body),
    })));
    expect(receipt.status).toBe('retrieved');
    expect(receipt.text!.length).toBeLessThanOrEqual(4000);
    expect(receipt.text).toContain('"crd":"143161"');
    expect(receipt.text).toContain('"crd":"151243"');
    expect(receipt.text).not.toContain('RELYING');
    expect(receipt.contentHash).toMatch(/^[a-f0-9]{64}$/);

    const invalid = await retrieveOriginalSource(iapd, transportFor(() => ({
      status: 200, headers: { 'content-type': 'application/json' }, body: Buffer.from('{"error":"blocked"}'),
    })));
    expect(invalid.status).not.toBe('retrieved');
  });

  it('slices the official ticker map when the lookup parameter is present', async () => {
    const full = JSON.stringify({
      0: { cik_str: 320193, ticker: 'AAPL', title: 'Apple Inc.' },
      1: { cik_str: 1786209, ticker: 'ZM', title: 'Zoom Video Communications, Inc.' },
    });
    const receipt = await retrieveOriginalSource(
      'https://www.sec.gov/files/company_tickers.json?lookup=Apple%20Inc.',
      transportFor(() => ({ status: 200, headers: { 'content-type': 'application/json' }, body: Buffer.from(full) })),
    );
    expect(receipt.status).toBe('retrieved');
    expect(receipt.text).toContain('AAPL');
    expect(receipt.text?.length ?? 0).toBeLessThan(full.length);
  });

  it('accepts the ADV report served as application/octet-stream', async () => {
    const receipt = await retrieveOriginalSource(
      'https://reports.adviserinfo.sec.gov/reports/ADV/160489/PDF/160489.pdf',
      transportFor(() => ({
        status: 200, headers: { 'content-type': 'application/octet-stream' }, body: Buffer.from('not a real pdf'),
      })),
    );
    // The type gate must pass — extraction (covered by the sec-adv fixtures)
    // is the real validator, and its failure lands in the outer catch.
    expect(receipt.reason).not.toBe('ADV report did not return a PDF');
  });
});
