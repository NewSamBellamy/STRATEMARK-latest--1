/**
 * One headquarters display form at every write point and in stored data:
 * "City, Full State" in the US, "City, Country" elsewhere, Title Case.
 */
import { describe, expect, it } from 'vitest';
import { canonicalHqLocation, hqGroundedInEvidence } from './hq-format';
import { homepageHeadquarters, wikidataHeadquarters } from './headquarters';
import { secHeadquartersPlace } from '../sec-profile';
import { revalidateStoredMetrics } from '../revalidate-stored';

describe('canonicalHqLocation', () => {
  it.each([
    // Coordinator cases: a state code that is also a country code is read
    // only on positive US evidence; otherwise it stays as written.
    ['Mumbai, IN', 'Mumbai, IN'],
    ['MUMBAI, IN', 'Mumbai, IN'],
    ['Toronto, CA', 'Toronto, CA'],
    ['Austin, TX', 'Austin, Texas'],
    ['San Francisco, CA, USA', 'San Francisco, California'],
    ['San Francisco, CA', 'San Francisco, CA'],
    ['Berlin, DE', 'Berlin, DE'],
    ['Portland, OR', 'Portland, Oregon'],
    ['Chicago, IL, United States', 'Chicago, Illinois'],
    ['Paris, FR', 'Paris, France'],
    ['San Juan, PR', 'San Juan, Puerto Rico'],
    ['Springfield, Some Region, USA', 'Springfield, Some Region, United States'],
    ['New York, NY, USA', 'New York, New York'],
    ['NEW YORK, NY', 'New York, New York'],
    ['New York City, New York, United States', 'New York, New York'],
    ['Austin, Texas, United States of America', 'Austin, Texas'],
    ['Chicago, IL 60601', 'Chicago, IL'],
    ['100 Main Street, Boston, MA 02110, USA', 'Boston, Massachusetts'],
    ['Seattle, WA 98101', 'Seattle, Washington'],
    ['Washington, D.C.', 'Washington, District of Columbia'],
    ['Austin, USA', 'Austin, United States'],
    ['London, UK', 'London, United Kingdom'],
    ['Toronto, ON, Canada', 'Toronto, Canada'],
    ['Zurich, Switzerland', 'Zurich, Switzerland'],
    ['zurich, switzerland', 'Zurich, Switzerland'],
    ['Luxembourg, Luxembourg', 'Luxembourg'],
    ['McLean, Virginia', 'McLean, Virginia'],
    ['Zurich', 'Zurich'],
  ])('%s -> %s', (raw, expected) => {
    expect(canonicalHqLocation(raw)).toBe(expected);
  });

  it('is idempotent and never invents a place', () => {
    for (const raw of ['San Francisco, CA', 'Mumbai, IN', 'Austin, TX', 'London, UK', 'Toronto, ON, Canada', 'Austin, USA']) {
      const once = canonicalHqLocation(raw);
      expect(canonicalHqLocation(once)).toBe(once);
    }
    expect(canonicalHqLocation(null)).toBeNull();
    expect(canonicalHqLocation('12345')).toBeNull();
  });
});

describe('write points use the canonical form', () => {
  it('homepage JSON-LD keeps a US state code and spells it out', () => {
    const html = `<script type="application/ld+json">${JSON.stringify({ '@context': 'https://schema.org', '@type': 'Organization', name: 'Acme',
      address: { '@type': 'PostalAddress', addressLocality: 'San Mateo', addressRegion: 'CA', addressCountry: 'US' } })}</script>`;
    expect(homepageHeadquarters(html, 'https://acme.com/')?.location).toBe('San Mateo, California');
  });

  it('Wikidata drops "of America" from the US country label', async () => {
    const responses: Record<string, unknown> = {
      wbsearchentities: { search: [{ id: 'Q1' }] },
      claims: { entities: { Q1: { claims: {
        P856: [{ mainsnak: { datavalue: { value: 'https://acme.com' } } }],
        P159: [{ mainsnak: { datavalue: { value: { id: 'Q2' } } } }],
        P17: [{ mainsnak: { datavalue: { value: { id: 'Q30' } } } }] } } } },
      labels: { entities: { Q2: { labels: { en: { value: 'Austin' } } }, Q30: { labels: { en: { value: 'United States of America' } } } } },
    };
    const fetchImpl = (async (url: string) => {
      const key = url.includes('wbsearchentities') ? 'wbsearchentities' : url.includes('props=claims') ? 'claims' : 'labels';
      return new Response(JSON.stringify(responses[key]), { status: 200 });
    }) as unknown as typeof fetch;
    expect((await wikidataHeadquarters({ name: 'Acme', websiteUrl: 'https://acme.com', fetchImpl }))?.location).toBe('Austin, United States');
  });

  it('SEC submissions address stays "City, Full State"', () => {
    expect(secHeadquartersPlace({ business: { city: 'ROUND ROCK', stateOrCountry: 'TX', stateOrCountryDescription: 'TX' } } as never))
      .toBe('Round Rock, Texas');
    // A US filer's "IN" is Indiana: the filing itself is the US evidence.
    expect(secHeadquartersPlace({ business: { city: 'INDIANAPOLIS', stateOrCountry: 'IN', stateOrCountryDescription: 'IN' } } as never))
      .toBe('Indianapolis, Indiana');
    expect(canonicalHqLocation('Indianapolis, IN', { usFiler: true })).toBe('Indianapolis, Indiana');
  });

  it('homepage JSON-LD with no country keeps an ambiguous region code as written', () => {
    const html = `<script type="application/ld+json">${JSON.stringify({ '@context': 'https://schema.org', '@type': 'Organization', name: 'Acme',
      address: { '@type': 'PostalAddress', addressLocality: 'Mumbai', addressRegion: 'IN' } })}</script>`;
    expect(homepageHeadquarters(html, 'https://acme.in/')?.location).toBe('Mumbai, IN');
  });
});

describe('revalidateStoredMetrics — v2 headquarters', () => {
  it('rewrites stored HQs to the canonical form and leaves unreadable ones alone', () => {
    const company = (id: string, hqLocation: string | null) => ({ id, name: id, oneLiner: `${id} builds software for teams.`, hqLocation });
    const snapshot = { metricGateVersion: 1, metrics: [], dashboards: {} as Record<string, unknown>,
      companies: [company('a', 'San Francisco, CA, USA'), company('b', 'Zurich, Switzerland'), company('c', null), company('d', 'London, UK'),
        company('e', 'Mumbai, IN'), company('f', 'Austin, TX')] };
    const outcome = revalidateStoredMetrics(snapshot);
    expect(snapshot.companies.map((c) => c.hqLocation)).toEqual(['San Francisco, California', 'Zurich, Switzerland', null, 'London, United Kingdom',
      'Mumbai, IN', 'Austin, Texas']);
    expect(outcome.normalizedHq.map((r) => r.companyId)).toEqual(['a', 'd', 'f']);
    expect(snapshot.dashboards).toEqual({});
  });
});

describe('one headquarters is never stitched from two places', () => {
  it.each([
    ['Miami, Florida; Dallas, Texas', 'Miami, Florida'],
    ['Miami, FL / Dallas, Texas', 'Miami, Florida'],
    ['Miami, Florida and Dallas, Texas', 'Miami, Florida'],
    ['Miami, FL, Dallas, Texas', 'Miami, Florida'],
    ['Miami, Florida (with a large office in Dallas, Texas)', 'Miami, Florida'],
    ['Toronto, ON, Canada', 'Toronto, Canada'],
  ])('%s -> %s', (raw, expected) => expect(canonicalHqLocation(raw)).toBe(expected));
});

describe('a hedged headquarters keeps the place the text fully states', () => {
  it.each([
    // Physical Intelligence: a misspelt bare alternative before the full address.
    ['San Ratael / San Francisco, California, United States', 'San Francisco, California'],
    ['Bay Area | Oakland, CA, USA', 'Oakland, California'],
    // Both bare, or the first already qualified: the first still stands.
    ['San Francisco / Bay Area', 'San Francisco'],
    ['Miami, FL / Dallas, Texas', 'Miami, Florida'],
    // A list ("and", ";") names two sites, not alternatives.
    ['Austin and Dallas, Texas', 'Austin'],
  ])('%s -> %s', (raw, expected) => expect(canonicalHqLocation(raw)).toBe(expected));
});

describe('hqGroundedInEvidence', () => {
  const evidence = 'Southern Glazer\'s is headquartered in Miami, Florida, with a large office in Dallas, Texas.';
  it('replaces a state the evidence does not put beside the city', () => {
    expect(hqGroundedInEvidence('Miami, Texas', evidence)).toBe('Miami, Florida');
  });
  it('keeps a state the evidence supports, by name or code', () => {
    expect(hqGroundedInEvidence('Miami, Florida', evidence)).toBe('Miami, Florida');
    expect(hqGroundedInEvidence('Austin, Texas', 'Based in Austin, TX since 2012.')).toBe('Austin, Texas');
  });
  it('keeps only the city when the evidence names no state beside it', () => {
    expect(hqGroundedInEvidence('Miami, Texas', 'The firm is based in Miami and sells wine.')).toBe('Miami');
  });
  it('leaves a location alone when the evidence never names the city', () => {
    expect(hqGroundedInEvidence('Miami, Texas', 'A distributor of wine and spirits.')).toBe('Miami, Texas');
    expect(hqGroundedInEvidence('Zurich, Switzerland', 'Zurich is nice.')).toBe('Zurich, Switzerland');
    expect(hqGroundedInEvidence(null, evidence)).toBeNull();
  });
});

describe('revalidateStoredMetrics v5 headquarters', () => {
  it('cuts a stored city+state back to what its retained research text says', () => {
    const snapshot = { metricGateVersion: 4, metrics: [], dashboards: {} as Record<string, unknown>,
      companies: [{ id: 'sg', name: 'SGWS', oneLiner: 'x', hqLocation: 'Miami, Texas' }, { id: 'gp', name: 'GP', oneLiner: 'x', hqLocation: 'Grand Prairie, Texas' }],
      researchEvidence: [{ id: 'e1', companyId: 'sg', topic: 'hq', capturedAt: '2026-01-01', text: 'Headquarters: Miami, Florida. Dallas, Texas office.', citations: [], queries: [] }] };
    const outcome = revalidateStoredMetrics(snapshot);
    expect(snapshot.companies.map((c) => c.hqLocation)).toEqual(['Miami, Florida', 'Grand Prairie, Texas']);
    expect(outcome.normalizedHq.map((r) => r.companyId)).toEqual(['sg']);
  });
});
