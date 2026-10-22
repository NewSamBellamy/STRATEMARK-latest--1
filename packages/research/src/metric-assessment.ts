/**
 * Small helpers shared by the read path, the hunts and the prompts for the Source
 * check. The assessment itself lives in source-assessment.ts and is computed on read
 * (assess-facts.ts); latest-wins lives in compare-observations.ts.
 */
import type { CompanyMetric } from '@mi/contracts';
import { hostOf } from './registries/shared';

/**
 * A deck refresh re-hunts figures that are stale, undated or past their re-hunt window
 * (recency-rank.ts). It costs model calls (about two per affected company, at most
 * REFRESH_STALE_MAX_COMPANIES per refresh: a manual refresh, or the cadence auto-refresh,
 * which never runs for hosted visitors spending the covered allowance).
 * Owner decision D6 had this OFF; turned ON 2026-10-22 after the owner's audit found
 * year-old valuations that a refresh never looked past. Ordinary hunts are unchanged:
 * only `refreshStale` hunts read it.
 */
export const HUNT_STALE_FIGURES: boolean = true;

/** Who published the figure's evidence: the first citation's publisher, else the host of its source. Null when unknown. */
export function figurePublisher(metric: Pick<CompanyMetric, 'citations' | 'source'>): string | null {
  const first = metric.citations?.[0];
  return (first?.title?.trim() || hostOf(first?.url ?? metric.source) || null);
}

/** The company's own domain. */
export const companyDomainOf = (website: string | null | undefined): string | null => hostOf(website);
