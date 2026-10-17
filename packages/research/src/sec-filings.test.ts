// Rows trimmed from NVIDIA's real submissions feed, retrieved 2026-10-13.
import { describe, expect, it } from 'vitest';
import { describeCompanyFiling, MAX_COMPANY_FILINGS, selectCompanyFilings } from './sec-filings';

const recent = {
  accessionNumber: ['0001045810-26-000201', '0001045810-26-000190', '0001045810-26-000188', '0001045810-26-000180', '0001127602-26-000301', '0001045810-26-000150', 'bad'],
  filingDate: ['2026-09-03', '2026-08-26', '2026-08-26', '2026-08-17', '2026-08-15', '2026-07-02', '2026-07-01'],
  reportDate: ['2026-09-02', '2026-07-26', '2026-08-26', '2026-08-17', '', '2026-06-28', ''],
  form: ['8-K', '10-Q', '8-K', '8-K', '4', '8-K', '8-K'],
  items: ['8.01', '', '2.02,9.01', '1.01,2.03,7.01', '', '5.02', '8.01'],
  primaryDocument: ['nvda-20260902.htm', 'nvda-20260726.htm', 'nvda-20260826.htm', 'nvda-20260817.htm', 'xslF345X05/wk-form4.xml', 'nvda-20260628.htm', 'x.htm'],
};

describe('company filings from the submissions feed', () => {
  it('keeps only the company\'s own disclosure forms, newest first, with items as filed', () => {
    const rows = selectCompanyFilings(recent);
    expect(rows.map((row) => [row.form, row.filingDate, row.items.join()])).toEqual([
      ['8-K', '2026-09-03', '8.01'], ['10-Q', '2026-08-26', ''], ['8-K', '2026-08-26', '2.02,9.01'],
      ['8-K', '2026-08-17', '1.01,2.03,7.01'], ['8-K', '2026-07-02', '5.02'],
    ]);
    expect(rows.find((row) => row.form === '10-Q')?.reportDate).toBe('2026-07-26');
  });

  it('labels an 8-K only from its item numbers, and links the filed document', () => {
    const [deal] = selectCompanyFilings(recent).filter((row) => row.items.includes('1.01'));
    expect(describeCompanyFiling('0001045810', deal!)).toEqual({
      form: '8-K', filingDate: '2026-08-17', reportDate: '2026-08-17', title: 'Current report',
      events: ['Material agreement', 'New debt or obligation', 'Regulation FD disclosure'],
      url: 'https://www.sec.gov/Archives/edgar/data/1045810/000104581026000180/nvda-20260817.htm',
    });
    const results = selectCompanyFilings(recent).find((row) => row.items.includes('2.02'))!;
    expect(describeCompanyFiling('0001045810', results).events).toEqual(['Financial results']);
    const quarterly = selectCompanyFilings(recent).find((row) => row.form === '10-Q')!;
    expect(describeCompanyFiling('0001045810', quarterly)).toMatchObject({ title: 'Quarterly report', events: [] });
  });

  it('is bounded, and empty for anything that is not a recent-filings table', () => {
    const many = { ...recent, accessionNumber: Array.from({ length: 40 }, (_, i) => `0001045810-26-${String(i).padStart(6, '0')}`),
      filingDate: Array(40).fill('2026-01-01'), reportDate: Array(40).fill(''), form: Array(40).fill('8-K'),
      items: Array(40).fill('8.01'), primaryDocument: Array(40).fill('a.htm') };
    expect(selectCompanyFilings(many)).toHaveLength(MAX_COMPANY_FILINGS);
    expect(selectCompanyFilings(null)).toEqual([]);
    expect(selectCompanyFilings({ form: ['8-K'] })).toEqual([]);
  });
});
