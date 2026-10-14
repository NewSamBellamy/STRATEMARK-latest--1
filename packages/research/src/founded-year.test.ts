import { describe, expect, it } from 'vitest';
import { foundedFromWebsite, wikidataFoundedYear, type JsonFetcher } from './founded-year';

const time = (year: number, precision = 9) => ({ time: `+${year}-01-01T00:00:00Z`, precision });
const claim = (value: unknown, rank = 'normal') => ({ rank, mainsnak: { datavalue: { value } } });

/** A fake Wikidata: `search` maps a search term to ids; `entities` is the item table. */
function wikidata(search: Record<string, string[]>, entities: Record<string, unknown>): { fetch: JsonFetcher; terms: string[] } {
  const terms: string[] = [];
  return {
    terms,
    fetch: async (url) => {
      const u = new URL(url);
      if (u.searchParams.get('action') === 'wbsearchentities') {
        const term = u.searchParams.get('search') ?? '';
        terms.push(term);
        return { search: (search[term] ?? []).map((id) => ({ id })) };
      }
      const ids = (u.searchParams.get('ids') ?? '').split('|');
      return { entities: Object.fromEntries(ids.map((id) => [id, entities[id]]).filter(([, e]) => e)) };
    },
  };
}

describe('wikidataFoundedYear', () => {
  it('matches the company item by its website domain and reads inception', async () => {
    const { fetch } = wikidata({ Acme: ['Q1'] }, { Q1: { labels: { en: { value: 'Acme' } }, claims: { P856: [claim('https://www.acme.com/')], P571: [claim(time(2015))] } } });
    expect(await wikidataFoundedYear('Acme', 'https://acme.com', fetch)).toEqual({ year: 2015, qid: 'Q1' });
  });

  it('finds an item the name search misses by searching the domain brand word', async () => {
    const { fetch, terms } = wikidata({ 'Initech Systems': [], initech: ['Q2'] }, { Q2: { labels: { en: { value: 'Initech Holdings' } }, claims: { P856: [claim('https://initech.io')], P571: [claim(time(1999))] } } });
    expect(await wikidataFoundedYear('Initech Systems', 'https://www.initech.io', fetch)).toEqual({ year: 1999, qid: 'Q2' });
    expect(terms).toContain('initech');
  });

  it('uses the QID the homepage links itself to, and an alias to break a shared-site tie', async () => {
    const entities = {
      Q3: { labels: { en: { value: 'Globex Cloud' } }, aliases: { en: [{ value: 'Globex' }] }, claims: { P856: [claim('https://globex.com')], P571: [claim(time(2008))] } },
      Q4: { labels: { en: { value: 'Globex Mail' } }, claims: { P856: [claim('https://globex.com')], P571: [claim(time(2012))] } },
    };
    const { fetch } = wikidata({}, entities);
    expect(await wikidataFoundedYear('Globex', 'https://globex.com', fetch, { qid: 'Q3' })).toEqual({ year: 2008, qid: 'Q3' });
    const both = wikidata({ Globex: ['Q3', 'Q4'] }, entities);
    expect(await wikidataFoundedYear('Globex', 'https://globex.com', both.fetch)).toEqual({ year: 2008, qid: 'Q3' });
  });

  it('refuses a same-named item on another domain, a person, a coarse date, and conflicting years', async () => {
    const other = wikidata({ Acme: ['Q5'] }, { Q5: { claims: { P856: [claim('https://acme.org')], P571: [claim(time(1950))] } } });
    expect(await wikidataFoundedYear('Acme', 'https://acme.com', other.fetch)).toBeNull();
    const person = wikidata({ Acme: ['Q6'] }, { Q6: { claims: { P31: [claim({ id: 'Q5' })], P856: [claim('https://acme.com')], P571: [claim(time(1950))] } } });
    expect(await wikidataFoundedYear('Acme', 'https://acme.com', person.fetch)).toBeNull();
    const decade = wikidata({ Acme: ['Q7'] }, { Q7: { claims: { P856: [claim('https://acme.com')], P571: [claim(time(1950, 8))] } } });
    expect(await wikidataFoundedYear('Acme', 'https://acme.com', decade.fetch)).toBeNull();
    const conflict = wikidata({ Acme: ['Q8'] }, { Q8: { claims: { P856: [claim('https://acme.com')], P571: [claim(time(1950)), claim(time(1960))] } } });
    expect(await wikidataFoundedYear('Acme', 'https://acme.com', conflict.fetch)).toBeNull();
    const preferred = wikidata({ Acme: ['Q9'] }, { Q9: { claims: { P856: [claim('https://acme.com')], P571: [claim(time(1950)), claim(time(1960), 'preferred')] } } });
    expect(await wikidataFoundedYear('Acme', 'https://acme.com', preferred.fetch)).toEqual({ year: 1960, qid: 'Q9' });
  });

  it('rejects a future inception year', async () => {
    const future = wikidata({ Acme: ['Q10'] }, { Q10: { claims: { P856: [claim('https://acme.com')], P571: [claim(time(2999))] } } });
    expect(await wikidataFoundedYear('Acme', 'https://acme.com', future.fetch)).toBeNull();
  });
});

const page = (body: string, head = '') => `<html><head>${head}</head><body>${body}</body></html>`;
const NOW = '2026-10-14T00:00:00.000Z';

describe('foundedFromWebsite', () => {
  it('reads schema.org Organization foundingDate with the page as citation', () => {
    const ld = '<script type="application/ld+json">{"@context":"https://schema.org","@type":"Organization","name":"Acme","foundingDate":"2013-05-01"}</script>';
    const found = foundedFromWebsite(page('<p>Hello</p>', ld), 'https://www.acme.com/', NOW);
    expect(found).toMatchObject({ year: 2013, source: 'website', evidence: 'foundingDate: 2013-05-01' });
    expect(found?.citations).toEqual([{ title: 'acme.com (company website)', url: 'https://www.acme.com/', credibility: 'primary' }]);
  });

  it('reads an explicit "founded in" sentence from about text', () => {
    const found = foundedFromWebsite(page('<h1>About</h1><p>Acme was founded in 2015 by two engineers in Austin.</p>'), 'https://acme.com/about', NOW);
    expect(found?.year).toBe(2015);
    expect(found?.evidence).toContain('founded in 2015');
    expect(foundedFromWebsite(page('<p>Founded: March 2009</p>'), 'https://acme.com', NOW)?.year).toBe(2009);
    expect(foundedFromWebsite(page('<footer>Est. 1987</footer>'), 'https://acme.com', NOW)?.year).toBe(1987);
  });

  it('accepts "serving customers since" only as the weak tier, and never a product launch', () => {
    expect(foundedFromWebsite(page('<p>Proudly serving customers since 1994.</p>'), 'https://acme.com', NOW)?.year).toBe(1994);
    expect(foundedFromWebsite(page('<p>Available since 2019 on every platform. Launched in 2020.</p>'), 'https://acme.com', NOW)).toBeNull();
    // A stated founding beats a "since" phrase.
    expect(foundedFromWebsite(page('<p>Serving customers since 1994. Founded in 1990.</p>'), 'https://acme.com', NOW)?.year).toBe(1990);
  });

  it('rejects future years, years before 1600, conflicting years, and non-page input', () => {
    expect(foundedFromWebsite(page('<p>Founded in 2031.</p>'), 'https://acme.com', NOW)).toBeNull();
    expect(foundedFromWebsite(page('<p>Founded in 1492.</p>'), 'https://acme.com', NOW)).toBeNull();
    expect(foundedFromWebsite(page('<p>Acme, founded in 2001, merged with Beta, founded in 1975.</p>'), 'https://acme.com', NOW)).toBeNull();
    const badLd = '<script type="application/ld+json">{"@type":"Organization","name":"A","foundingDate":"3020"}</script>';
    expect(foundedFromWebsite(page('<p>nothing</p>', badLd), 'https://acme.com', NOW)).toBeNull();
    expect(foundedFromWebsite(null, 'https://acme.com', NOW)).toBeNull();
    expect(foundedFromWebsite(page('<p>Founded in 2015</p>'), 'not a url', NOW)).toBeNull();
  });

  it('ignores years inside scripts and styles', () => {
    expect(foundedFromWebsite(page('<script>var x = "founded in 2015";</script><p>Welcome</p>'), 'https://acme.com', NOW)).toBeNull();
  });
});
