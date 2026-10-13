/**
 * A listed company's own recent SEC filings — the free, official equivalent of
 * a terminal's company-filings screen. Read from the same submissions feed the
 * ownership lane reads (one SEC request serves both).
 *
 * Only the company's own disclosure forms are kept (annual, quarterly, current
 * reports, proxies, registrations); insider and holder forms are other lanes.
 * An 8-K's event is labelled only from the item numbers EDGAR files with it,
 * never from reading or summarizing the document.
 */
import { z } from 'zod';

/** The company's own disclosure forms, in the order a reader cares about them. */
export const COMPANY_FILING_FORMS = ['10-K', '10-K/A', '10-Q', '10-Q/A', '8-K', '8-K/A', '20-F', '20-F/A', '40-F', '6-K',
  'DEF 14A', 'S-1', 'S-1/A', 'F-1', 'F-1/A', 'S-4', '424B4'] as const;
export type CompanyFilingForm = typeof COMPANY_FILING_FORMS[number];
/** Newest company filings kept from the submissions feed. */
export const MAX_COMPANY_FILINGS = 20;

const FORM_LABEL: Partial<Record<CompanyFilingForm, string>> = {
  '10-K': 'Annual report', '10-K/A': 'Annual report (amended)', '10-Q': 'Quarterly report', '10-Q/A': 'Quarterly report (amended)',
  '20-F': 'Annual report (foreign issuer)', '20-F/A': 'Annual report (foreign issuer, amended)', '40-F': 'Annual report (Canadian issuer)',
  '6-K': 'Current report (foreign issuer)', 'DEF 14A': 'Proxy statement', 'S-1': 'IPO registration', 'S-1/A': 'IPO registration (amended)',
  'F-1': 'IPO registration (foreign issuer)', 'F-1/A': 'IPO registration (foreign issuer, amended)', 'S-4': 'Merger registration',
  '424B4': 'Final prospectus',
};

/** Form 8-K item numbers as the SEC defines them; 9.01 (exhibits) describes no event. */
const EIGHT_K_ITEMS: Record<string, string> = {
  '1.01': 'Material agreement', '1.02': 'Material agreement ended', '1.03': 'Bankruptcy', '1.05': 'Cybersecurity incident',
  '2.01': 'Acquisition or sale completed', '2.02': 'Financial results', '2.03': 'New debt or obligation', '2.04': 'Debt acceleration',
  '2.05': 'Restructuring costs', '2.06': 'Impairment', '3.01': 'Listing standards notice', '3.02': 'Unregistered share sale',
  '3.03': 'Shareholder rights changed', '4.01': 'Auditor change', '4.02': 'Prior financials no longer reliable',
  '5.01': 'Change in control', '5.02': 'Executive or director change', '5.03': 'Charter or bylaws amended',
  '5.07': 'Shareholder vote results', '7.01': 'Regulation FD disclosure', '8.01': 'Other events',
};

export interface CompanyFilingRow {
  form: CompanyFilingForm;
  filingDate: string;
  /** The period or event date the filing reports, when EDGAR gives one. */
  reportDate: string | null;
  accession: string;
  primaryDocument: string;
  /** 8-K item numbers exactly as filed. */
  items: string[];
}

const accessionPattern = /^\d{10}-\d{2}-\d{6}$/;
const documentPattern = /^[\w.-]{1,120}\.(?:htm|html|txt|xml)$/;
const datePattern = /^\d{4}-\d{2}-\d{2}$/;

export const companyFilingRowSchema = z.object({
  form: z.enum(COMPANY_FILING_FORMS),
  filingDate: z.string().regex(datePattern),
  reportDate: z.string().regex(datePattern).nullable(),
  accession: z.string().regex(accessionPattern),
  primaryDocument: z.string().regex(documentPattern),
  items: z.array(z.string().regex(/^\d\.\d{2}$/)).max(12),
});

const recentSchema = z.object({
  accessionNumber: z.array(z.string()), filingDate: z.array(z.string()), form: z.array(z.string()),
  primaryDocument: z.array(z.string()), reportDate: z.array(z.string()).optional(), items: z.array(z.string()).optional(),
}).passthrough();

/** Reader-side: the company's own newest disclosure filings from `filings.recent`, bounded. */
export function selectCompanyFilings(recent: unknown): CompanyFilingRow[] {
  const parsed = recentSchema.safeParse(recent);
  if (!parsed.success) return [];
  const r = parsed.data;
  const rows: CompanyFilingRow[] = [];
  for (let i = 0; i < r.form.length; i++) {
    const row = companyFilingRowSchema.safeParse({
      form: r.form[i], filingDate: r.filingDate[i], accession: r.accessionNumber[i], primaryDocument: r.primaryDocument[i],
      reportDate: datePattern.test(r.reportDate?.[i] ?? '') ? r.reportDate![i] : null,
      items: (r.items?.[i] ?? '').split(',').map((item) => item.trim()).filter(Boolean),
    });
    if (row.success) rows.push(row.data);
  }
  return rows.sort((a, b) => b.filingDate.localeCompare(a.filingDate) || b.accession.localeCompare(a.accession))
    .slice(0, MAX_COMPANY_FILINGS);
}

export interface CompanyFiling {
  form: CompanyFilingForm;
  filingDate: string;
  reportDate: string | null;
  /** Plain-language form name, e.g. "Quarterly report". */
  title: string;
  /** For an 8-K: what happened, from its filed item numbers only. */
  events: string[];
  /** The filed document itself. */
  url: string;
}

export function describeCompanyFiling(cik: string, row: CompanyFilingRow): CompanyFiling {
  const events = row.items.flatMap((item) => EIGHT_K_ITEMS[item] ? [EIGHT_K_ITEMS[item]!] : []);
  const current = row.form === '8-K' || row.form === '8-K/A';
  return {
    form: row.form, filingDate: row.filingDate, reportDate: row.reportDate, events,
    title: current ? (row.form === '8-K/A' ? 'Current report (amended)' : 'Current report') : FORM_LABEL[row.form] ?? row.form,
    url: `https://www.sec.gov/Archives/edgar/data/${Number(cik.replace(/\D/g, ''))}/${row.accession.replace(/-/g, '')}/${row.primaryDocument}`,
  };
}
