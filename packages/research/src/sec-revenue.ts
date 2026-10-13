import { z } from 'zod';
import { metricVerificationDiffers, usableCitations, type CompanyMetric } from '@mi/contracts';
import type { OriginalSourceReceipt } from './original-source';
import { companyNameKey } from './market-quote';

export const MAX_SEC_CONCEPT_TEXT = 32000;
const concept = 'RevenueFromContractWithCustomerExcludingAssessedTax';
// Issuers that report total revenue outside the ASC 606 concept (banks), or moved
// back to it (NVIDIA after FY2022, Alphabet after Q1 2025), file it as Revenues.
const fallbackConcept = 'Revenues';
const path = new RegExp(`^/api/xbrl/companyconcept/CIK(\\d{10})/us-gaap/(?:${concept}|${fallbackConcept})\\.json$`);
const filingPath = /^\/(?:Archives\/)?edgar\/data\/(\d{1,10})\/.+$/;
export function secRevenueCik(raw: string): string | null {
  try {
    const url = new URL(raw);
    return url.protocol === 'https:' && url.hostname === 'data.sec.gov' && !url.username && !url.password &&
      !url.port && !url.search && !url.hash ? path.exec(url.pathname)?.[1] ?? null : null;
  } catch { return null; }
}

/** The issuer's annual-revenue concept, straight from a CIK the ticker map
 * resolved: a listed company's revenue never waits on a search citing it. */
export function secRevenueConceptUrl(cik: string): string {
  return `https://data.sec.gov/api/xbrl/companyconcept/CIK${cik.replace(/\D/g, '').padStart(10, '0')}/us-gaap/${concept}.json`;
}

/** Of one issuer's revenue observations (one per concept), the latest annual
 * period, and within it the largest figure: total revenue, never a sub-line. */
export function totalSecRevenue<T extends { value: number; passageSupport: { asOf: string } }>(observations: ReadonlyArray<T | null>): T | null {
  return observations.filter((o): o is T => o !== null)
    .sort((a, b) => b.passageSupport.asOf.localeCompare(a.passageSupport.asOf) || b.value - a.value)[0] ?? null;
}

/** A direct HTML filing that can carry disclosures outside XBRL concepts. */
export function secFilingCik(raw: string): string | null {
  try {
    const url = new URL(raw);
    if (url.protocol !== 'https:' || !['sec.gov', 'www.sec.gov'].includes(url.hostname) ||
      url.username || url.password || url.port || url.search || url.hash) return null;
    const cik = filingPath.exec(url.pathname)?.[1];
    return cik && Number(cik) > 0 ? cik.padStart(10, '0') : null;
  } catch { return null; }
}

/** A cited filing is a locator, not identity proof. Payload entity/CIK must match. */
export function secRevenueSourceUrl(raw: string): string | null {
  try {
    if (secRevenueCik(raw)) return raw;
    const url = new URL(raw);
    if (url.protocol !== 'https:' || !['sec.gov', 'www.sec.gov'].includes(url.hostname) || url.port || url.username || url.password) return null;
    const browseIds = /^\/edgar\/browse\/?$/.test(url.pathname) ? url.searchParams.getAll('CIK') : [];
    const browseCik = browseIds.length === 1 && /^\d{1,10}$/.test(browseIds[0]!) ? browseIds[0] : undefined;
    const cik = /^\/(?:Archives\/)?edgar\/data\/(\d{1,10})\//.exec(url.pathname)?.[1] ?? browseCik;
    return cik && Number(cik) > 0 ? `https://data.sec.gov/api/xbrl/companyconcept/CIK${cik.padStart(10, '0')}/us-gaap/${concept}.json` : null;
  } catch { return null; }
}

/** The Revenues concept for the same issuer, when this is the ASC 606 concept URL. */
export function secRevenueFallbackUrl(raw: string): string | null {
  return secRevenueCik(raw) && raw.endsWith(`/${concept}.json`) ? raw.replace(`/${concept}.json`, `/${fallbackConcept}.json`) : null;
}

/** Whether a concept document holds no annual or quarterly fact ending in the last ~15 months. */
export function secConceptIsStale(body: string, nowMs = Date.now()): boolean {
  try {
    const records = (JSON.parse(body) as { units?: { USD?: Array<{ end?: unknown }> } }).units?.USD ?? [];
    return !records.some(record => typeof record.end === 'string' && nowMs - Date.parse(record.end) <= 460 * 86400000);
  } catch { return true; }
}

/**
 * The concept document as retained: whole when it fits, else only the facts
 * ending in the last 11 years (the series reads ten), re-serialized so every
 * kept record is still quoted byte for byte from the retained text. Null when
 * even that does not fit.
 */
export function retainedSecConcept(body: string, nowMs = Date.now()): string | null {
  if (body.length <= MAX_SEC_CONCEPT_TEXT) return body;
  try {
    const doc = JSON.parse(body) as { units?: { USD?: Array<{ end?: unknown }> } };
    if (!Array.isArray(doc.units?.USD)) return null;
    doc.units.USD = doc.units.USD.filter(record => typeof record.end === 'string' && nowMs - Date.parse(record.end) <= 11 * 366 * 86400000);
    const text = JSON.stringify(doc);
    return text.length <= MAX_SEC_CONCEPT_TEXT ? text : null;
  } catch { return null; }
}

const recordSchema = z.object({
  start: z.string(), end: z.string(), val: z.number().nonnegative().safe(),
  accn: z.string().regex(/^\d{10}-\d{2}-\d{6}$/), form: z.enum(['10-K', '10-K/A']),
  filed: z.string(), fy: z.number().int().optional(), fp: z.literal('FY'), frame: z.string().max(20).optional(),
}).strict();
const documentSchema = z.object({ cik: z.number().int().positive(), entityName: z.string().min(1).max(256),
  taxonomy: z.literal('us-gaap'), tag: z.enum([concept, fallbackConcept]), units: z.object({ USD: z.array(z.unknown()).max(2000) }) });
// SEC files the legal name ("AEROVIRONMENT, INC."); the deck stores the brand
// ("AeroVironment"). Compare with legal suffixes stripped, exactly as the ticker
// lookup that found the CIK does; the CIK match still pins the issuer.
const name = companyNameKey;
const calendarDate = (value: string) => /^\d{4}-\d{2}-\d{2}$/.test(value) &&
  Number.isFinite(Date.parse(value)) && new Date(`${value}T00:00:00.000Z`).toISOString().slice(0, 10) === value;

/** Deterministic disclosed annual revenue, NOT ARR or independently audited truth.
 * Parse the retained complete original, never a search summary or model proposal. */
export function secRevenueObservation(companyName: string, originals: readonly OriginalSourceReceipt[], nowMs = Date.now()) {
  if (!Number.isFinite(nowMs) || !name(companyName)) return null;
  const candidates = originals.flatMap(source => {
    const cik = secRevenueCik(source.finalUrl ?? '');
    if (!cik || source.format !== 'sec-companyconcept' || source.status !== 'retrieved' || source.httpStatus !== 200 ||
      source.truncated || !/^[a-f0-9]{64}$/.test(source.contentHash ?? '') || !source.text || source.text.length > MAX_SEC_CONCEPT_TEXT ||
      !Number.isFinite(Date.parse(source.retrievedAt)) || Date.parse(source.retrievedAt) > nowMs) return [];
    let doc: z.infer<typeof documentSchema>;
    try { doc = documentSchema.parse(JSON.parse(source.text)); } catch { return []; }
    if (doc.cik !== Number(cik) || name(doc.entityName) !== name(companyName)) return [];
    const fragments = new Map<string, string>();
    for (const match of source.text.matchAll(/\{[^{}]*\}/g)) {
      if (match[0].length > 600) continue;
      try { fragments.set(JSON.stringify(JSON.parse(match[0])), match[0]); } catch { /* Not a flat fact record. */ }
    }
    return doc.units.USD.flatMap(raw => {
      const parsed = recordSchema.safeParse(raw);
      if (!parsed.success) return [];
      const fact = parsed.data;
      if (![fact.start, fact.end, fact.filed].every(calendarDate) || fact.filed < fact.end ||
        fact.filed > source.retrievedAt.slice(0, 10) || fact.filed > new Date(nowMs).toISOString().slice(0, 10) ||
        nowMs - Date.parse(fact.end) > 366 * 86400000 ||
        ![364, 365, 366, 371].includes((Date.parse(fact.end) - Date.parse(fact.start)) / 86400000 + 1)) return [];
      // The actual flat record bytes remain a literal quote, including its
      // reporting dates/accession. The full JSON supplies entity and currency.
      const quote = fragments.get(JSON.stringify(raw));
      if (!quote || quote.length > 600) return [];
      return [{ fact, quote, source, cik }];
    });
  }).sort((a, b) => b.fact.end.localeCompare(a.fact.end) || b.fact.filed.localeCompare(a.fact.filed));
  const latest = candidates[0];
  if (!latest || candidates.some(row => row.fact.end === latest.fact.end && row.fact.filed === latest.fact.filed &&
    (row.fact.start !== latest.fact.start || row.fact.val !== latest.fact.val || row.cik !== latest.cik))) return null;
  const passageSupport: NonNullable<CompanyMetric['passageSupport']> = {
    sourceUrl: latest.source.finalUrl!, quote: latest.quote, asOf: latest.fact.end, periodStart: latest.fact.start,
    basis: 'arr', unit: 'USD', definition: 'annual_revenue', format: 'sec-companyconcept',
  };
  const filing = `https://www.sec.gov/Archives/edgar/data/${Number(latest.cik)}/${latest.fact.accn.replaceAll('-', '')}/${latest.fact.accn}-index.htm`;
  return { value: latest.fact.val, passageSupport, citations: usableCitations([
    { title: `SEC filing-reported annual revenue (${latest.fact.start} to ${latest.fact.end}); not independently audited`, url: latest.source.finalUrl! },
    { title: `SEC filing ${latest.fact.accn}`, url: filing },
  ]) };
}

/**
 * A reported SEC headcount, not a model-derived estimate. The filing's inline
 * registrant name is retained independently from the selected text excerpt, so
 * a first-person disclosure ("we had … employees") cannot be attributed to a
 * different issuer.
 */
export function secFilingHeadcountObservation(companyName: string, originals: readonly OriginalSourceReceipt[], nowMs = Date.now()) {
  if (!Number.isFinite(nowMs) || !name(companyName)) return null;
  const candidates = originals.flatMap(source => {
    const cik = secFilingCik(source.finalUrl ?? '');
    if (!cik || source.format !== 'sec-filing' || source.status !== 'retrieved' || source.httpStatus !== 200 ||
      source.truncated || !/^[a-f0-9]{64}$/.test(source.contentHash ?? '') || !source.text || !source.issuerName ||
      source.text.length > 4000 || !Number.isFinite(Date.parse(source.retrievedAt)) || Date.parse(source.retrievedAt) > nowMs ||
      name(source.issuerName) !== name(companyName)) return [];
    const match = /As of ([A-Z][a-z]+ \d{1,2}, \d{4}), we (?:had|employed) (approximately )?([\d,]+) (?:full-time employees\.|people on a full-time basis(?=[,.]))/g.exec(source.text);
    if (!match) return [];
    const asOf = new Date(`${match[1]} UTC`);
    const value = Number(match[3]!.replaceAll(',', ''));
    if (!Number.isSafeInteger(value) || value < 1 || !Number.isFinite(asOf.getTime()) || asOf.getTime() > nowMs ||
      nowMs - asOf.getTime() > 366 * 86400000) return [];
    const iso = asOf.toISOString().slice(0, 10);
    return [{ value, asOf: iso, approximate: Boolean(match[2]), quote: match[0], source }];
  }).sort((a, b) => b.asOf.localeCompare(a.asOf));
  const latest = candidates[0];
  if (!latest || candidates.some(row => row.asOf === latest.asOf && row.value !== latest.value)) return null;
  const passageSupport: NonNullable<CompanyMetric['passageSupport']> = {
    sourceUrl: latest.source.finalUrl!, quote: latest.quote, asOf: latest.asOf,
    basis: 'employees', unit: 'count', definition: 'employees', format: 'sec-filing',
  };
  return { value: latest.value, passageSupport, citations: usableCitations([
    { title: `SEC filing-reported ${latest.approximate ? 'approximate ' : ''}full-time employees (${latest.asOf})`, url: latest.source.finalUrl! },
  ]), methodNote: `Company-reported ${latest.approximate ? 'approximate ' : ''}full-time employees as of ${latest.asOf}.` };
}

/**
 * Multi-year annual-revenue series derived from the SAME retained SEC
 * companyconcept receipts the single verification uses - never invented. Every
 * point is a quoted, entity-matched, calendar-bounded annual fact; periods keep
 * the latest filed revision. Returns null below two points (a lone point is the
 * existing single verification's job, not a trend).
 */
export function secRevenueSeries(companyName: string, originals: readonly OriginalSourceReceipt[], nowMs = Date.now()):
  Array<{ period: string; value: number; asOf: string }> | null {
  // History window: a decade of annual periods is the chart's honest span.
  return reportedPeriodSeries(companyName, originals, nowMs, recordSchema, [364, 365, 366, 371], 10 * 366);
}

// A 10-Q's own quarter, or a 10-K that states a three-month period outright.
const quarterRecordSchema = recordSchema.extend({
  form: z.enum(['10-Q', '10-Q/A', '10-K', '10-K/A']), fp: z.enum(['Q1', 'Q2', 'Q3', 'Q4', 'FY']),
}).strict();
// Calendar quarters and 13- or 14-week fiscal quarters (52/53-week years).
const QUARTER_DAYS = Array.from({ length: 15 }, (_, i) => 84 + i);

/**
 * Three-month revenue periods exactly as filed, for the last three years.
 * A fourth quarter is usually reported only inside the annual total; it is
 * then absent here, never derived as annual minus nine months.
 */
export function secQuarterlyRevenueSeries(companyName: string, originals: readonly OriginalSourceReceipt[], nowMs = Date.now()):
  Array<{ period: string; value: number; asOf: string }> | null {
  return reportedPeriodSeries(companyName, originals, nowMs, quarterRecordSchema, QUARTER_DAYS, 3 * 366);
}

/** Entity-matched, quoted, calendar-bounded facts of one period length; each period keeps its latest filed revision. */
function reportedPeriodSeries(companyName: string, originals: readonly OriginalSourceReceipt[], nowMs: number,
  schema: z.ZodType<{ start: string; end: string; val: number; filed: string }, z.ZodTypeDef, unknown>, periodDays: readonly number[], windowDays: number):
  Array<{ period: string; value: number; asOf: string }> | null {
  if (!Number.isFinite(nowMs) || !name(companyName)) return null;
  const byPeriod = new Map<string, { period: string; value: number; asOf: string; filed: string }>();
  for (const source of originals) {
    const cik = secRevenueCik(source.finalUrl ?? '');
    if (!cik || source.format !== 'sec-companyconcept' || source.status !== 'retrieved' || source.httpStatus !== 200 ||
      source.truncated || !/^[a-f0-9]{64}$/.test(source.contentHash ?? '') || !source.text || source.text.length > MAX_SEC_CONCEPT_TEXT ||
      !Number.isFinite(Date.parse(source.retrievedAt)) || Date.parse(source.retrievedAt) > nowMs) continue;
    let doc: z.infer<typeof documentSchema>;
    try { doc = documentSchema.parse(JSON.parse(source.text)); } catch { continue; }
    if (doc.cik !== Number(cik) || name(doc.entityName) !== name(companyName)) continue;
    const fragments = new Map<string, string>();
    for (const match of source.text.matchAll(/\{[^{}]*\}/g)) {
      if (match[0].length > 600) continue;
      try { fragments.set(JSON.stringify(JSON.parse(match[0])), match[0]); } catch { /* Not a flat fact record. */ }
    }
    for (const raw of doc.units.USD) {
      const parsed = schema.safeParse(raw);
      if (!parsed.success) continue;
      const fact = parsed.data;
      if (![fact.start, fact.end, fact.filed].every(calendarDate) || fact.filed < fact.end ||
        fact.filed > source.retrievedAt.slice(0, 10) || fact.filed > new Date(nowMs).toISOString().slice(0, 10) ||
        nowMs - Date.parse(fact.end) > windowDays * 86400000 ||
        !periodDays.includes((Date.parse(fact.end) - Date.parse(fact.start)) / 86400000 + 1)) continue;
      const quote = fragments.get(JSON.stringify(raw));
      if (!quote || quote.length > 600) continue;
      const existing = byPeriod.get(fact.end);
      if (!existing || fact.filed > existing.filed) {
        byPeriod.set(fact.end, { period: fact.end, value: fact.val, asOf: fact.end, filed: fact.filed });
      }
    }
  }
  if (byPeriod.size < 2) return null;
  // A series is only honest if every point came from the same issuer identity.
  return [...byPeriod.values()]
    .sort((a, b) => a.period.localeCompare(b.period))
    .map(({ period, value, asOf }) => ({ period, value, asOf }));
}

/** Keep large financial originals on disk, not in every model context. This
 * labelled parsed observation is a summary; its retained record is revalidated. */
export function originalSourcePromptViews(originals: readonly OriginalSourceReceipt[], companyName: string) {
  return originals.map(source => source.format === 'sec-companyconcept'
    ? { ...source, text: undefined, parsedFinancialObservation: secRevenueObservation(companyName, [source]) }
    : source);
}

/** A revenue observation cannot refute a known ARR: refresh like-for-like only. */
export function secRevenueVerification(companyName: string, metric: Pick<CompanyMetric, 'metricType' | 'value' | 'passageSupport'>,
  originals: readonly OriginalSourceReceipt[], nowMs = Date.now()) {
  if (metric.metricType !== 'arr' || metric.value !== null && metric.passageSupport?.definition !== 'annual_revenue') return null;
  const observation = secRevenueObservation(companyName, originals, nowMs);
  return observation ? {
    currentValue: observation.value, passageSupport: observation.passageSupport,
    verdict: metricVerificationDiffers(metric.value, observation.value) ? 'contradicted' as const : 'supported' as const,
    methodNote: 'Annual revenue reported in SEC XBRL; not ARR or independent audit.',
    rationale: 'Matched retained SEC issuer, annual revenue concept and reporting interval; no model-derived numeric interpretation.',
  } : null;
}
