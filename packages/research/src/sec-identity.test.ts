/**
 * Listed-company identity when the everyday name is not the SEC registrant
 * title. Fixtures are trimmed copies of the real public answers (SEC ticker
 * map rows and submissions feeds, Yahoo search, Wikidata P5531/P856), served
 * through a fake reader — no network.
 */
import { describe, expect, it, vi } from 'vitest';
import type { OriginalSourceReceipt } from './original-source';
import { secTickerSliceUrl, selectTickerMapSlice, selectTickerRowsSlice, singleIssuer, tickerLookupSymbols } from './market-quote';
import { nameRelatesToTitle, primaryCompanyName, replayListedIdentity, resolveListedIdentity, sameSite, topListedEquity, wikidataCikSearchUrl, wikidataWebsiteClaimsUrl } from './sec-identity';
import { secSubmissionsUrl, selectScheduleFilingIndex } from './sec-ownership';
import { parseSubmissionsProfile, secHeadquartersPlace } from './sec-profile';

const TICKER_MAP = JSON.stringify({
  0: { cik_str: 1652044, ticker: 'GOOGL', title: 'Alphabet Inc.' },
  1: { cik_str: 1326801, ticker: 'META', title: 'Meta Platforms, Inc.' },
  2: { cik_str: 1652044, ticker: 'GOOG', title: 'Alphabet Inc.' },
  3: { cik_str: 51143, ticker: 'IBM', title: 'INTERNATIONAL BUSINESS MACHINES CORP' },
  4: { cik_str: 1571996, ticker: 'DELL', title: 'Dell Technologies Inc.' },
  5: { cik_str: 1999111, ticker: 'MTTAF', title: 'Meta Critical Minerals Inc.' },
  6: { cik_str: 1166663, ticker: 'TEN', title: 'TSAKOS ENERGY NAVIGATION LTD' },
  7: { cik_str: 2030954, ticker: 'XHLD', title: 'TEN Holdings, Inc.' },
  8: { cik_str: 900001, ticker: 'ACME', title: 'Acme Corp' },
  9: { cik_str: 900002, ticker: 'ACMB', title: 'Acme, Inc.' },
  10: { cik_str: 1591698, ticker: 'PCTY', title: 'Paylocity Holding Corp' },
  11: { cik_str: 8670, ticker: 'ADP', title: 'AUTOMATIC DATA PROCESSING INC' },
  12: { cik_str: 896878, ticker: 'INTU', title: 'INTUIT INC.' },
  13: { cik_str: 1015922, ticker: 'CHKP', title: 'CHECK POINT SOFTWARE TECHNOLOGIES LTD' },
});

const address = (city: string, state: string) => ({ street1: '1 MAIN ST', city, stateOrCountry: state, zipCode: '10504', stateOrCountryDescription: state });
const submissions = (cik: string, name: string, tickers: string[], city: string, state: string, website = '') => JSON.stringify({
  cik, name, tickers, exchanges: tickers.map(() => 'NYSE'), website, investorWebsite: '',
  addresses: { mailing: address(city, state), business: address(city, state) },
  filings: { recent: { accessionNumber: [], filingDate: [], form: [], primaryDocument: [] } },
});
const FEEDS: Record<string, string> = {
  '0000051143': submissions('0000051143', 'INTERNATIONAL BUSINESS MACHINES CORP', ['IBM'], 'ARMONK', 'NY'),
  '0001571996': submissions('0001571996', 'Dell Technologies Inc.', ['DELL'], 'ROUND ROCK', 'TX'),
  '0001326801': submissions('0001326801', 'Meta Platforms, Inc.', ['META'], 'MENLO PARK', 'CA'),
  '0001652044': submissions('0001652044', 'Alphabet Inc.', ['GOOGL', 'GOOG'], 'MOUNTAIN VIEW', 'CA'),
  '0001166663': submissions('0001166663', 'TSAKOS ENERGY NAVIGATION LTD', ['TEN'], 'ATHENS', 'J3'),
};

const quote = (symbol: string, longname: string, exchange = 'NYQ', quoteType = 'EQUITY') => ({ symbol, longname, shortname: longname, exchange, quoteType });
const YAHOO: Record<string, unknown[]> = {
  IBM: [quote('IBM', 'International Business Machines Corporation'), quote('IBX', 'Tradr 2X Long IBM Daily ETF', 'BTS', 'ETF')],
  Dell: [quote('DELL', 'Dell Technologies Inc.'), quote('DLLL', 'GraniteShares 2x Long DELL Daily ETF', 'NGM', 'ETF')],
  Meta: [quote('META', 'Meta Platforms, Inc.', 'NMS'), quote('TMC', 'TMC the metals company Inc.', 'NMS')],
  Google: [quote('GOOG', 'Alphabet Inc.', 'NMS')],
  Ten: [quote('TEN', 'Tsakos Energy Navigation Limited')],
  'Company Ten': [quote('TEN', 'Tsakos Energy Navigation Limited')],
};

const WIKIDATA_ITEMS: Record<string, string[]> = {
  '0000051143': ['Q37156'], '0001571996': ['Q30873', 'Q27500963'], '0001326801': ['Q380'],
  '0001652044': ['Q20800404'], '0001166663': ['Q1000001'],
};
const WEBSITES: Record<string, string[]> = {
  Q37156: ['https://www.ibm.com/', 'https://www.ibm.com/uk-en'], Q30873: ['https://www.dell.com/'],
  Q27500963: ['http://www.delltechnologies.com/'], Q380: ['https://www.meta.com/'], Q20800404: ['https://abc.xyz/'],
  Q1000001: ['https://www.tenn.gr/'],
};

type Overrides = Partial<Record<'wikidataSearch' | 'yahoo' | 'byName', string>>;

function reader(overrides: Overrides = {}) {
  return vi.fn(async (url: string): Promise<OriginalSourceReceipt> => {
    const ok = (text: string): OriginalSourceReceipt => ({ requestedUrl: url, finalUrl: url, status: 'retrieved', httpStatus: 200,
      contentHash: 'a'.repeat(64), retrievedAt: '2026-10-13T00:00:00.000Z', text, truncated: false });
    const parsed = new URL(url);
    if (parsed.pathname === '/files/company_tickers.json') {
      const lookup = parsed.searchParams.get('lookup');
      if (lookup) return ok(overrides.byName ?? selectTickerMapSlice(TICKER_MAP, lookup));
      return ok(selectTickerRowsSlice(TICKER_MAP, tickerLookupSymbols(parsed.searchParams.get('tickers'))));
    }
    if (parsed.hostname === 'query1.finance.yahoo.com') {
      return ok(overrides.yahoo ?? JSON.stringify({ quotes: YAHOO[parsed.searchParams.get('q') ?? ''] ?? [] }));
    }
    const feed = /\/submissions\/CIK(\d{10})\.json$/.exec(parsed.pathname)?.[1];
    if (feed) return FEEDS[feed] ? ok(selectScheduleFilingIndex(FEEDS[feed]!)) : { requestedUrl: url, status: 'unavailable', retrievedAt: '2026-10-13T00:00:00.000Z' };
    if (parsed.hostname === 'www.wikidata.org' && parsed.searchParams.get('action') === 'query') {
      const cik = /P5531=(\d{10})/.exec(parsed.searchParams.get('srsearch') ?? '')?.[1] ?? '';
      const ids = WIKIDATA_ITEMS[cik] ?? [];
      return ok(overrides.wikidataSearch ?? JSON.stringify({ query: { searchinfo: { totalhits: ids.length }, search: ids.map((title) => ({ ns: 0, title })) } }));
    }
    if (parsed.hostname === 'www.wikidata.org' && parsed.searchParams.get('action') === 'wbgetclaims') {
      const sites = WEBSITES[parsed.searchParams.get('entity') ?? ''] ?? [];
      return ok(JSON.stringify({ claims: { P856: sites.map((value, i) => ({ rank: i ? 'normal' : 'preferred', mainsnak: { datavalue: { value } } })) } }));
    }
    return { requestedUrl: url, status: 'unavailable', retrievedAt: '2026-10-13T00:00:00.000Z' };
  });
}

describe('listed identity: everyday name vs SEC registrant title', () => {
  it.each([
    ['IBM', 'https://www.ibm.com', '51143', 'IBM', 'INTERNATIONAL BUSINESS MACHINES CORP', 'Armonk, New York'],
    ['Dell', 'https://www.dell.com/en-us', '1571996', 'DELL', 'Dell Technologies Inc.', 'Round Rock, Texas'],
    ['Meta', 'meta.com', '1326801', 'META', 'Meta Platforms, Inc.', 'Menlo Park, California'],
  ])('resolves %s through market listing, name and its own domain', async (name, websiteUrl, cik, ticker, title, hq) => {
    const read = reader();
    const result = await resolveListedIdentity({ name, websiteUrl }, read);
    expect(result.identity).toEqual({ cik, ticker, title, via: 'alias', issuerName: title });
    expect(secHeadquartersPlace(result.profile)).toBe(hq);
    // Every piece of evidence is a retained receipt from the reader.
    expect(result.receipts.map((r) => r.requestedUrl)).toEqual(read.mock.calls.map(([url]) => url));
    expect(read.mock.calls.map(([url]) => url)).toContain(secTickerSliceUrl([ticker]));
    expect(read.mock.calls.map(([url]) => url)).toContain(wikidataCikSearchUrl(cik));
  });

  it('keeps the exact registrant-name path first, with no alias reads', async () => {
    const read = reader();
    const result = await resolveListedIdentity({ name: 'Dell Technologies', websiteUrl: 'https://www.dell.com' }, read);
    expect(result.identity).toMatchObject({ cik: '1571996', ticker: 'DELL', via: 'name', issuerName: 'Dell Technologies' });
    expect(read).toHaveBeenCalledTimes(1);
  });

  it('resolves share classes of one CIK to that issuer (Alphabet: GOOGL, GOOG)', async () => {
    const result = await resolveListedIdentity({ name: 'Alphabet', websiteUrl: 'https://abc.xyz' }, reader());
    expect(result.identity).toMatchObject({ cik: '1652044', ticker: 'GOOGL', via: 'name' });
    expect(singleIssuer([{ cik: '1', ticker: 'A', title: 'A' }, { cik: '2', ticker: 'B', title: 'A' }])).toBeNull();
  });

  it('never resolves an exact-name tie between two registrants, and never falls through to the alias path', async () => {
    const read = reader();
    const result = await resolveListedIdentity({ name: 'Acme', websiteUrl: 'https://acme.com' }, read);
    expect(result.identity).toBeNull();
    expect(read).toHaveBeenCalledTimes(1);
  });

  it('never gives a parent to a subsidiary on another domain (Google is not Alphabet)', async () => {
    const result = await resolveListedIdentity({ name: 'Google', websiteUrl: 'https://google.com' }, reader());
    expect(result.identity).toBeNull();
    expect(result.profile).toBeNull();
  });

  it('rejects a same-named company on another domain', async () => {
    const result = await resolveListedIdentity({ name: 'Meta', websiteUrl: 'https://meta-labs.io' }, reader());
    expect(result.identity).toBeNull();
    expect(result.profile).toBeNull();
  });

  it('never shrinks "Company Ten" to a TEN listing, and an acronym alone is not identity', async () => {
    expect((await resolveListedIdentity({ name: 'Company Ten', websiteUrl: 'https://companyten.com' }, reader())).identity).toBeNull();
    // "Ten" is the initials of Tsakos Energy Navigation and Yahoo agrees — but
    // the company's own domain is not the registrant's.
    // (No exact-title row here, so the alias path is what decides.)
    const read = reader({ byName: JSON.stringify({ lookupName: 'Ten', matches: [] }) });
    expect((await resolveListedIdentity({ name: 'Ten', websiteUrl: 'https://ten.example.com' }, read)).identity).toBeNull();
    expect(read.mock.calls.map(([url]) => url)).toContain(wikidataCikSearchUrl('1166663'));
  });

  it('needs a website to anchor an alias at all', async () => {
    const read = reader();
    expect((await resolveListedIdentity({ name: 'IBM', websiteUrl: null }, read)).identity).toBeNull();
    expect(read).toHaveBeenCalledTimes(1);
  });

  it('rejects when Yahoo and the SEC disagree on who the symbol is', async () => {
    const yahoo = JSON.stringify({ quotes: [quote('IBM', 'Imaginary Bits Media Inc.')] });
    expect((await resolveListedIdentity({ name: 'IBM', websiteUrl: 'https://www.ibm.com' }, reader({ yahoo }))).identity).toBeNull();
  });

  it('decides on the top listed equity only, never a lower-ranked one', async () => {
    const yahoo = JSON.stringify({ quotes: [quote('IBMX', 'Unknown Co', 'NYQ'), quote('IBM', 'International Business Machines Corporation')] });
    expect((await resolveListedIdentity({ name: 'IBM', websiteUrl: 'https://www.ibm.com' }, reader({ yahoo }))).identity).toBeNull();
    // A foreign line or a fund is not the US listing.
    expect(topListedEquity(JSON.stringify({ quotes: [quote('IBM.DE', 'International Business Machines Corporation', 'GER'), quote('IBX', 'x', 'BTS', 'ETF')] }))).toBeNull();
  });

  it('treats many Wikidata items claiming one CIK as noise', async () => {
    const wikidataSearch = JSON.stringify({ query: { searchinfo: { totalhits: 9 }, search: [{ title: 'Q37156' }] } });
    expect((await resolveListedIdentity({ name: 'IBM', websiteUrl: 'https://www.ibm.com' }, reader({ wikidataSearch }))).identity).toBeNull();
  });

  it('treats an unreadable ticker map as unknown, not as "no registrant"', async () => {
    const read = reader({ byName: '<html>throttled</html>' });
    expect((await resolveListedIdentity({ name: 'IBM', websiteUrl: 'https://www.ibm.com' }, read)).identity).toBeNull();
    expect(read).toHaveBeenCalledTimes(1);
  });

  it('accepts the website the registrant itself gives EDGAR, without Wikidata', async () => {
    FEEDS['0000051143'] = submissions('0000051143', 'INTERNATIONAL BUSINESS MACHINES CORP', ['IBM'], 'ARMONK', 'NY', 'https://www.ibm.com');
    try {
      const read = reader();
      expect((await resolveListedIdentity({ name: 'IBM', websiteUrl: 'ibm.com' }, read)).identity).toMatchObject({ cik: '51143', via: 'alias' });
      expect(read.mock.calls.some(([url]) => url.includes('wikidata'))).toBe(false);
    } finally {
      FEEDS['0000051143'] = submissions('0000051143', 'INTERNATIONAL BUSINESS MACHINES CORP', ['IBM'], 'ARMONK', 'NY');
    }
  });

  it('rejects a submissions feed that does not list the matched symbol', async () => {
    const saved = FEEDS['0000051143']!;
    FEEDS['0000051143'] = submissions('0000051143', 'INTERNATIONAL BUSINESS MACHINES CORP', ['IBMX'], 'ARMONK', 'NY');
    try {
      expect((await resolveListedIdentity({ name: 'IBM', websiteUrl: 'https://www.ibm.com' }, reader())).identity).toBeNull();
    } finally { FEEDS['0000051143'] = saved; }
  });
});

describe('registrant names with a holding-company tail or a product beside the name', () => {
  const ADP_NAME = 'Automatic Data Processing, Inc. / ADP (RUN Powered by ADP)';

  it('matches "Paylocity" to "Paylocity Holding Corp" by name, with no alias reads', async () => {
    const read = reader();
    const result = await resolveListedIdentity({ name: 'Paylocity', websiteUrl: 'https://www.paylocity.com' }, read);
    expect(result.identity).toMatchObject({ cik: '1591698', ticker: 'PCTY', via: 'name', issuerName: 'Paylocity' });
    expect(read).toHaveBeenCalledTimes(1);
  });

  it('reads the first part of a compound stored name (ADP, Intuit) with the same exact match', async () => {
    const read = reader();
    const adp = await resolveListedIdentity({ name: ADP_NAME, websiteUrl: 'https://www.adp.com' }, read);
    expect(adp.identity).toMatchObject({ cik: '8670', ticker: 'ADP', via: 'name', issuerName: 'Automatic Data Processing, Inc.' });
    // The full name found nothing; its first part found the registrant. No alias reads.
    expect(read).toHaveBeenCalledTimes(2);
    const intuit = await resolveListedIdentity({ name: 'Intuit (QuickBooks Payroll)', websiteUrl: 'https://www.intuit.com' }, reader());
    expect(intuit.identity).toMatchObject({ cik: '896878', ticker: 'INTU', via: 'name', issuerName: 'Intuit' });
  });

  it('never stretches a first part into a different registrant', async () => {
    // "Check" is not Check Point Software Technologies: only the whole registrant name counts.
    const check = await resolveListedIdentity({ name: 'Check (Check Technologies)', websiteUrl: 'https://checkhq.com' }, reader());
    expect(check.identity).toBeNull();
    // A tie on the first part stays a tie: no pick, no alias fallthrough.
    const read = reader();
    const acme = await resolveListedIdentity({ name: 'Acme (Smart Widgets)', websiteUrl: 'https://acme.example' }, read);
    expect(acme.identity).toBeNull();
    expect(read).toHaveBeenCalledTimes(2);
  });

  it('replays a compound-name identity from its retained reads, and older evidence without the second read decides nothing wrong', async () => {
    const company = { name: ADP_NAME, websiteUrl: 'https://www.adp.com' };
    const live = await resolveListedIdentity(company, reader());
    const retained = live.receipts;
    expect(replayListedIdentity(company, retained)).toEqual(live.identity);
    // Evidence retained before the second read existed: the alias path decides, here to no identity, never a crash.
    expect(replayListedIdentity(company, retained.slice(0, 1))).toBeNull();
  });

  it('finds the first part of a name only when there is one', () => {
    expect(primaryCompanyName('Intuit (QuickBooks Payroll)')).toBe('Intuit');
    expect(primaryCompanyName('Automatic Data Processing, Inc. / ADP (RUN Powered by ADP)')).toBe('Automatic Data Processing, Inc.');
    expect(primaryCompanyName('Paychex, Inc.')).toBeNull();
    expect(primaryCompanyName('Gusto')).toBeNull();
    expect(primaryCompanyName('(Gusto)')).toBeNull();
  });
});

describe('identity building blocks', () => {
  it('relates a name to a title only by the whole title, its leading words or its initials', () => {
    expect(nameRelatesToTitle('IBM', 'INTERNATIONAL BUSINESS MACHINES CORP')).toBe(true);
    expect(nameRelatesToTitle('Dell', 'Dell Technologies Inc.')).toBe(true);
    expect(nameRelatesToTitle('Meta', 'Meta Platforms, Inc.')).toBe(true);
    expect(nameRelatesToTitle('Company Ten', 'TEN Holdings, Inc.')).toBe(false);
    expect(nameRelatesToTitle('Holdings', 'TEN Holdings, Inc.')).toBe(false);
    expect(nameRelatesToTitle('Platforms', 'Meta Platforms, Inc.')).toBe(false);
    expect(nameRelatesToTitle('Google', 'Alphabet Inc.')).toBe(false);
    expect(nameRelatesToTitle('Me', 'Meta Platforms, Inc.')).toBe(false);
    expect(nameRelatesToTitle('Met', 'Meta Platforms, Inc.')).toBe(false);
  });

  it('compares sites by host, allowing only a subdomain of the company domain', () => {
    expect(sameSite('https://www.ibm.com/us-en', 'https://www.ibm.com/uk-en')).toBe(true);
    expect(sameSite('meta.com', 'https://about.meta.com/')).toBe(true);
    expect(sameSite('https://about.meta.com', 'https://meta.com')).toBe(false);
    expect(sameSite('https://google.com', 'https://abc.xyz/')).toBe(false);
    expect(sameSite('https://notibm.com', 'https://ibm.com')).toBe(false);
    expect(sameSite(null, 'https://ibm.com')).toBe(false);
  });

  it('builds bounded, exact Wikidata and by-ticker URLs', () => {
    expect(wikidataCikSearchUrl('51143')).toContain('srsearch=haswbstatement%3AP5531%3D0000051143');
    expect(wikidataWebsiteClaimsUrl('Q37156')).toContain('entity=Q37156&property=P856');
    expect(tickerLookupSymbols('ibm,IBM, goog')).toEqual(['IBM', 'GOOG']);
    expect(tickerLookupSymbols('IBM;DROP')).toEqual([]);
    expect(tickerLookupSymbols('A,B,C,D,E,F,G')).toEqual([]);
    expect(JSON.parse(selectTickerRowsSlice(TICKER_MAP, ['GOOG'])).matches).toEqual([{ cik: '1652044', ticker: 'GOOG', title: 'Alphabet Inc.' }]);
  });
});

describe('SEC headquarters', () => {
  const profileOf = (feed: string) => parseSubmissionsProfile(selectScheduleFilingIndex(feed))?.profile ?? null;

  it('keeps the registrant profile in the retained submissions slice', () => {
    const slice = parseSubmissionsProfile(selectScheduleFilingIndex(FEEDS['0000051143']!));
    expect(slice).toMatchObject({ cik: '0000051143', profile: { tickers: ['IBM'], website: null,
      business: { city: 'ARMONK', stateOrCountry: 'NY' } } });
    expect(secSubmissionsUrl('51143')).toBe('https://data.sec.gov/submissions/CIK0000051143.json');
  });

  it('maps the filed business address to a readable place', () => {
    expect(secHeadquartersPlace(profileOf(FEEDS['0001571996']!))).toBe('Round Rock, Texas');
    expect(secHeadquartersPlace(profileOf(submissions('1', 'X', [], 'ST. LOUIS', 'MO')))).toBe('St. Louis, Missouri');
  });

  it('shows no place for an EDGAR country code, a numbered city or a missing address', () => {
    expect(secHeadquartersPlace(profileOf(FEEDS['0001166663']!))).toBeNull();
    const foreign = JSON.parse(submissions('1', 'X', [], 'LONDON', 'X0')) as { addresses: { business: { stateOrCountryDescription: string } } };
    foreign.addresses.business.stateOrCountryDescription = 'UNITED KINGDOM';
    expect(secHeadquartersPlace(profileOf(JSON.stringify(foreign)))).toBe('London, United Kingdom');
    expect(secHeadquartersPlace(profileOf(submissions('1', 'X', [], 'PO BOX 12', 'NY')))).toBeNull();
    expect(secHeadquartersPlace(null)).toBeNull();
    // A slice retained before profiles were kept has none.
    expect(parseSubmissionsProfile(JSON.stringify({ cik: '0000000001', name: 'X', filings: [], companyFilings: [] }))).toBeNull();
  });
});
