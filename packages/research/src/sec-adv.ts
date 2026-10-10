/**
 * SEC Form ADV structured lane — the official IAPD PDF report IS the original.
 *
 * For financial-profile firms (venture capital, private equity, fund
 * managers…), two HTTP calls fill what a grounded hunt ladder burns provider
 * calls on: the public IAPD search JSON resolves the firm's CRD number from
 * its legal name or aliases, and the official Form ADV PDF report at
 * reports.adviserinfo.sec.gov then reports Item 5.A (employee count) and
 * Item 5.F.(2)(c) (total regulatory assets under management) as exact
 * figures the firm filed with the SEC — never invented, never a midpoint.
 *
 * The node reader (original-source.node.ts) fetches the PDF and retains a
 * bounded, deterministic slice via selectSecAdvRetainedText; every consumer
 * here works only on that retained receipt. Retention, hashing and the
 * passage gate stay exactly as for any other original source.
 */
import { z } from 'zod';
import type { CompanyMetric, MetricType } from '@mi/contracts';
import type { OriginalSourceReceipt } from './original-source';

export const MAX_SEC_ADV_TEXT = 16000;

/** Public IAPD search (unofficial JSON backing adviserinfo.sec.gov; UA required). */
export function secAdvSearchUrl(companyName: string): string {
  return `https://api.adviserinfo.sec.gov/search/firm?query=${encodeURIComponent(companyName)}&hl=1`;
}

/** The official Form ADV PDF report — the document the SEC holds the firm to. */
export function secAdvReportUrl(crd: string): string {
  return `https://reports.adviserinfo.sec.gov/reports/ADV/${crd}/PDF/${crd}.pdf`;
}

/** CRD number embedded in an IAPD report URL. */
export function secAdvCrd(raw: string): string | null {
  const match = /reports\.adviserinfo\.sec\.gov\/reports\/ADV\/(\d{1,10})\/PDF\//.exec(raw);
  return match ? match[1]! : null;
}

/** Legal-suffix-insensitive firm-name key. Never invents aliases: it only
 * compares what the searcher and the filing both state. */
function firmNameKey(raw: string): string {
  return raw
    .toUpperCase()
    .normalize('NFKC')
    .replace(/[^A-Z0-9]+/g, ' ')
    // Punctuation collapse turns "L.L.C." into "L L C" — strip both the
    // spaced-letter and the solid forms of the legal suffixes.
    .replace(/\b(?:L L C|L L P|L P)\b/g, ' ')
    .replace(/\b(?:LLC|LLP|LP|INC|CORP(?:O?RATION)?|LTD|PLC|COMPANY|LIMITED)\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

const searchHitSchema = z.object({
  hits: z.object({
    hits: z.array(z.object({
      _source: z.object({
        firm_source_id: z.string().regex(/^\d{1,10}$/),
        firm_name: z.string().min(1),
        firm_other_names: z.array(z.string()).nullish().default([]),
      }).passthrough(),
    })).max(25),
  }).passthrough(),
}).passthrough();

export interface SecAdvFirmMatch {
  crd: string;
  legalName: string;
  otherNames: string[];
}

/** Resolve a CRD from the retained search JSON by legal name or stated alias.
 * Ambiguity (two distinct firms tie) refuses to pick — the hunt ladder still
 * runs, and no wrong firm's figures can land. */
export function secAdvFirmMatch(searchJson: string, companyName: string): SecAdvFirmMatch | null {
  const wanted = firmNameKey(companyName);
  if (wanted.length < 4) return null;
  let doc: z.infer<typeof searchHitSchema>;
  try {
    doc = searchHitSchema.parse(JSON.parse(searchJson));
  } catch {
    return null;
  }
  const matches: SecAdvFirmMatch[] = [];
  for (const hit of doc.hits.hits) {
    const otherNames = (hit._source.firm_other_names ?? []).filter((n): n is string => Boolean(n));
    const names = [hit._source.firm_name, ...otherNames];
    if (names.some((n) => firmNameKey(n) === wanted)) {
      matches.push({ crd: hit._source.firm_source_id, legalName: hit._source.firm_name, otherNames });
    }
  }
  const byCrd = new Map(matches.map((m) => [m.crd, m]));
  return byCrd.size === 1 ? (byCrd.values().next().value ?? null) : null;
}

/** Reader-side: deterministic bounded slice of the PDF's full text holding
 * exactly the fields the lane derives from (identity, fiscal year, Item 5.A,
 * Item 5.F). Anything outside stays out of the vault. */
export function selectSecAdvRetainedText(fullText: string): string {
  const lines = fullText.split(/\r?\n/);
  const take = (predicate: (line: string) => boolean, count: number): string[] => {
    const index = lines.findIndex(predicate);
    if (index < 0) return [];
    return lines.slice(index, index + count);
  };
  const headerEnd = lines.findIndex((l) => /\d{1,2}\/\d{1,2}\/\d{4} \d{1,2}:\d{2}:\d{2} [AP]M/.test(l));
  const header = headerEnd >= 0 ? lines.slice(0, headerEnd + 1) : lines.slice(0, 5);
  // The 5.F block ends at the Total line — a fixed line count leaks the next
  // Item's heading into the vault.
  const aumStart = lines.findIndex((l) => l.includes('(2) If yes, what is the amount of your regulatory assets'));
  const aumEnd = aumStart >= 0 ? lines.findIndex((l, i) => i > aumStart && /Total:\s+\(c\)\s*\$/.test(l)) : -1;
  const aum = aumStart >= 0 && aumEnd > aumStart ? lines.slice(aumStart, aumEnd + 1).join('\n') : '';
  const parts = [
    header.join('\n'),
    take((l) => l.includes('Your full legal name'), 3).join('\n'),
    take((l) => l.includes('what month does your fiscal year end'), 3).join('\n'),
    take((l) => l.includes('A. Approximately how many employees'), 3).join('\n'),
    aum,
  ].filter(Boolean);
  const text = parts.join('\n');
  return text.length <= MAX_SEC_ADV_TEXT ? text : text.slice(0, MAX_SEC_ADV_TEXT);
}

const retainedSchema = z.object({
  primaryName: z.string().min(1),
  crd: z.string().regex(/^\d{1,10}$/),
  filedAt: z.string().regex(/^\d{1,2}\/\d{1,2}\/\d{4} \d{1,2}:\d{2}:\d{2} [AP]M$/),
  legalName: z.string().min(1),
  fiscalYearEndMonth: z.string().regex(/^[A-Z]+$/).optional(),
  employees: z.number().int().positive().optional(),
  /** The raw Item 5.A question line — the quote must stay verbatim-in-text. */
  employeesQuestionLine: z.string().min(1).optional(),
  aum: z.object({
    discretionary: z.number(),
    nonDiscretionary: z.number(),
    total: z.number(),
    accounts: z.number(),
  }).optional(),
});

export type SecAdvRecord = z.infer<typeof retainedSchema>;

function number(raw: string): number | null {
  const value = Number(raw.replaceAll(',', ''));
  return Number.isSafeInteger(value) && value >= 0 ? value : null;
}

/** A question line never answers anything — retained blocks can overlap, so
 * the answer search skips repeated questions and empty layout lines. */
const ADV_QUESTION_MARKERS = [
  'Your full legal name', 'what month does your fiscal year end',
  'Approximately how many employees', '(2) If yes, what is the amount',
];
function isAdvQuestionLine(line: string): boolean {
  return ADV_QUESTION_MARKERS.some((marker) => line.includes(marker)) || /\?\s*$/.test(line.trim());
}

/** Parse the retained slice. Every field must be literally present — a form
 * that answers nothing yields nothing. Line answers are read from the line
 * that follows the question (layout text, CRLF or LF). */
export function parseSecAdvRecord(retained: string): SecAdvRecord | null {
  const lines = retained.split(/\r?\n/);
  const answerAfter = (predicate: (line: string) => boolean): { line: string; answer: string } | null => {
    const index = lines.findIndex(predicate);
    if (index < 0) return null;
    for (let offset = 1; offset <= 3 && index + offset < lines.length; offset++) {
      const candidate = lines[index + offset]!.trim();
      if (!candidate || isAdvQuestionLine(candidate)) continue;
      return { line: lines[index]!.trim(), answer: candidate };
    }
    return null;
  };
  const headerLine = lines.find((l) => /Primary Business Name:/.test(l));
  // Layout extractors collapse the header's column gaps to single spaces.
  const primaryMatch = headerLine ? /Primary Business Name:\s*(.+?)(?:\s+CRD Number:\s*(\d+))?\s*$/.exec(headerLine) : null;
  const crd = primaryMatch?.[2] ?? /CRD Number:\s*(\d+)/.exec(retained)?.[1];
  const filedAt = /\d{1,2}\/\d{1,2}\/\d{4} \d{1,2}:\d{2}:\d{2} [AP]M/.exec(retained)?.[0];
  const legal = answerAfter((l) => l.includes('Your full legal name'));
  const month = answerAfter((l) => l.includes('what month does your fiscal year end'));
  const employees = answerAfter((l) => l.includes('A. Approximately how many employees'));
  const aumBlock = /\(2\) If yes, what is the amount of your regulatory assets[\s\S]{0,1200}/.exec(retained)?.[0];
  let aum: SecAdvRecord['aum'];
  if (aumBlock) {
    const d = /Discretionary:\s+\(a\)\s*\$\s*([\d,]+)\s+\(d\)\s*([\d,]+)/.exec(aumBlock);
    const n = /Non-Discretionary:\s+\(b\)\s*\$\s*([\d,]+)\s+\(e\)\s*([\d,]+)/.exec(aumBlock);
    const t = /Total:\s+\(c\)\s*\$\s*([\d,]+)\s+\(f\)\s*([\d,]+)/.exec(aumBlock);
    if (d && n && t) {
      const parts = [number(d[1]!), number(n[1]!), number(t[1]!)];
      const accounts = number(t[2]!);
      if (parts.every((p): p is number => p !== null) && accounts !== null) {
        aum = { discretionary: parts[0]!, nonDiscretionary: parts[1]!, total: parts[2]!, accounts };
      }
    }
  }
  const employeesValue = employees ? number(employees.answer) : null;
  const parsed = retainedSchema.safeParse({
    primaryName: primaryMatch?.[1]?.trim() ?? '',
    crd: crd ?? '',
    filedAt: filedAt ?? '',
    legalName: legal?.answer ?? '',
    ...(month && /^[A-Za-z]+$/.test(month.answer) ? { fiscalYearEndMonth: month.answer.toUpperCase() } : {}),
    ...(employees && employeesValue !== null ? { employees: employeesValue, employeesQuestionLine: employees.line } : {}),
    ...(aum ? { aum } : {}),
  });
  return parsed.success ? parsed.data : null;
}

/** Most recent fiscal year-end strictly before the filing date — the date the
 * form's own instructions bind Item 5.F to. */
export function secAdvAumAsOf(record: SecAdvRecord): string | null {
  if (!record.fiscalYearEndMonth) return null;
  const monthIndex = ['JANUARY', 'FEBRUARY', 'MARCH', 'APRIL', 'MAY', 'JUNE', 'JULY', 'AUGUST', 'SEPTEMBER', 'OCTOBER', 'NOVEMBER', 'DECEMBER'].indexOf(record.fiscalYearEndMonth);
  if (monthIndex < 0) return null;
  const [m, d, y] = record.filedAt.split(' ')[0]!.split('/').map(Number);
  if (!m || !d || !y) return null;
  const filed = Date.UTC(y, m - 1, d);
  // The filing year's fiscal year-end if it has passed, otherwise the prior year's.
  const candidateYear = Date.UTC(y, monthIndex + 1, 0) < filed ? y : y - 1;
  const end = new Date(Date.UTC(candidateYear, monthIndex + 1, 0));
  if (end.getTime() >= filed) return null;
  return end.toISOString().slice(0, 10);
}

function identityMatches(record: SecAdvRecord, companyName: string): boolean {
  const wanted = firmNameKey(companyName);
  if (wanted.length < 4) return false;
  return [record.primaryName, record.legalName].some((n) => n && firmNameKey(n) === wanted);
}

function validAdvReceipt(source: OriginalSourceReceipt, nowMs: number, maxText: number): boolean {
  return secAdvCrd(source.finalUrl ?? '') !== null && source.format === 'sec-adv' && source.status === 'retrieved' &&
    source.httpStatus === 200 && !source.truncated && /^[a-f0-9]{64}$/.test(source.contentHash ?? '') &&
    Boolean(source.text) && source.text!.length <= maxText &&
    Number.isFinite(Date.parse(source.retrievedAt)) && Date.parse(source.retrievedAt) <= nowMs;
}

export interface SecAdvObservation {
  value: number;
  asOf: string;
  quote: string;
  passageSupport: NonNullable<CompanyMetric['passageSupport']>;
  citations: Array<{ title: string; url: string }>;
  methodNote: string;
}

/** Item 5.A — the employee count the firm filed, exact as reported. */
export function secAdvEmployeesObservation(companyName: string, originals: readonly OriginalSourceReceipt[], nowMs = Date.now()): SecAdvObservation | null {
  if (!companyName.trim()) return null;
  let best: { source: OriginalSourceReceipt; record: SecAdvRecord; asOf: string; employees: number } | null = null;
  for (const source of originals) {
    if (!validAdvReceipt(source, nowMs, MAX_SEC_ADV_TEXT)) continue;
    const record = parseSecAdvRecord(source.text!);
    if (!record?.employees || !identityMatches(record, companyName)) continue;
    const filedDate = record.filedAt.split(' ')[0]!.split('/').map(Number);
    if (filedDate.length !== 3 || !filedDate.every(Number.isFinite)) continue;
    const asOf = `${filedDate[2]!}-${String(filedDate[0]!).padStart(2, '0')}-${String(filedDate[1]!).padStart(2, '0')}`;
    if (!best || asOf.localeCompare(best.asOf) > 0) best = { source, record, asOf, employees: record.employees };
  }
  if (!best) return null;
  const quote = `${best.record.employeesQuestionLine ?? 'A. Approximately how many employees do you have?'} ${best.employees}`;
  return {
    value: best.employees,
    asOf: best.asOf,
    quote,
    passageSupport: {
      sourceUrl: best.source.finalUrl!, quote, asOf: best.asOf,
      basis: 'employees', unit: 'count', definition: 'employees', format: 'sec-adv',
    },
    citations: [{ title: `SEC Form ADV Item 5.A employees (${best.asOf})`, url: best.source.finalUrl! }],
    methodNote: `Employee count as reported in the firm's SEC Form ADV (CRD ${best.record.crd}, filed ${best.asOf}).`,
  };
}

/** Item 5.F.(2)(c) — total regulatory assets under management, exact dollars
 * as filed. The quote retains the filed line; the as-of is the fiscal year-end
 * the form binds the figure to. */
export function secAdvAumObservation(companyName: string, originals: readonly OriginalSourceReceipt[], nowMs = Date.now()): SecAdvObservation | null {
  if (!companyName.trim()) return null;
  let best: { source: OriginalSourceReceipt; record: SecAdvRecord; asOf: string } | null = null;
  for (const source of originals) {
    if (!validAdvReceipt(source, nowMs, MAX_SEC_ADV_TEXT)) continue;
    const record = parseSecAdvRecord(source.text!);
    if (!record?.aum || record.aum.total <= 0 || !identityMatches(record, companyName)) continue;
    const asOf = secAdvAumAsOf(record);
    if (!asOf) continue;
    if (!best || asOf.localeCompare(best.asOf) > 0) best = { source, record, asOf };
  }
  if (!best) return null;
  const total = best.record.aum!;
  const quote = `Total: (c) $ ${total.total.toLocaleString('en-US')}`;
  return {
    value: total.total,
    asOf: best.asOf,
    quote,
    passageSupport: {
      sourceUrl: best.source.finalUrl!, quote, asOf: best.asOf,
      basis: 'aum', unit: 'USD', definition: 'aum', format: 'sec-adv',
    },
    citations: [{ title: `SEC Form ADV Item 5.F.(2)(c) regulatory AUM (${best.asOf})`, url: best.source.finalUrl! }],
    methodNote: `Regulatory assets under management as reported in the firm's SEC Form ADV (CRD ${best.record.crd}, filed ${best.record.filedAt.split(' ')[0]}, as of fiscal year-end ${best.asOf}).`,
  };
}

/** The deterministic observation for a metric type, or null. metric-support's
 * passage gate calls this for format 'sec-adv' proofs — the retained record
 * must re-derive the exact claim. */
export function secAdvObservationFor(metricType: MetricType, companyName: string, originals: readonly OriginalSourceReceipt[], nowMs = Date.now()): SecAdvObservation | null {
  if (metricType === 'employees') return secAdvEmployeesObservation(companyName, originals, nowMs);
  if (metricType === 'aum') return secAdvAumObservation(companyName, originals, nowMs);
  return null;
}
