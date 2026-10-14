import { afterEach, describe, expect, it, vi } from 'vitest';
import { lookupFoundedYear } from './wikidataFounded';

const time = (year: string, precision = 9) => ({ mainsnak: { datavalue: { value: { time: `+${year}-01-01T00:00:00Z`, precision } } } });
const site = (url: string) => ({ mainsnak: { datavalue: { value: url } } });

function answer(search: string[], entities: Record<string, { P856?: unknown[]; P571?: unknown[] }>, labels: Record<string, string> = {}) {
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
    const url = String(input);
    return new Response(JSON.stringify(url.includes('wbsearchentities')
      ? { search: search.map((id) => ({ id })) }
      : { entities: Object.fromEntries(Object.entries(entities).map(([id, claims]) => [id, { claims, labels: labels[id] ? { en: { value: labels[id] } } : undefined }])) }));
  });
}

let n = 0;
const company = () => `Acme ${++n}`;

describe('founded year from Wikidata', () => {
  afterEach(() => vi.restoreAllMocks());

  it('is the inception year of the one item whose official website is the company\'s', async () => {
    answer(['Q1', 'Q2'], { Q1: { P856: [site('https://www.other.com')], P571: [time('1999')] }, Q2: { P856: [site('https://acme.ai/')], P571: [time('2015')] } });
    expect(await lookupFoundedYear(company(), 'https://www.acme.ai')).toEqual({ year: 2015, qid: 'Q2' });
  });

  it('gives no answer when the website matches nothing, matches several items, or the date is too vague', async () => {
    answer(['Q1'], { Q1: { P856: [site('https://other.com')], P571: [time('2015')] } });
    expect(await lookupFoundedYear(company(), 'https://acme.ai')).toBeNull();
    answer(['Q1', 'Q2'], { Q1: { P856: [site('https://acme.ai')], P571: [time('2015')] }, Q2: { P856: [site('https://acme.ai')], P571: [time('2016')] } });
    expect(await lookupFoundedYear(company(), 'https://acme.ai')).toBeNull(); // neither is labelled with the name
    answer(['Q1'], { Q1: { P856: [site('https://acme.ai')], P571: [time('2000', 7)] } });
    expect(await lookupFoundedYear(company(), 'https://acme.ai')).toBeNull();
    answer(['Q1'], { Q1: { P856: [site('https://acme.ai')], P571: [time('2012'), time('2013')] } });
    expect(await lookupFoundedYear(company(), 'https://acme.ai')).toBeNull();
  });

  it('picks the item labelled with the company\'s name when its products share the website', async () => {
    const name = company();
    answer(['Q1', 'Q2'], { Q1: { P856: [site('https://acme.ai')], P571: [time('2015')] }, Q2: { P856: [site('https://acme.ai')], P571: [time('2022')] } }, { Q1: name, Q2: `${name} Assistant` });
    expect(await lookupFoundedYear(name, 'https://acme.ai')).toEqual({ year: 2015, qid: 'Q1' });
  });

  it('asks once per company, and a network failure is just no answer', async () => {
    answer(['Q1'], { Q1: { P856: [site('https://acme.ai')], P571: [time('2015')] } });
    const name = company();
    await lookupFoundedYear(name, 'https://acme.ai');
    await lookupFoundedYear(name, 'https://acme.ai');
    // Name search, brand-word search, entity fetch: once, not per call.
    expect(fetch).toHaveBeenCalledTimes(3);
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('offline'));
    expect(await lookupFoundedYear(company(), 'https://acme.ai')).toBeNull();
    expect(await lookupFoundedYear(company(), null)).toBeNull();
  });
});
