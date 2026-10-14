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

/** Trailing words that name an adviser's ROLE, not its brand: "Antares
 * Capital Advisers", "Apollo Capital Management" and "Apollo Global
 * Management" all reduce to their brand core. Deliberately excludes strategy
 * words (CREDIT, REAL ESTATE, OPPORTUNITIES…): "Antares Capital Credit
 * Advisers" is a sibling adviser, not the brand's own registration. */
const ADVISER_ROLE_WORDS = new Set([
  'CAPITAL', 'MANAGEMENT', 'MANAGER', 'MANAGERS', 'ADVISERS', 'ADVISORS', 'ADVISER', 'ADVISOR',
  'PARTNERS', 'INVESTMENT', 'INVESTMENTS', 'ASSET', 'GLOBAL', 'GROUP', 'HOLDINGS',
]);

/** The brand core of a firm name: its legal-suffix-free key with trailing role
 * words removed. '' when nothing distinctive is left. */
function firmBrandCore(raw: string): string {
  const words = firmNameKey(raw).split(' ').filter(Boolean);
  while (words.length > 1 && ADVISER_ROLE_WORDS.has(words[words.length - 1]!)) words.pop();
  const core = words.join(' ');
  return core.length >= 3 && !ADVISER_ROLE_WORDS.has(core) ? core : '';
}

/** A relying adviser listed under an umbrella filer is not a name the filer
 * does business under — never identity evidence. */
// IAPD states the role both as "(RELYING ADVISER)" and as ", RELYING ADVISER".
const RELYING_ADVISER_PATTERN = /[(,]\s*RELYING\s+ADVIS[EO]R/i;

const searchHitSchema = z.object({
  hits: z.object({
    total: z.number().int().nonnegative().optional(),
    hits: z.array(z.object({
      _source: z.object({
        firm_source_id: z.string().regex(/^\d{1,10}$/),
        firm_name: z.string().min(1),
        firm_other_names: z.array(z.string()).nullish().default([]),
        /** "801-…" registered adviser; "802-…" exempt reporting adviser. */
        firm_ia_full_sec_number: z.string().nullish(),
        firm_ia_scope: z.string().nullish(),
        /** Broker-dealer scope — present without an IA scope on broker-only rows. */
        firm_scope: z.string().nullish(),
      }).passthrough(),
    })).max(50),
  }).passthrough(),
}).passthrough();

/** The compact, deterministic projection the reader retains for an IAPD
 * search (the raw JSON runs to 40 KB for a large manager's relying-adviser
 * roster — past the retained-receipt bound). Only what selection reads. */
const searchSliceSchema = z.object({
  iapdSearch: z.string().max(200),
  total: z.number().int().nonnegative(),
  firms: z.array(z.object({
    crd: z.string().regex(/^\d{1,10}$/),
    name: z.string().min(1).max(300),
    sec: z.string().max(40).nullable(),
    ia: z.string().max(40).nullable(),
    brokerOnly: z.boolean(),
    aliases: z.array(z.string().max(300)).max(40),
  })).max(50),
});

/** Retained IAPD search receipts ride the generic (format-less) receipt bound. */
export const MAX_SEC_ADV_SEARCH_TEXT = 4000;

interface SearchFirm { crd: string; name: string; sec: string | null; ia: string | null; brokerOnly: boolean; aliases: string[] }

/** Whether a URL is the public IAPD firm search this lane reads. */
export function isSecAdvSearchUrl(raw: string): boolean {
  return /^https:\/\/api\.adviserinfo\.sec\.gov\/search\/firm\?query=/.test(raw);
}

function secAdvSearchQuery(raw: string): string | null {
  try {
    const url = new URL(raw);
    return isSecAdvSearchUrl(url.href) ? url.searchParams.get('query') : null;
  } catch {
    return null;
  }
}

function searchFirms(searchText: string): { total: number; firms: SearchFirm[] } | null {
  let json: unknown;
  try {
    json = JSON.parse(searchText);
  } catch {
    return null;
  }
  const slice = searchSliceSchema.safeParse(json);
  if (slice.success) return { total: slice.data.total, firms: slice.data.firms };
  const raw = searchHitSchema.safeParse(json);
  if (!raw.success) return null;
  const firms = raw.data.hits.hits.map(({ _source: s }) => ({
    crd: s.firm_source_id, name: s.firm_name,
    sec: s.firm_ia_full_sec_number ?? null, ia: s.firm_ia_scope ?? null,
    brokerOnly: !s.firm_ia_scope && Boolean(s.firm_scope),
    aliases: (s.firm_other_names ?? []).filter((n): n is string => Boolean(n)),
  }));
  return { total: raw.data.hits.total ?? firms.length, firms };
}

/** Reader-side: the deterministic retained slice of an IAPD search answer.
 * Keeps every firm row (selection must see every competitor to detect
 * ambiguity) but only the aliases that share the query's first word — a
 * wealth adviser's forty unrelated DBAs and an umbrella's relying-adviser
 * roster are not identity evidence. null when even that exceeds the bound. */
export function selectSecAdvSearchSlice(body: string, requestedUrl: string): string | null {
  const query = secAdvSearchQuery(requestedUrl);
  const parsed = searchFirms(body);
  if (!query || !parsed) return null;
  const lead = firmNameKey(query).split(' ')[0] ?? '';
  const firms = parsed.firms.map((firm) => ({
    ...firm,
    name: firm.name.slice(0, 300),
    aliases: lead
      ? [...new Set(firm.aliases.filter((alias) => !RELYING_ADVISER_PATTERN.test(alias) &&
        firmNameKey(alias).split(' ').includes(lead)).map((alias) => alias.slice(0, 300)))].slice(0, 40)
      : [],
  }));
  const text = JSON.stringify({ iapdSearch: query.slice(0, 200), total: parsed.total, firms });
  return text.length <= MAX_SEC_ADV_SEARCH_TEXT ? text : null;
}

export interface SecAdvFirmMatch {
  crd: string;
  legalName: string;
  otherNames: string[];
  /** 'name': the firm's own name or a stated alias IS the company name.
   * 'brand': only the brand core matches ("Apollo Capital Management" for
   * Apollo Global Management) — usable only when the filed report lists the
   * company's official website. */
  matchedBy: 'name' | 'brand';
}

/** A firm that can file Item 5.F: an active SEC-registered adviser. Exempt
 * reporting advisers (802-) never report regulatory AUM, and inactive or
 * broker-only rows have no current adviser report. Rows that do not state
 * their registration (older retained receipts) are kept. */
function canReportAum(firm: SearchFirm): boolean {
  if (firm.brokerOnly) return false;
  if (firm.ia && firm.ia.toUpperCase() !== 'ACTIVE') return false;
  return !(firm.sec && firm.sec.startsWith('802-'));
}

/** Every adviser worth reading for this company, or [] when the answer is
 * ambiguous. A unique firm whose own name is the company name stands alone;
 * two firms claiming the exact name is ambiguity. Otherwise an exact-alias hit
 * and brand-core hits are all candidates (at most three — more is ambiguity,
 * not a reason to guess) and the filed reports' identity decides among them. */
export function secAdvFirmCandidates(searchText: string, companyName: string): SecAdvFirmMatch[] {
  const wanted = firmNameKey(companyName);
  if (wanted.length < 4) return [];
  const parsed = searchFirms(searchText);
  if (!parsed) return [];
  const eligible = parsed.firms.filter(canReportAum);
  const names = (firm: SearchFirm) => [firm.name, ...firm.aliases.filter((a) => !RELYING_ADVISER_PATTERN.test(a))];
  const toMatch = (firm: SearchFirm, matchedBy: SecAdvFirmMatch['matchedBy']): SecAdvFirmMatch =>
    ({ crd: firm.crd, legalName: firm.name, otherNames: firm.aliases, matchedBy });
  const exact = new Map<string, SearchFirm>();
  for (const firm of eligible) if (names(firm).some((n) => firmNameKey(n) === wanted)) exact.set(firm.crd, firm);
  if (exact.size > 1) return [];
  const only = [...exact.values()][0];
  if (only && firmNameKey(only.name) === wanted) return [toMatch(only, 'name')];
  const candidates = new Map<string, SecAdvFirmMatch>(only ? [[only.crd, toMatch(only, 'name')]] : []);
  const core = firmBrandCore(companyName);
  if (core) {
    for (const firm of eligible) {
      if (!candidates.has(firm.crd) && names(firm).some((n) => firmBrandCore(n) === core)) candidates.set(firm.crd, toMatch(firm, 'brand'));
    }
  }
  return candidates.size <= 3 ? [...candidates.values()] : [];
}

/** The single firm whose own name or stated alias is the company name, or
 * null. Ambiguity (two distinct firms tie) refuses to pick — the hunt ladder
 * still runs, and no wrong firm's figures can land. */
export function secAdvFirmMatch(searchJson: string, companyName: string): SecAdvFirmMatch | null {
  const named = secAdvFirmCandidates(searchJson, companyName).filter((c) => c.matchedBy === 'name');
  return named.length === 1 ? named[0]! : null;
}

const ADV_WEBSITE_PREFIX = 'Address of Website/Account on Publicly Available Social Media Platform:';
const MAX_ADV_WEBSITES = 30;

/** Reader-side: deterministic bounded slice of the PDF's full text holding
 * exactly the fields the lane derives from (identity, fiscal year, Item 5.A,
 * Item 5.F, Schedule D 1.I websites). Anything outside stays out of the vault. */
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
  // Schedule D Section 1.I — the websites the adviser itself filed. Identity
  // evidence for a registered adviser whose name differs from its brand.
  const websites = lines.map((l) => l.trim()).filter((l) => l.startsWith(ADV_WEBSITE_PREFIX))
    .slice(0, MAX_ADV_WEBSITES).map((l) => l.slice(0, 300));
  const parts = [
    header.join('\n'),
    take((l) => l.includes('Your full legal name'), 3).join('\n'),
    take((l) => l.includes('what month does your fiscal year end'), 3).join('\n'),
    take((l) => l.includes('A. Approximately how many employees'), 3).join('\n'),
    aum,
    websites.join('\n'),
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
  /** Lower-cased hosts of the Schedule D 1.I websites, as filed. */
  websiteHosts: z.array(z.string()).default([]),
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

/** Lower-cased host without "www.", or null. Accepts bare "WWW.X.COM" forms. */
function websiteHost(raw: string | null | undefined): string | null {
  if (!raw?.trim()) return null;
  try {
    const url = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(raw.trim()) ? raw.trim() : `https://${raw.trim()}`);
    const host = url.hostname.toLowerCase().replace(/^www\./, '').replace(/\.$/, '');
    return host.includes('.') ? host : null;
  } catch {
    return null;
  }
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
  const websiteHosts = [...new Set(lines.map((l) => l.trim()).filter((l) => l.startsWith(ADV_WEBSITE_PREFIX))
    .map((l) => websiteHost(l.slice(ADV_WEBSITE_PREFIX.length).trim()))
    .filter((host): host is string => Boolean(host)))];
  const parsed = retainedSchema.safeParse({
    websiteHosts,
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

function nameIdentityMatches(record: SecAdvRecord, companyName: string): boolean {
  const wanted = firmNameKey(companyName);
  if (wanted.length < 4) return false;
  return [record.primaryName, record.legalName].some((n) => n && firmNameKey(n) === wanted);
}

/** The filed report lists the company's own website (or a subdomain of it). */
function websiteIdentityMatches(record: SecAdvRecord, officialWebsite: string | null | undefined): boolean {
  const site = websiteHost(officialWebsite);
  return Boolean(site) && record.websiteHosts.some((host) => host === site || host.endsWith(`.${site}`));
}

function validSearchReceipt(source: OriginalSourceReceipt, nowMs: number): boolean {
  return source.status === 'retrieved' && source.httpStatus === 200 && isSecAdvSearchUrl(source.finalUrl ?? '') &&
    Boolean(source.text) && source.text!.length <= MAX_SEC_ADV_SEARCH_TEXT &&
    Number.isFinite(Date.parse(source.retrievedAt)) && Date.parse(source.retrievedAt) <= nowMs;
}

interface IdentifiedAdvRecord { source: OriginalSourceReceipt; record: SecAdvRecord; matchedBy: SecAdvFirmMatch['matchedBy'] }

/**
 * The retained reports that are THIS company's adviser — one CRD or nothing.
 *  - name: the filing's own primary business or legal name is the company name.
 *  - brand: the adviser was a candidate of a retained IAPD search for this
 *    company (brand-core or alias match) AND its filed Schedule D websites
 *    include the company's official website. Two independent facts from two
 *    official SEC documents; neither alone suffices.
 * Name identity outranks brand identity. Two different advisers at the same
 * rank is ambiguity: no figure, never a pick and never a sum across affiliates.
 */
function identifiedAdvRecords(companyName: string, originals: readonly OriginalSourceReceipt[], nowMs: number,
  officialWebsite: string | null | undefined): IdentifiedAdvRecord[] {
  if (!companyName.trim()) return [];
  const parsed = originals.flatMap((source) => {
    if (!validAdvReceipt(source, nowMs, MAX_SEC_ADV_TEXT)) return [];
    const record = parseSecAdvRecord(source.text!);
    return record ? [{ source, record }] : [];
  });
  // A filing with no Item 5 at all (an exempt reporting adviser such as
  // ANTARES CAPITAL CORPORATION) can report neither figure, so its name match
  // must not shadow the brand's registered adviser.
  const named = parsed.filter(({ record }) => (record.aum || record.employees) && nameIdentityMatches(record, companyName));
  let identified: IdentifiedAdvRecord[] = named.map((row) => ({ ...row, matchedBy: 'name' as const }));
  if (!identified.length) {
    const searched = new Set(originals.filter((source) => validSearchReceipt(source, nowMs))
      .flatMap((source) => secAdvFirmCandidates(source.text!, companyName).map((c) => c.crd)));
    identified = parsed.filter(({ record }) => searched.has(record.crd) && websiteIdentityMatches(record, officialWebsite))
      .map((row) => ({ ...row, matchedBy: 'brand' as const }));
  }
  return new Set(identified.map(({ record }) => record.crd)).size === 1 ? identified : [];
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
export function secAdvEmployeesObservation(companyName: string, originals: readonly OriginalSourceReceipt[], nowMs = Date.now(),
  officialWebsite?: string | null): SecAdvObservation | null {
  let best: IdentifiedAdvRecord & { asOf: string; employees: number } | null = null;
  for (const row of identifiedAdvRecords(companyName, originals, nowMs, officialWebsite)) {
    const { record } = row;
    // An adviser entity's headcount is not the brand's headcount (staff sit in
    // affiliated entities): Item 5.A lands only for the firm's own filing.
    if (!record.employees || row.matchedBy !== 'name') continue;
    const filedDate = record.filedAt.split(' ')[0]!.split('/').map(Number);
    if (filedDate.length !== 3 || !filedDate.every(Number.isFinite)) continue;
    const asOf = `${filedDate[2]!}-${String(filedDate[0]!).padStart(2, '0')}-${String(filedDate[1]!).padStart(2, '0')}`;
    if (!best || asOf.localeCompare(best.asOf) > 0) best = { ...row, asOf, employees: record.employees };
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
export function secAdvAumObservation(companyName: string, originals: readonly OriginalSourceReceipt[], nowMs = Date.now(),
  officialWebsite?: string | null): SecAdvObservation | null {
  let best: IdentifiedAdvRecord & { asOf: string } | null = null;
  for (const row of identifiedAdvRecords(companyName, originals, nowMs, officialWebsite)) {
    if (!row.record.aum || row.record.aum.total <= 0) continue;
    const asOf = secAdvAumAsOf(row.record);
    if (!asOf) continue;
    if (!best || asOf.localeCompare(best.asOf) > 0) best = { ...row, asOf };
  }
  if (!best) return null;
  const total = best.record.aum!;
  const quote = `Total: (c) $ ${total.total.toLocaleString('en-US')}`;
  const filer = best.matchedBy === 'name'
    ? `the firm's SEC Form ADV (CRD ${best.record.crd}`
    : `the SEC Form ADV of ${best.record.legalName}, the registered adviser whose filing lists ${websiteHost(officialWebsite)} — this adviser's figure only, not a sum across affiliated advisers (CRD ${best.record.crd}`;
  return {
    value: total.total,
    asOf: best.asOf,
    quote,
    passageSupport: {
      sourceUrl: best.source.finalUrl!, quote, asOf: best.asOf,
      basis: 'aum', unit: 'USD', definition: 'aum', format: 'sec-adv',
    },
    citations: [{ title: `SEC Form ADV Item 5.F.(2)(c) regulatory AUM (${best.asOf})`, url: best.source.finalUrl! }],
    methodNote: `Regulatory assets under management as reported in ${filer}, filed ${best.record.filedAt.split(' ')[0]}, as of fiscal year-end ${best.asOf}).`,
  };
}

/** The deterministic observation for a metric type, or null. metric-support's
 * passage gate calls this for format 'sec-adv' proofs — the retained record
 * must re-derive the exact claim. `officialWebsite` is the company's own site:
 * the only way an adviser registered under a different name can be identified. */
export function secAdvObservationFor(metricType: MetricType, companyName: string, originals: readonly OriginalSourceReceipt[], nowMs = Date.now(),
  officialWebsite?: string | null): SecAdvObservation | null {
  if (metricType === 'employees') return secAdvEmployeesObservation(companyName, originals, nowMs, officialWebsite);
  if (metricType === 'aum') return secAdvAumObservation(companyName, originals, nowMs, officialWebsite);
  return null;
}
