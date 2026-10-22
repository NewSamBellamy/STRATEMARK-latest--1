/**
 * The Metrics tab's deck comparison, as plain data: which companies are
 * charted for a figure, with the value, its source publisher and its date,
 * and which are not charted and why.
 *
 * Rule 9 holds here: only known, same-basis figures are charted. A company
 * without one is named as "not charted", never drawn as zero, and nothing is
 * imputed or rescaled to hide a gap.
 */
import { publisherOf, type CompanyMetric, type MetricType } from '@mi/contracts';
import { comparableKnown, rankInDeck, shownKnown, type PeerEntry, type PeerRanking } from '../dashboardModel';
import { figureDates, figureDisplay, figureTrust, linkedCitation } from '../figureSet';
import { figureCurrency } from '../figureCurrency';
import { shortCompanyName } from '../companyNames';

export interface CompareBar {
  companyId: string;
  name: string;
  value: number;
  /** The value as the dashboard shows it, e.g. "$380.0B". */
  display: string;
  isSelf: boolean;
  /** An estimate is drawn hatched and labelled; a verified figure is drawn solid. */
  estimate: boolean;
  trust: ReturnType<typeof figureTrust>;
  /** Who published it; null when no link was recorded. */
  publisher: string | null;
  /** What the source says the figure is for, or when we captured it, labelled. */
  when: string | null;
}

export interface DeckComparison {
  ranking: PeerRanking;
  bars: CompareBar[];
  /** Known, but reported in another currency: shown as reported, never ranked against dollars. */
  otherCurrency: Array<{ companyId: string; text: string; converted: boolean }>;
  /** No sourced figure for this metric. Includes this company when it has none. */
  notCharted: Array<{ companyId: string; name: string; isSelf: boolean }>;
}

function whenOf(m: CompanyMetric): string | null {
  const d = figureDates(m);
  return d.period ? `For ${d.period}` : d.record;
}

function barOf(entry: PeerEntry, m: CompanyMetric, selfId: string): CompareBar {
  const cite = linkedCitation(m);
  return {
    companyId: entry.companyId,
    name: entry.name,
    value: m.value as number,
    display: figureDisplay(m),
    isSelf: entry.companyId === selfId,
    estimate: m.confidence === 'estimated',
    trust: figureTrust(m),
    publisher: cite ? publisherOf(cite.url, cite.title) : null,
    when: whenOf(m),
  };
}

export function deckComparison(selfId: string, type: MetricType, peers: readonly PeerEntry[]): DeckComparison {
  const ranking = rankInDeck(selfId, type, peers);
  const byId = new Map(peers.map((p) => [p.companyId, p]));
  const bars: CompareBar[] = [];
  for (const point of ranking.points) {
    const entry = byId.get(point.companyId);
    const m = entry && comparableKnown(entry, type);
    if (entry && m) bars.push(barOf(entry, m, selfId));
  }
  const charted = new Set(bars.map((b) => b.companyId));
  const otherCurrency: DeckComparison['otherCurrency'] = [];
  const notCharted: DeckComparison['notCharted'] = [];
  for (const p of peers) {
    if (charted.has(p.companyId)) continue;
    const m = shownKnown(p, type);
    const currency = m ? figureCurrency(m) : null;
    if (m && currency) {
      otherCurrency.push({
        companyId: p.companyId,
        converted: currency.converted,
        text: `${shortCompanyName(p.name)} ${figureDisplay(m)}${currency.converted ? ` (converted from ${currency.code})` : ` (${currency.code})`}`,
      });
    } else {
      notCharted.push({ companyId: p.companyId, name: shortCompanyName(p.name), isSelf: p.companyId === selfId });
    }
  }
  return { ranking, bars, otherCurrency, notCharted };
}

/** The bars to draw: everything, or the top `limit` plus this company when it ranks lower. */
export function visibleBars(bars: readonly CompareBar[], limit: number, all: boolean): CompareBar[] {
  if (all || bars.length <= limit) return [...bars];
  const top = bars.slice(0, limit);
  const self = bars.find((b) => b.isSelf);
  return self && !top.includes(self) ? [...top, self] : top;
}

/** Bar length as a share of the largest charted value, on a linear scale from zero. Null when there is nothing to scale against. */
export function barShare(value: number, max: number): number | null {
  if (!(max > 0) || !(value >= 0) || !Number.isFinite(value)) return null;
  return Math.min(100, (value / max) * 100);
}

export interface ScatterPoint {
  companyId: string;
  name: string;
  x: number;
  y: number;
  xDisplay: string;
  yDisplay: string;
  isSelf: boolean;
  /** Either coordinate is an estimate. */
  estimate: boolean;
}

/** Companies with a known, same-basis figure on BOTH axes. Everyone else is listed, never placed. */
export function scatterPoints(selfId: string, xType: MetricType, yType: MetricType, peers: readonly PeerEntry[]): { points: ScatterPoint[]; left: string[] } {
  const points: ScatterPoint[] = [];
  const left: string[] = [];
  for (const p of peers) {
    const x = comparableKnown(p, xType);
    const y = comparableKnown(p, yType);
    if (!x || !y) { left.push(shortCompanyName(p.name)); continue; }
    points.push({
      companyId: p.companyId, name: p.name, x: x.value as number, y: y.value as number,
      xDisplay: figureDisplay(x), yDisplay: figureDisplay(y), isSelf: p.companyId === selfId,
      estimate: x.confidence === 'estimated' || y.confidence === 'estimated',
    });
  }
  return { points, left };
}

/** Figures at least two companies in the deck can be compared on. */
export function comparableTypes(types: readonly MetricType[], peers: readonly PeerEntry[]): MetricType[] {
  return types.filter((t) => peers.filter((p) => comparableKnown(p, t)).length >= 2);
}

/** Up to five round axis ticks from zero to just past `max`. Linear only. */
export function niceTicks(max: number): number[] {
  if (!(max > 0) || !Number.isFinite(max)) return [0];
  const rough = max / 4;
  const mag = Math.pow(10, Math.floor(Math.log10(rough)));
  const step = [1, 2, 2.5, 5, 10].map((s) => s * mag).find((s) => s >= rough) ?? 10 * mag;
  const out: number[] = [];
  for (let v = 0; v < max + step * 0.999 && out.length < 7; v += step) out.push(Number(v.toPrecision(12)));
  return out;
}
