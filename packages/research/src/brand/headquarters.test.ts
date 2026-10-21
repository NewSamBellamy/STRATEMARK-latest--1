import { describe, expect, it, vi } from 'vitest';
import { homepageHeadquarters, wikidataHeadquarters } from './headquarters';

const json = (body: unknown) => ({ ok: true, json: async () => body }) as Response;
const item = (site: string, city = 'Q1', country = 'Q2') => ({ claims: {
  P856: [{ mainsnak: { datavalue: { value: site } } }],
  P159: [{ mainsnak: { datavalue: { value: { id: city } } } }],
  P17: [{ mainsnak: { datavalue: { value: { id: country } } } }],
} });

describe('homepageHeadquarters', () => {
  it('reads the Organization address as a place, spelling out the country code', () => {
    const html = '<script type="application/ld+json">{"@type":"Organization","name":"Wingtra","address":{"streetAddress":"Giesshübelstrasse 40","addressLocality":"Zurich","addressRegion":"ZH","addressCountry":"CH"}}</script>';
    expect(homepageHeadquarters(html, 'https://wingtra.com/')).toEqual({ location: 'Zurich, Switzerland', sourceUrl: 'https://wingtra.com/', via: 'homepage-jsonld' });
  });
  it('gives nothing without a locality', () => {
    expect(homepageHeadquarters('<script type="application/ld+json">{"@type":"Organization","name":"X","address":{"addressCountry":"US"}}</script>', 'https://x.com')).toBeNull();
  });
});

describe('wikidataHeadquarters', () => {
  it('takes P159 and P17 from the one item whose official website is the company\'s domain', async () => {
    const fetchImpl = vi.fn(async (url: string) => {
      if (url.includes('wbsearchentities')) return json({ search: [{ id: 'Q10' }, { id: 'Q11' }] });
      if (url.includes('props=claims')) return json({ entities: { Q10: item('https://www.flyability.com'), Q11: item('https://flyability.org.uk', 'Q9') } });
      return json({ entities: { Q1: { labels: { en: { value: 'Lausanne' } } }, Q2: { labels: { en: { value: 'Switzerland' } } } } });
    }) as unknown as typeof fetch;
    expect(await wikidataHeadquarters({ name: 'Flyability', websiteUrl: 'https://flyability.com', fetchImpl }))
      .toEqual({ location: 'Lausanne, Switzerland', sourceUrl: 'https://www.wikidata.org/wiki/Q10', via: 'wikidata' });
  });
  it('refuses a same-named item on another domain', async () => {
    const fetchImpl = vi.fn(async (url: string) => url.includes('wbsearchentities')
      ? json({ search: [{ id: 'Q11' }] })
      : json({ entities: { Q11: item('https://flyability.org.uk') } })) as unknown as typeof fetch;
    expect(await wikidataHeadquarters({ name: 'Flyability', websiteUrl: 'https://flyability.com', fetchImpl })).toBeNull();
  });
});
