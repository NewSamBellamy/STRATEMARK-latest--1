/**
 * computeCompanyCompleteness — the "what's missing?" gate that runs before a
 * report or deep-dive is served. For each company it walks the core slots of
 * the company's market profile (the same PROFILE_CORE_SLOTS table the card
 * face renders) and classifies every slot honestly: filled, unknown (a row
 * exists but holds no trusted value) or absent (no row at all).
 *
 * The anti-fabrication law holds here in its purest form: a gap is an honest
 * gap. Nothing in this module proposes, estimates or defaults a value — it
 * only names what is missing, so the fill machinery can be pointed at it and
 * a caller can decide whether the report is served with disclosed holes.
 *
 * Pure and provider-free: the same classification runs in the repository's
 * readiness pass and in any UI that wants to show readiness before spending.
 */
import {
  METRIC_TYPE_LABELS,
  PROFILE_CORE_SLOTS,
  classifyMarketProfile,
  metricTypeSchema,
  profileMetricTypes,
  type CompanyCompleteness,
  type CompanyCompletenessGap,
  type CompanyMetric,
  type MarketProfile,
} from '@mi/contracts';
import { z } from 'zod';

export type { CompanyCompleteness, CompanyCompletenessGap } from '@mi/contracts';

export const companyCompletenessSchema = z.object({
  companyId: z.string().min(1),
  name: z.string().min(1),
  profile: z.enum(['operating_company', 'financial_firm']),
  gaps: z.array(z.object({
    metricType: metricTypeSchema,
    label: z.string().min(1),
    state: z.enum(['unknown', 'absent']),
  })).default([]),
  ready: z.boolean(),
});

export function computeCompanyCompleteness(input: {
  companyId: string;
  name: string;
  metrics: CompanyMetric[];
  profile?: MarketProfile;
}): CompanyCompleteness {
  const profile = input.profile ?? classifyMarketProfile({ name: input.name });
  const preferred = profileMetricTypes(profile);
  const gaps: CompanyCompletenessGap[] = [];
  for (const slot of PROFILE_CORE_SLOTS[profile]) {
    // Filled: any member carries a value at better-than-unknown confidence —
    // the same criterion the living deck's hasCoreGap applies to the card.
    if (slot.some((type) => input.metrics.some((m) =>
      m.metricType === type && m.value != null && m.confidence !== 'unknown'))) continue;
    const rowed = slot.find((type) => input.metrics.some((m) => m.metricType === type));
    // Unknown names the row that exists (the concrete story); absent names the
    // member this profile's hunt would chase first, so the gap points where
    // research will actually look.
    const metricType = rowed ?? preferred.find((type) => slot.includes(type)) ?? slot[0]!;
    gaps.push({ metricType, label: METRIC_TYPE_LABELS[metricType], state: rowed ? 'unknown' : 'absent' });
  }
  return { companyId: input.companyId, name: input.name, profile, gaps, ready: gaps.length === 0 };
}

/** Deck-level readiness rollup for UI display: who is servable, who is not,
 * and the honest total of what is still missing across the roster. */
export function summarizeDeckCompleteness(reports: CompanyCompleteness[]): {
  readyCompanies: number;
  blockedCompanies: number;
  totalGaps: number;
} {
  return {
    readyCompanies: reports.filter((report) => report.ready).length,
    blockedCompanies: reports.filter((report) => !report.ready).length,
    totalGaps: reports.reduce((sum, report) => sum + report.gaps.length, 0),
  };
}
