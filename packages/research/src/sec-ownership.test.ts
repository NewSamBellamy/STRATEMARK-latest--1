/**
 * Fixtures are trimmed from real EDGAR documents retrieved 2026-10-13:
 * NVIDIA's submissions feed, Vanguard's 13G filings about NVIDIA (one at
 * 9.32%, then the 0% exit after its January 2026 realignment, and Vanguard
 * Capital Management's new 7.31%), NVIDIA's own 13G about Nebius (a filing in
 * NVIDIA's feed whose subject is ANOTHER issuer, with Workiva's `sch:`
 * prefixes), and the Medpace 13D/A joint filing (Troendle + his LLC).
 */
import { describe, expect, it } from 'vitest';
import type { OriginalSourceReceipt } from './original-source';
import { retrieveOriginalSource, type SourceTransport } from './original-source.node';
import {
  findMajorShareholders,
  isScheduleDocumentUrl,
  parsePercentOfClass,
  parseScheduleFilingIndex,
  parseScheduleOwnershipDocument,
  parseScheduleOwnershipXml,
  scheduleDocumentUrl,
  secSubmissionsCik,
  secSubmissionsUrl,
  selectMajorShareholders,
  selectScheduleFilingIndex,
  type ScheduleFilingRow,
} from './sec-ownership';

const g13 = (body: string, opts: { form?: string; filer?: string; issuer?: string; item5?: string; prefix?: string } = {}) => {
  const p = opts.prefix ?? '';
  const xmlns = p ? `xmlns:${p.slice(0, -1)}="http://www.sec.gov/edgar/schedule13g"` : 'xmlns="http://www.sec.gov/edgar/schedule13g"';
  return `<?xml version="1.0" encoding="UTF-8"?><${p}edgarSubmission ${xmlns} xmlns:com="http://www.sec.gov/edgar/common">
<${p}headerData><${p}submissionType>${opts.form ?? 'SCHEDULE 13G/A'}</${p}submissionType>
<${p}filerInfo><${p}filer><${p}filerCredentials><${p}cik>${opts.filer ?? '0000102909'}</${p}cik><${p}ccc>XXXXXXXX</${p}ccc></${p}filerCredentials></${p}filer></${p}filerInfo></${p}headerData>
<${p}formData><${p}coverPageHeader><${p}securitiesClassTitle>Common Stock</${p}securitiesClassTitle>
<${p}eventDateRequiresFilingThisStatement>12/31/2025</${p}eventDateRequiresFilingThisStatement>
<${p}issuerInfo><${p}issuerCik>${opts.issuer ?? '0001045810'}</${p}issuerCik><${p}issuerName>NVIDIA Corp</${p}issuerName>
<${p}issuerPrincipalExecutiveOfficeAddress><com:street1>2788 San Tomas Expressway</com:street1></${p}issuerPrincipalExecutiveOfficeAddress></${p}issuerInfo></${p}coverPageHeader>
${body}
<${p}items><${p}item5><${p}notApplicableFlag>N</${p}notApplicableFlag>${opts.item5 ?? ''}</${p}item5></${p}items>
<${p}signatureInformation><${p}reportingPersonName>Signer Name</${p}reportingPersonName></${p}signatureInformation>
</${p}formData></${p}edgarSubmission>`;
};
const person13g = (name: string, percent: string, shares: string, p = '') =>
  `<${p}coverPageHeaderReportingPersonDetails><${p}reportingPersonName>${name}</${p}reportingPersonName>
<${p}reportingPersonBeneficiallyOwnedAggregateNumberOfShares>${shares}</${p}reportingPersonBeneficiallyOwnedAggregateNumberOfShares>
<${p}classPercent>${percent}</${p}classPercent><${p}typeOfReportingPerson>IA</${p}typeOfReportingPerson>
<${p}comments>On January 12, 2026, The Vanguard Group, Inc. went through an internal realignment.</${p}comments></${p}coverPageHeaderReportingPersonDetails>`;

const VANGUARD_9 = g13(person13g('The Vanguard Group', '9.32', '2266625855'));
const VANGUARD_EXIT = g13(person13g('The Vanguard Group', '0', '0'), { item5: '<classOwnership5PercentOrLess>Y</classOwnership5PercentOrLess>' });
const VCM_7 = g13(person13g('Vanguard Capital Management', '7.31', '1777408252'), { form: 'SCHEDULE 13G', filer: '0002100119' });
const NEBIUS_BY_NVIDIA = g13(person13g('NVIDIA Corporation', '9.3', '22256412.00', 'sch:'), { form: 'SCHEDULE 13G', filer: '0001045810', issuer: '0001513845', prefix: 'sch:' });

const MEDPACE_13DA = `<?xml version="1.0" encoding="UTF-8"?><edgarSubmission xmlns="http://www.sec.gov/edgar/schedule13D">
<headerData><submissionType>SCHEDULE 13D/A</submissionType><filerInfo><filer><filerCredentials><cik>0001622058</cik></filerCredentials></filer></filerInfo></headerData>
<formData><coverPageHeader><amendmentNo>24</amendmentNo><dateOfEvent>09/24/2026</dateOfEvent>
<issuerInfo><issuerCIK>0001668397</issuerCIK><issuerName>Medpace Holdings, Inc.</issuerName></issuerInfo></coverPageHeader>
<reportingPersons>
<reportingPersonInfo><reportingPersonCIK>0001622058</reportingPersonCIK><reportingPersonName>August J. Troendle</reportingPersonName>
<aggregateAmountOwned>5396508</aggregateAmountOwned><percentOfClass>19.1</percentOfClass><typeOfReportingPerson>IN</typeOfReportingPerson></reportingPersonInfo>
<reportingPersonInfo><reportingPersonCIK>0001524599</reportingPersonCIK><reportingPersonName>Medpace Investors, LLC</reportingPersonName>
<aggregateAmountOwned>4733019.00</aggregateAmountOwned><percentOfClass>16.8</percentOfClass><typeOfReportingPerson>OO</typeOfReportingPerson></reportingPersonInfo>
</reportingPersons>
<items1To7><item5><percentageOfClassSecurities>See Items 7 - 13 of the cover pages above.</percentageOfClassSecurities></item5></items1To7>
</formData></edgarSubmission>`;

const SUBMISSIONS = JSON.stringify({
  cik: '0001045810', name: 'NVIDIA CORP', tickers: ['NVDA'],
  filings: {
    recent: {
      accessionNumber: ['0001045810-26-000062', '0002100119-26-000017', '0000102909-26-000426', '0001045810-26-000099', '0000102909-26-000226', '0000315066-24-002826', '0001045810-26-000100'],
      filingDate: ['2026-07-20', '2026-04-28', '2026-03-26', '2026-03-01', '2026-01-30', '2024-11-12', '2026-02-01'],
      form: ['SCHEDULE 13G', 'SCHEDULE 13G', 'SCHEDULE 13G/A', '4', 'SCHEDULE 13G/A', 'SC 13G/A', '10-Q'],
      primaryDocument: ['xslSCHEDULE_13G_X01/primary_doc.xml', 'xslSCHEDULE_13G_X02/primary_doc.xml', 'xslSCHEDULE_13G_X02/primary_doc.xml', 'xslF345X05/wk-form4.xml', 'xslSCHEDULE_13G_X01/primary_doc.xml', 'filing.txt', 'nvda-20260426.htm'],
    },
    files: [],
  },
});

const row = (accession: string, filingDate: string, form: ScheduleFilingRow['form'] = 'SCHEDULE 13G/A'): ScheduleFilingRow =>
  ({ accession, filingDate, form, primaryDocument: 'xslSCHEDULE_13G_X02/primary_doc.xml' });

describe('SEC ownership URLs', () => {
  it('builds and recognises exactly the submissions feed and the schedule document', () => {
    expect(secSubmissionsUrl('1045810')).toBe('https://data.sec.gov/submissions/CIK0001045810.json');
    expect(secSubmissionsCik('https://data.sec.gov/submissions/CIK0001045810.json')).toBe('0001045810');
    expect(secSubmissionsCik('https://data.sec.gov/submissions/CIK0001045810-submissions-001.json')).toBeNull();
    expect(secSubmissionsCik('https://data.sec.gov/submissions/CIK0001045810.json?x=1')).toBeNull();
    const doc = scheduleDocumentUrl('0001045810', '0002100119-26-000017');
    expect(doc).toBe('https://www.sec.gov/Archives/edgar/data/1045810/000210011926000017/primary_doc.xml');
    expect(isScheduleDocumentUrl(doc)).toBe(true);
    expect(isScheduleDocumentUrl('https://www.sec.gov/Archives/edgar/data/1045810/000210011926000017/xslSCHEDULE_13G_X02/primary_doc.xml')).toBe(false);
    expect(isScheduleDocumentUrl('https://evil.example/Archives/edgar/data/1/000210011926000017/primary_doc.xml')).toBe(false);
  });
});

describe('selectScheduleFilingIndex', () => {
  it('keeps only structured 13D/G rows, newest first, and drops legacy free-text schedules', () => {
    const index = parseScheduleFilingIndex(selectScheduleFilingIndex(SUBMISSIONS));
    expect(index?.cik).toBe('0001045810');
    expect(index?.filings.map((f) => f.accession)).toEqual([
      '0001045810-26-000062', '0002100119-26-000017', '0000102909-26-000426', '0000102909-26-000226',
    ]);
  });

  it('is empty for anything that is not a submissions feed', () => {
    expect(selectScheduleFilingIndex('<html>')).toBe('');
    expect(selectScheduleFilingIndex('{"cik":"1"}')).toBe('');
  });
});

describe('parseScheduleOwnershipXml', () => {
  it('reads the 13G cover page: issuer, filer, event date, person, percent, shares', () => {
    expect(parseScheduleOwnershipXml(VANGUARD_9)).toEqual({
      form: 'SCHEDULE 13G/A', issuerCik: '0001045810', issuerName: 'NVIDIA Corp', filerCik: '0000102909',
      eventDate: '2025-12-31', exitedFivePercent: false,
      reportingPersons: [{ name: 'The Vanguard Group', percentOfClass: 9.32, shares: 2266625855 }],
    });
  });

  it('strips vendor namespace prefixes (Workiva sch:)', () => {
    const doc = parseScheduleOwnershipXml(NEBIUS_BY_NVIDIA);
    expect(doc?.issuerCik).toBe('0001513845');
    expect(doc?.reportingPersons[0]).toEqual({ name: 'NVIDIA Corporation', percentOfClass: 9.3, shares: 22256412 });
  });

  it('reads every reporting person of a 13D joint filing', () => {
    const doc = parseScheduleOwnershipXml(MEDPACE_13DA);
    expect(doc?.form).toBe('SCHEDULE 13D/A');
    expect(doc?.issuerCik).toBe('0001668397');
    expect(doc?.eventDate).toBe('2026-09-24');
    expect(doc?.reportingPersons.map((p) => [p.name, p.percentOfClass])).toEqual([
      ['August J. Troendle', 19.1], ['Medpace Investors, LLC', 16.8],
    ]);
  });

  it('flags the 13G Item 5 exit', () => {
    expect(parseScheduleOwnershipXml(VANGUARD_EXIT)?.exitedFivePercent).toBe(true);
  });

  it('a prose percent is null, never a guess; a non-schedule is null', () => {
    const prose = parseScheduleOwnershipXml(g13(person13g('Holder LLC', 'See Row 11 of cover page for the Reporting Person.', '100')));
    expect(prose?.reportingPersons[0]?.percentOfClass).toBeNull();
    expect(parsePercentOfClass('7.31%')).toBe(7.31);
    expect(parsePercentOfClass('140')).toBeNull();
    expect(parseScheduleOwnershipXml('<edgarSubmission xmlns="http://www.sec.gov/edgar/thirteenffiler"></edgarSubmission>')).toBeNull();
    expect(parseScheduleOwnershipXml('<html>not xml</html>')).toBeNull();
  });

  it('round-trips through the retained JSON validator', () => {
    const doc = parseScheduleOwnershipXml(VCM_7)!;
    expect(parseScheduleOwnershipDocument(JSON.stringify(doc))).toEqual(doc);
    expect(parseScheduleOwnershipDocument(JSON.stringify({ ...doc, issuerCik: 'x' }))).toBeNull();
  });
});

describe('selectMajorShareholders', () => {
  const nvidia = [
    { filing: row('0001045810-26-000062', '2026-07-20', 'SCHEDULE 13G'), document: parseScheduleOwnershipXml(NEBIUS_BY_NVIDIA) },
    { filing: row('0002100119-26-000017', '2026-04-28', 'SCHEDULE 13G'), document: parseScheduleOwnershipXml(VCM_7) },
    { filing: row('0000102909-26-000426', '2026-03-26'), document: parseScheduleOwnershipXml(VANGUARD_EXIT) },
    { filing: row('0000102909-26-000226', '2026-01-30'), document: parseScheduleOwnershipXml(VANGUARD_9) },
  ];

  it('latest filing per holder; an exit drops the holder; filings about other issuers are ignored', () => {
    expect(selectMajorShareholders('1045810', nvidia)).toEqual([{
      holder: 'Vanguard Capital Management', percentOfClass: 7.31, shares: 1777408252,
      form: 'SCHEDULE 13G', filingDate: '2026-04-28', eventDate: '2025-12-31',
      filingUrl: 'https://www.sec.gov/Archives/edgar/data/1045810/000210011926000017/xslSCHEDULE_13G_X02/primary_doc.xml',
      jointFilers: [],
    }]);
  });

  it('an amendment below 5% drops the holder even when an older filing was higher', () => {
    const below = g13(person13g('The Vanguard Group', '4.9', '10'));
    const rows = selectMajorShareholders('1045810', [
      { filing: row('0000102909-26-000500', '2026-05-01'), document: parseScheduleOwnershipXml(below) },
      { filing: row('0000102909-26-000226', '2026-01-30'), document: parseScheduleOwnershipXml(VANGUARD_9) },
    ]);
    expect(rows).toEqual([]);
  });

  it('a joint filing is one row led by the largest stated stake, affiliates named', () => {
    const rows = selectMajorShareholders('0001668397', [
      { filing: row('0001193125-26-405684', '2026-09-28', 'SCHEDULE 13D/A'), document: parseScheduleOwnershipXml(MEDPACE_13DA) },
    ]);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ holder: 'August J. Troendle', percentOfClass: 19.1, jointFilers: ['Medpace Investors, LLC'] });
  });

  it('keeps a holder whose percent is not stated numerically, with a null percent, ordered last', () => {
    const prose = g13(person13g('Holder LLC', 'See Row 11', '100'), { form: 'SCHEDULE 13G', filer: '0000000001' });
    const rows = selectMajorShareholders('1045810', [
      { filing: row('0000000001-26-000001', '2026-06-01', 'SCHEDULE 13G'), document: parseScheduleOwnershipXml(prose) },
      { filing: row('0002100119-26-000017', '2026-04-28', 'SCHEDULE 13G'), document: parseScheduleOwnershipXml(VCM_7) },
    ]);
    expect(rows.map((r) => [r.holder, r.percentOfClass])).toEqual([['Vanguard Capital Management', 7.31], ['Holder LLC', null]]);
  });
});

function transportFor(respond: (url: URL) => { status: number; headers: Record<string, string | undefined>; body: Buffer } | null): SourceTransport {
  return {
    lookup: async () => ['93.184.216.34'],
    read: async ({ url }) => respond(url) ?? { status: 404, headers: {}, body: Buffer.from('') },
  };
}

const NVIDIA_SEC = transportFor((url) => {
  if (url.pathname === '/files/company_tickers.json') {
    return { status: 200, headers: { 'content-type': 'application/json' }, body: Buffer.from(JSON.stringify({ 0: { cik_str: 1045810, ticker: 'NVDA', title: 'NVIDIA CORP' } })) };
  }
  if (url.pathname === '/submissions/CIK0001045810.json') {
    return { status: 200, headers: { 'content-type': 'application/json' }, body: Buffer.from(SUBMISSIONS) };
  }
  const docs: Record<string, string> = {
    '000104581026000062': NEBIUS_BY_NVIDIA, '000210011926000017': VCM_7, '000010290926000426': VANGUARD_EXIT, '000010290926000226': VANGUARD_9,
  };
  const acc = /\/(\d{18})\/primary_doc\.xml$/.exec(url.pathname)?.[1];
  return acc && docs[acc] ? { status: 200, headers: { 'content-type': 'text/xml' }, body: Buffer.from(docs[acc]!) } : null;
});

describe('reader + lane end to end (recorded EDGAR responses)', () => {
  it('the reader keeps bounded slices: schedule rows of the feed, cover facts of a schedule', async () => {
    const feed = await retrieveOriginalSource('https://data.sec.gov/submissions/CIK0001045810.json', NVIDIA_SEC);
    expect(feed.status).toBe('retrieved');
    expect(parseScheduleFilingIndex(feed.text!)?.filings).toHaveLength(4);
    const doc = await retrieveOriginalSource(scheduleDocumentUrl('1045810', '0002100119-26-000017'), NVIDIA_SEC);
    expect(doc.status).toBe('retrieved');
    expect(parseScheduleOwnershipDocument(doc.text!)?.reportingPersons[0]?.percentOfClass).toBe(7.31);
    expect(doc.text!.length).toBeLessThan(4000);
    const html = await retrieveOriginalSource(scheduleDocumentUrl('1045810', '0002100119-26-000017'),
      transportFor(() => ({ status: 200, headers: { 'content-type': 'text/html' }, body: Buffer.from('<html>x</html>') })));
    expect(html.status).toBe('unavailable');
  });

  it('finds the 5%+ holders by company name', async () => {
    const read = (url: string) => retrieveOriginalSource(url, NVIDIA_SEC);
    const result = await findMajorShareholders('NVIDIA Corp', read);
    expect(result?.cik).toBe('0001045810');
    expect(result?.holders.map((h) => [h.holder, h.percentOfClass])).toEqual([['Vanguard Capital Management', 7.31]]);
  });

  it('no answer for an unknown company or when any schedule read fails (no partial lists)', async () => {
    const read = (url: string) => retrieveOriginalSource(url, NVIDIA_SEC);
    expect(await findMajorShareholders('Andreessen Horowitz', read)).toBeNull();
    const flaky = async (url: string): Promise<OriginalSourceReceipt> => url.includes('000010290926000426')
      ? { requestedUrl: url, status: 'unavailable', retrievedAt: new Date().toISOString() }
      : read(url);
    expect(await findMajorShareholders('NVIDIA Corp', flaky)).toBeNull();
  });
});
