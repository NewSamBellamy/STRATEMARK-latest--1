import { describe, expect, it } from 'vitest';
import { extractOrganizationJsonLd } from './jsonld';
import { lookupRegistryFacts } from './index';
import { wikidataSource, pickLatestClaim } from './wikidata';
import { brregSource } from './brreg';
import { frEntreprisesSource, inseeBand, inseeBandLabel } from './fr-entreprises';

type Handler = (url: string) => unknown | Promise<unknown>;
function mockFetch(handler: Handler): typeof fetch {
  return (async (input: RequestInfo | URL) => {
    const body = await handler(String(input));
    return { ok: true, status: 200, json: async () => body } as Response;
  }) as typeof fetch;
}
const ctx = (fetchImpl: typeof fetch) => ({ fetchImpl });

const qty = (amount: number, unit = '1') => ({
  mainsnak: { datavalue: { value: { amount: `+${amount}`, unit } } },
});
const time = (t: string, precision = 10) => ({
  P585: [{ datavalue: { value: { time: t, precision } } }],
});
const site = (url: string) => ({ mainsnak: { datavalue: { value: url } } });

function wikidataFetch(entities: Record<string, unknown>, hits: string[]): typeof fetch {
  return mockFetch((url) => {
    if (url.includes('wbsearchentities')) return { search: hits.map((id) => ({ id })) };
    return { entities };
  });
}

describe('wikidata adapter', () => {
  it('rejects a name-search candidate whose website does not match (DJI -> Djibouti)', async () => {
    const f = wikidataFetch(
      { Q977: { claims: { P856: [site('https://www.gouv.dj')], P1128: [{ ...qty(900000), qualifiers: time('+2020-00-00T00:00:00Z', 9) }] } } },
      ['Q977'],
    );
    const r = await wikidataSource.lookup({ name: 'DJI', domain: 'dji.com' }, ctx(f));
    expect(r.status).toBe('no-match');
    expect(r.facts).toEqual([]);
  });

  it('accepts a domain-matched candidate (www + subdomain normalized) and returns extras', async () => {
    const f = wikidataFetch(
      {
        Q1: {
          claims: {
            P856: [site('https://www.mistral.ai/')],
            P1128: [{ ...qty(350), qualifiers: time('+2025-11-00T00:00:00Z'), references: [{ snaks: { P854: [{ datavalue: { value: 'https://example.org/ref' } }] } }] }],
            P154: [site('Mistral AI logo.svg')],
            P1278: [site('LEI123')],
            P414: [{ qualifiers: { P249: [{ datavalue: { value: 'MIST' } }] } }],
          },
        },
      },
      ['Q1'],
    );
    const r = await wikidataSource.lookup({ name: 'Mistral AI', domain: 'https://app.mistral.ai/x' }, ctx(f));
    expect(r.status).toBe('matched');
    const emp = r.facts[0]!;
    expect(emp).toMatchObject({ metricType: 'employees', value: 350, asOf: '2025-11', undated: false, referenceUrl: 'https://example.org/ref', sourceUrl: 'https://www.wikidata.org/wiki/Q1' });
    expect(emp.methodNote).toContain('Wikidata Q1');
    expect(r.enrichment).toMatchObject({ wikidataQid: 'Q1', lei: 'LEI123', ticker: 'MIST', logoUrl: 'https://commons.wikimedia.org/wiki/Special:FilePath/Mistral_AI_logo.svg' });
  });

  it('accepts a sameAs QID without a website match', async () => {
    const f = wikidataFetch({ Q5: { claims: { P1128: [{ ...qty(10), qualifiers: time('+2024-00-00T00:00:00Z', 9) }] } } }, []);
    const r = await wikidataSource.lookup({ name: 'X', wikidataQid: 'Q5' }, ctx(f));
    expect(r.facts[0]!.identity).toEqual({ kind: 'jsonld-sameas', qid: 'Q5' });
  });

  it('never matches on name alone when no domain is known', async () => {
    const f = wikidataFetch({}, ['Q1']);
    expect((await wikidataSource.lookup({ name: 'OpenAI' }, ctx(f))).status).toBe('no-match');
  });

  it('selects the latest-dated claim and ignores deprecated ones', () => {
    const entity = {
      claims: {
        P1128: [
          { ...qty(1000), qualifiers: time('+2023-00-00T00:00:00Z', 9) },
          { ...qty(2500), qualifiers: time('+2026-01-00T00:00:00Z') },
          { ...qty(9999), rank: 'deprecated', qualifiers: time('+2027-01-00T00:00:00Z') },
        ],
      },
    };
    expect(pickLatestClaim(entity, 'P1128')).toMatchObject({ amount: 2500, asOf: '2026-01' });
  });

  it('flags a lone undated claim and refuses ambiguous undated claims', () => {
    expect(pickLatestClaim({ claims: { P1128: [qty(42)] } }, 'P1128')).toMatchObject({ amount: 42, asOf: null });
    expect(pickLatestClaim({ claims: { P1128: [qty(42), qty(43)] } }, 'P1128')).toBeNull();
  });

  it('preserves revenue currency and skips unknown units', async () => {
    const f = wikidataFetch(
      {
        Q2: {
          claims: {
            P856: [site('https://acme.eu')],
            P2139: [{ ...qty(1200000000, 'http://www.wikidata.org/entity/Q4916'), qualifiers: time('+2024-12-31T00:00:00Z', 11) }],
          },
        },
        Q3: { claims: { P856: [site('https://other.eu')], P2139: [qty(5, 'http://www.wikidata.org/entity/Q999999999')] } },
      },
      ['Q2'],
    );
    const r = await wikidataSource.lookup({ name: 'Acme', domain: 'acme.eu' }, ctx(f));
    const rev = r.facts.find((x) => x.metric === 'revenue')!;
    expect(rev).toMatchObject({ value: 1200000000, unit: 'EUR', asOf: '2024-12-31', metricType: null });
    expect(pickLatestClaim({ claims: { P2139: [qty(5, 'http://www.wikidata.org/entity/Q999999999')] } }, 'P2139', (u) => u === 'Q4917')).toBeNull();
  });

  it('marks an undated employee fact in the result', async () => {
    const f = wikidataFetch({ Q9: { claims: { P856: [site('https://a.io')], P1128: [qty(77)] } } }, ['Q9']);
    const r = await wikidataSource.lookup({ name: 'A', domain: 'a.io' }, ctx(f));
    expect(r.facts[0]).toMatchObject({ value: 77, asOf: null, undated: true });
  });
});

describe('brreg adapter', () => {
  const body = (rows: unknown[]) => ({ _embedded: { enheter: rows } });
  it('returns exact employees on name + website match and only for NO', async () => {
    expect(brregSource.applies({ name: 'x', country: 'NO' })).toBe(true);
    expect(brregSource.applies({ name: 'x', country: 'FR' })).toBe(false);
    const f = mockFetch(() => body([{ navn: 'Kongsberg Maritime AS', organisasjonsnummer: '123456789', antallAnsatte: 4321, hjemmeside: 'www.kongsberg.com' }]));
    const r = await brregSource.lookup({ name: 'Kongsberg Maritime', country: 'NO', domain: 'kongsberg.com' }, ctx(f));
    expect(r.facts[0]).toMatchObject({ value: 4321, undated: true, sourceUrl: 'https://virksomhet.brreg.no/nb/oppslag/enheter/123456789' });
    expect(r.enrichment.orgnr).toBe('123456789');
  });
  it('rejects a similar name with a different website and no exact legal name', async () => {
    const f = mockFetch(() => body([{ navn: 'Kongsberg Maritime Services AS', organisasjonsnummer: '1', antallAnsatte: 5, hjemmeside: 'other.no' }]));
    const r = await brregSource.lookup({ name: 'Kongsberg Maritime', country: 'NO', domain: 'kongsberg.com' }, ctx(f));
    expect(r.status).toBe('no-match');
  });
});

describe('france adapter', () => {
  it('maps INSEE codes including open-ended band and NN', () => {
    expect(inseeBand('22')).toEqual({ min: 100, max: 199 });
    expect(inseeBand('53')).toEqual({ min: 10000, max: null });
    expect(inseeBand('00')).toEqual({ min: 0, max: 0 });
    expect(inseeBand('NN')).toBeNull();
    expect(inseeBandLabel({ min: 100, max: 199 }, '2023')).toBe('100–199 employees (INSEE band, 2023)');
  });
  it('returns a band fact that is not card-face safe', async () => {
    const f = mockFetch(() => ({ results: [{ nom_complet: 'PARROT SA', siren: '394149835', tranche_effectif_salarie: '22', annee_tranche_effectif_salarie: '2023', etat_administratif: 'A' }] }));
    const r = await frEntreprisesSource.lookup({ name: 'Parrot', country: 'FR' }, ctx(f));
    expect(r.facts[0]).toMatchObject({ value: null, band: { min: 100, max: 199 }, cardFaceSafe: false, asOf: '2023', label: '100–199 employees (INSEE band, 2023)', sourceUrl: 'https://annuaire-entreprises.data.gouv.fr/entreprise/394149835' });
  });
  it('yields no fact for NN and no match for a non-exact name', async () => {
    const nn = mockFetch(() => ({ results: [{ nom_complet: 'PARROT SA', siren: '1', tranche_effectif_salarie: 'NN' }] }));
    const r = await frEntreprisesSource.lookup({ name: 'Parrot', country: 'FR' }, ctx(nn));
    expect(r.status).toBe('matched');
    expect(r.facts).toEqual([]);
    const other = mockFetch(() => ({ results: [{ nom_complet: 'PARROT DRONES FORMATION', siren: '2', tranche_effectif_salarie: '12' }] }));
    expect((await frEntreprisesSource.lookup({ name: 'Parrot', country: 'FR' }, ctx(other))).status).toBe('no-match');
  });
});

describe('jsonld', () => {
  it('parses @graph with Organization and sameAs QID', () => {
    const html = `<html><script type="application/ld+json">{"@context":"https://schema.org","@graph":[{"@type":"WebSite","name":"Site"},{"@type":["Organization"],"name":"Skydio","url":"https://skydio.com","logo":{"@type":"ImageObject","url":"https://skydio.com/l.png"},"sameAs":["https://www.linkedin.com/company/skydio","https://www.wikidata.org/wiki/Q42"],"foundingDate":"2014","address":{"addressCountry":"US"}}]}</script></html>`;
    expect(extractOrganizationJsonLd(html)).toEqual({
      name: 'Skydio', url: 'https://skydio.com', logo: 'https://skydio.com/l.png',
      sameAs: ['https://www.linkedin.com/company/skydio', 'https://www.wikidata.org/wiki/Q42'],
      foundingDate: '2014', addressCountry: 'US', wikidataQid: 'Q42',
    });
  });
  it('tolerates arrays, malformed blocks and no org', () => {
    const html = `<script type="application/ld+json">{bad</script><script type="application/ld+json">[{"@type":"Organization","name":"A","sameAs":"https://x.com/a"}]</script>`;
    expect(extractOrganizationJsonLd(html)).toMatchObject({ name: 'A', sameAs: ['https://x.com/a'], wikidataQid: null });
    expect(extractOrganizationJsonLd('<p>none</p>')).toBeNull();
  });
});

describe('lookupRegistryFacts', () => {
  it('reports errors and timeouts as status and never throws', async () => {
    const boom = (async () => { throw new Error('network down'); }) as typeof fetch;
    const r = await lookupRegistryFacts({ name: 'A', domain: 'a.io', country: 'NO' }, { fetchImpl: boom });
    expect(r.facts).toEqual([]);
    expect(r.statuses.find((s) => s.registry === 'wikidata')).toMatchObject({ status: 'error', reason: 'network down' });
    expect(r.statuses.find((s) => s.registry === 'brreg')?.status).toBe('error');
    expect(r.statuses.find((s) => s.registry === 'fr-entreprises')?.status).toBe('skipped');

    const hang = (() => new Promise(() => {})) as unknown as typeof fetch;
    const t = await lookupRegistryFacts({ name: 'A', domain: 'a.io' }, { fetchImpl: hang, timeoutMs: 20 });
    expect(t.statuses.find((s) => s.registry === 'wikidata')).toMatchObject({ status: 'error' });
    expect(t.statuses.find((s) => s.registry === 'wikidata')!.reason).toContain('timeout');
  });

  it('merges facts and enrichment from adapters that match', async () => {
    const f = mockFetch((url) => {
      if (url.includes('wikidata')) {
        return url.includes('wbsearchentities')
          ? { search: [{ id: 'Q7' }] }
          : { entities: { Q7: { claims: { P856: [site('https://a.no')], P1128: [{ ...qty(50), qualifiers: time('+2025-00-00T00:00:00Z', 9) }] } } } };
      }
      return { _embedded: { enheter: [{ navn: 'A AS', organisasjonsnummer: '999888777', antallAnsatte: 48, hjemmeside: 'a.no' }] } };
    });
    const r = await lookupRegistryFacts({ name: 'A', domain: 'a.no', country: 'NO' }, { fetchImpl: f });
    expect(r.facts.map((x) => x.registry).sort()).toEqual(['brreg', 'wikidata']);
    expect(r.enrichment).toMatchObject({ wikidataQid: 'Q7', orgnr: '999888777' });
  });
});
