import { describe, expect, it } from 'vitest';
import { companyAliases, fetchWikidataHeadshot, mentionsAny } from './wikidataHeadshot';

const human = [{ mainsnak: { datavalue: { value: { id: 'Q5' } } } }];
const ent = (id: string, o: Record<string, unknown>) => ({ id, labels: { en: { value: o.label } }, ...o });

function mockFetch(): typeof fetch {
  return (async (url: string) => {
    const u = new URL(url);
    const a = u.searchParams.get('action');
    let body: unknown = {};
    if (a === 'wbsearchentities') body = { search: [{ id: 'Q1' }, { id: 'Q2' }] };
    else if (a === 'wbgetentities' && u.searchParams.get('ids')!.includes('Q1')) {
      body = { entities: {
        Q1: ent('Q1', { label: 'Jane Roe', descriptions: { en: { value: 'footballer' } },
          claims: { P31: human, P108: [{ mainsnak: { datavalue: { value: { id: 'Q100' } } } }], P18: [{ mainsnak: { datavalue: { value: 'Jane Roe.jpg' } } }] } }),
        Q2: ent('Q2', { label: 'Jane Roe', descriptions: { en: { value: 'CEO of Acme' } },
          claims: { P31: human, P18: [{ mainsnak: { datavalue: { value: 'Jane Acme.jpg' } } }] } }),
      } };
    } else if (a === 'wbgetentities') body = { entities: { Q100: ent('Q100', { label: 'Other Club FC' }) } };
    return { ok: true, json: async () => body } as Response;
  }) as unknown as typeof fetch;
}

describe('wikidata headshot', () => {
  it('strips legal suffixes', () => {
    expect(companyAliases('Anthropic, PBC')).toEqual(['anthropic']);
    expect(mentionsAny('CEO of Metadata Inc', ['meta'])).toBe(false);
  });
  it('accepts the right person and rejects the namesake at another company', async () => {
    const shot = await fetchWikidataHeadshot('Jane Roe', 'Acme Inc', [], mockFetch());
    expect(shot?.thumb).toContain('Jane_Acme.jpg');
    expect(await fetchWikidataHeadshot('Jane Roe', 'Globex', [], mockFetch())).toBeNull();
  });
});
