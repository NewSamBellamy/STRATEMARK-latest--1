// Regressions from the 2026-10-10 live "AI-native accounting software" deck.
import { describe, expect, it } from 'vitest';
import { websiteUrlOf } from './util';
import { employeeBandIn, providerCompanySummary, reportedCompanyMetrics } from './reported-metrics';
import { extractProviderGrounding } from './grounding-support';
import { enrichmentOutSchema } from './schemas';
import { collectLogoCandidates, isThirdPartyMark } from './brand/logo-candidates';

describe('websiteUrlOf', () => {
  it('turns the bare hosts models return into URLs the official-host gates can parse', () => {
    expect(websiteUrlOf('rillet.com')).toBe('https://rillet.com');
    expect(websiteUrlOf('www.rillet.com')).toBe('https://www.rillet.com');
    expect(websiteUrlOf(' quickbooks.intuit.com ')).toBe('https://quickbooks.intuit.com');
  });
  it('passes full URLs through and rejects non-hosts', () => {
    expect(websiteUrlOf('https://xero.com')).toBe('https://xero.com');
    expect(websiteUrlOf('localhost')).toBeNull();
    expect(websiteUrlOf('not a site')).toBeNull();
    expect(websiteUrlOf('ftp://x.com')).toBeNull();
    expect(websiteUrlOf(null)).toBeNull();
  });
});

describe('company summary', () => {
  it('never uses a statement about a missing figure as the description', () => {
    const text = 'Skydio, Inc. is a private company, so it has no market cap.\n\nSkydio, Inc. builds autonomous drones for inspection and public safety.';
    const segments = text.split('\n\n');
    const grounding = extractProviderGrounding(text, {
      groundingChunks: [{ web: { uri: 'https://vertexaisearch.cloud.google.com/grounding-api-redirect/s', title: 'skydio.com' } }],
      groundingSupports: segments.map((passage) => {
        const start = text.indexOf(passage);
        return { segment: { text: passage, startIndex: start, endIndex: start + passage.length }, groundingChunkIndices: [0] };
      }),
    });
    expect(providerCompanySummary('Skydio, Inc.', 'https://www.skydio.com', text, grounding)?.summary)
      .toBe('Skydio, Inc. builds autonomous drones for inspection and public safety.');
  });
});

describe('employee bands', () => {
  it('rejects a band too wide to say anything (Campfire "50 to 5,000")', () => {
    expect(employeeBandIn('Campfire has a headcount ranging from 50 to 5,000 employees as of July 13, 2026.')).toBeNull();
  });
  it('keeps the standard registry bands', () => {
    expect(employeeBandIn('Acme has 1 to 10 employees.')).toEqual({ low: 1, high: 10 });
    expect(employeeBandIn('Acme has 11-50 employees.')).toEqual({ low: 11, high: 50 });
    expect(employeeBandIn('Acme has 1,001-5,000 employees.')).toEqual({ low: 1001, high: 5000 });
  });
});

describe('undated market cap', () => {
  const sourceUrl = 'https://vertexaisearch.cloud.google.com/grounding-api-redirect/xero';
  const rows = (quote: string, asOf: string | null) => {
    const grounding = extractProviderGrounding(quote, {
      groundingChunks: [{ web: { uri: sourceUrl, title: 'asx.com.au' } }],
      groundingSupports: [{ segment: { text: quote, startIndex: 0, endIndex: quote.length }, groundingChunkIndices: [0] }],
    });
    return reportedCompanyMetrics({ companyId: 'xero', companyName: 'Xero', website: 'https://xero.com',
      enrichment: enrichmentOutSchema.parse({ metrics: { market_cap: { value: 9_860_000_000, confidence: 'estimated',
        reportedClaim: { sourceUrl, quote, asOf, basis: 'market_cap', definition: 'market_cap', unit: 'USD' } } } }),
      text: quote, grounding, capturedAt: '2026-10-10T00:00:00.000Z' }).find(row => row.metricType === 'market_cap')!;
  };
  it('stays unknown when the source gives no date — it would read as today', () => {
    expect(rows('Xero has a market capitalization of USD 9.86 billion.', null)).toMatchObject({ value: null, confidence: 'unknown' });
  });
  it('is kept when the source dates it', () => {
    expect(rows('Xero had a market capitalization of USD 9.86 billion as of October 9, 2026.', '2026-10-09'))
      .toMatchObject({ value: 9_860_000_000, confidence: 'estimated' });
  });
});

describe('third-party marks in the header', () => {
  it('recognises badge filenames joined with underscores and dashes', () => {
    expect(isThirdPartyMark('67c6ebb043933f48500f501a_g2.svg')).toBe(true);
    expect(isThirdPartyMark('soc-2-badge.png')).toBe(true);
    expect(isThirdPartyMark('rillet-logo.svg')).toBe(false);
    expect(isThirdPartyMark('logo-g2x.svg')).toBe(false);
  });
  it('never offers a G2 badge as the company logo', () => {
    const html = `<header><a href="/"><img class="nav-logo" src="https://cdn.prod.website-files.com/a/rillet-logo.svg"></a>
      <div class="nav-logos"><img class="logo" alt="G2 logo" src="https://cdn.prod.website-files.com/a/67c6ebb0_g2.svg"></div></header>`;
    const urls = collectLogoCandidates(html, new URL('https://www.rillet.com/')).map(c => c.url);
    expect(urls).toContain('https://cdn.prod.website-files.com/a/rillet-logo.svg');
    expect(urls.some(u => u.includes('g2'))).toBe(false);
  });
});
