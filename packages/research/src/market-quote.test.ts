/**
 * market-quote — the estimated market-cap lane, fixtures shaped like the real
 * Yahoo v8 chart response, the SEC company_tickers.json map, and the SEC XBRL
 * dei EntityCommonStockSharesOutstanding concept (Apple, CIK 320193).
 */
import { describe, expect, it } from 'vitest';
import type { OriginalSourceReceipt } from './original-source';
import {
  marketCapEstimate,
  parseQuoteMeta,
  parseSharesOutstanding,
  parseTickerMatches,
  secSharesConceptUrl,
  selectTickerMapSlice,
  yahooChartUrl,
} from './market-quote';

const CHART_JSON = JSON.stringify({
  chart: {
    result: [{
      meta: {
        currency: 'USD', symbol: 'AAPL', exchangeName: 'NMS', fullExchangeName: 'NasdaqGS',
        instrumentType: 'EQUITY', regularMarketTime: 1791576000, regularMarketPrice: 336.64,
        longName: 'Apple Inc.', shortName: 'Apple Inc.',
      },
      timestamp: [1791576000],
      indicators: { quote: [{ close: [336.64] }] },
    }],
    error: null,
  },
});

const TICKER_MAP_JSON = JSON.stringify({
  '0': { cik_str: 320193, ticker: 'AAPL', title: 'Apple Inc.' },
  '1': { cik_str: 789019, ticker: 'MSFT', title: 'MICROSOFT CORP' },
  '2': { cik_str: 1318605, ticker: 'TSLA', title: 'Tesla, Inc.' },
});

const SHARES_JSON = JSON.stringify({
  cik: 320193, taxonomy: 'dei', tag: 'EntityCommonStockSharesOutstanding',
  label: 'Entity Common Stock, Shares Outstanding',
  entityName: 'Apple Inc.',
  units: { shares: [
    { end: '2025-09-27', val: 14840392000, accn: '0000320193-25-000073', fy: 2025, fp: 'FY', form: '10-K', filed: '2025-10-31' },
    { end: '2025-06-28', val: 14957797000, accn: '0000320193-25-000058', fy: 2025, fp: 'Q3', form: '10-Q', filed: '2025-08-01' },
  ] },
});

function receipt(url: string, text: string, overrides: Partial<OriginalSourceReceipt> = {}): OriginalSourceReceipt {
  return {
    requestedUrl: url, finalUrl: url, status: 'retrieved', httpStatus: 200,
    retrievedAt: '2026-10-09T00:00:00.000Z', contentHash: 'b'.repeat(64), text, truncated: false, ...overrides,
  };
}

describe('parseQuoteMeta', () => {
  it('reads the last traded price with its market date', () => {
    const meta = parseQuoteMeta(CHART_JSON)!;
    expect(meta).toMatchObject({ symbol: 'AAPL', currency: 'USD', price: 336.64, name: 'Apple Inc.' });
    expect(meta.asOf).toBe(new Date(1791576000 * 1000).toISOString().slice(0, 10));
  });

  it('yields nothing for malformed payloads', () => {
    expect(parseQuoteMeta('{"chart":{"result":[],"error":null}}')).toBeNull();
    expect(parseQuoteMeta('not json')).toBeNull();
  });
});

describe('parseTickerMatches / selectTickerMapSlice', () => {
  it('matches on the suffix-insensitive company key', () => {
    expect(parseTickerMatches(TICKER_MAP_JSON, 'Apple Inc')).toEqual([{ cik: '320193', ticker: 'AAPL', title: 'Apple Inc.' }]);
    expect(parseTickerMatches(TICKER_MAP_JSON, 'TESLA INC')).toEqual([{ cik: '1318605', ticker: 'TSLA', title: 'Tesla, Inc.' }]);
    expect(parseTickerMatches(TICKER_MAP_JSON, 'Microsoft Corporation')).toEqual([{ cik: '789019', ticker: 'MSFT', title: 'MICROSOFT CORP' }]);
    expect(parseTickerMatches(TICKER_MAP_JSON, 'Andreessen Horowitz')).toEqual([]);
  });

  it('slices the map to the matched entries for the reader', () => {
    const slice = selectTickerMapSlice(TICKER_MAP_JSON, 'Apple Inc');
    expect(JSON.parse(slice)).toEqual({ lookupName: 'Apple Inc', matches: [{ cik: '320193', ticker: 'AAPL', title: 'Apple Inc.' }] });
  });
});

describe('parseSharesOutstanding', () => {
  it('takes the latest reported cover-page share count', () => {
    const shares = parseSharesOutstanding(SHARES_JSON, '0000320193')!;
    expect(shares).toMatchObject({ cik: '320193', value: 14_840_392_000, asOf: '2025-09-27', form: '10-K' });
  });

  it('refuses a CIK mismatch', () => {
    expect(parseSharesOutstanding(SHARES_JSON, '0000789019')).toBeNull();
  });
});

describe('marketCapEstimate', () => {
  const receipts = [
    receipt(yahooChartUrl('AAPL'), CHART_JSON),
    receipt(secSharesConceptUrl('320193'), SHARES_JSON, { format: 'sec-companyconcept' as const }),
  ];

  it('combines the two dated facts into an honest estimated figure', () => {
    const estimate = marketCapEstimate('Apple Inc', receipts, 'Apple Inc.')!;
    expect(estimate.value).toBe(Math.round(336.64 * 14_840_392_000));
    expect(estimate.currency).toBe('USD');
    expect(estimate.symbol).toBe('AAPL');
    expect(estimate.methodNote).toContain('A computation from two reported figures');
    expect(estimate.citations).toHaveLength(2);
  });

  it('refuses identity mismatches, missing receipts, and non-USD prices', () => {
    expect(marketCapEstimate('Andreessen Horowitz', receipts, null)).toBeNull();
    expect(marketCapEstimate('Apple Inc', [receipts[0]!], 'Apple Inc.')).toBeNull();
    const eur = CHART_JSON.replace('"currency":"USD"', '"currency":"EUR"');
    expect(marketCapEstimate('Apple Inc', [receipt(yahooChartUrl('AAPL'), eur), receipts[1]!], 'Apple Inc.')).toBeNull();
    expect(marketCapEstimate('Apple Inc', receipts.map((r) => ({ ...r, status: 'blocked' as const })), 'Apple Inc.')).toBeNull();
  });
});
