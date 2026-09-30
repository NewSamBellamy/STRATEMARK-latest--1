import type { Confidence, UserFootprintBasis } from './enums';
import { SCOREABLE_USER_FOOTPRINT_BASES, USER_FOOTPRINT_BASIS_LABELS } from './enums';

export interface UserFootprintCohort {
  /** One denominator selected for the entire deck; unknown means no peer cohort. */
  basis: UserFootprintBasis;
  values: number[];
}

export type ComparableUserFootprintBasis = (typeof SCOREABLE_USER_FOOTPRINT_BASES)[number];

export interface UserFootprintMetricLike {
  id?: string;
  metricType: string;
  companyId?: string;
  value: number | null;
  confidence: Confidence;
  userBasis?: UserFootprintBasis;
  methodNote?: string | null;
}

/** Resolve a structured footprint unit, inferring only for pre-basis snapshots. */
export function userFootprintBasisFor(
  metric: Pick<UserFootprintMetricLike, 'userBasis' | 'methodNote'>,
): UserFootprintBasis {
  return metric.userBasis ?? inferUserFootprintBasis(metric.methodNote);
}

/** Normalize method text for matching intentionally unclassified footprint rows. */
export function normalizeUserFootprintNote(note: string | null | undefined): string {
  return note?.trim().toLowerCase().replace(/\s+/g, ' ') ?? '';
}

/**
 * Identity for a users row. Known units are unique per company; `other` and
 * `unknown` need their own method text (or row ID) to avoid collapsing unlike
 * measures into one generic bucket.
 */
export function userFootprintIdentity(
  metric: Pick<UserFootprintMetricLike, 'userBasis' | 'methodNote'> & { id?: string },
): string {
  const basis = userFootprintBasisFor(metric);
  if (basis !== 'unknown' && basis !== 'other') return basis;
  return `${basis}:${normalizeUserFootprintNote(metric.methodNote) || `row:${metric.id ?? 'unidentified'}`}`;
}

/** Find by unit; unknown/other units require a note when multiple rows exist. */
export function findUserFootprint<T extends UserFootprintMetricLike>(
  metrics: readonly T[],
  basis?: UserFootprintBasis,
  methodNote?: string | null,
): T | undefined {
  const footprints = metrics.filter((metric) => metric.metricType === 'users');
  if (basis === undefined) return footprints[0];
  const matching = footprints.filter((metric) => userFootprintBasisFor(metric) === basis);
  if (basis === 'unknown' || basis === 'other') {
    if (methodNote != null) {
      const note = normalizeUserFootprintNote(methodNote);
      return matching.find((metric) => normalizeUserFootprintNote(metric.methodNote) === note);
    }
    return matching.length === 1 ? matching[0] : undefined;
  }
  return matching[0];
}

const scoreableBases = new Set<UserFootprintBasis>(SCOREABLE_USER_FOOTPRINT_BASES);

export function isScoreableUserFootprintBasis(
  basis: UserFootprintBasis | null | undefined,
): basis is ComparableUserFootprintBasis {
  return basis != null && scoreableBases.has(basis);
}

/**
 * Infer a denominator only when a saved note names it plainly. Ambiguous
 * historical values intentionally stay unclassified rather than being guessed.
 */
export function inferUserFootprintBasis(note: string | null | undefined): UserFootprintBasis {
  if (!note) return 'unknown';
  const text = note.toLowerCase();
  const hasTimedActivity = /\b(?:dau|wau|mau|daily|weekly|monthly) active users?\b/.test(text);
  const hasQualifiedCustomerCount =
    /\b(?:business customer accounts?|enterprise customers?|business customers?|paying business accounts?|paying business customers?|individual paying customers?|paying individual customers?)\b/.test(
      text,
    );
  const specific: [UserFootprintBasis, RegExp][] = [
    ['daily_active_users', /\b(?:dau|daily active users?)\b/],
    ['weekly_active_users', /\b(?:wau|weekly active users?)\b/],
    ['monthly_active_users', /\b(?:mau|monthly active users?)\b/],
    ['active_workspaces', /\bactive (?:workspaces?|teams?)\b/],
    ['paid_seats', /\b(?:paid|billable) seats?\b/],
    ['paying_business_accounts', /\bpaying business (?:accounts?|customers?)\b/],
    [
      'business_customer_accounts',
      /\b(?:business customer accounts?|enterprise customers?|business customers?)\b/,
    ],
    [
      'individual_paying_customers',
      /\b(?:individual paying customers?|paying individual customers?)\b/,
    ],
    ['registered_accounts', /\b(?:registered accounts?|registered users?)\b/],
    ['github_stars', /\b(?:github|repository|repo) stars?\b/],
    ['downloads_or_installs', /\b(?:downloads?|installs?)\b/],
    ['social_followers', /\b(?:followers?|social following)\b/],
    ['social_reach', /\bsocial reach\b/],
    ['waitlist_signups', /\b(?:wait[ -]?list|prelaunch signups?)\b/],
    ['newsletter_subscribers', /\b(?:newsletter subscribers?|email subscribers?|email list)\b/],
    ['active_users_unspecified', hasTimedActivity ? /$^/ : /\bactive users?\b/],
    ['customers_unspecified', hasQualifiedCustomerCount ? /$^/ : /\b(?:customers?|clients?)\b/],
  ];
  const matches = specific.filter(([, pattern]) => pattern.test(text)).map(([basis]) => basis);
  const distinctMatches = [...new Set(matches)];
  if (distinctMatches.length === 1) return distinctMatches[0]!;
  // A compound row such as "app installs + email list" has no single unit.
  // Generic "signups" and "users" are also insufficient to infer a cohort.
  return 'unknown';
}

export function userFootprintLabel(
  basis: UserFootprintBasis | null | undefined,
  methodNote?: string | null,
): string {
  return USER_FOOTPRINT_BASIS_LABELS[basis ?? inferUserFootprintBasis(methodNote)];
}

/**
 * Pick the most represented comparable basis in one deck. A single basis is
 * shared by every company score, so MAU and customer-account ranks cannot be
 * mixed into one apparently comparable scale band.
 */
export function buildUserFootprintCohort(
  metrics: readonly UserFootprintMetricLike[],
): UserFootprintCohort {
  const groups = new Map<UserFootprintBasis, Map<string, number>>();
  for (const [index, metric] of metrics.entries()) {
    if (
      metric.metricType !== 'users' ||
      metric.value === null ||
      !Number.isFinite(metric.value) ||
      metric.value < 0 ||
      metric.confidence === 'unknown'
    ) {
      continue;
    }

    // Only infer for legacy rows with no structured field. An explicit
    // `unknown` from research is a deliberate no-classification result.
    const basis = metric.userBasis ?? inferUserFootprintBasis(metric.methodNote);
    if (!isScoreableUserFootprintBasis(basis)) continue;
    const group = groups.get(basis) ?? new Map<string, number>();
    const identity = metric.companyId ?? `row:${index}`;
    if (!group.has(identity)) group.set(identity, metric.value);
    groups.set(basis, group);
  }

  const selected = SCOREABLE_USER_FOOTPRINT_BASES.flatMap((basis) => {
    const group = groups.get(basis);
    return group ? [{ basis, values: [...group.values()] }] : [];
  }).sort((a, b) => b.values.length - a.values.length)[0];

  return selected ?? { basis: 'unknown', values: [] };
}
