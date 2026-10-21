/**
 * Small helpers shared by the read path, the hunts and the prompts for the Source
 * check. The assessment itself lives in source-assessment.ts and is computed on read
 * (assess-facts.ts); latest-wins lives in compare-observations.ts.
 */
import type { CompanyMetric } from '@mi/contracts';
import { hostOf } from './registries/shared';

/**
 * Re-hunting stale or undated figures costs model calls (about two per affected
 * company), so it is OFF (owner decision D6). With it off, hunt targets and model-call
 * counts are identical to before any currency work.
 */
export const HUNT_STALE_FIGURES: boolean = false;

/** Who published the figure's evidence: the first citation's publisher, else the host of its source. Null when unknown. */
export function figurePublisher(metric: Pick<CompanyMetric, 'citations' | 'source'>): string | null {
  const first = metric.citations?.[0];
  return (first?.title?.trim() || hostOf(first?.url ?? metric.source) || null);
}

/** The company's own domain. */
export const companyDomainOf = (website: string | null | undefined): string | null => hostOf(website);
