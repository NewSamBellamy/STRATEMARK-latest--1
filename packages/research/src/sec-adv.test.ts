/**
 * sec-adv — the official Form ADV PDF lane, parsed from REAL filing text
 * (Andreessen Horowitz, CRD 160489, annual amendment filed 3/30/2026).
 * Every fixture below is the actual extracted layout of that filing.
 */
import { describe, expect, it } from 'vitest';
import type { OriginalSourceReceipt } from './original-source';
import {
  MAX_SEC_ADV_TEXT,
  parseSecAdvRecord,
  secAdvAumAsOf,
  secAdvAumObservation,
  secAdvCrd,
  secAdvEmployeesObservation,
  secAdvFirmMatch,
  secAdvObservationFor,
  secAdvReportUrl,
  selectSecAdvRetainedText,
} from './sec-adv';

const A16Z_FULL_TEXT = `                                                         FORM ADV

UNIFORM APPLICATION FOR INVESTMENT ADVISER REGISTRATION AND REPORT BY EXEMPT REPORTING ADVISERS

Primary Business Name: ANDREESSEN HOROWITZ                                                         CRD Number: 160489
Annual Amendment - All Sections                                                                                 Rev. 10/2021
3/30/2026 5:50:59 PM

Item 1 Identifying Information
 A. Your full legal name (if you are a sole proprietor, your last, first, and middle names):

        A16Z CAPITAL MANAGEMENT, L.L.C.

 B. (1) Name under which you primarily conduct your advisory business, if different from Item 1.A.
        ANDREESSEN HOROWITZ

Item 2 Form of Organization
 B. In what month does your fiscal year end each year?
        DECEMBER

Item 5 Information About Your Advisory Business - Employees, Clients, and Compensation
 A. Approximately how many employees do you have? Include full- and part-time employees but do not include any clerical workers.
        738

Item 5 Information About Your Advisory Business - Regulatory Assets Under Management
F. (1) Do you provide continuous and regular supervisory or management services to securities portfolios?
(2) If yes, what is the amount of your regulatory assets under management and total number of accounts?
                    U.S. Dollar Amount                                                   Total Number of Accounts
Discretionary:      (a) $ 106,476,153,956                                                (d) 119
Non-Discretionary:  (b) $ 0                                                              (e) 0
Total:              (c) $ 106,476,153,956                                                (f) 119

Item 6 Private Fund Reporting
6.A Bookkeeping and Computing Net Asset Value per Share
`;

const A16Z_SEARCH_JSON = JSON.stringify({
  hits: { total: 1, hits: [{ _type: '_doc', _source: {
    firm_source_id: '160489', firm_ia_sec_number: '114985', firm_name: 'ANDREESSEN HOROWITZ',
    firm_other_names: ['A16Z CAPITAL MANAGEMENT, L.L.C.', 'HOROWITZ, ANDREESSEN', 'ANDREESSEN HOROWITZ', 'AH CAPITAL MANAGEMENT, L.L.C.'],
  } }] },
});

function advReceipt(text: string, overrides: Partial<OriginalSourceReceipt> = {}): OriginalSourceReceipt {
  return {
    requestedUrl: secAdvReportUrl('160489'), finalUrl: secAdvReportUrl('160489'),
    status: 'retrieved', httpStatus: 200, retrievedAt: '2026-10-09T00:00:00.000Z',
    contentHash: 'a'.repeat(64), text, truncated: false, format: 'sec-adv', ...overrides,
  };
}

const normalized = (text: string) => text.normalize('NFKC').replace(/\s+/g, ' ').trim();

describe('selectSecAdvRetainedText', () => {
  it('keeps the identity, fiscal-year, Item 5.A and Item 5.F blocks and nothing else', () => {
    const retained = selectSecAdvRetainedText(A16Z_FULL_TEXT);
    expect(retained.length).toBeLessThanOrEqual(MAX_SEC_ADV_TEXT);
    expect(retained).toContain('Primary Business Name: ANDREESSEN HOROWITZ');
    expect(retained).toContain('3/30/2026 5:50:59 PM');
    expect(retained).toContain('A16Z CAPITAL MANAGEMENT, L.L.C.');
    expect(retained).toContain('DECEMBER');
    expect(retained).toContain('738');
    expect(retained).toContain('Total:              (c) $ 106,476,153,956');
    // Private-fund schedule content stays out of the vault.
    expect(retained).not.toContain('Bookkeeping');
  });
});

describe('parseSecAdvRecord', () => {
  const record = parseSecAdvRecord(selectSecAdvRetainedText(A16Z_FULL_TEXT))!;

  it('reads the filed identity exactly as the document states it', () => {
    expect(record).toMatchObject({ primaryName: 'ANDREESSEN HOROWITZ', crd: '160489', legalName: 'A16Z CAPITAL MANAGEMENT, L.L.C.', fiscalYearEndMonth: 'DECEMBER' });
  });

  it('reads Item 5.A employees and Item 5.F.(2)(c) totals as exact filed figures', () => {
    expect(record.employees).toBe(738);
    expect(record.aum).toEqual({ discretionary: 106_476_153_956, nonDiscretionary: 0, total: 106_476_153_956, accounts: 119 });
  });

  it('reads the pdf.js layout too, where column gaps collapse to single spaces', () => {
    const collapsed = A16Z_FULL_TEXT
      .replace('Primary Business Name: ANDREESSEN HOROWITZ                                                         CRD Number: 160489',
        'Primary Business Name: ANDREESSEN HOROWITZ CRD Number: 160489')
      .replace('Discretionary:      (a) $ 106,476,153,956                                                (d) 119',
        'Discretionary: (a) $ 106,476,153,956 (d) 119')
      .replace('Non-Discretionary:  (b) $ 0                                                              (e) 0',
        'Non-Discretionary: (b) $ 0 (e) 0')
      .replace('Total:              (c) $ 106,476,153,956                                                (f) 119',
        'Total: (c) $ 106,476,153,956 (f) 119');
    const parsed = parseSecAdvRecord(selectSecAdvRetainedText(collapsed))!;
    expect(parsed).toMatchObject({ primaryName: 'ANDREESSEN HOROWITZ', crd: '160489' });
    expect(parsed.aum).toEqual({ discretionary: 106_476_153_956, nonDiscretionary: 0, total: 106_476_153_956, accounts: 119 });
  });

  it('yields nothing when a section is absent (an honest unknown)', () => {
    const noAum = selectSecAdvRetainedText(A16Z_FULL_TEXT).replace(/Total:[^\n]+\n/, '').replace(/Discretionary:[^\n]+\n/, '');
    expect(parseSecAdvRecord(noAum)?.aum).toBeUndefined();
    expect(parseSecAdvRecord('FORM ADV\nPrimary Business Name: X CRD Number: 1\nnope')).toBeNull();
  });
});

describe('secAdvFirmMatch', () => {
  it('matches the legal name and stated aliases to one CRD', () => {
    expect(secAdvFirmMatch(A16Z_SEARCH_JSON, 'Andreessen Horowitz')).toMatchObject({ crd: '160489', legalName: 'ANDREESSEN HOROWITZ' });
    expect(secAdvFirmMatch(A16Z_SEARCH_JSON, 'A16Z Capital Management, L.L.C.')).toMatchObject({ crd: '160489' });
    expect(secAdvFirmMatch(A16Z_SEARCH_JSON, 'AH Capital Management LLC')).toMatchObject({ crd: '160489' });
  });

  it('refuses short names, malformed JSON, and ambiguous multi-firm ties', () => {
    expect(secAdvFirmMatch(A16Z_SEARCH_JSON, 'a16z')).toBeNull();
    expect(secAdvFirmMatch('not json', 'Andreessen Horowitz')).toBeNull();
    const tie = JSON.stringify({ hits: { hits: [
      { _source: { firm_source_id: '111', firm_name: 'ANDREESSEN HOROWITZ', firm_other_names: [] } },
      { _source: { firm_source_id: '222', firm_name: 'ANDREESSEN HOROWITZ PARTNERS', firm_other_names: ['ANDREESSEN HOROWITZ'] } },
    ] } });
    expect(secAdvFirmMatch(tie, 'Andreessen Horowitz')).toBeNull();
  });
});

describe('secAdvCrd / secAdvReportUrl', () => {
  it('round-trips the report URL', () => {
    expect(secAdvReportUrl('160489')).toBe('https://reports.adviserinfo.sec.gov/reports/ADV/160489/PDF/160489.pdf');
    expect(secAdvCrd(secAdvReportUrl('160489'))).toBe('160489');
    expect(secAdvCrd('https://example.com/x')).toBeNull();
  });
});

describe('secAdvEmployeesObservation', () => {
  it('derives the exact filed count with a verbatim quote from the retained record', () => {
    const retained = selectSecAdvRetainedText(A16Z_FULL_TEXT);
    const observation = secAdvEmployeesObservation('Andreessen Horowitz', [advReceipt(retained)])!;
    expect(observation.value).toBe(738);
    expect(observation.asOf).toBe('2026-03-30');
    expect(observation.passageSupport).toMatchObject({ basis: 'employees', unit: 'count', definition: 'employees', format: 'sec-adv' });
    expect(normalized(retained)).toContain(normalized(observation.quote));
  });

  it('refuses a different firm and invalid receipts', () => {
    const retained = selectSecAdvRetainedText(A16Z_FULL_TEXT);
    expect(secAdvEmployeesObservation('Sequoia Capital', [advReceipt(retained)])).toBeNull();
    expect(secAdvEmployeesObservation('Andreessen Horowitz', [advReceipt(retained, { format: undefined })])).toBeNull();
    expect(secAdvEmployeesObservation('Andreessen Horowitz', [advReceipt(retained, { status: 'blocked' })])).toBeNull();
  });
});

describe('secAdvAumObservation', () => {
  it('derives the exact filed total with the fiscal year-end the form binds it to', () => {
    const retained = selectSecAdvRetainedText(A16Z_FULL_TEXT);
    const observation = secAdvAumObservation('Andreessen Horowitz', [advReceipt(retained)])!;
    expect(observation.value).toBe(106_476_153_956);
    expect(observation.asOf).toBe('2025-12-31');
    expect(observation.passageSupport).toMatchObject({ basis: 'aum', unit: 'USD', definition: 'aum', format: 'sec-adv' });
    expect(observation.quote).toBe('Total: (c) $ 106,476,153,956');
    expect(normalized(retained)).toContain(normalized(observation.quote));
  });

  it('keeps the latest filing when two are retained and refuses conflicting totals', () => {
    const retained2026 = selectSecAdvRetainedText(A16Z_FULL_TEXT);
    const older = retained2026.replace('3/30/2026 5:50:59 PM', '3/28/2025 5:50:59 PM')
      .replace(/\$ 106,476,153,956/g, '$ 66,000,000,000');
    const both = [advReceipt(older, { finalUrl: secAdvReportUrl('160489'), requestedUrl: secAdvReportUrl('160489') }), advReceipt(retained2026)];
    const observation = secAdvAumObservation('Andreessen Horowitz', both)!;
    expect(observation.value).toBe(106_476_153_956);
    expect(observation.asOf).toBe('2025-12-31');
  });

  it('reports zero AUM as nothing rather than a zero figure', () => {
    const zeroed = selectSecAdvRetainedText(A16Z_FULL_TEXT).replace(/\$ 106,476,153,956/g, '$ 0');
    expect(secAdvAumObservation('Andreessen Horowitz', [advReceipt(zeroed)])).toBeNull();
  });
});

describe('secAdvAumAsOf', () => {
  it('binds the figure to the fiscal year-end before the filing date', () => {
    const record = parseSecAdvRecord(selectSecAdvRetainedText(A16Z_FULL_TEXT))!;
    expect(secAdvAumAsOf(record)).toBe('2025-12-31');
    const june = parseSecAdvRecord(selectSecAdvRetainedText(A16Z_FULL_TEXT).replace('3/30/2026 5:50:59 PM', '6/15/2026 1:00:00 PM'))!;
    expect(secAdvAumAsOf(june)).toBe('2025-12-31');
    const january = parseSecAdvRecord(selectSecAdvRetainedText(A16Z_FULL_TEXT).replace('3/30/2026 5:50:59 PM', '1/20/2025 9:00:00 AM'))!;
    expect(secAdvAumAsOf(january)).toBe('2024-12-31');
  });
});

describe('secAdvObservationFor', () => {
  it('routes employees and aum and declines other metric types', () => {
    const retained = selectSecAdvRetainedText(A16Z_FULL_TEXT);
    const receipts = [advReceipt(retained)];
    expect(secAdvObservationFor('employees', 'Andreessen Horowitz', receipts)?.value).toBe(738);
    expect(secAdvObservationFor('aum', 'Andreessen Horowitz', receipts)?.value).toBe(106_476_153_956);
    expect(secAdvObservationFor('market_cap', 'Andreessen Horowitz', receipts)).toBeNull();
  });
});
