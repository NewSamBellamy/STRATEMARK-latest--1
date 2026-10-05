import { describe, expect, it } from 'vitest';
import { selectOriginalSourceCitations } from './original-source';

describe('bounded original source priority', () => {
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
});
