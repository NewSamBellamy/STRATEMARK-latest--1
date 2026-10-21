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
import { amountMatches, sameAmount } from './amounts';

export interface SourceCheck {
  /** Where the cited link actually led; null when the page could not be read. */
  finalUrl: string | null;
  /** The figure (and the company) appear on the page. */
  found: boolean;
  /** The page could be read at all. Unread pages are retried later, never counted as "not stated". */
  read: boolean;
  checkedAt: string;
  /** The page's own date (YYYY-MM-DD): an upper bound on the figure's age, never a figure date. */
  publishedAt?: string;
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

const brandIn = (companyName: string, text: string) => brandTokens(companyName).some((token) =>
  // Whole words only: the alias "ssi" must not match "classic".
  new RegExp(`(?<![\\p{L}\\p{N}])${escapeRe(token)}(?![\\p{L}\\p{N}])`, 'iu').test(text));

/** What a figure of each kind is stated next to ("valued at", "employs", "raised"). */
const BASIS_NEAR: Record<string, RegExp> = {
  valuation: /valu|worth|post-money|pre-money/i,
  market_cap: /market cap|capitali[sz]ation/i,
  arr: /revenue|sales|\bARR\b|recurring|annuali[sz]ed|run[- ]rate/i,
  revenue: /revenue|sales|\bARR\b|recurring|annuali[sz]ed|run[- ]rate/i,
  employees: /employ|staff|headcount|workforce|people|team members/i,
  users: /users|customers|subscribers|members|accounts/i,
  funding_total: /rais|funding|round|financing|invest|series|capital/i,
  last_round: /rais|funding|round|financing|invest|series|capital/i,
  aum: /assets under|\bAUM\b|manage/i,
  market_share: /share|market/i,
  distribution: /stores|retail|doors|locations|countries|stockists|outlets|markets/i,
};

/** The amount sits beside the company's name and the words that say what it measures. */
function statedNearby(companyName: string, metricType: string, text: string, index: number): boolean {
  const cue = BASIS_NEAR[metricType];
  return brandIn(companyName, text.slice(Math.max(0, index - 300), index + 300)) &&
    (!cue || cue.test(text.slice(Math.max(0, index - 160), index + 120)));
}

/**
 * The page names the company and states every value (a band needs both ends),
 * allowing for display rounding ("$4.6 billion" for 4,620,000,000). With
 * `strictFor` (a metric type) each amount must also sit beside the company's
 * name and the words for that measurement: the bar for a page the figure was
 * NOT attributed to, where a coincidental number must not count.
 */
export function figureOnPage(companyName: string, values: readonly number[], text: string, strictFor?: string): boolean {
  if (!brandIn(companyName, text)) return false;
  const found = amountMatches(text);
  return values.length > 0 && values.every((value) => found.some((m) => sameAmount(m.value, value) &&
    (strictFor === undefined || statedNearby(companyName, strictFor, text, m.index))));
}

/** Record one page read for one figure. */
export function checkFromReceipt(companyName: string, values: readonly number[], receipt: OriginalSourceReceipt, now = new Date(),
  strictFor?: string): SourceCheck {
  const read = receipt.status === 'retrieved' && Boolean(receipt.text);
  return {
    finalUrl: read ? (receipt.finalUrl ?? receipt.requestedUrl) : null,
    found: read && figureOnPage(companyName, values, receipt.text!, strictFor),
    read,
    checkedAt: now.toISOString(),
    ...(read && receipt.publishedAt ? { publishedAt: receipt.publishedAt } : {}),
  };
}

function hostOf(url: string): string {
  try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return url; }
}

/** The ledger rows kept for one figure, whichever page they were read from. */
const figurePrefix = (companyId: string, metricType: string, values: readonly number[]) => `${companyId}|${metricType}|${values.join('/')}|`;

/**
 * Apply the ledger to projected facts (see the module comment for the three
 * outcomes). A page the figure was not attributed to (see alternateSources)
 * counts when it states the figure: the citation moves to the page that does.
 */
export function applySourceChecks(companyId: string, rows: readonly CompanyMetric[], checks: SourceChecks | undefined): CompanyMetric[] {
  if (!checks) return [...rows];
  const mine = Object.entries(checks).filter(([key]) => key.startsWith(`${companyId}|`));
  return rows.map((row) => {
    const cited = reportedCitedSources(row);
    if (!cited || cited.sources.length === 0) return row;
    const results = cited.sources.map((s) => checks[sourceCheckKey(companyId, row.metricType, cited.values, s.url)]);
    const prefix = figurePrefix(companyId, row.metricType, cited.values);
    const stated = mine.filter(([key, r]) => key.startsWith(prefix) && r.found && r.finalUrl).map(([, r]) => r);
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

/** Most pages tried for one figure beyond the ones its own citation named. */
export const ALTERNATES_PER_FIGURE = 6;

/**
 * Search grounding often hangs a figure on the wrong chunk (a Wikipedia page
 * for a valuation a news article reported). When every page a figure cited was
 * read and none states it, the other pages the same research returned are
 * tried, a few at a time, against the stricter bar in figureOnPage: a page
 * that does state it becomes the figure's source; if none does it stays hidden.
 */
export function alternateSources(companyId: string, rows: readonly CompanyMetric[], checks: SourceChecks | undefined,
  pool: readonly Citation[], limit: number, nowMs = Date.now()): Array<{ key: string; url: string; values: number[]; metricType: string }> {
  const out: Array<{ key: string; url: string; values: number[]; metricType: string }> = [];
  for (const row of rows) {
    const cited = reportedCitedSources(row);
    if (!cited || cited.sources.length === 0) continue;
    const own = cited.sources.map((s) => checks?.[sourceCheckKey(companyId, row.metricType, cited.values, s.url)]);
    if (!own.every((r) => r?.read)) continue;
    const prefix = figurePrefix(companyId, row.metricType, cited.values);
    const ledger = Object.entries(checks ?? {}).filter(([key]) => key.startsWith(prefix));
    if (ledger.some(([, r]) => r.found)) continue;
    let tried = ledger.length - own.length;
    const citedUrls = new Set(cited.sources.map((s) => s.url));
    for (const c of pool) {
      if (tried >= ALTERNATES_PER_FIGURE || out.length >= limit) break;
      if (citedUrls.has(c.url)) continue;
      const key = sourceCheckKey(companyId, row.metricType, cited.values, c.url);
      const prior = checks?.[key];
      if (prior && (prior.read || nowMs - Date.parse(prior.checkedAt) < UNREAD_RETRY_MS)) continue;
      if (out.some((o) => o.key === key)) continue;
      out.push({ key, url: c.url, values: cited.values, metricType: row.metricType });
      tried += 1;
    }
    if (out.length >= limit) break;
  }
  return out;
}
