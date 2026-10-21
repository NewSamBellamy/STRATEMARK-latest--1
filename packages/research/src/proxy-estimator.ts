/**
 * Grounded Proxy Estimator Engine (§2)
 *
 * Implements a Deep-Module Clean Architecture for grounded financial metric
 * proxy estimation under the Stratemark Multi-Agent Backend Specification.
 *
 * When hard empirical figures (e.g. ARR, post-money valuation) are private
 * or not directly disclosed in grounded search results, this engine derives
 * transparent, auditable proxy estimates from observable facts (FTE headcount,
 * VC funding rounds, pricing footprint) or honestly flags them as Unknown.
 *
 * 4-Tier Proxy Hierarchy:
 *   Tier 1: Pricing Tier × Footprint (direct operational/commercial evidence)
 *   Tier 2: Headcount Multiplier (empirical category-aware FTE benchmark)
 *   Tier 3: VC Funding Dilution Valuation (capitalization / round multiple)
 *   Tier 4: Honest Null / Unknown (facts missing, zero fabrication)
 *
 * Core Mandates:
 *   1. Deep Module: Simple, strongly-typed export surface hiding deep
 *      mathematical validation, bounds enforcement, and category inference.
 *   2. Explicit Transparency: Every estimate produces an explicit mathematical
 *      formula string in `methodNote` for auditable investor transparency.
 *   3. Zero Fabrication: Strictly zero fabricated numbers or ungrounded assertions.
 */

import type { Citation, CompanyMetric, Confidence, MetricType } from '@mi/contracts';

// ============================================================================
// 1. Domain Types & Enums
// ============================================================================

export type IndustryCategory =
  | 'ai_infra_compute'
  | 'b2b_vertical_saas'
  | 'marketplace_ecommerce'
  | 'general_tech';

export type FundingRoundKey =
  | 'seed'
  | 'series_a'
  | 'series_b_c_growth'
  | 'general_venture';

/**
 * The canonical funding-round vocabulary (issue #48).
 *
 * This tuple is the single source of truth: the `FundingRoundType` union, the
 * model-facing Zod enum in `schemas.ts`, and therefore the native
 * `responseSchema` handed to Gemini are all derived from it. A round type is a
 * CONSTRAINED outcome — it selects a dilution bracket and so moves an estimated
 * valuation — and must never arrive as free prose.
 */
export const FUNDING_ROUND_TYPES = [
  'pre_seed',
  'seed',
  'series_a',
  'series_b',
  'series_c',
  'series_d_plus',
  'growth',
] as const;

export type FundingRoundType = (typeof FUNDING_ROUND_TYPES)[number];

/** Human-readable round names, for method notes a reader has to understand. */
export const FUNDING_ROUND_LABELS: Record<FundingRoundType, string> = {
  pre_seed: 'Pre-Seed',
  seed: 'Seed',
  series_a: 'Series A',
  series_b: 'Series B',
  series_c: 'Series C',
  series_d_plus: 'Series D+',
  growth: 'Growth',
};

/**
 * Which dilution bracket each canonical round belongs to. Explicit rather than
 * pattern-matched, so adding a round value is a compile error here instead of a
 * silent fall-through to `general_venture` (a different multiplier, hence a
 * different valuation).
 */
const CANONICAL_ROUND_BRACKET: Record<FundingRoundType, FundingRoundKey> = {
  pre_seed: 'seed',
  seed: 'seed',
  series_a: 'series_a',
  series_b: 'series_b_c_growth',
  series_c: 'series_b_c_growth',
  series_d_plus: 'series_b_c_growth',
  growth: 'series_b_c_growth',
};

export function isFundingRoundType(value: unknown): value is FundingRoundType {
  return (FUNDING_ROUND_TYPES as readonly unknown[]).includes(value);
}

export type ProxyTier = 1 | 2 | 3 | 4;

export const PROXY_TIER_ORDER: readonly ProxyTier[] = [1, 2, 3, 4] as const;

export const PROXY_TIER_LABELS: Record<ProxyTier, string> = {
  1: 'Tier 1: Pricing Tier × Footprint',
  2: 'Tier 2: Headcount Multiplier',
  3: 'Tier 3: VC Funding Dilution',
  4: 'Tier 4: Honest Null / Unknown',
};

// ============================================================================
// 2. Category & Funding Benchmark Tables
// ============================================================================

export interface CategoryBenchmark {
  readonly key: IndustryCategory;
  readonly label: string;
  readonly defaultArrPerFte: number;
  readonly minArrPerFte: number;
  readonly maxArrPerFte: number;
}

export const CATEGORY_BENCHMARKS: Record<IndustryCategory, CategoryBenchmark> = {
  ai_infra_compute: {
    key: 'ai_infra_compute',
    label: 'AI / Infra / Compute',
    defaultArrPerFte: 220_000,
    minArrPerFte: 180_000,
    maxArrPerFte: 240_000,
  },
  b2b_vertical_saas: {
    key: 'b2b_vertical_saas',
    label: 'B2B / Vertical SaaS',
    defaultArrPerFte: 160_000,
    minArrPerFte: 130_000,
    maxArrPerFte: 180_000,
  },
  marketplace_ecommerce: {
    key: 'marketplace_ecommerce',
    label: 'Marketplace / E-commerce',
    defaultArrPerFte: 300_000,
    minArrPerFte: 250_000,
    maxArrPerFte: 400_000,
  },
  general_tech: {
    key: 'general_tech',
    label: 'General Tech Software',
    defaultArrPerFte: 160_000,
    minArrPerFte: 130_000,
    maxArrPerFte: 180_000,
  },
};

export interface FundingBenchmark {
  readonly key: FundingRoundKey;
  readonly label: string;
  readonly defaultMultiplier: number;
  readonly dilutionPercent: number;
}

export const FUNDING_DILUTION_BENCHMARKS: Record<FundingRoundKey, FundingBenchmark> = {
  seed: {
    key: 'seed',
    label: 'Seed',
    defaultMultiplier: 8.0,
    dilutionPercent: 12.5,
  },
  series_a: {
    key: 'series_a',
    label: 'Series A',
    defaultMultiplier: 4.5,
    dilutionPercent: 22.0,
  },
  series_b_c_growth: {
    key: 'series_b_c_growth',
    label: 'Series B / C / Growth',
    defaultMultiplier: 5.5,
    dilutionPercent: 18.0,
  },
  general_venture: {
    key: 'general_venture',
    label: 'General Venture',
    defaultMultiplier: 5.0,
    dilutionPercent: 20.0,
  },
};

// ============================================================================
// 3. Mathematical Formatting Helpers
// ============================================================================

/**
 * Format a numeric amount in compact auditable currency notation ($40, $160k, $1.2M, $1B).
 */
export function formatCurrencyAuditable(val: number | null | undefined): string {
  if (val === null || val === undefined || !Number.isFinite(val)) return '$0';
  if (val === 0) return '$0';

  const abs = Math.abs(val);
  const sign = val < 0 ? '-' : '';

  if (abs >= 1_000_000_000) {
    const b = abs / 1_000_000_000;
    const formatted = b % 1 === 0 ? b.toFixed(0) : b.toFixed(1).replace(/\.0$/, '');
    return `${sign}$${formatted}B`;
  }
  if (abs >= 1_000_000) {
    const m = abs / 1_000_000;
    const formatted = m % 1 === 0 ? m.toFixed(0) : m.toFixed(1).replace(/\.0$/, '');
    return `${sign}$${formatted}M`;
  }
  if (abs >= 1_000) {
    const k = abs / 1_000;
    const formatted = k % 1 === 0 ? k.toFixed(0) : k.toFixed(1).replace(/\.0$/, '');
    return `${sign}$${formatted}k`;
  }
  return `${sign}$${Math.round(abs)}`;
}

/**
 * Format an integer count with standard thousand-separators (e.g. 2,500, 100,000).
 */
export function formatNumberAuditable(val: number | null | undefined): string {
  if (val === null || val === undefined || !Number.isFinite(val)) return '0';
  return Math.round(val).toLocaleString('en-US');
}

/**
 * Format a numeric amount in standard full USD currency ($X,XXX,XXX).
 */
export function formatUsd(amount: number): string {
  if (!Number.isFinite(amount)) return '$0';
  const rounded = Math.round(amount);
  return `$${rounded.toLocaleString('en-US')}`;
}

/**
 * Format a percentage with clean precision (e.g. 12.5%, 22%).
 */
export function formatPercent(pct: number): string {
  if (!Number.isFinite(pct)) return '0%';
  const formatted = pct % 1 === 0 ? pct.toFixed(0) : pct.toFixed(1);
  return `${formatted}%`;
}

/**
 * Format a multiplier (e.g. 8.0x, 4.5x).
 */
export function formatMultiple(multiplier: number): string {
  if (!Number.isFinite(multiplier)) return '0.0x';
  const str = multiplier.toFixed(2);
  if (str.endsWith('00')) return `${multiplier.toFixed(1)}x`;
  if (str.endsWith('0')) return `${str.slice(0, -1)}x`;
  return `${str}x`;
}

// ============================================================================
// 4. Detection & Parsing Helpers
// ============================================================================

/**
 * Detect the empirical category benchmark from free text, vertical tags, or descriptions.
 */
export function detectCategoryBenchmark(categoryOrPrompt?: string | null): CategoryBenchmark {
  if (!categoryOrPrompt) return CATEGORY_BENCHMARKS.b2b_vertical_saas;
  const s = categoryOrPrompt.toLowerCase();

  // 1. Marketplace / E-commerce check
  if (
    /(marketplace|exchange|wholesale|e-commerce|ecommerce|retail|d2c|reseller|delivery)/i.test(s)
  ) {
    return CATEGORY_BENCHMARKS.marketplace_ecommerce;
  }

  // 2. AI / Infrastructure / Compute / Hardware / DevTools check
  if (
    /(\bai\b|infra|compute|gpu|cloud|hardware|chip|llm|deep tech|developer tooling|sdk|machine learning|foundation model|autonomous coding agent|agent)/i.test(
      s,
    )
  ) {
    return CATEGORY_BENCHMARKS.ai_infra_compute;
  }

  // 3. Default fallback: B2B / Vertical SaaS
  return CATEGORY_BENCHMARKS.b2b_vertical_saas;
}

/**
 * Detect the empirical VC funding dilution benchmark from round names.
 */
export function detectFundingBenchmark(roundTypeOrText?: string | null): FundingBenchmark {
  if (!roundTypeOrText) return FUNDING_DILUTION_BENCHMARKS.general_venture;

  // A canonical enum value is an exact lookup — no pattern matching, so
  // `series_a` can never miss its bracket on an underscore.
  if (isFundingRoundType(roundTypeOrText)) {
    return FUNDING_DILUTION_BENCHMARKS[CANONICAL_ROUND_BRACKET[roundTypeOrText]];
  }

  // Legacy fallback ONLY: decks stored before the enum, and prose that reached
  // us from a non-conforming model. New model output is enum-constrained.
  const s = roundTypeOrText.toLowerCase();

  if (/(seed|pre[- ]?seed|angel|safe|incubator|grant)/i.test(s)) {
    return FUNDING_DILUTION_BENCHMARKS.seed;
  }
  if (/(series[- ]a\b|round[- ]a\b)/i.test(s)) {
    return FUNDING_DILUTION_BENCHMARKS.series_a;
  }
  if (/(series[- ](b|c|d|e|f)|growth|late[- ]stage)/i.test(s)) {
    return FUNDING_DILUTION_BENCHMARKS.series_b_c_growth;
  }

  return FUNDING_DILUTION_BENCHMARKS.general_venture;
}

/**
 * Canonical industry category parser.
 */
export function parseIndustryCategory(input: string | null | undefined): IndustryCategory | null {
  if (!input) return null;
  const detected = detectCategoryBenchmark(input);
  return detected.key;
}

/**
 * Canonical funding round type parser.
 */
export function parseFundingRoundType(input: string | null | undefined): FundingRoundType | null {
  if (!input) return null;
  if (isFundingRoundType(input)) return input;
  const s = input.toLowerCase();

  if (/pre[- ]?seed|angel/.test(s)) return 'pre_seed';
  if (/seed/.test(s)) return 'seed';
  if (/series[- ]?a\b/.test(s)) return 'series_a';
  if (/series[- ]?b\b/.test(s)) return 'series_b';
  if (/series[- ]?c\b/.test(s)) return 'series_c';
  if (/series[- ]?[d-z]\b|late[- ]stage/.test(s)) return 'series_d_plus';
  if (/growth/.test(s)) return 'growth';

  return null;
}

// ============================================================================
// 5. Core Metric Output Structure
// ============================================================================

export interface EstimatedMetric extends CompanyMetric {
  metricType: MetricType;
  value: number | null;
  confidence: Confidence;
  source: string | null;
  citations: Citation[];
  methodNote: string | null;
  capturedAt: string;
  categoryKey?: string;
  arrPerFte?: number;
  multiplier?: number;
  dilutionPercent?: number;
}

export interface HeadcountEstimateOptions {
  sourceNote?: string;
  customArrPerFte?: number;
  companyId?: string;
}

export interface FundingRoundInput {
  amount?: number | null;
  roundType?: string | null;
  sourceUrl?: string | null;
  sourceTitle?: string | null;
}

export interface FundingEstimateOptions {
  customFundingMultiplier?: number;
  companyId?: string;
}

export interface PricingInput {
  monthlyPrice?: number | null;
  annualPrice?: number | null;
  lowestPrice?: number | null;
  highestPrice?: number | null;
  tierName?: string | null;
}

export interface PricingFootprintOptions {
  footprintLabel?: string;
  companyId?: string;
}

export interface PrivateCompanyResearchData {
  headcount?: number | null;
  headcountSource?: string | null;
  publicUserFootprint?: number | null;
  footprintLabel?: string | null;
  scrapedPricing?: PricingInput | null;
  lastFundingRound?: FundingRoundInput | null;
  citations?: Citation[];
}

export interface EstimateOptions {
  includeUnknowns?: boolean;
}

// ============================================================================
// 6. Tier 1: Pricing Tier × Footprint Estimator
// ============================================================================

/**
 * Estimate ARR using Direct Pricing Tier × Customer Footprint (§2.3).
 *
 * Formula:
 *   ARR = Footprint Count × Annual Subscription Price
 *       = Footprint Count × (Monthly Subscription Price × 12)
 */
export function estimateArrFromPricingAndFootprint(
  pricing?: PricingInput | null,
  footprintCount?: number | null,
  citations: Citation[] = [],
  options?: PricingFootprintOptions,
): EstimatedMetric | null {
  if (
    !pricing ||
    footprintCount === null ||
    footprintCount === undefined ||
    !Number.isFinite(footprintCount) ||
    footprintCount <= 0
  ) {
    return null;
  }

  let monthly: number | null = null;
  let annual: number | null = null;

  if (
    pricing.annualPrice !== null &&
    pricing.annualPrice !== undefined &&
    Number.isFinite(pricing.annualPrice) &&
    pricing.annualPrice > 0
  ) {
    annual = pricing.annualPrice;
    monthly = Math.round(annual / 12);
  } else if (
    pricing.monthlyPrice !== null &&
    pricing.monthlyPrice !== undefined &&
    Number.isFinite(pricing.monthlyPrice) &&
    pricing.monthlyPrice > 0
  ) {
    monthly = pricing.monthlyPrice;
    annual = monthly * 12;
  } else if (
    pricing.lowestPrice !== null &&
    pricing.lowestPrice !== undefined &&
    pricing.highestPrice !== null &&
    pricing.highestPrice !== undefined &&
    Number.isFinite(pricing.lowestPrice) &&
    Number.isFinite(pricing.highestPrice) &&
    pricing.lowestPrice > 0 &&
    pricing.highestPrice >= pricing.lowestPrice
  ) {
    monthly = Math.round((pricing.lowestPrice + pricing.highestPrice) / 2);
    annual = monthly * 12;
  }

  if (annual === null || monthly === null || annual <= 0) {
    return null;
  }

  const arr = Math.round(footprintCount * annual);
  const footprintStr = formatNumberAuditable(footprintCount);
  const unitStr = options?.footprintLabel?.trim() || 'customers';
  const monthlyStr = formatCurrencyAuditable(monthly);
  const annualStr = formatCurrencyAuditable(annual);
  const totalArrStr = formatCurrencyAuditable(arr);
  const tierLabel = pricing.tierName?.trim()
    ? `standard ${pricing.tierName.trim()} tier`
    : 'standard tier';

  const methodNote = `Estimated: ${footprintStr} ${unitStr} × ${monthlyStr}/mo ${tierLabel} (${annualStr}/yr) = ~${totalArrStr} ARR.`;
  const companyId = options?.companyId ?? 'cmp_proxy';

  return {
    id: `met_${companyId}_arr_${Math.random().toString(36).slice(2, 7)}`,
    companyId,
    metricType: 'arr',
    value: arr,
    confidence: 'estimated',
    source: citations[0]?.url ?? null,
    citations,
    methodNote,
    capturedAt: new Date().toISOString(),
  };
}

// Alias matching Deep-Module conventions
export const estimateArrFromFootprint = (
  input: {
    footprintCount: number | null | undefined;
    annualPricePerUnit?: number | null;
    monthlyPricePerUnit?: number | null;
    footprintUnit?: string | null;
    pricingTierName?: string | null;
  },
  citations: Citation[] = [],
) =>
  estimateArrFromPricingAndFootprint(
    {
      annualPrice: input.annualPricePerUnit,
      monthlyPrice: input.monthlyPricePerUnit,
      tierName: input.pricingTierName,
    },
    input.footprintCount,
    citations,
    { footprintLabel: input.footprintUnit ?? undefined },
  );

// ============================================================================
// 7. Tier 2: Headcount Multiplier Estimator
// ============================================================================

/**
 * Estimate ARR using Category-Aware Headcount Multipliers (§2.1).
 *
 * Formula:
 *   ARR = Headcount (FTE) × Benchmark Revenue/FTE
 *
 * Benchmarks:
 *   - AI/Infra/Compute: $180k–$240k/FTE ($220k default)
 *   - B2B/Vertical SaaS: $130k–$180k/FTE ($160k default)
 *   - Marketplaces/E-commerce: $250k–$400k/FTE ($300k default)
 */
export function estimateArrFromHeadcount(
  headcount: number | null | undefined,
  categoryOrPrompt?: string | null,
  citations: Citation[] = [],
  options?: HeadcountEstimateOptions,
): EstimatedMetric | null {
  if (
    headcount === null ||
    headcount === undefined ||
    !Number.isFinite(headcount) ||
    headcount <= 0
  ) {
    return null;
  }

  const benchmark = detectCategoryBenchmark(categoryOrPrompt);
  const arrPerFte =
    options?.customArrPerFte &&
    Number.isFinite(options.customArrPerFte) &&
    options.customArrPerFte > 0
      ? options.customArrPerFte
      : benchmark.defaultArrPerFte;

  const arr = Math.round(headcount * arrPerFte);
  const fteStr = options?.sourceNote
    ? `${formatNumberAuditable(headcount)} FTEs (${options.sourceNote})`
    : `${formatNumberAuditable(headcount)} FTEs`;
  const benchmarkStr = options?.customArrPerFte
    ? `${formatCurrencyAuditable(arrPerFte)} custom benchmark`
    : `${formatCurrencyAuditable(arrPerFte)} ${benchmark.label} benchmark`;
  const methodNote = `Estimated: ${fteStr} × ${benchmarkStr} = ~${formatCurrencyAuditable(arr)} ARR.`;

  const companyId = options?.companyId ?? 'cmp_proxy';
  return {
    id: `met_${companyId}_arr_${Math.random().toString(36).slice(2, 7)}`,
    companyId,
    metricType: 'arr',
    value: arr,
    confidence: 'estimated',
    source: citations[0]?.url ?? null,
    citations,
    methodNote,
    capturedAt: new Date().toISOString(),
    categoryKey: benchmark.key,
    arrPerFte,
  };
}

// ============================================================================
// 8. Tier 3: VC Funding Dilution Valuation Estimator
// ============================================================================

/**
 * Estimate Post-Money Company Valuation using VC Funding Round Dilution (§2.2).
 *
 * Formula:
 *   Post-Money Valuation = Amount Raised × Valuation Multiplier
 *
 * Benchmarks:
 *   - Seed: 8.0x multiplier (12.5% dilution)
 *   - Series A: 4.5x multiplier (22.0% dilution)
 *   - Series B / C / Growth: 5.5x multiplier (18.0% dilution)
 */
export function estimateValuationFromFunding(
  funding?: FundingRoundInput | null,
  citations: Citation[] = [],
  options?: FundingEstimateOptions,
): EstimatedMetric | null {
  if (
    !funding ||
    funding.amount === null ||
    funding.amount === undefined ||
    !Number.isFinite(funding.amount) ||
    funding.amount <= 0
  ) {
    return null;
  }

  const benchmark = detectFundingBenchmark(funding.roundType);
  const multiplier =
    options?.customFundingMultiplier &&
    Number.isFinite(options.customFundingMultiplier) &&
    options.customFundingMultiplier > 0
      ? options.customFundingMultiplier
      : benchmark.defaultMultiplier;

  const valuation = Math.round(funding.amount * multiplier);
  const amountStr = formatCurrencyAuditable(funding.amount);
  // Canonical values are machine vocabulary ("series_a"); a method note is read
  // by a person, so present the human label.
  const rawRound = funding.roundType?.trim();
  const roundLabel = rawRound
    ? isFundingRoundType(rawRound)
      ? FUNDING_ROUND_LABELS[rawRound]
      : rawRound
    : benchmark.label;
  const dilutionStr = `${benchmark.dilutionPercent}%`;
  const multStr = `${multiplier}x`;
  const valuationStr = formatCurrencyAuditable(valuation);

  const methodNote = `Estimated: ${amountStr} ${roundLabel} announcement at standard ~${dilutionStr} venture dilution (${multStr} multiplier) = ~${valuationStr} post-money valuation.`;

  const attachedCitations = [...citations];
  if (funding.sourceUrl && !attachedCitations.some((c) => c.url === funding.sourceUrl)) {
    attachedCitations.unshift({
      url: funding.sourceUrl,
      title: funding.sourceTitle || 'Funding Announcement',
    });
  }

  const companyId = options?.companyId ?? 'cmp_proxy';
  return {
    id: `met_${companyId}_valuation_${Math.random().toString(36).slice(2, 7)}`,
    companyId,
    metricType: 'valuation',
    value: valuation,
    confidence: 'estimated',
    source: attachedCitations[0]?.url ?? null,
    citations: attachedCitations,
    methodNote,
    capturedAt: new Date().toISOString(),
    multiplier,
    dilutionPercent: benchmark.dilutionPercent,
  };
}

// ============================================================================
// 9. Tier 4 & Orchestrated Engine: estimatePrivateCompanyMetrics
// ============================================================================

/**
 * Orchestrate the complete 4-tier proxy hierarchy for a private company (§2).
 *
 * Evaluation hierarchy:
 *   1. Headcount Multiplier (Tier 2) prioritized for ARR when headcount is known.
 *   2. Pricing × Footprint (Tier 1) evaluated when headcount is absent.
 *   3. VC Funding Dilution (Tier 3) evaluated for post-money valuation.
 *   4. Honest Unknowns (Tier 4) emitted when facts are missing. Zero fabrication.
 */
export function estimatePrivateCompanyMetrics(
  companyName: string,
  categoryOrVertical?: string | null,
  data?: PrivateCompanyResearchData | null,
  options?: EstimateOptions,
): EstimatedMetric[] {
  const results: EstimatedMetric[] = [];
  const citations = data?.citations ?? [];
  const companyId = `cmp_${companyName.toLowerCase().replace(/[^a-z0-9]+/g, '_')}`;

  // 1. ARR Estimation: prioritize headcount first, fall back to pricing footprint
  let arrMetric: EstimatedMetric | null = null;
  if (data?.headcount !== undefined && data?.headcount !== null && data.headcount > 0) {
    arrMetric = estimateArrFromHeadcount(data.headcount, categoryOrVertical, citations, {
      sourceNote: data.headcountSource ?? undefined,
      companyId,
    });
  } else if (
    data?.scrapedPricing &&
    data?.publicUserFootprint !== undefined &&
    data?.publicUserFootprint !== null &&
    data.publicUserFootprint > 0
  ) {
    arrMetric = estimateArrFromPricingAndFootprint(
      data.scrapedPricing,
      data.publicUserFootprint,
      citations,
      {
        footprintLabel: data.footprintLabel ?? undefined,
        companyId,
      },
    );
  }

  // 2. Valuation Estimation: VC Funding Dilution
  let valMetric: EstimatedMetric | null = null;
  if (data?.lastFundingRound && data.lastFundingRound.amount && data.lastFundingRound.amount > 0) {
    valMetric = estimateValuationFromFunding(data.lastFundingRound, citations, { companyId });
  }

  const isStealthOrEmpty =
    !data ||
    (!data.headcount &&
      !data.publicUserFootprint &&
      !data.scrapedPricing &&
      !data.lastFundingRound?.amount);

  const shouldIncludeUnknowns = Boolean(options?.includeUnknowns || isStealthOrEmpty);

  if (arrMetric) {
    results.push(arrMetric);
  } else if (shouldIncludeUnknowns) {
    results.push({
      id: `met_${companyId}_arr_${Math.random().toString(36).slice(2, 7)}`,
      companyId,
      metricType: 'arr',
      value: null,
      confidence: 'unknown',
      source: null,
      citations: [],
      methodNote:
        'Unknown: No verified headcount or customer pricing footprint disclosed for private company ARR proxy.',
      capturedAt: new Date().toISOString(),
    });
  }

  if (valMetric) {
    results.push(valMetric);
  } else if (shouldIncludeUnknowns) {
    results.push({
      id: `met_${companyId}_valuation_${Math.random().toString(36).slice(2, 7)}`,
      companyId,
      metricType: 'valuation',
      value: null,
      confidence: 'unknown',
      source: null,
      citations: [],
      methodNote:
        'Unknown: No verified venture funding rounds disclosed for private company valuation proxy.',
      capturedAt: new Date().toISOString(),
    });
  }

  return results;
}

// Deep-Module composite interface alias
export const estimateGroundedProxies = (company: {
  companyId?: string;
  name?: string;
  category?: string | null;
  employees?: number | null;
  funding?: FundingRoundInput | null;
  pricingFootprint?: {
    footprintCount?: number | null;
    monthlyPrice?: number | null;
    annualPrice?: number | null;
    footprintLabel?: string | null;
  } | null;
  citations?: Citation[];
}) => {
  const metrics = estimatePrivateCompanyMetrics(
    company.name ?? company.companyId ?? 'Company',
    company.category,
    {
      headcount: company.employees,
      lastFundingRound: company.funding,
      publicUserFootprint: company.pricingFootprint?.footprintCount,
      footprintLabel: company.pricingFootprint?.footprintLabel,
      scrapedPricing: company.pricingFootprint
        ? {
            monthlyPrice: company.pricingFootprint.monthlyPrice,
            annualPrice: company.pricingFootprint.annualPrice,
          }
        : null,
      citations: company.citations,
    },
    { includeUnknowns: true },
  );

  const arrMetric = metrics.find((m) => m.metricType === 'arr');
  const valMetric = metrics.find((m) => m.metricType === 'valuation');

  return {
    companyId: company.companyId,
    arr: arrMetric,
    valuation: valMetric,
    metrics,
  };
};

// ============================================================================
// Removed: inferScaleFromEntity (institutional scale discriminator)
// ============================================================================
//
// This function returned hardcoded `headcount` / `arr` / `valuation` figures
// matched from a regex over the company NAME, with a catch-all handing ANY
// unrecognized company arr: 800_000 / valuation: 8_000_000. Those numbers
// carried no citation, no confidence tag, and no methodNote.
//
// It was never wired into the card pipeline — its only callers were tests,
// which asserted the fabricated figures as CORRECT. That made it a landmine
// with a green light on it: one import away from putting invented financials
// on a card, in a product whose entire premise is that no figure is invented.
//
// Scale and tier must be derived from grounded, cited metrics via
// estimatePrivateCompanyMetrics + the CMS scoring in @mi/contracts. A prior
// inferred from a company name is model recall, not evidence, and must not
// influence a tier. If a bracket hint is ever needed again, it must return
// null values with confidence: "unknown" and an explicit methodNote.
