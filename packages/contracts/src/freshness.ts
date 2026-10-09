/**
 * Freshness — how the deck knows what to re-research next.
 *
 * A "living" deck cannot poll. Grounded search is billed per query, so a loop
 * that refreshes everything on a timer converts an open tab into a metered
 * faucet. The alternative is to make staleness a property of the data and let a
 * scheduler always work on the single most-decayed figure it can afford.
 *
 * Two ideas carry the whole design:
 *
 *   1. **Facts decay at different rates.** A funding round can change overnight;
 *      a company's founding year cannot. Refreshing both on the same cadence
 *      either wastes queries on the second or lets the first go stale. So
 *      volatility is declared per metric type, not per deck.
 *
 *   2. **Confidence changes the deadline.** An `estimated` figure is a standing
 *      invitation to find the real one, so it is due sooner than a `verified`
 *      figure of the same type. A `user_verified` figure was entered by a human
 *      and is never auto-refreshed — overwriting it would be rude and wrong.
 *
 * Everything here is pure. No clock is read implicitly: callers pass `nowMs`, so
 * scheduling is deterministic and testable.
 */
import {
  isEntityCardType,
  type CardType,
  type Confidence,
  type MaturityTier,
  type MetricType,
} from './enums';
import type { CompanyMetric } from './types';

// ---------------------------------------------------------------------------
// Volatility
// ---------------------------------------------------------------------------

export const VOLATILITY_TIERS = ['hot', 'warm', 'cold'] as const;
export type VolatilityTier = (typeof VOLATILITY_TIERS)[number];

const HOUR = 3_600;
const DAY = 24 * HOUR;

/** How long a figure of each volatility stays trustworthy, in seconds. */
export const VOLATILITY_SECONDS: Record<VolatilityTier, number> = {
  hot: DAY,
  warm: 7 * DAY,
  cold: 30 * DAY,
};

/**
 * Volatility per metric type.
 *
 * `market_cap` is the most volatile thing here — it moves every trading day —
 * but it is also cheap to re-source, so it sits in `hot` with valuation and ARR.
 * Headcount and market share move on a hiring/quarterly rhythm. AUM moves on a
 * firm-disclosure rhythm (quarterly/annual, market moves in between), so it
 * shares the `warm` band. Nothing is `cold` today because every figure the deck
 * carries is financial or scale related; the tier exists for the descriptive
 * fields that will join later.
 */
export const METRIC_VOLATILITY: Record<MetricType, VolatilityTier> = {
  market_cap: 'hot',
  valuation: 'hot',
  arr: 'hot',
  market_share: 'warm',
  aum: 'warm',
  users: 'warm',
  employees: 'warm',
};

/**
 * Multiplier applied to the base window based on how solid the figure is.
 *
 * An estimate is due sooner than a verified figure because replacing it with a
 * sourced number is a direct quality win. An unknown is due soonest of all: a
 * blank is the strongest signal that research is incomplete.
 */
const CONFIDENCE_MULTIPLIER: Record<Confidence, number> = {
  verified: 1,
  estimated: 0.5,
  unknown: 0.25,
  // Human input is authoritative. Never scheduled for automatic refresh.
  user_verified: Number.POSITIVE_INFINITY,
};

/** True when a human entered this figure and automation must leave it alone. */
export function isHumanAuthored(metric: Pick<CompanyMetric, 'confidence'>): boolean {
  return metric.confidence === 'user_verified';
}

/**
 * How long this specific figure stays fresh, in seconds, or null when it should
 * never be automatically refreshed.
 */
export function staleAfterSecondsFor(
  metric: Pick<CompanyMetric, 'metricType' | 'confidence'>,
): number | null {
  const multiplier = CONFIDENCE_MULTIPLIER[metric.confidence];
  if (!Number.isFinite(multiplier)) return null;
  const base = VOLATILITY_SECONDS[METRIC_VOLATILITY[metric.metricType]];
  return Math.max(HOUR, Math.round(base * multiplier));
}

// ---------------------------------------------------------------------------
// Due dates
// ---------------------------------------------------------------------------

/**
 * The reference instant for a figure's age.
 *
 * `lastVerifiedAt` is when a source last confirmed it; `capturedAt` is when we
 * wrote the row. They differ after a refresh that re-confirms an unchanged
 * value, and the confirmation is what matters — otherwise re-verifying a stable
 * figure would look like no progress at all.
 */
export function verifiedAtMs(metric: CompanyMetric): number | null {
  const raw = metric.lastVerifiedAt ?? metric.capturedAt;
  const parsed = Date.parse(raw);
  return Number.isNaN(parsed) ? null : parsed;
}

/**
 * True when this figure has never survived a verification pass: an estimate
 * or a blank that no re-research has ever confirmed. `capturedAt` only says
 * when the row was WRITTEN — a figure can be born stale (a real production
 * case: an ARR from 18-month-old coverage landed on a fresh deck, and the
 * decay timers wouldn't have touched it for hours).
 */
export function isUnauditedAtBirth(metric: CompanyMetric): boolean {
  if (isHumanAuthored(metric)) return false;
  if (metric.lastVerifiedAt) return false;
  return metric.confidence === 'estimated' || metric.confidence === 'unknown';
}

/** Epoch ms when this figure next needs attention, or null if never. */
export function nextRefreshDueAtMs(metric: CompanyMetric): number | null {
  if (isHumanAuthored(metric)) return null;
  const attempted = Date.parse(metric.lastVerificationAttemptAt ?? '');
  const attemptMs = Number.isFinite(attempted) ? attempted : null;
  // BIRTH AUDIT: soft figures with no verification history are due NOW, not
  // after a decay window. The deck starts fact-checking itself the moment it
  // lands, instead of trusting first-pass research for hours.
  if (isUnauditedAtBirth(metric) && attemptMs === null) return 0;
  const seconds = metric.staleAfterSeconds ?? staleAfterSecondsFor(metric);
  if (seconds === null) return null;
  const supported = verifiedAtMs(metric);
  // Scheduling cooldown is not factual freshness: inconclusive attempts delay
  // another paid query but never change lastVerifiedAt or capturedAt.
  const from = attemptMs === null ? supported : Math.max(attemptMs, supported ?? attemptMs);
  // An unparseable or missing timestamp means we cannot vouch for the figure's
  // age, so it is due immediately rather than treated as fresh.
  if (from === null) return 0;
  return from + seconds * 1_000;
}

export function isMetricStale(metric: CompanyMetric, nowMs: number): boolean {
  const due = nextRefreshDueAtMs(metric);
  return due !== null && nowMs >= due;
}

/**
 * How far past due a figure is, in ms. Negative means still fresh; `null` means
 * never refreshed automatically. This is the scheduler's sort key — ranking by
 * overdue-ness rather than by raw age keeps a `cold` figure from starving a
 * `hot` one that decayed faster.
 */
export function overdueByMs(metric: CompanyMetric, nowMs: number): number | null {
  const due = nextRefreshDueAtMs(metric);
  return due === null ? null : nowMs - due;
}

// ---------------------------------------------------------------------------
// Scheduling
// ---------------------------------------------------------------------------

export interface RefreshCandidate {
  metric: CompanyMetric;
  /** Positive when due; larger means more overdue. */
  overdueByMs: number;
}

/**
 * Pick the figures most worth spending a search query on, most overdue first.
 *
 * `limit` is the caller's budget, not a page size — the scheduler asks for
 * exactly as many refreshes as it can currently afford, which is what keeps a
 * living deck inside its query allowance.
 */
export function selectStaleMetrics(
  metrics: readonly CompanyMetric[],
  nowMs: number,
  limit: number,
): RefreshCandidate[] {
  if (limit <= 0) return [];
  const due: RefreshCandidate[] = [];
  for (const metric of metrics) {
    const overdue = overdueByMs(metric, nowMs);
    if (overdue === null || overdue < 0) continue;
    due.push({ metric, overdueByMs: overdue });
  }
  due.sort((a, b) => b.overdueByMs - a.overdueByMs);
  return due.slice(0, limit);
}

/**
 * Stamp a figure as confirmed at `atIso`, recording its own decay window.
 *
 * Writing `staleAfterSeconds` onto the row rather than deriving it at read time
 * means a policy change later cannot silently reinterpret the freshness of data
 * already on disk.
 */
export function markVerified(metric: CompanyMetric, atIso: string): CompanyMetric {
  return {
    ...metric,
    lastVerifiedAt: atIso,
    staleAfterSeconds: staleAfterSecondsFor(metric),
  };
}

// ---------------------------------------------------------------------------
// Deck readiness — "is this deck fully baked?"
// ---------------------------------------------------------------------------

export interface DeckBakedState {
  /** True when every entity card has finished forming (tier assigned). */
  baked: boolean;
  /** Entity cards in the deck (companies, infrastructure, distribution). */
  total: number;
  /** How many of them have a tier — i.e. finished enrichment + scoring. */
  formed: number;
}

/**
 * Whether a deck is done forming. Derived artifacts that summarize the WHOLE
 * deck (daily briefings, exported reports) gate on this: publishing a digest
 * of a half-researched deck would launder skeletons into prose. Pure and
 * structural — pass any card list; only entity cards count, and a card counts
 * as formed once scoring assigned it a tier (the same signal the card face
 * uses to stop rendering skeletons).
 */
export function deckBakedState(
  cards: ReadonlyArray<{ tier: MaturityTier | null; cardType: CardType }>,
): DeckBakedState {
  const entities = cards.filter((c) => isEntityCardType(c.cardType));
  const formed = entities.filter((c) => c.tier != null).length;
  return { baked: entities.length > 0 && formed === entities.length, total: entities.length, formed };
}
