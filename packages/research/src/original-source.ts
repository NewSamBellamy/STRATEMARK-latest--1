import { classifySource, isRedirectCitation, usableCitations, currentMetricRevision, metricPassageSupportSchema, METRIC_TYPES, type CompanyMetric, type Citation } from '@mi/contracts';
import { MAX_SEC_CONCEPT_TEXT, secFilingCik, secRevenueSourceUrl, secRevenueCik } from './sec-revenue';

/** Discovery hints only. Never trust a title, fabricate a URL or accept a fact
 * because a page looks like a financial document. Original gates still apply. */
function companyDocumentPriority(raw: string, officialWebsite?: string | null): number {
  if (secRevenueCik(raw)) return 4;
  // Preserve the underlying filing after adding its structured XBRL sibling.
  // It carries disclosures such as employee count that company-concept JSON
  // intentionally does not expose.
  if (secRevenueSourceUrl(raw)) return 3;
  if (!officialWebsite) return 0;
  try {
    const source = new URL(raw);
    const host = new URL(officialWebsite).hostname.toLowerCase().replace(/^www\./, '');
    const sourceHost = source.hostname.toLowerCase().replace(/^www\./, '');
    if (sourceHost !== host && !sourceHost.endsWith(`.${host}`)) return 0;
    // A disclosure is more useful than an investor navigation hub. Match only
    // a discovered official URL; this is routing, never evidence acceptance.
    if (/\/(?:reports?\/|annual-reports?(?:[/.-]|$)|earnings\/|financial-results?\/)/i.test(source.pathname)) return 3;
    if (/^(?:investor|investors|ir)\./i.test(sourceHost) ||
      /\/(?:investor(?:s|-relations)?|annual-report(?:s)?|financial(?:s|-results)?|earnings)(?:[/.-]|$)/i.test(source.pathname)) return 2;
    if (/\/(?:about(?:-us)?|company(?:-profile)?|corporate)(?:[/.-]|$)/i.test(source.pathname)) return 1;
  } catch { /* Invalid official identity cannot receive priority. */ }
  return 0;
}

/** Routing priority only, never evidence acceptance. Preserve the two-read budget. */
export function selectOriginalSourceCitations(citations: readonly Citation[], officialWebsite?: string | null, preferAnnualRevenue = false,
  supportsUrl?: (url: string) => boolean, discoveryText = '', maxSources = 2): Citation[] {
  const priority = { primary: 4, reputable_secondary: 3, industry: 2, unknown: 1, user_generated: 0 };
  const pages = new Set<string>();
  // Grounding metadata can expose only opaque redirect URLs even when the
  // search notes contain a discovered original. Explicit locator lines are
  // untrusted fetch candidates, NEVER citations or evidence for a model claim.
  // Keep this bounded and limited to primary hosts; readers still enforce
  // public DNS, HTTPS, size/time limits and claim-by-claim evidence checks.
  const locators: Citation[] = [];
  for (const match of discoveryText.slice(0, 40000).matchAll(/^Original source:[ \t]*(https:\/\/\S+)[ \t]*$/gim)) {
    const url = match[1]!;
    if (url.length > 2048 || isRedirectCitation(url)) continue;
    if (!['primary', 'reputable_secondary', 'industry'].includes(classifySource(url, '', officialWebsite))) continue;
    locators.push({ url, title: 'Discovered original locator (not verified)' });
    if (locators.length === 20) break;
  }
  // Both original readers require public HTTPS on the standard TLS port.
  // Do not promote HTTP to HTTPS: that would invent a different source URL.
  // A filing lead has two separate, useful jobs: its deterministic XBRL
  // counterpart can establish annual revenue, while the filed document can
  // establish disclosures XBRL does not carry (for example headcount). Keep
  // both candidates inside the existing two-read budget. Replacing the filing
  // outright made one public-company source incapable of ever filling both.
  const routed = [...citations, ...locators].flatMap(citation => {
    const financial = preferAnnualRevenue ? secRevenueSourceUrl(citation.url) : null;
    // A browse page identifies an issuer but has no disclosure body. Do not
    // spend a second source slot on its menus after routing to actual records.
    return financial ? [{ ...citation, url: financial }, ...(secFilingCik(citation.url) ? [citation] : [])] : [citation];
  });
  return usableCitations(routed).filter(citation => {
    const url = new URL(citation.url);
    if (url.protocol !== 'https:' || (url.port && url.port !== '443')) return false;
    if (supportsUrl && !supportsUrl(citation.url)) return false;
    // Readers strip fragments. URL also normalizes an explicit :443, but query
    // parameters remain part of identity because they may select another report.
    url.hash = '';
    if (pages.has(url.href)) return false;
    pages.add(url.href);
    return true;
  }).map((citation, index) => ({
    citation, index,
    // A direct SEC filing is a primary regulator document even though the
    // generic host classifier is intentionally conservative. This only
    // affects the annual-revenue routing mode, where the filing and its XBRL
    // counterpart must be considered as a pair.
    priority: preferAnnualRevenue && secRevenueSourceUrl(citation.url)
      ? priority.primary : priority[classifySource(citation.url, citation.title, officialWebsite)],
    documentPriority: preferAnnualRevenue ? companyDocumentPriority(citation.url, officialWebsite) : 0,
    redirect: Number(isRedirectCitation(citation.url)),
  })).sort((a, b) => b.priority - a.priority || b.documentPriority - a.documentPriority || a.redirect - b.redirect || a.index - b.index)
    .slice(0, Math.max(1, Math.min(4, maxSources))).map(row => row.citation);
}

/** Original page extract; retrieval alone never establishes claim accuracy. */
export interface OriginalSourceScope {
  companyId: string;
  companyName: string;
  metricType?: string;
  /** Explicit user refresh bypasses completed reuse, not an active read. */
  forceRefresh?: boolean;
}

export interface OriginalSourceReceipt {
  requestedUrl: string;
  finalUrl?: string;
  status: 'retrieved' | 'blocked' | 'unavailable';
  retrievedAt: string;
  httpStatus?: number;
  contentHash?: string;
  text?: string;
  /** Issuer identity extracted directly from an SEC inline-XBRL filing. */
  issuerName?: string;
  truncated?: boolean;
  reason?: string;
  format?: 'sec-companyconcept' | 'sec-filing';
}

export interface OriginalSourceAttempt {
  id: string;
  companyId: string;
  metricType: string;
  capturedAt: string;
  receipts: OriginalSourceReceipt[];
}

/** Storage shape/size validation only; never proof of a document's authenticity. */
export function isOriginalSourceAttempt(value: unknown): value is OriginalSourceAttempt {
  if (!value || typeof value !== 'object') return false;
  const row = value as Partial<OriginalSourceAttempt>;
  const bounded = (text: unknown, max: number) => typeof text === 'string' && text.length > 0 && text.length <= max;
  const date = (text: unknown) => bounded(text, 40) && Number.isFinite(Date.parse(text as string));
  return bounded(row.id, 200) && bounded(row.companyId, 200) && bounded(row.metricType, 80) && date(row.capturedAt) &&
    Array.isArray(row.receipts) && row.receipts.length <= 2 && row.receipts.every(receipt => {
      if (!receipt || typeof receipt !== 'object' || !bounded(receipt.requestedUrl, 2048) || !date(receipt.retrievedAt) ||
        !['retrieved', 'blocked', 'unavailable'].includes(receipt.status) ||
        (receipt.finalUrl !== undefined && !bounded(receipt.finalUrl, 2048)) ||
        (receipt.reason !== undefined && !bounded(receipt.reason, 1000)) ||
        (receipt.truncated !== undefined && typeof receipt.truncated !== 'boolean') ||
        (receipt.httpStatus !== undefined && (!Number.isInteger(receipt.httpStatus) || receipt.httpStatus < 100 || receipt.httpStatus > 599))) return false;
      return receipt.status === 'retrieved'
        ? receipt.httpStatus === 200 && bounded(receipt.finalUrl, 2048) && /^[a-f0-9]{64}$/.test(receipt.contentHash ?? '') &&
          (receipt.format === undefined ? bounded(receipt.text, 4000)
            : receipt.format === 'sec-companyconcept'
              ? Boolean(secRevenueCik(receipt.finalUrl!)) && receipt.truncated !== true && bounded(receipt.text, MAX_SEC_CONCEPT_TEXT)
              : receipt.format === 'sec-filing'
                ? Boolean(secFilingCik(receipt.finalUrl!)) && bounded(receipt.issuerName, 256) && receipt.truncated !== true && bounded(receipt.text, 4000)
                : false)
        : receipt.text === undefined && receipt.contentHash === undefined;
    });
}

/** Native host supplies durable storage and network; renderer gets neither. */
export interface OriginalSourceQuery {
  companyId: string;
  metricType?: string;
  limit?: number;
  support?: Array<{ sourceUrl: string; quote: string }>;
}
export const normalizeSourceText = (text: string) => text.normalize('NFKC').replace(/\s+/g, ' ').trim();
export function originalSupportReferences(metrics: readonly CompanyMetric[], companyId: string) {
  return METRIC_TYPES.flatMap(type => {
    const revision = currentMetricRevision(metrics, companyId, type);
    const parsed = metricPassageSupportSchema.safeParse(revision?.metric.passageSupport);
    return !revision?.ambiguous && parsed.success && usableCitations([{ url: parsed.data.sourceUrl, title: '' }]).length
      ? [{ sourceUrl: parsed.data.sourceUrl, quote: parsed.data.quote }] : [];
  });
}
export function validatedOriginalSupport(support: OriginalSourceQuery['support'] = []) {
  if (!Array.isArray(support) || support.length > 12 || support.some(ref => !ref || typeof ref.sourceUrl !== 'string' ||
    ref.sourceUrl.length > 2048 || typeof ref.quote !== 'string' || !ref.quote.trim() || ref.quote.length > 600 ||
    !usableCitations([{ url: ref.sourceUrl, title: '' }]).length)) throw new Error('Invalid original support references.');
  return support;
}
/** Recent diagnostics plus exact referenced originals. References only locate
 * evidence; the existing claim gate must still accept it. No unbounded history. */
export function selectOriginalSourceAttempts(attempts: readonly OriginalSourceAttempt[], input: OriginalSourceQuery) {
  const refs = validatedOriginalSupport(input.support);
  const limit = Number.isFinite(input.limit) ? Math.max(1, Math.min(100, Math.floor(input.limit!))) : 20;
  // Diagnostics include legacy incomplete receipts. Do not silently discard
  // them here; the facts adapter independently validates publication evidence.
  const scoped = attempts.filter(row => row && typeof row.id === 'string' && typeof row.capturedAt === 'string' &&
    Array.isArray(row.receipts) && row.companyId === input.companyId && (!input.metricType || row.metricType === input.metricType))
    .sort((a, b) => b.capturedAt.localeCompare(a.capturedAt) || b.id.localeCompare(a.id));
  const selected = scoped.slice(0, limit);
  for (const ref of refs) {
    const hit = scoped.find(row => row.receipts.some(receipt => receipt && receipt.status === 'retrieved' &&
      (receipt.finalUrl === ref.sourceUrl || receipt.requestedUrl === ref.sourceUrl) &&
      typeof receipt.text === 'string' && normalizeSourceText(receipt.text).includes(normalizeSourceText(ref.quote))));
    if (hit && !selected.some(row => row.id === hit.id)) selected.push(hit);
  }
  return structuredClone(selected);
}
export interface OriginalSourceServices {
  /** Optional transport capability. Absent means the adapter applies its own checks at read time. */
  supports?(url: string): boolean;
  retrieve(url: string, scope?: OriginalSourceScope): Promise<OriginalSourceReceipt>;
  save(attempt: OriginalSourceAttempt): Promise<void>;
  list(input: OriginalSourceQuery): Promise<OriginalSourceAttempt[]>;
}

/** Public-page receipts only. Short reuse never changes their retrieval date. */
export function coalesceOriginalSources(read: (url: string, scope?: OriginalSourceScope) => Promise<OriginalSourceReceipt>, now = Date.now): (url: string, scope?: OriginalSourceScope) => Promise<OriginalSourceReceipt> {
  const cache = new Map<string, { receipt: OriginalSourceReceipt; expires: number }>();
  const pending = new Map<string, Promise<OriginalSourceReceipt>>();
  return async (url, scope) => {
    scope = scope ? { ...scope } : undefined;
    const key = JSON.stringify([url, scope?.companyId ?? null, scope?.companyName ?? null, scope?.metricType ?? null]);
    const hit = cache.get(key);
    if (hit && hit.expires > now() && !scope?.forceRefresh) return { ...hit.receipt };
    cache.delete(key);
    let work = pending.get(key);
    if (!work) {
      if (pending.size >= 32) return { ...await read(url, scope) };
      work = Promise.resolve().then(() => read(url, scope)).then((receipt) => {
        if (receipt.status === 'retrieved') {
          cache.set(key, { receipt: { ...receipt }, expires: now() + 30000 });
          if (cache.size > 32) cache.delete(cache.keys().next().value!);
        }
        return { ...receipt };
      }).finally(() => pending.delete(key));
      pending.set(key, work);
    }
    return { ...await work };
  };
}
