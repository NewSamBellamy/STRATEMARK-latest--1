import { describe, expect, it } from 'vitest';
import { selectOriginalSourceCitations } from './original-source';

describe('bounded original source priority', () => {
  it('recovers a discovered direct filing locator from notes when grounding metadata only has redirects', () => {
    const chosen = selectOriginalSourceCitations([
      { title: 'sec.gov', url: 'https://vertexaisearch.cloud.google.com/grounding-api-redirect/token' },
    ], 'https://microsoft.com', true, undefined,
    'Original source: https://www.sec.gov/Archives/edgar/data/789019/000119312526323660/msft.htm');
    expect(chosen[0]?.url).toContain('data.sec.gov/api/xbrl/companyconcept/CIK0000789019/');
    expect(chosen).toHaveLength(2);
  });
  it('does not turn arbitrary URLs in untrusted notes into source candidates', () => {
    const original = { title: 'Homepage', url: 'https://microsoft.com/' };
    expect(selectOriginalSourceCitations([original], 'https://microsoft.com', true, undefined,
      ['Original source: https://microsoft.com.attacker.test/investor/report',
        'Original source: https://user:secret@microsoft.com/about',
        'Original source: https://127.0.0.1/admin',
        'Original source: http://microsoft.com/results'].join('\n')
    ).map(row => row.url)).toEqual([original.url]);
  });
  it('filters recovered locators through the active reader and does not mutate grounding metadata', () => {
    const citations = [{ title: 'sec.gov', url: 'https://vertexaisearch.cloud.google.com/grounding-api-redirect/token' }];
    const before = structuredClone(citations);
    const notes = 'Original source: https://www.sec.gov/Archives/edgar/data/789019/000119312526323660/msft.htm';
    expect(selectOriginalSourceCitations(citations, 'https://microsoft.com', true,
      candidate => !candidate.startsWith('https://data.sec.gov/'), notes).map(row => row.url)).toEqual([citations[0]!.url]);
    expect(citations).toEqual(before);
  });
  it('does not let the homepage and newsroom crowd out a cited financial original', () => {
    const filing = 'https://www.sec.gov/Archives/edgar/data/789019/000119312526323660/msft.htm';
    const chosen = selectOriginalSourceCitations([
      { url: 'https://microsoft.com/', title: 'Microsoft' },
      { url: 'https://news.microsoft.com/product-launch', title: 'Product launch' },
      { url: filing, title: 'Annual filing' },
    ], 'https://microsoft.com', true);
    expect(chosen[0]?.url).toContain('data.sec.gov/api/xbrl/companyconcept/CIK0000789019/');
    expect(chosen).toHaveLength(2);
  });
  it('prefers discovered official investor and company-profile pages over general homepages', () => {
    expect(selectOriginalSourceCitations([
      { url: 'https://example.com/', title: 'Homepage' },
      { url: 'https://example.com/products', title: 'Products' },
      { url: 'https://example.com/investor/annual-report', title: 'Results' },
      { url: 'https://example.com/about', title: 'Company profile' },
    ], 'https://example.com', true).map(row => row.url)).toEqual([
      'https://example.com/investor/annual-report', 'https://example.com/about',
    ]);
  });
  it('never promotes a fake investor host by its path or title', () => {
    expect(selectOriginalSourceCitations([
      { url: 'https://example.com.attacker.test/investor/annual-report', title: 'Official financial results' },
      { url: 'https://example.com/about', title: 'Company profile' },
      { url: 'https://reuters.com/business/report', title: 'Reporting' },
    ], 'https://example.com', true).map(row => row.url)).toEqual([
      'https://example.com/about', 'https://reuters.com/business/report',
    ]);
  });
  it('prioritizes official pages and filings without trusting claimed credibility', () => {
    const citations = [
      { url: 'https://example.com.attacker.test/report', title: 'Official filing', credibility: 'primary' as const },
      { url: 'https://reuters.com/report', title: 'Reporting' },
      { url: 'https://sec.gov/Archives/report', title: 'Filing' },
      { url: 'https://investors.example.com/report', title: 'Company results' },
    ];
    const before = structuredClone(citations);
    expect(selectOriginalSourceCitations(citations, 'https://example.com').map(source => source.url))
      .toEqual(['https://sec.gov/Archives/report', 'https://investors.example.com/report']);
    expect(citations).toEqual(before);
  });
  it('uses bare grounding publisher metadata only for routing and favors direct pages on ties', () => {
    const redirect = 'https://vertexaisearch.cloud.google.com/grounding-api-redirect/report';
    expect(selectOriginalSourceCitations([
      { url: redirect, title: 'reuters.com' },
      { url: 'https://unknown.example/report', title: 'SEC filing', credibility: 'primary' },
      { url: 'https://reuters.com/report', title: 'Reporting' },
    ]).map(source => source.url)).toEqual(['https://reuters.com/report', redirect]);
  });
  it('deduplicates and rejects unusable links before applying the two-page budget', () => {
    const url = 'https://sec.gov/Archives/report';
    expect(selectOriginalSourceCitations([
      { url: 'javascript:alert(1)', title: 'SEC' },
      { url: 'https://user:secret@sec.gov/report', title: 'SEC' },
      { url, title: 'Filing' }, { url, title: 'Repeated filing' },
    ]).map(source => source.url)).toEqual([url]);
    expect(selectOriginalSourceCitations([])).toEqual([]);
  });
  it('keeps niche sources eligible and stable rather than inventing official URLs', () => {
    const citations = [1, 2, 3].map(index => ({ url: `https://niche.example/${index}`, title: `Article ${index}` }));
    expect(selectOriginalSourceCitations(citations).map(source => source.url)).toEqual(citations.slice(0, 2).map(source => source.url));
  });
  it('does not spend source slots on protocols or ports neither reader supports', () => {
    const citations = [
      { url: 'http://sec.gov/Archives/report', title: 'Filing' },
      { url: 'https://sec.gov:8443/Archives/report', title: 'Filing' },
      { url: 'https://reuters.com/report', title: 'Reporting' },
      { url: 'https://niche.example/report', title: 'Article' },
    ];
    expect(selectOriginalSourceCitations(citations).map(source => source.url))
      .toEqual(['https://reuters.com/report', 'https://niche.example/report']);
  });
  it('filters candidates through the active reader capability before spending either source slot', () => {
    const citations = [
      { url: 'https://meta.com/about', title: 'Official company page' },
      { url: 'https://vertexaisearch.cloud.google.com/grounding-api-redirect/meta', title: 'meta.com' },
      { url: 'https://sec.gov/Archives/report', title: 'Filing' },
    ];
    expect(selectOriginalSourceCitations(citations, 'https://meta.com', false, url => url.includes('sec.gov')).map(row => row.url))
      .toEqual([citations[2]!.url]);
  });
  it('reads one page once even when citations use fragments or an explicit default port', () => {
    const citations = [
      { url: 'https://sec.gov:443/Archives/report#employees', title: 'Headcount' },
      { url: 'https://sec.gov/Archives/report#revenue', title: 'Revenue' },
      { url: 'https://reuters.com/report', title: 'Reporting' },
    ];
    const before = structuredClone(citations);
    expect(selectOriginalSourceCitations(citations).map(source => source.url))
      .toEqual([citations[0]!.url, citations[2]!.url]);
    expect(citations).toEqual(before);
    expect(selectOriginalSourceCitations([
      { url: 'https://sec.gov/report?year=2025', title: '2025 report' },
      { url: 'https://sec.gov/report?year=2026', title: '2026 report' },
    ])).toHaveLength(2);
  });
});
