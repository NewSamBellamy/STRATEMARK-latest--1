/**
 * Source binding: a reported figure must be stated by the page it cites.
 *
 * Grounded figures arrive attributed to search chunks whose URLs are
 * vertexaisearch.cloud.google.com redirects: opaque, expiring, and impossible
 * for a reader (or an auditor) to check. A background pass reads each cited
 * page through the original-source reader (which follows the redirect under the
 * usual network-safety policy) and records, per figure and source, the real
 * publisher URL and whether the figure is on the page. The single facts
 * projection then applies the ledger:
 *   - stated on a cited page  -> the citation becomes that real publisher URL;
 *   - every cited page read and none states it -> the figure is not shown;
 *   - not checked yet         -> unchanged (shown as before, link via search).
 *
 * Measured live (2026-10-12, 5 frontier labs): 6 of 6 reported figures were
 * on a cited page once the redirect was followed, so binding mostly upgrades
 * links rather than removing figures. A page that states the figure is still
 * corroboration, not verification: rows stay `estimated`.
 */
import type { Citation, CompanyMetric } from '@mi/contracts';
import type { OriginalSourceReceipt } from './original-source';

export interface SourceCheck {
  /** Where the cited link actually led; null when the page could not be read. */
  finalUrl: string | null;
  /** The figure (and the company) appear on the page. */
  found: boolean;
  /** The page could be read at all. Unread pages are retried later, never counted as "not stated". */
  read: boolean;
  checkedAt: string;
}
export type SourceChecks = Record<string, SourceCheck>;

export function sourceCheckKey(companyId: string, metricType: string, values: readonly number[], url: string): string {
  return `${companyId}|${metricType}|${values.join('/')}|${url}`;
}

/** The figure as the source states it (native currency), and what it cites. */
export function reportedCitedSources(metric: CompanyMetric): { values: number[]; sources: Citation[] } | null {
  if (metric.confidence !== 'estimated') return null;
  if (metric.reportedBand) {
    return { values: [metric.reportedBand.low, metric.reportedBand.high],
      sources: metric.reportedBand.support.sources.map((s) => ({ url: s.url, title: s.title })) };
  }
  const proof = metric.reportedSupport;
  if (!proof || metric.value == null) return null;
  return { values: [proof.value ?? metric.value], sources: proof.support.sources.map((s) => ({ url: s.url, title: s.title })) };
}

const SCALE: Record<string, number> = { trillion: 1e12, billion: 1e9, million: 1e6, thousand: 1e3, tn: 1e12, bn: 1e9, b: 1e9, mn: 1e6, m: 1e6, k: 1e3 };

function amountsIn(text: string): number[] {
  return [...text.matchAll(/(\d[\d,]*(?:\.\d+)?)\s*(trillion|billion|million|thousand|tn|bn|mn|[bmk])?\b/gi)]
    // A bare year ("in 2025") is a date, not a headcount of 2,025.
    .filter((m) => m[2] || !/^(?:19|20)\d{2}$/.test(m[1]!))
    .map((m) => Number(m[1]!.replaceAll(',', '')) * (SCALE[m[2]?.toLowerCase() ?? ''] ?? 1));
}

const escapeRe = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * The names a page may use for the company: "Anthropic, PBC" -> anthropic;
 * "Moonshot AI" -> moonshot (a generic trailing word is not the brand);
 * "Safe Superintelligence (SSI)" -> safe superintelligence, ssi.
 */
export function brandTokens(companyName: string): string[] {
  const alias = /\(([^)]{2,30})\)/.exec(companyName)?.[1]?.trim();
  const first = companyName.split(/\s*[,(/]\s*/)[0]!.trim()
    .replace(/\s+(?:inc\.?|incorporated|llc|ltd\.?|limited|pbc|corp\.?|corporation|co\.|plc|gmbh|ag|s\.a\.)$/i, '');
  const words = first.split(/\s+/);
  const brand = words.length > 1 && /^(?:ai|labs?|technologies|technology|group|holdings)$/i.test(words.at(-1)!) ? words.slice(0, -1).join(' ') : first;
  // Articles shorten multi-word names ("Lyre's Spirit Co." -> "Lyre's"); a
  // distinctive first word counts, a generic one ("Safe", "Global") does not.
  const lead = words.length > 1 && words[0]!.length >= 4 && !GENERIC_LEAD.test(words[0]!) ? words[0] : undefined;
  return [...new Set([brand, alias, lead].filter((t): t is string => Boolean(t && t.length >= 2)).map((t) => t.toLowerCase()))];
}

const GENERIC_LEAD = /^(?:safe|global|general|united|first|national|international|american|digital|open|data|cloud|smart|the|new|blue|green|red|black|white|advanced|applied|future|next)$/i;

/**
 * The page names the company and states every value (a band needs both ends),
 * allowing for display rounding ("$4.6 billion" for 4,620,000,000).
 */
export function figureOnPage(companyName: string, values: readonly number[], text: string): boolean {
  // Whole words only: the alias "ssi" must not match "classic".
  if (!brandTokens(companyName).some((token) =>
    new RegExp(`(?<![\\p{L}\\p{N}])${escapeRe(token)}(?![\\p{L}\\p{N}])`, 'iu').test(text))) return false;
  const found = amountsIn(text);
  return values.length > 0 && values.every((value) =>
    found.some((amount) => Math.abs(amount - value) <= Math.max(1, Math.abs(value)) * 0.01));
}

/** Record one cited page read for one figure. */
export function checkFromReceipt(companyName: string, values: readonly number[], receipt: OriginalSourceReceipt, now = new Date()): SourceCheck {
  const read = receipt.status === 'retrieved' && Boolean(receipt.text);
  return {
    finalUrl: read ? (receipt.finalUrl ?? receipt.requestedUrl) : null,
    found: read && figureOnPage(companyName, values, receipt.text!),
    read,
    checkedAt: now.toISOString(),
  };
}

function hostOf(url: string): string {
  try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return url; }
}

/** Apply the ledger to projected facts (see the module comment for the three outcomes). */
export function applySourceChecks(companyId: string, rows: readonly CompanyMetric[], checks: SourceChecks | undefined): CompanyMetric[] {
  if (!checks) return [...rows];
  return rows.map((row) => {
    const cited = reportedCitedSources(row);
    if (!cited || cited.sources.length === 0) return row;
    const results = cited.sources.map((s) => checks[sourceCheckKey(companyId, row.metricType, cited.values, s.url)]);
    const stated = results.filter((r): r is SourceCheck => Boolean(r?.found && r.finalUrl));
    if (stated.length) {
      const urls = [...new Set(stated.map((r) => r.finalUrl!))];
      const citations = urls.map((url) => ({ url, title: hostOf(url) }));
      return { ...row, citations, source: citations[0]!.url };
    }
    // Hidden only when every cited page was actually read and none states it;
    // an unreadable page proves nothing either way.
    if (results.every((r) => r?.read)) {
      return { ...row, value: null, confidence: 'unknown', citations: [], source: null, reportedSupport: null, reportedBand: null,
        lastVerifiedAt: null, methodNote: 'The page this figure was attributed to does not state it, so it is not shown.' };
    }
    return row;
  });
}

/** An unreadable page (blocked, timed out) is retried after this long, not on every pass. */
export const UNREAD_RETRY_MS = 6 * 60 * 60 * 1000;

/** Cited sources of these facts that still need a page read, de-duplicated, at most `limit`. */
export function uncheckedSources(companyId: string, rows: readonly CompanyMetric[], checks: SourceChecks | undefined, limit: number,
  nowMs = Date.now()): Array<{ key: string; url: string; values: number[]; metricType: string }> {
  const out: Array<{ key: string; url: string; values: number[]; metricType: string }> = [];
  for (const row of rows) {
    const cited = reportedCitedSources(row);
    if (!cited) continue;
    for (const s of cited.sources) {
      const key = sourceCheckKey(companyId, row.metricType, cited.values, s.url);
      const prior = checks?.[key];
      if (prior && (prior.read || nowMs - Date.parse(prior.checkedAt) < UNREAD_RETRY_MS)) continue;
      if (out.some((o) => o.key === key)) continue;
      out.push({ key, url: s.url, values: cited.values, metricType: row.metricType });
      if (out.length >= limit) return out;
    }
  }
  return out;
}
