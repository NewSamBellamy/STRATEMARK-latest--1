import { z } from 'zod';
import { metricVerificationDiffers, usableCitations, type CompanyMetric } from '@mi/contracts';
import type { OriginalSourceReceipt } from './original-source';

export const MAX_SEC_CONCEPT_TEXT = 32000;
const concept = 'RevenueFromContractWithCustomerExcludingAssessedTax';
const path = new RegExp(`^/api/xbrl/companyconcept/CIK(\\d{10})/us-gaap/${concept}\\.json$`);
export function secRevenueCik(raw: string): string | null {
  try {
    const url = new URL(raw);
    return url.protocol === 'https:' && url.hostname === 'data.sec.gov' && !url.username && !url.password &&
      !url.port && !url.search && !url.hash ? path.exec(url.pathname)?.[1] ?? null : null;
  } catch { return null; }
}

/** A cited filing is a locator, not identity proof. Payload entity/CIK must match. */
export function secRevenueSourceUrl(raw: string): string | null {
  try {
    if (secRevenueCik(raw)) return raw;
    const url = new URL(raw);
    if (url.protocol !== 'https:' || !['sec.gov', 'www.sec.gov'].includes(url.hostname) || url.port || url.username || url.password) return null;
    const cik = /^\/(?:Archives\/)?edgar\/data\/(\d{1,10})\//.exec(url.pathname)?.[1];
    return cik && Number(cik) > 0 ? `https://data.sec.gov/api/xbrl/companyconcept/CIK${cik.padStart(10, '0')}/us-gaap/${concept}.json` : null;
  } catch { return null; }
}

const recordSchema = z.object({
  start: z.string(), end: z.string(), val: z.number().nonnegative().safe(),
  accn: z.string().regex(/^\d{10}-\d{2}-\d{6}$/), form: z.enum(['10-K', '10-K/A']),
  filed: z.string(), fy: z.number().int().optional(), fp: z.literal('FY'), frame: z.string().max(20).optional(),
}).strict();
const documentSchema = z.object({ cik: z.number().int().positive(), entityName: z.string().min(1).max(256),
  taxonomy: z.literal('us-gaap'), tag: z.literal(concept), units: z.object({ USD: z.array(z.unknown()).max(2000) }) });
const name = (value: string) => value.normalize('NFKC').replace(/[.,]/g, '').replace(/\s+/g, ' ').trim().toLowerCase();
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
