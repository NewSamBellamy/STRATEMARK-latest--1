/**
 * Canonical enums for the Market Intelligence domain.
 *
 * These const tuples are the single source of truth: Zod enums (schemas.ts) and
 * TypeScript union types are both derived from them, so the DB, the API contract,
 * and the UI can never drift apart.
 */

// ---------------------------------------------------------------------------
// Card taxonomy (spec §4)
// ---------------------------------------------------------------------------
export const CARD_TYPES = [
  'company',
  'infrastructure',
  'distribution',
  'culture',
  'vice',
  'insight',
  'barrier',
] as const;
export type CardType = (typeof CARD_TYPES)[number];

export const CARD_TYPE_LABELS: Record<CardType, string> = {
  company: 'Company',
  infrastructure: 'Infrastructure',
  distribution: 'Distribution',
  culture: 'Culture',
  vice: 'Vice',
  insight: 'Insight',
  barrier: 'Barrier to Entry',
};

export const CARD_TYPE_DESCRIPTIONS: Record<CardType, string> = {
  company: 'Core entry for any company operating directly within the defined market.',
  infrastructure: 'Companies providing infrastructure/tooling to the market.',
  distribution: 'Companies providing distribution/channel access into the market.',
  culture: 'Positive community/culture signal — engagement, giving back, non-profit ties.',
  vice: 'Negative/risk signal — lawsuits, bad press, founder-integrity issues.',
  insight:
    'A market-level finding worth remembering — a shift, pattern, or non-obvious dynamic surfaced by the research.',
  barrier: 'Structural barriers identified for the market (regulatory, capital, network effects).',
};

/**
 * Card types that ARE a business entity, and therefore legitimately carry that
 * entity's financial and scale metrics. NVIDIA can be both a company and an
 * infrastructure provider — those are two facets of one real business.
 */
export const ENTITY_CARD_TYPES = ['company', 'infrastructure', 'distribution'] as const;

/**
 * Card types that ANNOTATE an entity or market with a sourced signal. A
 * controversy is not a business: it has no valuation, no ARR, no headcount.
 *
 * This distinction is load-bearing, not cosmetic. Audit 2026-07-29 (Finding 1.2)
 * found a Vice card that had minted a pseudo-company —
 * "OpenAI / Safety / Governance Controversy Entity" — and inherited OpenAI's
 * valuation, ARR and user count as *unsourced* "verified" figures. Signal cards
 * must carry their claim and its sources, never borrowed numbers.
 */
export const SIGNAL_CARD_TYPES = ['culture', 'vice', 'insight'] as const;

/** True when a card type describes a real business that can own metrics. */
export function isEntityCardType(type: CardType): boolean {
  return (ENTITY_CARD_TYPES as readonly CardType[]).includes(type);
}

/** True when a card type is a sourced observation rather than a business. */
export function isSignalCardType(type: CardType): boolean {
  return (SIGNAL_CARD_TYPES as readonly CardType[]).includes(type);
}

// The order card-type sub-decks are displayed in after a Level-1 split.
export const CARD_TYPE_ORDER: readonly CardType[] = [
  'company',
  'infrastructure',
  'distribution',
  'culture',
  'vice',
  'insight',
  'barrier',
];

// ---------------------------------------------------------------------------
// Metrics (spec §10)
// ---------------------------------------------------------------------------
export const METRIC_TYPES = [
  'market_cap',
  'valuation',
  'market_share',
  'arr',
  'users',
  'employees',
] as const;
export type MetricType = (typeof METRIC_TYPES)[number];

export const METRIC_TYPE_LABELS: Record<MetricType, string> = {
  market_cap: 'Market Cap',
  valuation: 'Valuation',
  market_share: 'Market Share',
  arr: 'ARR',
  users: 'Users',
  employees: 'Employees',
};

// ---------------------------------------------------------------------------
// Confidence (spec §6.4)
// ---------------------------------------------------------------------------
export const CONFIDENCE_LEVELS = ['verified', 'estimated', 'unknown', 'user_verified'] as const;
export type Confidence = (typeof CONFIDENCE_LEVELS)[number];

/**
 * The confidence vocabulary a MODEL is allowed to propose (issue #48).
 *
 * `user_verified` is deliberately absent: it asserts that a person checked this
 * figure, and no model output can make that true. Because this tuple backs the
 * model-facing Zod schema, it is also what becomes the native `@google/genai`
 * `responseSchema` enum — so a conforming model cannot even emit the value.
 *
 * `verified` IS proposable but is not thereby granted: provenance enforcement
 * demotes it unless a usable, verification-grade citation stands behind it.
 */
export const MODEL_PROPOSABLE_CONFIDENCE = ['verified', 'estimated', 'unknown'] as const;

export const CONFIDENCE_LABELS: Record<Confidence, string> = {
  verified: 'Sourced',
  estimated: 'Estimated',
  unknown: 'Unknown',
  user_verified: 'User confirmed',
};

// ---------------------------------------------------------------------------
// Refresh cadence (spec §9)
// ---------------------------------------------------------------------------
export const REFRESH_CADENCES = ['daily', 'twice_daily', 'weekly'] as const;
export type RefreshCadence = (typeof REFRESH_CADENCES)[number];

export const REFRESH_CADENCE_LABELS: Record<RefreshCadence, string> = {
  daily: 'Daily',
  twice_daily: '2× Daily',
  weekly: 'Weekly',
};

export const REFRESH_CADENCE_HOURS: Record<RefreshCadence, number> = {
  daily: 24,
  twice_daily: 12,
  weekly: 168,
};

// ---------------------------------------------------------------------------
// Company dashboard tabs (spec §8 — locked order)
// ---------------------------------------------------------------------------
export const DASHBOARD_TABS = [
  'overview',
  'metrics',
  'live_intel',
  'team_org',
  'live_landing',
  'mission_governance',
  'history',
  'products_roadmap',
] as const;
export type DashboardTab = (typeof DASHBOARD_TABS)[number];

export const DASHBOARD_TAB_LABELS: Record<DashboardTab, string> = {
  overview: 'Overview',
  live_intel: 'Live Intel',
  team_org: 'Team & Org Chart',
  live_landing: 'Live Landing Page',
  metrics: 'Metrics',
  mission_governance: 'Mission & Governance',
  history: 'History',
  products_roadmap: 'Products & Roadmap',
};

// ---------------------------------------------------------------------------
// Company size-signal bands (stored as MaturityTier for data compatibility)
// ---------------------------------------------------------------------------
export const MATURITY_TIERS = [1, 2, 3, 4, 5, 6, 7, 8] as const;
export type MaturityTier = (typeof MATURITY_TIERS)[number];

export const TIER_LABELS: Record<MaturityTier, string> = {
  1: 'Minimal footprint',
  2: 'Very small footprint',
  3: 'Small footprint',
  4: 'Mid-sized footprint',
  5: 'Substantial footprint',
  6: 'Large footprint',
  7: 'Very large footprint',
  8: 'Largest footprint',
};

export const TIER_BLURBS: Record<MaturityTier, string> = {
  1: 'Lowest band from available size signals; not a measure of growth, product quality, or leadership.',
  2: 'Low band from available size signals; not a measure of growth, product quality, or leadership.',
  3: 'Lower-middle band from available size signals; not a measure of growth, product quality, or leadership.',
  4: 'Middle band from available size signals; not a measure of growth, product quality, or leadership.',
  5: 'Upper-middle band from available size signals; not a measure of growth, product quality, or leadership.',
  6: 'High band from available size signals; not a measure of growth, product quality, or leadership.',
  7: 'Very high band from available size signals; not a measure of growth, product quality, or leadership.',
  8: 'Highest band from available size signals; not a measure of growth, product quality, or leadership.',
};

/** Typical (not enforced) company counts per tier — used only for UI hints. */
export const TIER_TYPICAL_COUNTS: Record<MaturityTier, number> = {
  1: 2,
  2: 3,
  3: 3,
  4: 3,
  5: 3,
  6: 3,
  7: 3,
  8: 2,
};

export function isMaturityTier(value: unknown): value is MaturityTier {
  return typeof value === 'number' && MATURITY_TIERS.includes(value as MaturityTier);
}

// ---------------------------------------------------------------------------
// Subscription Tiers & Statuses
// ---------------------------------------------------------------------------
export const SUBSCRIPTION_TIERS = ['free', 'pro'] as const;
export type SubscriptionTier = (typeof SUBSCRIPTION_TIERS)[number];

export const SUBSCRIPTION_STATUSES = ['active', 'trialing', 'canceled'] as const;
export type SubscriptionStatus = (typeof SUBSCRIPTION_STATUSES)[number];

export const SUBSCRIPTION_TIER_LABELS: Record<SubscriptionTier, string> = {
  free: 'Free',
  pro: 'Pro',
};
