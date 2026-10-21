/**
 * Pure helpers behind the Overview and Metrics tabs.
 *
 * Nothing here invents, imputes or zero-fills. A peer with no known figure is
 * EXCLUDED from a ranking (never ranked last); a metric with no evidence stays
 * a gap and carries a hint about what would fill it.
 */
import {
  comparableMetricBasis,
  figureAsOf,
  type CompanyMetric,
  type MetricType,
} from '@mi/contracts';

export type MetricFamily = 'financials' | 'value_funding' | 'reach_scale';

export const FAMILY_LABELS: Record<MetricFamily, string> = {
  financials: 'Financials',
  value_funding: 'Value & funding',
  reach_scale: 'Reach & scale',
};

export const METRIC_FAMILY: Record<MetricType, MetricFamily> = {
  arr: 'financials',
  revenue: 'financials',
  aum: 'financials',
  valuation: 'value_funding',
  market_cap: 'value_funding',
  funding_total: 'value_funding',
  last_round: 'value_funding',
  market_share: 'reach_scale',
  users: 'reach_scale',
  employees: 'reach_scale',
  distribution: 'reach_scale',
};

/** Display order for tables and tiles. */
export const METRIC_ORDER: MetricType[] = [
  'valuation', 'market_cap', 'revenue', 'arr', 'aum', 'funding_total', 'last_round',
  'market_share', 'users', 'employees', 'distribution',
];

/** KPI tile priority: what an analyst reaches for first. */
const KPI_PRIORITY: MetricType[] = [
  'valuation', 'market_cap', 'revenue', 'arr', 'aum', 'funding_total', 'users', 'employees', 'market_share', 'last_round', 'distribution',
];

/** "What would fill this" — stated per metric, never a guess at the value. */
export const FILL_HINT: Record<MetricType, string> = {
  valuation: 'A priced funding round, tender offer or acquisition announcement.',
  market_cap: 'A public listing: exchange quote and share count from a filing.',
  market_share: 'An analyst or industry report sizing the market and this company’s part of it.',
  arr: 'A company or investor statement of recurring revenue.',
  aum: 'A regulatory filing (e.g. Form ADV) or the firm’s own AUM disclosure.',
  users: 'A company-reported customer or user count with a date.',
  employees: 'A filing, the company’s about page, or a dated headcount report.',
  revenue: 'An annual report, regulatory filing or credible press report.',
  funding_total: 'A funding announcement or database entry listing all rounds.',
  last_round: 'The latest round’s press release or a regulatory filing.',
  distribution: 'A store, outlet or channel count from the company or a filing.',
};

/** A figure is shown as a value only when it has one and is not Unknown. */
export function isKnown(m: Pick<CompanyMetric, 'value' | 'confidence'> | undefined | null): boolean {
  return !!m && m.value != null && m.confidence !== 'unknown';
}

export function orderMetrics<T extends { metricType: MetricType }>(metrics: readonly T[]): T[] {
  const rank = (t: MetricType) => METRIC_ORDER.indexOf(t);
  return [...metrics].sort((a, b) => rank(a.metricType) - rank(b.metricType));
}

/** The date a figure refers to, with its honest provenance. */
export function metricAsOf(m: CompanyMetric): { iso: string | null; kind: 'as_of' | 'verified' | 'captured' } {
  const own = figureAsOf(m).asOf;
  if (own) return { iso: own, kind: 'as_of' };
  if (m.lastVerifiedAt) return { iso: m.lastVerifiedAt, kind: 'verified' };
  return { iso: m.capturedAt ?? null, kind: 'captured' };
}

/**
 * YYYY-MM-DD for a stored date. A timestamp (capture/verification time) is an
 * instant, so it reads in the viewer's local calendar — slicing its UTC form
 * says "tomorrow" every local evening west of Greenwich. A plain calendar date
 * (a source's stated as-of) has no instant and is never timezone-shifted.
 */
function localDay(iso: string): string {
  if (!/T\d{2}:\d{2}/.test(iso)) return iso.length >= 10 ? iso.slice(0, 10) : iso;
  const at = new Date(iso);
  if (!Number.isFinite(at.getTime())) return iso.slice(0, 10);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())}`;
}

export function formatAsOf(m: CompanyMetric): string | null {
  const { iso, kind } = metricAsOf(m);
  if (!iso) return null;
  return `${kind === 'as_of' ? 'As of' : kind === 'verified' ? 'Checked' : 'Captured'} ${localDay(iso)}`;
}

/**
 * 4–6 headline tiles. Known figures lead (in priority order); gaps fill up to
 * a minimum of four so a sparse company still shows an intentional grid of
 * labelled Unknowns rather than one lonely tile.
 */
export function pickKpis(metrics: readonly CompanyMetric[], max = 6, minShown = 4): CompanyMetric[] {
  const byType = new Map<MetricType, CompanyMetric>();
  for (const m of metrics) if (!byType.has(m.metricType)) byType.set(m.metricType, m);
  const ordered = KPI_PRIORITY.map((t) => byType.get(t)).filter((m): m is CompanyMetric => !!m);
  const known = ordered.filter(isKnown);
  const gaps = ordered.filter((m) => !isKnown(m));
  const picked = known.slice(0, max);
  for (const g of gaps) if (picked.length < Math.min(max, minShown)) picked.push(g);
  return picked;
}

/** Core types to surface as labelled gaps when no row exists for them at all. */
export function missingCoreTypes(metrics: readonly CompanyMetric[], want: number): MetricType[] {
  const have = new Set(metrics.map((m) => m.metricType));
  return (['valuation', 'revenue', 'employees', 'users'] as MetricType[]).filter((t) => !have.has(t)).slice(0, Math.max(0, want));
}

export interface PeerEntry {
  companyId: string;
  name: string;
  logoUrl?: string | null;
  websiteUrl?: string | null;
  metrics: readonly CompanyMetric[];
}

export interface PeerPoint {
  companyId: string;
  name: string;
  value: number;
  confidence: CompanyMetric['confidence'];
  isSelf: boolean;
}

export interface PeerRanking {
  metricType: MetricType;
  /** Known, comparable points, highest first. */
  points: PeerPoint[];
  /** 1-based; null when this company has no known comparable value. */
  rank: number | null;
  /** Known comparable count (including this company when known). */
  of: number;
  /** Peers in the deck with no known comparable value: excluded, not ranked. */
  unknownPeers: number;
  /** 0–100, how many known peers sit at or below this company. Null when not rankable. */
  percentile: number | null;
  /** Estimated figures take part, so the ranking is only as firm as its weakest input. */
  includesEstimates: boolean;
}

export function comparableKnown(entry: PeerEntry, type: MetricType): CompanyMetric | undefined {
  const m = entry.metrics.find((x) => x.metricType === type);
  return m && isKnown(m) && comparableMetricBasis(m) ? m : undefined;
}

/**
 * Rank `selfId` among deck peers on one metric. Only known, same-basis values
 * take part; ties share the better rank.
 */
export function rankInDeck(selfId: string, type: MetricType, entries: readonly PeerEntry[]): PeerRanking {
  const points: PeerPoint[] = [];
  let unknownPeers = 0;
  for (const e of entries) {
    const m = comparableKnown(e, type);
    if (m) points.push({ companyId: e.companyId, name: e.name, value: m.value as number, confidence: m.confidence, isSelf: e.companyId === selfId });
    else if (e.companyId !== selfId) unknownPeers += 1;
  }
  points.sort((a, b) => b.value - a.value || a.name.localeCompare(b.name));
  const self = points.find((p) => p.isSelf);
  const rank = self ? points.filter((p) => p.value > self.value).length + 1 : null;
  const percentile = self && points.length > 1
    ? Math.round(((points.filter((p) => p.value <= self.value).length - 1) / (points.length - 1)) * 100)
    : null;
  return {
    metricType: type, points, rank, of: points.length, unknownPeers, percentile,
    includesEstimates: points.some((p) => p.confidence === 'estimated'),
  };
}

/** Rankings worth showing: this company known and at least one known peer. */
export function positionRankings(selfId: string, entries: readonly PeerEntry[]): { ranked: PeerRanking[]; unrankable: MetricType[] } {
  const ranked: PeerRanking[] = [];
  const unrankable: MetricType[] = [];
  for (const type of METRIC_ORDER) {
    const r = rankInDeck(selfId, type, entries);
    if (r.rank != null && r.of >= 2) ranked.push(r);
    else unrankable.push(type);
  }
  return { ranked, unrankable };
}

// ---- Overview narrative parsing -------------------------------------------

export interface OverviewSection { title: string; body: string }

export function parseOverviewSections(markdown: string): { sections: OverviewSection[]; figures: string[] } {
  const sections: OverviewSection[] = [];
  let current: OverviewSection | null = null;
  const figures: string[] = [];
  let inFigures = false;
  for (const line of markdown.split('\n')) {
    const heading = line.match(/^##\s+(.+)$/);
    if (heading) {
      if (current) sections.push(current);
      current = { title: heading[1]!.trim(), body: '' };
      inFigures = false;
      continue;
    }
    const bullet = line.match(/^-\s+(.+)$/);
    // Figure bullets are self-produced: "- Label: value — attribution ([source](url))".
    if (current && bullet && /:\s/.test(bullet[1]!) && /\s—\s/.test(bullet[1]!)) {
      inFigures = true;
      figures.push(bullet[1]!);
      continue;
    }
    if (inFigures && line.trim() === '' && !bullet) continue;
    inFigures = false;
    if (current) current.body += line + '\n';
  }
  if (current) sections.push(current);
  return { sections, figures };
}

export interface SourceLink { title: string; url: string }

/** Split a paragraph block into prose and its trailing [title](url) attribution chips. */
export function splitAttribution(block: string): { text: string; links: SourceLink[] } {
  const lines = block.split('\n').map((l) => l.trim()).filter(Boolean);
  const links: SourceLink[] = [];
  while (lines.length) {
    const last = lines[lines.length - 1]!;
    const tokens = [...last.matchAll(/\[([^\]]+)\]\(([^)]+)\)/g)].map((m) => ({ title: m[1]!, url: m[2]! }));
    if (!tokens.length) break;
    const remainder = last.replace(/\[[^\]]+\]\([^)]+\)/g, '').replace(/·/g, '').trim();
    if (remainder) break;
    links.unshift(...tokens);
    lines.pop();
  }
  return { text: lines.join(' '), links };
}

export interface Takeaway { section: string; text: string; links: SourceLink[] }

const stripMarkdown = (s: string) =>
  s.replace(/\[([^\]]+)\]\([^)]+\)/g, '$1').replace(/[*_`]/g, '').replace(/^[-•]\s+/, '').trim();

function leadSentences(text: string, maxChars: number): string {
  const clean = stripMarkdown(text).replace(/\s+/g, ' ');
  // Split only where a sentence really ends: punctuation, then space and a
  // capital/quote/digit-start. "Claude 4.5", "U.S." and "Inc." never split.
  const sentences = clean.split(/(?<=[.!?])\s+(?=[A-Z"“(])/).map((x) => `${x} `);
  let out = '';
  for (const s of sentences) {
    if (out && (out + s).length > maxChars) break;
    out += s;
    if (out.length >= maxChars * 0.5) break;
  }
  out = out.trim();
  return out.length > maxChars ? `${out.slice(0, maxChars - 1).trimEnd()}…` : out;
}

/**
 * Key takeaways: the lead statement of each researched section, carrying that
 * paragraph's own source chips. Only text the research already produced.
 */
const NON_ANSWER = /^[^.]{0,60}\b(?:unavailable|not available|not retained|no source[- ]attributed|could not be (?:found|confirmed))\b/i;

export function extractTakeaways(sections: readonly OverviewSection[], max = 5): Takeaway[] {
  const out: Takeaway[] = [];
  for (const section of sections) {
    const blocks = section.body.split('\n\n').map((b) => b.trim()).filter(Boolean);
    for (const block of blocks) {
      const { text, links } = splitAttribution(block);
      if (!text || text.startsWith('#')) continue;
      // A list of figures (mostly "Unknown") is data, not a takeaway.
      if ((text.match(/\bUnknown\b/g) ?? []).length >= 2) continue;
      // "Background unavailable: no source-attributed background was retained"
      // is a research status, not a takeaway; the section is skipped.
      if (NON_ANSWER.test(text)) continue;
      const lead = leadSentences(text, 220);
      if (lead.length < 20 || /^[^A-Za-z"“(]/.test(lead)) continue;
      out.push({ section: section.title, text: lead, links });
      break; // one takeaway per section keeps the list scannable
    }
    if (out.length >= max) break;
  }
  return out;
}

/** A peer bar's width as a share of the deck leader. Unknowns never get a bar. */
export function barPercent(value: number, max: number): number {
  if (!(max > 0) || !(value >= 0)) return 0;
  return Math.max(2, Math.min(100, (value / max) * 100));
}

export type SortKey = 'metric' | 'value' | 'confidence' | 'asof' | 'rank';
const CONF_ORDER: Record<string, number> = { user_verified: 0, verified: 1, estimated: 2, unknown: 3 };

/** Sort table rows. Unknowns always sink to the bottom whichever way we sort. */
export function sortMetricRows<T extends { metric: CompanyMetric; rank: number | null }>(
  rows: readonly T[], key: SortKey, dir: 'asc' | 'desc',
): T[] {
  const sign = dir === 'asc' ? 1 : -1;
  const orderIdx = (r: T) => METRIC_ORDER.indexOf(r.metric.metricType);
  const val = (r: T): number | string | null => {
    switch (key) {
      case 'metric': return orderIdx(r);
      case 'value': return isKnown(r.metric) ? (r.metric.value as number) : null;
      case 'confidence': return CONF_ORDER[r.metric.confidence] ?? 9;
      case 'asof': return isKnown(r.metric) ? (metricAsOf(r.metric).iso ?? null) : null;
      case 'rank': return r.rank;
    }
  };
  return [...rows].sort((a, b) => {
    const av = val(a);
    const bv = val(b);
    if (av == null && bv == null) return orderIdx(a) - orderIdx(b);
    if (av == null) return 1;
    if (bv == null) return -1;
    const cmp = typeof av === 'string' || typeof bv === 'string'
      ? String(av).localeCompare(String(bv))
      : av - bv;
    return cmp === 0 ? orderIdx(a) - orderIdx(b) : cmp * sign;
  });
}
