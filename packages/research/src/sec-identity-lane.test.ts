/**
 * The structured lane end to end for a listed company whose everyday name is
 * not its SEC title: "IBM" gets its filed annual revenue and its filed
 * headquarters, and every identity read lands in the retained ledger.
 */
import { expect, it, vi } from 'vitest';
import { GeminiRepository, type RepoSnapshot, type ResearchStore } from './repository';
import type { LlmClient } from './types';
import type { OriginalSourceReceipt } from './original-source';
import { selectTickerMapSlice, selectTickerRowsSlice, tickerLookupSymbols } from './market-quote';
import { selectScheduleFilingIndex } from './sec-ownership';

const DAY = 86_400_000;
const iso = (ms: number) => new Date(ms).toISOString().slice(0, 10);
const END = Date.now() - 200 * DAY;
const PERIOD = { start: iso(END - 364 * DAY), end: iso(END), filed: iso(END + 30 * DAY) };

const TICKER_MAP = JSON.stringify({
  0: { cik_str: 51143, ticker: 'IBM', title: 'INTERNATIONAL BUSINESS MACHINES CORP' },
  1: { cik_str: 1166663, ticker: 'TEN', title: 'TSAKOS ENERGY NAVIGATION LTD' },
});
const FEED = JSON.stringify({
  cik: '0000051143', name: 'INTERNATIONAL BUSINESS MACHINES CORP', tickers: ['IBM'], website: '', investorWebsite: '',
  addresses: { business: { street1: '1 NEW ORCHARD ROAD', city: 'ARMONK', stateOrCountry: 'NY', zipCode: '10504', stateOrCountryDescription: 'NY' } },
  filings: { recent: { accessionNumber: [], filingDate: [], form: [], primaryDocument: [] } },
});
const CONCEPT = 'https://data.sec.gov/api/xbrl/companyconcept/CIK0000051143/us-gaap/RevenueFromContractWithCustomerExcludingAssessedTax.json';

function snapshot(name: string, websiteUrl: string): RepoSnapshot {
  return {
    schemaVersion: 2, markets: [], decks: [],
    companies: [{ id: 'cmp_1', name, oneLiner: 'Enterprise technology company.', websiteUrl, logoUrl: null, hqLocation: '', brandTheme: null }],
    metrics: [], cards: [], viceClaims: [], dashboards: {}, companyMarket: { cmp_1: 'Enterprise IT' },
    opportunity: {}, reports: [], savedCards: [], researchJobs: [], threads: [],
  } as unknown as RepoSnapshot;
}

function memoryStore(initial: RepoSnapshot): ResearchStore & { current: () => RepoSnapshot } {
  let data = initial;
  return { read: () => data, write: (snap: RepoSnapshot) => { data = snap; }, current: () => data };
}

const reader = () => vi.fn(async (url: string): Promise<OriginalSourceReceipt> => {
  const ok = (text: string, extra: Partial<OriginalSourceReceipt> = {}): OriginalSourceReceipt => ({ requestedUrl: url, finalUrl: url,
    status: 'retrieved', httpStatus: 200, contentHash: 'a'.repeat(64), retrievedAt: new Date().toISOString(), text, truncated: false, ...extra });
  const parsed = new URL(url);
  if (parsed.pathname === '/files/company_tickers.json') {
    const lookup = parsed.searchParams.get('lookup');
    return ok(lookup ? selectTickerMapSlice(TICKER_MAP, lookup) : selectTickerRowsSlice(TICKER_MAP, tickerLookupSymbols(parsed.searchParams.get('tickers'))));
  }
  if (parsed.pathname === '/v1/finance/search') {
    return ok(JSON.stringify({ quotes: parsed.searchParams.get('q') === 'IBM'
      ? [{ symbol: 'IBM', quoteType: 'EQUITY', exchange: 'NYQ', longname: 'International Business Machines Corporation' }] : [] }));
  }
  if (parsed.pathname === '/submissions/CIK0000051143.json') return ok(selectScheduleFilingIndex(FEED));
  if (parsed.hostname === 'www.wikidata.org' && parsed.searchParams.get('action') === 'query') {
    const own = (parsed.searchParams.get('srsearch') ?? '').endsWith('P5531=0000051143');
    return ok(JSON.stringify({ query: { searchinfo: { totalhits: own ? 1 : 0 }, search: own ? [{ title: 'Q37156' }] : [] } }));
  }
  if (parsed.hostname === 'www.wikidata.org') {
    return ok(JSON.stringify({ claims: { P856: [{ rank: 'preferred', mainsnak: { datavalue: { value: 'https://www.ibm.com/' } } }] } }));
  }
  if (url === CONCEPT) {
    return ok(JSON.stringify({ cik: 51143, entityName: 'INTERNATIONAL BUSINESS MACHINES CORPORATION', taxonomy: 'us-gaap',
      tag: 'RevenueFromContractWithCustomerExcludingAssessedTax', units: { USD: [{ start: PERIOD.start, end: PERIOD.end,
        val: 62753000000, accn: '0000051143-26-000012', form: '10-K', filed: PERIOD.filed, fp: 'FY' }] } }), { format: 'sec-companyconcept' });
  }
  return { requestedUrl: url, status: 'unavailable', retrievedAt: new Date().toISOString(), reason: 'No fixture' };
});

const client: LlmClient = {
  ground: async () => ({ text: 'No usable coverage.', citations: [], queries: [] }),
  structure: async (_prompt: string, schema: { parse: (v: unknown) => unknown }) => schema.parse({ figures: [] }),
} as unknown as LlmClient;

it('fills an alias-resolved listed company\'s SEC revenue and filed headquarters', async () => {
  const store = memoryStore(snapshot('IBM', 'https://www.ibm.com'));
  const read = reader();
  const repo = new GeminiRepository({ apiKey: 'k', store, client, originalSourceReader: read });
  const result = await repo.huntCompanyMetrics('cmp_1');
  expect(result.filledTypes).toContain('arr');
  const arr = (await repo.getCompanyFacts('cmp_1')).find((m) => m.metricType === 'arr');
  expect(arr).toMatchObject({ value: 62753000000, confidence: 'verified' });
  const snap = store.current();
  expect(snap.companies[0]!.hqLocation).toBe('Armonk, New York');
  // The identity evidence is in the retained ledger, not just in memory.
  const retained = (snap.originalSourceAttempts ?? []).flatMap((a) => a.receipts.map((r) => r.requestedUrl));
  expect(retained.some((u) => u.includes('query1.finance.yahoo.com/v1/finance/search'))).toBe(true);
  expect(retained.some((u) => u.includes('wikidata.org'))).toBe(true);
  expect(retained).toContain('https://data.sec.gov/submissions/CIK0000051143.json');
});

it('leaves a same-named company on another domain with nothing from SEC', async () => {
  const store = memoryStore(snapshot('IBM', 'https://ibm-consulting-partners.example'));
  const repo = new GeminiRepository({ apiKey: 'k', store, client, originalSourceReader: reader() });
  const result = await repo.huntCompanyMetrics('cmp_1');
  expect(result.filledTypes).not.toContain('arr');
  expect(store.current().companies[0]!.hqLocation).toBe('');
  expect((await repo.getCompanyFacts('cmp_1')).find((m) => m.metricType === 'arr' && m.value !== null)).toBeUndefined();
});
