import { TIER_LABELS, type CardWithCompany, type MaturityTier, type MetricType } from '@mi/contracts';
import { buildCardView } from './card-view';

/**
 * OVR — a 0–99 overall rating for a company card (Madden-style).
 *
 * PURE + DETERMINISTIC. Every input is something the card already shows:
 *   · the recorded maturity tier (T1–T8), and
 *   · SOURCED scale figures (value present AND a clickable receipt) ranked
 *     against the other companies in the SAME deck.
 * Nothing is invented: an Unknown figure is excluded (never scored as zero),
 * and a company with no tier and no rankable sourced figure gets no rating.
 *
 * Formula (all numbers are rounded only at the very end):
 *   tierScore  = 35 + (tier − 1) × 55/7                      T1 → 35 … T8 → 90
 *   g          = geometric mean of the company's in-deck percentiles (each
 *                floored at 0.03 so one bottom rank cannot zero the score)
 *   scaleScore = 30 + 69 × g
 *   blended    = ½ tierScore + ½ scaleScore    (tier only / scale only if the
 *                other is unavailable)
 *   bonus      = +1 per extra sourced figure beyond the first, max +4
 *   OVR        = clamp(round(blended + bonus), 30, 99)
 */

export const OVR_MIN = 30;
export const OVR_MAX = 99;
/** A percentile needs real comparators: fewer than this and the family is skipped. */
export const MIN_COMPARATORS = 3;
const PERCENTILE_FLOOR = 0.03;
const MAX_BONUS = 4;

/** Scale figure families. Related metric types share a family so nothing counts twice. */
export const SCALE_FAMILIES = ['employees', 'revenue', 'value', 'capital', 'reach', 'aum'] as const;
export type ScaleFamily = (typeof SCALE_FAMILIES)[number];

export const SCALE_FAMILY_LABELS: Record<ScaleFamily, string> = {
  employees: 'Employees',
  revenue: 'Revenue / ARR',
  value: 'Valuation / market cap',
  capital: 'Capital raised',
  reach: 'Users / distribution',
  aum: 'AUM',
};

/** Preference order within a family: the first sourced metric type wins. */
const FAMILY_TYPES: Record<ScaleFamily, readonly MetricType[]> = {
  employees: ['employees'],
  revenue: ['arr', 'revenue'],
  value: ['valuation', 'market_cap'],
  capital: ['funding_total', 'last_round'],
  reach: ['users', 'distribution'],
  aum: ['aum'],
};

export interface OvrInput {
  id: string;
  tier: MaturityTier | null;
  /** Sourced scale figures only. A family that is absent is Unknown, never 0. */
  scale: Partial<Record<ScaleFamily, number>>;
  /** Distinct sourced metrics on the card (evidence depth). */
  sourcedCount: number;
}

export interface OvrComponent {
  key: 'tier' | 'scale' | 'evidence';
  label: string;
  /** Points this component contributes to the pre-clamp total (bonus) or its 0–99 sub-score. */
  score: number;
  /** Share of the blended score this component carries (0 for the bonus). */
  weight: number;
  detail: string;
}

export interface OvrPercentile {
  family: ScaleFamily;
  label: string;
  /** 0–1 rank within the deck (1 = largest). */
  percentile: number;
  comparators: number;
}

export interface OvrBreakdown {
  overall: number;
  tier: MaturityTier | null;
  /** Fewer than two sourced figures behind the card: shown, but flagged. */
  indicative: boolean;
  components: OvrComponent[];
  percentiles: OvrPercentile[];
  basis: string;
}

export const OVR_EXPLAINER =
  'OVR is a 0–99 overall rating. It blends the company’s maturity tier with how its sourced ' +
  'scale figures (people, revenue, valuation, users…) rank against the rest of this deck, ' +
  'plus a small bonus for evidence depth. Unknown figures are left out, never scored as zero, ' +
  'and no rating is shown without evidence.';

/** Map the rating onto the existing tier hue scale so the badge looks native. */
export function ovrColorTier(overall: number): MaturityTier {
  if (overall < 40) return 1;
  if (overall < 48) return 2;
  if (overall < 56) return 3;
  if (overall < 64) return 4;
  if (overall < 72) return 5;
  if (overall < 80) return 6;
  if (overall < 90) return 7;
  return 8;
}

export function ovrTooltip(rating: OvrBreakdown): string {
  return `Overall rating ${rating.overall}/99. ${rating.basis}`;
}

/** Mid-rank percentile in [0,1]: top = 1, bottom = 0, a full tie = 0.5. */
function percentile(value: number, all: readonly number[]): number {
  let less = 0;
  let equal = 0;
  for (const v of all) {
    if (v < value) less += 1;
    else if (v === value) equal += 1;
  }
  return (less + 0.5 * (equal - 1)) / (all.length - 1);
}

const tierScore = (tier: MaturityTier) => 35 + ((tier - 1) * 55) / 7;

/**
 * Rate every input against the same population. Returns null for an input that
 * has nothing honest to rate (no tier and no rankable sourced figure).
 */
export function rateInputs(inputs: readonly OvrInput[]): Map<string, OvrBreakdown | null> {
  const pools = new Map<ScaleFamily, number[]>();
  for (const input of inputs) {
    for (const family of SCALE_FAMILIES) {
      const value = input.scale[family];
      if (value == null || !Number.isFinite(value)) continue;
      const pool = pools.get(family) ?? [];
      pool.push(value);
      pools.set(family, pool);
    }
  }

  const out = new Map<string, OvrBreakdown | null>();
  for (const input of inputs) {
    const percentiles: OvrPercentile[] = [];
    for (const family of SCALE_FAMILIES) {
      const value = input.scale[family];
      const pool = pools.get(family);
      if (value == null || !Number.isFinite(value) || !pool || pool.length < MIN_COMPARATORS) continue;
      percentiles.push({ family, label: SCALE_FAMILY_LABELS[family], percentile: percentile(value, pool), comparators: pool.length });
    }
    if (input.tier == null && percentiles.length === 0) {
      out.set(input.id, null);
      continue;
    }

    const components: OvrComponent[] = [];
    const hasTier = input.tier != null;
    const hasScale = percentiles.length > 0;
    const tierWeight = hasTier && hasScale ? 0.5 : hasTier ? 1 : 0;
    const scaleWeight = hasTier && hasScale ? 0.5 : hasScale ? 1 : 0;
    let blended = 0;
    if (hasTier) {
      const score = tierScore(input.tier!);
      blended += tierWeight * score;
      components.push({
        key: 'tier', label: 'Maturity tier', score: Math.round(score), weight: tierWeight,
        detail: `T${input.tier} · ${TIER_LABELS[input.tier!]}`,
      });
    }
    if (hasScale) {
      const g = Math.exp(
        percentiles.reduce((sum, p) => sum + Math.log(Math.max(p.percentile, PERCENTILE_FLOOR)), 0) / percentiles.length,
      );
      const score = OVR_MIN + (OVR_MAX - OVR_MIN) * g;
      blended += scaleWeight * score;
      components.push({
        key: 'scale', label: 'Scale vs this deck', score: Math.round(score), weight: scaleWeight,
        detail: percentiles.map((p) => `${p.label}: top ${Math.max(1, Math.round((1 - p.percentile) * 100))}%`).join(' · '),
      });
    }
    const bonus = Math.min(MAX_BONUS, Math.max(0, input.sourcedCount - 1));
    components.push({
      key: 'evidence', label: 'Evidence depth', score: bonus, weight: 0,
      detail: bonus > 0
        ? `+${bonus} for ${input.sourcedCount} sourced figures`
        : `${input.sourcedCount} sourced figure${input.sourcedCount === 1 ? '' : 's'}, no bonus`,
    });

    const overall = Math.min(OVR_MAX, Math.max(OVR_MIN, Math.round(blended + bonus)));
    const basis = hasTier && hasScale
      ? `Half maturity tier (T${input.tier}), half sourced scale rank within this deck, plus ${bonus} evidence point${bonus === 1 ? '' : 's'}.`
      : hasTier
        ? `Maturity tier T${input.tier} only: too few sourced scale figures to rank within this deck.`
        : 'Sourced scale rank within this deck only: no maturity tier is recorded.';
    out.set(input.id, { overall, tier: input.tier, indicative: input.sourcedCount < 2, components, percentiles, basis });
  }
  return out;
}

/** Build the rating input for a card using the same "sourced" test as the card face. */
export function ovrInputFor(data: CardWithCompany): OvrInput | null {
  if (data.card.cardType !== 'company' || !data.company) return null;
  const view = buildCardView(data);
  if (view.signal) return null;
  const sourced = view.metrics.filter((m) =>
    m.metric.value != null && m.metric.confidence !== 'unknown' && m.citations.length > 0);
  const scale: Partial<Record<ScaleFamily, number>> = {};
  for (const family of SCALE_FAMILIES) {
    for (const type of FAMILY_TYPES[family]) {
      const hit = sourced.find((m) => m.metric.metricType === type);
      if (hit) { scale[family] = hit.metric.value as number; break; }
    }
  }
  // A recorded tier is only honoured when the card face honours it too.
  const tier = view.maturity ? view.maturity.tier : null;
  return { id: data.card.id, tier, scale, sourcedCount: view.sourcedCount };
}

/** Rate every company card in a deck against the whole deck. */
export function rateDeck(cards: readonly CardWithCompany[]): Map<string, OvrBreakdown | null> {
  const inputs = cards.map(ovrInputFor).filter((i): i is OvrInput => i != null);
  const rated = rateInputs(inputs);
  for (const c of cards) if (!rated.has(c.card.id)) rated.set(c.card.id, null);
  return rated;
}

/** A card shown on its own (no deck): tier-only, honest about having no comparators. */
export function rateCardAlone(data: CardWithCompany): OvrBreakdown | null {
  return rateDeck([data]).get(data.card.id) ?? null;
}
