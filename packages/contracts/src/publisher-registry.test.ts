import { describe, expect, it } from 'vitest';
import { classifySource } from './provenance';
import { PUBLISHER_REGISTRY, independenceKey, publisherFit, publisherTier } from './publisher-registry';

// `classifySource` is frozen (PLAN-CRAAP 1.5): this table is its recorded output.
const FROZEN: ReadonlyArray<readonly [string, string | null, string | null, string]> = [
  ['https://www.sec.gov/Archives/report', null, null, 'primary'],
  ['https://investors.example.com/report', null, 'https://example.com', 'primary'],
  ['https://example.com.attacker.test/report', null, 'https://example.com', 'unknown'],
  ['https://www.reuters.com/a', null, null, 'reputable_secondary'],
  ['https://www.forbes.com/sites/x/2026/01/01/a', null, null, 'reputable_secondary'],
  ['https://techcrunch.com/a', null, null, 'industry'],
  ['https://www.crunchbase.com/organization/x', null, null, 'industry'],
  ['https://www.businesswire.com/news/home/1', null, null, 'industry'],
  ['https://www.prnewswire.com/news-releases/x', null, null, 'industry'],
  ['https://www.globenewswire.com/news-release/x', null, null, 'industry'],
  ['https://www.accesswire.com/1/x', null, null, 'unknown'],
  ['https://www.reddit.com/r/x', null, null, 'user_generated'],
  ['https://random-blog.example/x', null, null, 'unknown'],
  ['https://vertexaisearch.cloud.google.com/grounding-api-redirect/t', 'reuters.com', null, 'reputable_secondary'],
  ['https://vertexaisearch.cloud.google.com/grounding-api-redirect/t', 'Reuters says revenue grew', null, 'unknown'],
];

describe('classifySource stays byte-identical', () => {
  it.each(FROZEN)('%s (%s)', (url, title, site, expected) => {
    expect(classifySource(url, title, site)).toBe(expected);
  });
});

describe('PUBLISHER_REGISTRY', () => {
  it('agrees with classifySource: regulators are primary, community is user_generated, the rest are not unknown-grade', () => {
    for (const [host, tier] of Object.entries(PUBLISHER_REGISTRY)) {
      const credibility = classifySource(`https://${host}/x`);
      if (tier === 1) expect(credibility, host).toBe('primary');
      else if (tier === 5) expect(credibility, host).toBe('user_generated');
      else if (tier === 4) expect(credibility, host).toBe('industry');
      else if (tier === 3) expect(['reputable_secondary', 'industry'], host).toContain(credibility);
    }
  });
  it('puts wires in tier 2 and the company site in tier 2', () => {
    expect(publisherTier('https://www.businesswire.com/x')).toBe(2);
    expect(publisherTier('https://news.example.com/x', 'https://example.com')).toBe(2);
    expect(publisherTier('https://example.com.attacker.test/x', 'https://example.com')).toBe(5);
  });
  it('rates fit per metric', () => {
    expect(publisherFit(4, 'arr')).toBe('weak');
    expect(publisherFit(4, 'market_cap')).toBe('strong');
    expect(publisherFit(4, 'funding_total')).toBe('acceptable');
    expect(publisherFit(1, 'employees')).toBe('strong');
    expect(publisherFit(3, 'revenue')).toBe('acceptable');
  });
});

describe('independenceKey', () => {
  it('counts wire copy, the official site and company-voiced text as one company source', () => {
    expect(independenceKey('https://www.prnewswire.com/a', null)).toBe('company');
    expect(independenceKey('https://www.globenewswire.com/b', null)).toBe('company');
    expect(independenceKey('https://news.example.org/c', 'SAN FRANCISCO, /PRNewswire/ -- Acme said ...')).toBe('company');
    expect(independenceKey('https://news.example.org/c', 'Acme has 900 staff, according to the company.')).toBe('company');
    expect(independenceKey('https://example.com/about', null, 'https://example.com')).toBe('company');
  });
  it('keys agency reprints, regulators and ordinary publishers', () => {
    expect(independenceKey('https://www.yahoo.com/a', 'LONDON (Reuters) - Acme grew')).toBe('reuters');
    expect(independenceKey('https://www.sec.gov/Archives/x', null)).toBe('regulator:sec.gov');
    expect(independenceKey('https://www.techcrunch.com/a', 'Acme grew')).toBe('techcrunch.com');
  });
});
