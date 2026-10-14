/**
 * Major shareholders (5%+) from SEC beneficial-ownership filings — the free,
 * official equivalent of a terminal's ownership screen.
 *
 * A Schedule 13D or 13G is filed BY the holder ABOUT the subject company, and
 * EDGAR lists it in the subject company's own submissions feed. Since
 * December 2024 these schedules are filed as structured XML
 * (`primary_doc.xml`, form names "SCHEDULE 13G" / "SCHEDULE 13D" and their /A
 * amendments) carrying the reporting person's name and percent of class on the
 * cover page. Only those structured filings are read: the legacy free-text
 * "SC 13G" documents state the percentage in prose, and a regex guess at a
 * holding is not a reported figure.
 *
 * Rules (data integrity): every row cites its own filing; a percent the filing
 * does not state numerically is null, never estimated; the latest filing per
 * holder wins, and a latest filing below 5% (or an explicit exit) drops
 * the holder. Filings the company itself made about OTHER issuers also appear
 * in its feed (NVIDIA's own CoreWeave stake) — the issuer CIK in the document
 * must be the subject company, or the filing is ignored.
 *
 * The reader (original-source.node.ts) keeps only bounded, deterministic
 * slices: the 13D/G rows of the submissions feed and the cover-page facts of
 * each schedule, both as compact JSON.
 */
import { z } from 'zod';
import { companyNameKey, secTickerMapUrl } from './market-quote';
import { companyFilingRowSchema, describeCompanyFiling, MAX_COMPANY_FILINGS, selectCompanyFilings, type CompanyFiling, type CompanyFilingRow } from './sec-filings';
import type { OriginalSourceReceipt } from './original-source';
import { selectSubmissionsProfile } from './sec-profile';

export const SCHEDULE_13_FORMS = ['SCHEDULE 13G', 'SCHEDULE 13G/A', 'SCHEDULE 13D', 'SCHEDULE 13D/A'] as const;
export type Schedule13Form = typeof SCHEDULE_13_FORMS[number];
/** Most recent structured schedules kept from the submissions feed. */
export const MAX_SCHEDULE_FILINGS = 24;
const MAX_PERSONS = 8;
const MAX_NAME = 160;

const padCik = (cik: string) => cik.replace(/\D/g, '').padStart(10, '0');

export function secSubmissionsUrl(cik: string): string {
  return `https://data.sec.gov/submissions/CIK${padCik(cik)}.json`;
}

/** The CIK of an exact submissions-feed URL, else null. */
export function secSubmissionsCik(raw: string): string | null {
  try {
    const url = new URL(raw);
    if (url.protocol !== 'https:' || url.hostname !== 'data.sec.gov' || url.username || url.password ||
      url.port || url.search || url.hash) return null;
    return /^\/submissions\/CIK(\d{10})\.json$/.exec(url.pathname)?.[1] ?? null;
  } catch { return null; }
}

const accessionPattern = /^\d{10}-\d{2}-\d{6}$/;

/** Machine-readable schedule document: what the reader parses. */
export function scheduleDocumentUrl(subjectCik: string, accession: string): string {
  return `https://www.sec.gov/Archives/edgar/data/${Number(subjectCik.replace(/\D/g, ''))}/${accession.replace(/-/g, '')}/primary_doc.xml`;
}

/** Human-readable rendering of the same filing: the citation a person opens. */
export function scheduleFilingUrl(subjectCik: string, accession: string, primaryDocument: string): string {
  return `https://www.sec.gov/Archives/edgar/data/${Number(subjectCik.replace(/\D/g, ''))}/${accession.replace(/-/g, '')}/${primaryDocument}`;
}

/** True only for an EDGAR archive `primary_doc.xml` (the structured schedule). */
export function isScheduleDocumentUrl(raw: string): boolean {
  try {
    const url = new URL(raw);
    return url.protocol === 'https:' && url.hostname === 'www.sec.gov' && !url.username && !url.password &&
      !url.port && !url.search && !url.hash && /^\/Archives\/edgar\/data\/\d{1,10}\/\d{18}\/primary_doc\.xml$/.test(url.pathname);
  } catch { return false; }
}

// ---------------------------------------------------------------------------
// Submissions feed → the schedule rows only.

export interface ScheduleFilingRow {
  form: Schedule13Form;
  filingDate: string;
  accession: string;
  primaryDocument: string;
}

export interface ScheduleFilingIndex {
  cik: string;
  name: string;
  filings: ScheduleFilingRow[];
  /** The company's own recent disclosure filings (sec-filings.ts). */
  companyFilings: CompanyFilingRow[];
}

const submissionsSchema = z.object({
  cik: z.union([z.string(), z.number()]),
  name: z.string().min(1),
  filings: z.object({
    recent: z.object({
      accessionNumber: z.array(z.string()),
      filingDate: z.array(z.string()),
      form: z.array(z.string()),
      primaryDocument: z.array(z.string()),
    }).passthrough(),
  }).passthrough(),
}).passthrough();

/** Reader-side: the structured 13D/G rows of an issuer's submissions feed,
 * newest first, bounded. Anything unparsable is an empty slice, not a guess. */
export function selectScheduleFilingIndex(submissionsJson: string): string {
  let doc: z.infer<typeof submissionsSchema>;
  try { doc = submissionsSchema.parse(JSON.parse(submissionsJson)); } catch { return ''; }
  const recent = doc.filings.recent;
  const filings: ScheduleFilingRow[] = [];
  for (let i = 0; i < recent.form.length; i++) {
    const form = recent.form[i]!;
    const accession = recent.accessionNumber[i] ?? '';
    const filingDate = recent.filingDate[i] ?? '';
    const primaryDocument = recent.primaryDocument[i] ?? '';
    if (!(SCHEDULE_13_FORMS as readonly string[]).includes(form) || !accessionPattern.test(accession) ||
      !/^\d{4}-\d{2}-\d{2}$/.test(filingDate) || !/^(?:[\w.-]{1,60}\/)?primary_doc\.xml$/.test(primaryDocument)) continue;
    filings.push({ form: form as Schedule13Form, filingDate, accession, primaryDocument });
  }
  filings.sort((a, b) => b.filingDate.localeCompare(a.filingDate) || b.accession.localeCompare(a.accession));
  return JSON.stringify({ cik: padCik(String(doc.cik)), name: doc.name.slice(0, MAX_NAME), filings: filings.slice(0, MAX_SCHEDULE_FILINGS),
    companyFilings: selectCompanyFilings(recent),
    // The registrant's own tickers, website and business address (sec-profile.ts).
    profile: selectSubmissionsProfile(doc) });
}

const indexSchema = z.object({
  cik: z.string().regex(/^\d{10}$/),
  name: z.string().min(1).max(MAX_NAME),
  filings: z.array(z.object({
    form: z.enum(SCHEDULE_13_FORMS),
    filingDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    accession: z.string().regex(accessionPattern),
    primaryDocument: z.string().regex(/^(?:[\w.-]{1,60}\/)?primary_doc\.xml$/),
  })).max(MAX_SCHEDULE_FILINGS),
  // Absent from slices retained before the filings feed existed.
  companyFilings: z.array(companyFilingRowSchema).max(MAX_COMPANY_FILINGS).default([]),
});

export function parseScheduleFilingIndex(text: string): ScheduleFilingIndex | null {
  try { return indexSchema.parse(JSON.parse(text)); } catch { return null; }
}

// ---------------------------------------------------------------------------
// One structured schedule → its cover-page facts.

export interface ScheduleReportingPerson {
  name: string;
  /** Percent of class exactly as stated on the cover page; null when not numeric. */
  percentOfClass: number | null;
  shares: number | null;
}

export interface ScheduleOwnershipDocument {
  form: Schedule13Form;
  issuerCik: string;
  issuerName: string | null;
  filerCik: string | null;
  /** Date of the event requiring the filing (ISO), when stated. */
  eventDate: string | null;
  /** 13G Item 5: "ownership of 5 percent or less of a class" — an exit. */
  exitedFivePercent: boolean;
  reportingPersons: ScheduleReportingPerson[];
}

function decode(text: string): string {
  return text.replace(/<!\[CDATA\[([^]*?)\]\]>/g, '$1')
    .replace(/&#(x[\da-f]+|\d+);/gi, (entity, digits: string) => {
      const code = /^x/i.test(digits) ? parseInt(digits.slice(1), 16) : Number(digits);
      return code > 0 && code <= 0x10ffff && !(code >= 0xd800 && code <= 0xdfff) ? String.fromCodePoint(code) : entity;
    })
    .replace(/&(?:amp|lt|gt|quot|apos);/g, (entity) => ({ '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&apos;': "'" })[entity] ?? entity)
    .replace(/\s+/g, ' ').trim();
}

function blocks(xml: string, tag: string): string[] {
  return [...xml.matchAll(new RegExp(`<${tag}(?:\\s[^>]*)?>([^]*?)</${tag}\\s*>`, 'g'))].map((m) => m[1]!);
}

function field(xml: string, ...tags: string[]): string | null {
  for (const tag of tags) {
    const inner = blocks(xml, tag)[0];
    if (inner !== undefined && !/<[A-Za-z]/.test(inner)) {
      const value = decode(inner);
      if (value) return value;
    }
  }
  return null;
}

/** A stated percent: plain decimal, optional "%", within 0–100. Prose such as
 * "See Row 11 of cover page" is not a figure. */
export function parsePercentOfClass(raw: string | null): number | null {
  const match = raw ? /^(\d{1,3}(?:\.\d+)?)\s*%?$/.exec(raw.trim()) : null;
  const value = match ? Number(match[1]) : NaN;
  return Number.isFinite(value) && value >= 0 && value <= 100 ? value : null;
}

function parseShares(raw: string | null): number | null {
  const match = raw ? /^(\d[\d,]*(?:\.\d+)?)$/.exec(raw.trim()) : null;
  const value = match ? Number(match[1]!.replace(/,/g, '')) : NaN;
  return Number.isFinite(value) && value >= 0 ? value : null;
}

function isoDate(raw: string | null): string | null {
  const us = raw ? /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(raw) : null;
  if (us) return `${us[3]}-${us[1]}-${us[2]}`;
  return raw && /^\d{4}-\d{2}-\d{2}$/.test(raw) ? raw : null;
}

/** Parse a structured Schedule 13D/13G `primary_doc.xml`. Namespace prefixes
 * vary by filing software (`sch:` from Workiva, none from others), so they are
 * stripped first. Not a structured schedule → null. */
export function parseScheduleOwnershipXml(xml: string): ScheduleOwnershipDocument | null {
  if (!/<(?:\w+:)?edgarSubmission\b[^>]*schedule13[dg]/i.test(xml)) return null;
  const doc = xml.replace(/<!--[^]*?-->/g, '').replace(/<(\/?)[A-Za-z_][\w.-]*:/g, '<$1');
  const form = field(doc, 'submissionType');
  if (!form || !(SCHEDULE_13_FORMS as readonly string[]).includes(form)) return null;
  const issuerInfo = blocks(doc, 'issuerInfo')[0] ?? '';
  const issuerCik = field(issuerInfo, 'issuerCik', 'issuerCIK');
  if (!issuerCik || !/^\d{1,10}$/.test(issuerCik)) return null;
  const filerCik = field(blocks(doc, 'filerCredentials')[0] ?? '', 'cik');
  const personBlocks = form.startsWith('SCHEDULE 13G')
    ? blocks(doc, 'coverPageHeaderReportingPersonDetails')
    : blocks(doc, 'reportingPersonInfo');
  const reportingPersons: ScheduleReportingPerson[] = [];
  for (const person of personBlocks) {
    const name = field(person, 'reportingPersonName');
    if (!name) continue;
    reportingPersons.push({
      name: name.slice(0, MAX_NAME),
      percentOfClass: parsePercentOfClass(field(person, 'classPercent', 'percentOfClass')),
      shares: parseShares(field(person, 'reportingPersonBeneficiallyOwnedAggregateNumberOfShares', 'aggregateAmountOwned')),
    });
    if (reportingPersons.length >= MAX_PERSONS) break;
  }
  if (reportingPersons.length === 0) return null;
  const item5 = blocks(doc, 'item5')[0] ?? '';
  return {
    form: form as Schedule13Form,
    issuerCik: padCik(issuerCik),
    issuerName: field(issuerInfo, 'issuerName')?.slice(0, MAX_NAME) ?? null,
    filerCik: filerCik && /^\d{1,10}$/.test(filerCik) ? padCik(filerCik) : null,
    eventDate: isoDate(field(doc, 'eventDateRequiresFilingThisStatement', 'dateOfEvent')),
    exitedFivePercent: field(item5, 'classOwnership5PercentOrLess') === 'Y',
    reportingPersons,
  };
}

const ownershipDocumentSchema = z.object({
  form: z.enum(SCHEDULE_13_FORMS),
  issuerCik: z.string().regex(/^\d{10}$/),
  issuerName: z.string().max(MAX_NAME).nullable(),
  filerCik: z.string().regex(/^\d{10}$/).nullable(),
  eventDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable(),
  exitedFivePercent: z.boolean(),
  reportingPersons: z.array(z.object({
    name: z.string().min(1).max(MAX_NAME),
    percentOfClass: z.number().min(0).max(100).nullable(),
    shares: z.number().nonnegative().nullable(),
  })).min(1).max(MAX_PERSONS),
});

/** Validate the reader's retained cover-page JSON. */
export function parseScheduleOwnershipDocument(text: string): ScheduleOwnershipDocument | null {
  try { return ownershipDocumentSchema.parse(JSON.parse(text)); } catch { return null; }
}

// ---------------------------------------------------------------------------
// Filings → one row per holder.

export interface MajorShareholder {
  holder: string;
  /** As filed; null when the filing does not state it numerically. */
  percentOfClass: number | null;
  shares: number | null;
  form: Schedule13Form;
  filingDate: string;
  eventDate: string | null;
  /** The filing itself — every row's citation. */
  filingUrl: string;
  /** Other persons on the same joint filing (affiliates, trusts, funds). */
  jointFilers: string[];
}

function holderKey(name: string): string {
  return companyNameKey(name).replace(/^THE /, '');
}

/** Latest filing per holder, about THIS issuer only; holders whose latest
 * filing reports below 5% (or an explicit exit) are dropped. Ordered by
 * stated percent, unknown percents last. */
export function selectMajorShareholders(
  subjectCik: string,
  entries: ReadonlyArray<{ filing: ScheduleFilingRow; document: ScheduleOwnershipDocument | null }>,
): MajorShareholder[] {
  const subject = padCik(subjectCik);
  const newestFirst = [...entries].sort((a, b) =>
    b.filing.filingDate.localeCompare(a.filing.filingDate) || b.filing.accession.localeCompare(a.filing.accession));
  const seen = new Set<string>();
  const rows: MajorShareholder[] = [];
  for (const { filing, document } of newestFirst) {
    if (!document || document.issuerCik !== subject || document.form !== filing.form) continue;
    // The lead person on a joint filing is the one with the largest stated
    // stake (an individual whose figure includes their LLC's, say).
    const persons = document.reportingPersons;
    const lead = persons.reduce((best, p) => (p.percentOfClass ?? -1) > (best.percentOfClass ?? -1) ? p : best, persons[0]!);
    const key = holderKey(lead.name);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    for (const other of persons) seen.add(holderKey(other.name));
    if (document.exitedFivePercent || (lead.percentOfClass !== null && lead.percentOfClass < 5)) continue;
    rows.push({
      holder: lead.name,
      percentOfClass: lead.percentOfClass,
      shares: lead.shares,
      form: filing.form,
      filingDate: filing.filingDate,
      eventDate: document.eventDate,
      filingUrl: scheduleFilingUrl(subject, filing.accession, filing.primaryDocument),
      jointFilers: [...new Set(persons.filter((p) => p !== lead && holderKey(p.name) !== key).map((p) => p.name))],
    });
  }
  return rows.sort((a, b) => (b.percentOfClass ?? -1) - (a.percentOfClass ?? -1));
}

const receiptText = (receipt: OriginalSourceReceipt) => receipt.status === 'retrieved' && receipt.text ? receipt.text : null;

/** The company's one CIK through the official ticker map, and its submissions
 * slice. Null when the name matches no registrant or several. */
export async function resolveSecSubmissions(
  companyName: string,
  read: (url: string) => Promise<OriginalSourceReceipt>,
): Promise<{ cik: string; index: ScheduleFilingIndex } | null> {
  const mapText = receiptText(await read(`${secTickerMapUrl()}?lookup=${encodeURIComponent(companyName)}`));
  if (!mapText) return null;
  let matches: Array<{ cik?: unknown }> = [];
  try { matches = (JSON.parse(mapText) as { matches?: Array<{ cik?: unknown }> }).matches ?? []; } catch { return null; }
  const ciks = [...new Set(matches.map((m) => String(m.cik ?? '')).filter((c) => /^\d{1,10}$/.test(c)))];
  if (ciks.length !== 1) return null;
  const cik = padCik(ciks[0]!);
  const indexText = receiptText(await read(secSubmissionsUrl(cik)));
  const index = indexText ? parseScheduleFilingIndex(indexText) : null;
  return index && index.cik === cik ? { cik, index } : null;
}

/** The company's own recent SEC filings, newest first; null when it is not a single resolvable registrant. */
export async function findCompanyFilings(
  companyName: string,
  read: (url: string) => Promise<OriginalSourceReceipt>,
): Promise<{ cik: string; filings: CompanyFiling[] } | null> {
  const resolved = await resolveSecSubmissions(companyName, read);
  return resolved ? { cik: resolved.cik, filings: resolved.index.companyFilings.map((row) => describeCompanyFiling(resolved.cik, row)) } : null;
}

/** Schedules read per company: the newest ones, which hold every current
 * holder's latest filing. Bounded so one lookup stays a handful of SEC reads. */
export const MAX_SCHEDULE_READS = 10;

/**
 * The whole lane over any reader (the node reader, the Worker relay): resolve
 * the company to exactly one CIK through the official ticker map, list its
 * structured schedules, read the newest, select holders. Null when the company
 * is not an SEC registrant (or the name is ambiguous) or a read fails —
 * never a partial guess.
 */
export async function findMajorShareholders(
  companyName: string,
  read: (url: string) => Promise<OriginalSourceReceipt>,
): Promise<{ cik: string; holders: MajorShareholder[] } | null> {
  const resolved = await resolveSecSubmissions(companyName, read);
  if (!resolved) return null;
  const { cik, index } = resolved;
  const filings = index.filings.slice(0, MAX_SCHEDULE_READS);
  const entries: Array<{ filing: ScheduleFilingRow; document: ScheduleOwnershipDocument | null }> = [];
  // Two at a time: a courtesy to EDGAR's fair-access limit.
  for (let i = 0; i < filings.length; i += 2) {
    const batch = filings.slice(i, i + 2);
    const docs = await Promise.all(batch.map(async (filing) => {
      const docText = receiptText(await read(scheduleDocumentUrl(cik, filing.accession)));
      return docText ? parseScheduleOwnershipDocument(docText) : null;
    }));
    // A schedule that could not be read might be a holder's exit; showing an
    // older, higher figure in its place would overstate. No partial answers.
    if (docs.some((doc) => doc === null)) return null;
    batch.forEach((filing, j) => entries.push({ filing, document: docs[j]! }));
  }
  return { cik, holders: selectMajorShareholders(cik, entries) };
}
