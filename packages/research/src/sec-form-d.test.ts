import { afterEach, describe, expect, it, vi } from 'vitest';
import type { MetricType } from '@mi/contracts';
import {
  FORM_D_MAX_AGE_DAYS, findFormDLastRound, formDAddressMatches, formDDocumentUrl, formDLastRoundObservation,
  parseFormDDocument, parseFormDXml, secEntityLookupUrl, secEntityMatch,
} from './sec-form-d';
import { parseScheduleFilingIndex, secSubmissionsUrl, selectScheduleFilingIndex } from './sec-ownership';
import type { FormDFilingRow } from './sec-filings';
import { retrieveOriginalSource, type SourceTransport } from './original-source.node';
import type { OriginalSourceReceipt } from './original-source';
import { GeminiRepository, type RepoSnapshot, type ResearchStore } from './repository';
import type { LlmClient } from './types';
import { secTickerMapUrl } from './market-quote';

const NOW = Date.parse('2026-10-13T12:00:00.000Z');

/** Trimmed from Databricks, Inc.'s Form D, accession 0001587468-26-000002 (filed 2026-08-27). */
function formD(opts: {
  form?: 'D' | 'D/A'; cik?: string; name?: string; city?: string; state?: string; stateDescription?: string;
  industry?: string; pooled?: boolean; amendment?: string | null; firstSale?: string | null; offered?: string; sold?: string;
  businessCombination?: boolean;
} = {}): string {
  const amendment = opts.amendment ?? null;
  return `<?xml version="1.0"?>
<edgarSubmission>
    <schemaVersion>X0708</schemaVersion>
    <submissionType>${opts.form ?? (amendment ? 'D/A' : 'D')}</submissionType>
    <testOrLive>LIVE</testOrLive>
    <primaryIssuer>
        <cik>${opts.cik ?? '0001587468'}</cik>
        <entityName>${opts.name ?? 'Databricks, Inc.'}</entityName>
        <issuerAddress>
            <street1>160 SPEAR STREET</street1>
            <street2>15TH FLOOR</street2>
            <city>${opts.city ?? 'SAN FRANCISCO'}</city>
            <stateOrCountry>${opts.state ?? 'CA'}</stateOrCountry>
            <stateOrCountryDescription>${opts.stateDescription ?? 'CALIFORNIA'}</stateOrCountryDescription>
            <zipCode>94105</zipCode>
        </issuerAddress>
        <issuerPhoneNumber>866-330-0121</issuerPhoneNumber>
        <jurisdictionOfInc>DELAWARE</jurisdictionOfInc>
        <edgarPreviousNameList><previousName>DataBricks, Inc.</previousName></edgarPreviousNameList>
        <entityType>Corporation</entityType>
        <yearOfInc><overFiveYears>true</overFiveYears></yearOfInc>
    </primaryIssuer>
    <relatedPersonsList>
        <relatedPersonInfo>
            <relatedPersonName><firstName>Ali</firstName><lastName>Ghodsi</lastName></relatedPersonName>
            <relatedPersonAddress>
                <street1>c/o Databricks, Inc.</street1>
                <city>Elsewhere</city>
                <stateOrCountry>NY</stateOrCountry>
                <stateOrCountryDescription>NEW YORK</stateOrCountryDescription>
                <zipCode>94105</zipCode>
            </relatedPersonAddress>
            <relatedPersonRelationshipList><relationship>Executive Officer</relationship></relatedPersonRelationshipList>
        </relatedPersonInfo>
    </relatedPersonsList>
    <offeringData>
        <industryGroup>
            <industryGroupType>${opts.industry ?? (opts.pooled ? 'Pooled Investment Fund' : 'Other Technology')}</industryGroupType>
            ${opts.pooled ? '<investmentFundInfo><investmentFundType>Venture Capital Fund</investmentFundType><is40Act>false</is40Act></investmentFundInfo>' : ''}
        </industryGroup>
        <issuerSize><revenueRange>Decline to Disclose</revenueRange></issuerSize>
        <federalExemptionsExclusions><item>06c</item></federalExemptionsExclusions>
        <typeOfFiling>
            <newOrAmendment>
                <isAmendment>${amendment ? 'true' : 'false'}</isAmendment>
                ${amendment ? `<previousAccessionNumber>${amendment}</previousAccessionNumber>` : ''}
            </newOrAmendment>
            <dateOfFirstSale>
                ${opts.firstSale === null ? '<yetToOccur>true</yetToOccur>' : `<value>${opts.firstSale ?? '2026-08-12'}</value>`}
            </dateOfFirstSale>
        </typeOfFiling>
        <durationOfOffering><moreThanOneYear>false</moreThanOneYear></durationOfOffering>
        <typesOfSecuritiesOffered>
            ${opts.pooled ? '<isPooledInvestmentFundType>true</isPooledInvestmentFundType>' : '<isEquityType>true</isEquityType>'}
        </typesOfSecuritiesOffered>
        <businessCombinationTransaction>
            <isBusinessCombinationTransaction>${opts.businessCombination ? 'true' : 'false'}</isBusinessCombinationTransaction>
            <clarificationOfResponse></clarificationOfResponse>
        </businessCombinationTransaction>
        <minimumInvestmentAccepted>0</minimumInvestmentAccepted>
        <offeringSalesAmounts>
            <totalOfferingAmount>${opts.offered ?? '5000000000'}</totalOfferingAmount>
            <totalAmountSold>${opts.sold ?? '4999997255'}</totalAmountSold>
            <totalRemaining>2745</totalRemaining>
            <clarificationOfResponse></clarificationOfResponse>
        </offeringSalesAmounts>
        <investors>
            <hasNonAccreditedInvestors>false</hasNonAccreditedInvestors>
            <totalNumberAlreadyInvested>136</totalNumberAlreadyInvested>
        </investors>
        <signatureBlock>
            <authorizedRepresentative>false</authorizedRepresentative>
            <signature>
                <issuerName>Databricks, Inc.</issuerName>
                <signatureName>/s/ David Conte</signatureName>
                <nameOfSigner>David Conte</nameOfSigner>
                <signatureTitle>Chief Financial Officer</signatureTitle>
                <signatureDate>2026-08-27</signatureDate>
            </signature>
        </signatureBlock>
    </offeringData>
</edgarSubmission>`;
}

const CIK = '0001587468';
const HQ = 'San Francisco, California, USA';

function receipt(accession: string, xml: string, cik = CIK): OriginalSourceReceipt {
  const url = formDDocumentUrl(cik, accession);
  const doc = parseFormDXml(xml);
  return { requestedUrl: url, finalUrl: url, status: 'retrieved', httpStatus: 200, retrievedAt: '2026-10-13T00:00:00.000Z',
    contentHash: 'c'.repeat(64), truncated: false, text: JSON.stringify(doc) };
}
const row = (accession: string, filingDate: string, form: 'D' | 'D/A' = 'D'): FormDFilingRow => ({ form, filingDate, accession });
const observe = (rows: FormDFilingRow[], receipts: OriginalSourceReceipt[], extra: { companyName?: string; hqLocation?: string | null } = {}) =>
  formDLastRoundObservation({ companyName: extra.companyName ?? 'Databricks', hqLocation: extra.hqLocation === undefined ? HQ : extra.hqLocation,
    cik: CIK, rows, receipts, nowMs: NOW });

/** Real-shaped EDGAR entity lookup: only brand-named SPVs mention Anysphere. */
const ANYSPHERE_LOOKUP = JSON.stringify({ took: 1, timed_out: false, hits: { total: { value: 2, relation: 'eq' }, max_score: 28.6, hits: [
  { _index: 'edgar_entity', _id: '2139817', _score: 28.6, _source: { entity: 'HII Anysphere-01, a Series of HII Anysphere LLC', rank: 710 } },
  { _index: 'edgar_entity', _id: '2127420', _score: 17.1, _source: { entity: '25Madison Anysphere SPV Mar 2026 a Series of CGF2021 LLC', rank: 834 } },
] } });
const DATABRICKS_LOOKUP = JSON.stringify({ hits: { hits: [
  { _id: '1587468', _source: { entity: 'Databricks, Inc.' } },
  { _id: '2126355', _source: { entity: 'HII Databricks-02, a Series of HII Databricks-A LLC' } },
  { _id: '2129532', _source: { entity: 'HOUSE DATABRICKS LLC' } },
] } });

describe('parseFormDXml', () => {
  it('reads issuer identity, offering type, first sale and amounts from a real-shaped notice', () => {
    const doc = parseFormDXml(formD());
    expect(doc).toEqual({
      form: 'D', live: true, cik: CIK, entityName: 'Databricks, Inc.', city: 'SAN FRANCISCO', state: 'CA',
      stateDescription: 'CALIFORNIA', industryGroup: 'Other Technology', pooledFund: false, businessCombination: false,
      isAmendment: false, previousAccession: null, dateOfFirstSale: '2026-08-12', firstSaleYetToOccur: false,
      securities: ['Equity'], totalOfferingAmount: 5000000000, totalAmountSold: 4999997255, signatureDate: '2026-08-27',
    });
    expect(parseFormDDocument(JSON.stringify(doc))).toEqual(doc);
  });

  it('keeps "Indefinite" as stated and reads an amendment and a pooled fund', () => {
    expect(parseFormDXml(formD({ offered: 'Indefinite' }))?.totalOfferingAmount).toBe('Indefinite');
    const amended = parseFormDXml(formD({ amendment: '0001587468-23-000002' }))!;
    expect(amended).toMatchObject({ form: 'D/A', isAmendment: true, previousAccession: '0001587468-23-000002' });
    expect(parseFormDXml(formD({ pooled: true }))).toMatchObject({ pooledFund: true, securities: ['Pooled investment fund interests'] });
    expect(parseFormDXml(formD({ firstSale: null }))).toMatchObject({ dateOfFirstSale: null, firstSaleYetToOccur: true });
  });

  it('is null for anything that is not a Form D notice', () => {
    expect(parseFormDXml(formD().replace('<submissionType>D</submissionType>', '<submissionType>SCHEDULE 13G</submissionType>'))).toBeNull();
    expect(parseFormDXml('<html>not xml</html>')).toBeNull();
    expect(parseFormDDocument('{"form":"D"}')).toBeNull();
  });
});

describe('secEntityMatch — identity is strict', () => {
  it('rejects brand-named SPVs: Anysphere has no registrant of its own', () => {
    expect(secEntityMatch(ANYSPHERE_LOOKUP, 'Anysphere')).toBeNull();
    expect(secEntityMatch(ANYSPHERE_LOOKUP, 'Anysphere, Inc.')).toBeNull();
  });

  it('resolves the one registrant whose legal name equals the company name', () => {
    expect(secEntityMatch(DATABRICKS_LOOKUP, 'Databricks')).toEqual({ cik: CIK, name: 'Databricks, Inc.' });
  });

  it('refuses to pick between two registrants with the same name', () => {
    const twins = JSON.stringify({ hits: { hits: [
      { _id: '111', _source: { entity: 'Acme Robotics, Inc.' } }, { _id: '222', _source: { entity: 'ACME ROBOTICS CORP' } },
    ] } });
    expect(secEntityMatch(twins, 'Acme Robotics')).toBeNull();
    expect(secEntityMatch('not json', 'Acme Robotics')).toBeNull();
  });

  it('requires the filing address to agree with the known headquarters', () => {
    const doc = parseFormDXml(formD())!;
    expect(formDAddressMatches(doc, 'San Francisco, CA')).toBe(true);
    expect(formDAddressMatches(doc, 'Mountain View, California')).toBe(true);
    expect(formDAddressMatches(doc, 'New York, NY')).toBe(false);
    expect(formDAddressMatches(doc, null)).toBe(false);
    // A bare two-letter code is not evidence (CA is also Canada).
    expect(formDAddressMatches({ city: 'TORONTO', stateDescription: null }, 'Vancouver, CA')).toBe(false);
  });
});

describe('formDLastRoundObservation', () => {
  it('reports the amount sold in the latest offering, dated by first sale, at estimated wording', () => {
    const rows = [row('0001587468-26-000002', '2026-08-27'), row('0001587468-26-000001', '2026-08-27')];
    const receipts = [
      receipt('0001587468-26-000002', formD()),
      receipt('0001587468-26-000001', formD({ firstSale: '2026-02-21', offered: '241204249', sold: '241204249' })),
    ];
    const observed = observe(rows, receipts)!;
    expect(observed).toMatchObject({ value: 4999997255, asOf: '2026-08-12', dateBasis: 'first_sale', form: 'D',
      filingDate: '2026-08-27', accession: '0001587468-26-000002', totalOfferingAmount: 5000000000 });
    expect(observed.citations).toEqual([{ title: 'SEC Form D — Databricks, Inc. (filed 2026-08-27; first sale 2026-08-12)',
      url: 'https://www.sec.gov/Archives/edgar/data/1587468/000158746826000002/primary_doc.xml', credibility: 'primary' }]);
    expect(observed.methodNote).toContain('$4,999,997,255 of $5,000,000,000 offered');
    expect(observed.methodNote).toContain('Not a priced valuation');
    // Form D never names the round's stage; nothing may invent one.
    expect(observed.methodNote).not.toMatch(/Series [A-Z]\b|seed/i);
  });

  it('takes the latest amendment of the same offering, not the original amount', () => {
    const rows = [row('0001587468-26-000009', '2026-09-30', 'D/A'), row('0001587468-26-000002', '2026-08-27')];
    const receipts = [
      receipt('0001587468-26-000009', formD({ amendment: '0001587468-26-000002', sold: '4999999999' })),
      receipt('0001587468-26-000002', formD({ sold: '3000000000' })),
    ];
    expect(observe(rows, receipts)).toMatchObject({ value: 4999999999, form: 'D/A', asOf: '2026-08-12', accession: '0001587468-26-000009' });
  });

  it('does not let an amendment of an older offering pose as the latest round', () => {
    const rows = [row('0001587468-26-000009', '2026-09-30', 'D/A'), row('0001587468-26-000005', '2026-06-01')];
    const receipts = [
      receipt('0001587468-26-000009', formD({ amendment: '0001587468-25-000001', firstSale: '2025-11-20', sold: '900000000' })),
      receipt('0001587468-26-000005', formD({ firstSale: '2026-05-20', offered: '1000000000', sold: '750000000' })),
    ];
    expect(observe(rows, receipts)).toMatchObject({ value: 750000000, asOf: '2026-05-20' });
  });

  it('skips pooled-fund notices: a fund is not an operating company round', () => {
    const rows = [row('0001587468-26-000002', '2026-08-27')];
    expect(observe(rows, [receipt('0001587468-26-000002', formD({ pooled: true }))])).toBeNull();
    // An operating offering beside a pooled notice is still found.
    const mixed = [row('0001587468-26-000003', '2026-09-01'), row('0001587468-26-000002', '2026-08-27')];
    expect(observe(mixed, [receipt('0001587468-26-000003', formD({ pooled: true, firstSale: '2026-08-30' })),
      receipt('0001587468-26-000002', formD())])).toMatchObject({ value: 4999997255 });
  });

  it('produces nothing for an Indefinite offering, $0 sold, a merger or a sale yet to occur', () => {
    const rows = [row('0001587468-26-000002', '2026-08-27')];
    const one = (xml: string) => observe(rows, [receipt('0001587468-26-000002', xml)]);
    expect(one(formD({ offered: 'Indefinite' }))).toBeNull();
    expect(one(formD({ sold: '0' }))).toBeNull();
    expect(one(formD({ businessCombination: true }))).toBeNull();
    expect(one(formD({ firstSale: null, sold: '0' }))).toBeNull();
  });

  it('refuses a wrong or unconfirmed identity', () => {
    const rows = [row('0001587468-26-000002', '2026-08-27')];
    const good = [receipt('0001587468-26-000002', formD())];
    expect(observe(rows, good, { companyName: 'Databricks Labs' })).toBeNull();
    expect(observe(rows, good, { hqLocation: 'Austin, Texas' })).toBeNull();
    expect(observe(rows, good, { hqLocation: null })).toBeNull();
    // The document must be the registrant's own filing.
    expect(observe(rows, [receipt('0001587468-26-000002', formD({ cik: '0000000042' }))])).toBeNull();
  });

  it('refuses two different offerings tied for latest, and a stale offering', () => {
    const rows = [row('0001587468-26-000003', '2026-08-27'), row('0001587468-26-000002', '2026-08-27')];
    expect(observe(rows, [receipt('0001587468-26-000003', formD({ sold: '10000000' })), receipt('0001587468-26-000002', formD())])).toBeNull();
    const old = new Date(NOW - (FORM_D_MAX_AGE_DAYS + 5) * 86400000).toISOString().slice(0, 10);
    expect(observe([row('0001587468-25-000001', old)], [receipt('0001587468-25-000001', formD({ firstSale: old }))])).toBeNull();
  });

  it('refuses when any listed notice was not read: it might be the newer offering', () => {
    const rows = [row('0001587468-26-000003', '2026-09-20'), row('0001587468-26-000002', '2026-08-27')];
    expect(observe(rows, [receipt('0001587468-26-000002', formD())])).toBeNull();
  });
});

/** Submissions feed shaped like data.sec.gov's (only the fields the slice reads). */
const SUBMISSIONS = JSON.stringify({ cik: '1587468', name: 'Databricks, Inc.', filings: { recent: {
  accessionNumber: ['0001587468-26-000002', '0001587468-26-000001', '0001587468-23-000003'],
  filingDate: ['2026-08-27', '2026-08-27', '2023-11-13'],
  form: ['D', 'D', 'D/A'],
  primaryDocument: ['xslFormDX01/primary_doc.xml', 'xslFormDX01/primary_doc.xml', 'xslFormDX01/primary_doc.xml'],
}, files: [] } });

describe('the node reader keeps a Form D notice as a bounded record', () => {
  it('retains the parsed offering facts, hashed against the whole document, and slices D rows from the feed', async () => {
    const io: SourceTransport = {
      lookup: async () => ['93.184.216.34'],
      read: async ({ url }) => url.pathname.endsWith('.json')
        ? { status: 200, headers: { 'content-type': 'application/json' }, body: Buffer.from(SUBMISSIONS) }
        : { status: 200, headers: { 'content-type': 'text/xml' }, body: Buffer.from(formD()) },
    };
    const doc = await retrieveOriginalSource(formDDocumentUrl(CIK, '0001587468-26-000002'), io);
    expect(doc).toMatchObject({ status: 'retrieved', truncated: false });
    expect(doc.format).toBeUndefined();
    expect(doc.contentHash).toMatch(/^[a-f0-9]{64}$/);
    expect(doc.text!.length).toBeLessThan(4000);
    expect(parseFormDDocument(doc.text!)?.totalAmountSold).toBe(4999997255);
    const feed = await retrieveOriginalSource(secSubmissionsUrl(CIK), io);
    expect(parseScheduleFilingIndex(feed.text!)?.formDFilings.map((f) => f.accession))
      .toEqual(['0001587468-26-000002', '0001587468-26-000001', '0001587468-23-000003']);
  });
});

describe('findFormDLastRound — the lane over any reader', () => {
  const reader = (lookup: string) => vi.fn(async (url: string): Promise<OriginalSourceReceipt> => {
    const base = { requestedUrl: url, finalUrl: url, status: 'retrieved' as const, httpStatus: 200,
      retrievedAt: '2026-10-13T00:00:00.000Z', contentHash: 'd'.repeat(64), truncated: false };
    if (url === secEntityLookupUrl('Databricks') || url === secEntityLookupUrl('Anysphere')) return { ...base, text: lookup };
    if (url === secSubmissionsUrl(CIK)) return { ...base, text: selectScheduleFilingIndex(SUBMISSIONS) };
    if (url === formDDocumentUrl(CIK, '0001587468-26-000001')) return receipt('0001587468-26-000001', formD({ firstSale: '2026-02-21', offered: '241204249', sold: '241204249' }));
    if (url === formDDocumentUrl(CIK, '0001587468-26-000002')) return receipt('0001587468-26-000002', formD());
    if (url === formDDocumentUrl(CIK, '0001587468-23-000003')) return receipt('0001587468-23-000003', formD({ amendment: '0001587468-23-000002', firstSale: '2023-09-14', offered: '999999987', sold: '684559082' }));
    return { requestedUrl: url, status: 'unavailable', retrievedAt: base.retrievedAt };
  });

  it('resolves, lists and reads the newest notices, then reports the latest offering', async () => {
    const read = reader(DATABRICKS_LOOKUP);
    const observed = await findFormDLastRound({ name: 'Databricks', hqLocation: HQ }, read, NOW);
    expect(observed).toMatchObject({ value: 4999997255, asOf: '2026-08-12', accession: '0001587468-26-000002' });
    expect(read).toHaveBeenCalledTimes(5);
  });

  it('reads the clock after its reads, so receipts stamped during the call count (live-caught)', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    try {
      vi.setSystemTime(NOW);
      const base = reader(DATABRICKS_LOOKUP);
      const read = vi.fn(async (url: string) => {
        vi.setSystemTime(Date.now() + 60_000);
        return { ...(await base(url)), retrievedAt: new Date().toISOString() };
      });
      expect(await findFormDLastRound({ name: 'Databricks', hqLocation: HQ }, read)).toMatchObject({ value: 4999997255 });
    } finally { vi.useRealTimers(); }
  });

  it('spends one read and stops when only SPVs carry the brand (Anysphere)', async () => {
    const read = reader(ANYSPHERE_LOOKUP);
    expect(await findFormDLastRound({ name: 'Anysphere', hqLocation: HQ }, read, NOW)).toBeNull();
    expect(read).toHaveBeenCalledTimes(1);
  });

  it('spends no reads without a known headquarters to confirm identity against', async () => {
    const read = reader(DATABRICKS_LOOKUP);
    expect(await findFormDLastRound({ name: 'Databricks', hqLocation: null }, read, NOW)).toBeNull();
    expect(read).not.toHaveBeenCalled();
  });
});

describe('structured-lane wiring: Latest round from Form D', () => {
  afterEach(() => vi.useRealTimers());

  function snapshot(metrics: unknown[] = []): RepoSnapshot {
    return {
      schemaVersion: 2, markets: [], decks: [],
      companies: [{ id: 'cmp_1', name: 'Databricks', oneLiner: 'Data and AI platform.', websiteUrl: 'https://databricks.com',
        logoUrl: null, hqLocation: 'San Francisco, CA', brandTheme: null }],
      metrics, cards: [], viceClaims: [], dashboards: {}, companyMarket: { cmp_1: 'Data platforms' }, opportunity: {},
      reports: [], savedCards: [], researchJobs: [], threads: [],
    } as unknown as RepoSnapshot;
  }
  const store = (initial: RepoSnapshot): ResearchStore => { let data: RepoSnapshot | null = initial; return { read: () => data, write: (s) => { data = s; } }; };
  const client: LlmClient = { ground: async () => ({ text: '', citations: [], queries: [] }), structure: async (_p, schema) => schema.parse({}) };
  const lanes = (repo: GeminiRepository) => repo as unknown as { fillFromStructuredSources(company: unknown, missing: readonly MetricType[]): Promise<MetricType[]> };
  const read = vi.fn(async (url: string): Promise<OriginalSourceReceipt> => {
    const base = { requestedUrl: url, finalUrl: url, status: 'retrieved' as const, httpStatus: 200,
      retrievedAt: '2026-10-13T00:00:00.000Z', contentHash: 'e'.repeat(64), truncated: false };
    if (url.startsWith(secTickerMapUrl())) return { ...base, text: JSON.stringify({ lookupName: 'Databricks', matches: [] }) };
    if (url === secEntityLookupUrl('Databricks')) return { ...base, text: DATABRICKS_LOOKUP };
    if (url === secSubmissionsUrl(CIK)) return { ...base, text: selectScheduleFilingIndex(SUBMISSIONS) };
    if (url === formDDocumentUrl(CIK, '0001587468-26-000001')) return receipt('0001587468-26-000001', formD({ firstSale: '2026-02-21', offered: '241204249', sold: '241204249' }));
    if (url === formDDocumentUrl(CIK, '0001587468-26-000002')) return receipt('0001587468-26-000002', formD());
    if (url === formDDocumentUrl(CIK, '0001587468-23-000003')) return receipt('0001587468-23-000003', formD({ amendment: '0001587468-23-000002', firstSale: '2023-09-14' }));
    return { requestedUrl: url, status: 'unavailable', retrievedAt: base.retrievedAt };
  });

  it('fills a missing Latest round at estimated tier, citing the retained filing, and the facts projection keeps it', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(NOW);
    const repo = new GeminiRepository({ apiKey: 'k', store: store(snapshot()), client, originalSourceReader: read });
    const company = snapshot().companies[0];
    expect(await lanes(repo).fillFromStructuredSources(company, ['last_round'])).toEqual(['last_round']);
    const fact = (await repo.getCompanyFacts('cmp_1')).find((m) => m.metricType === 'last_round');
    expect(fact).toMatchObject({ value: 4999997255, confidence: 'estimated', passageSupport: null,
      source: 'https://www.sec.gov/Archives/edgar/data/1587468/000158746826000002/primary_doc.xml' });
    expect(fact!.methodNote).toContain('first sale 2026-08-12');
    // Never a valuation or a funding total from Form D.
    const facts = await repo.getCompanyFacts('cmp_1');
    expect(facts.find((m) => m.metricType === 'valuation')).toBeUndefined();
    expect(facts.find((m) => m.metricType === 'funding_total')).toBeUndefined();
  });

  it('never overwrites an existing Latest round figure', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(NOW);
    const existing = { id: 'met_lr', companyId: 'cmp_1', metricType: 'last_round', value: 1_000_000_000, confidence: 'estimated',
      source: 'https://example.com/news', citations: [{ title: 'example.com', url: 'https://example.com/news' }],
      methodNote: 'Series K, reported.', capturedAt: '2026-10-01T00:00:00.000Z' };
    const repo = new GeminiRepository({ apiKey: 'k', store: store(snapshot([existing])), client, originalSourceReader: read });
    read.mockClear();
    expect(await lanes(repo).fillFromStructuredSources(snapshot().companies[0], ['last_round'])).toEqual([]);
    expect(read).not.toHaveBeenCalled();
  });
});
