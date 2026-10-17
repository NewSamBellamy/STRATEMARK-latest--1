import { describe, expect, it } from 'vitest';
import {
  CATEGORY_BENCHMARKS,
  FUNDING_DILUTION_BENCHMARKS,
  FUNDING_ROUND_TYPES,
  detectCategoryBenchmark,
  detectFundingBenchmark,
  estimateArrFromHeadcount,
  estimateArrFromPricingAndFootprint,
  estimatePrivateCompanyMetrics,
  estimateValuationFromFunding,
  formatCurrencyAuditable,
  formatNumberAuditable,
} from './proxy-estimator';

describe('Proxy Estimator — Category Benchmark Detection', () => {
  it('exports valid CATEGORY_BENCHMARKS dictionaries', () => {
    expect(CATEGORY_BENCHMARKS.ai_infra_compute.defaultArrPerFte).toBe(220_000);
    expect(CATEGORY_BENCHMARKS.b2b_vertical_saas.defaultArrPerFte).toBe(160_000);
    expect(CATEGORY_BENCHMARKS.marketplace_ecommerce.defaultArrPerFte).toBe(300_000);
    expect(CATEGORY_BENCHMARKS.general_tech.defaultArrPerFte).toBe(160_000);
  });

  it('exports valid FUNDING_DILUTION_BENCHMARKS dictionaries', () => {
    expect(FUNDING_DILUTION_BENCHMARKS.seed.defaultMultiplier).toBe(8.0);
    expect(FUNDING_DILUTION_BENCHMARKS.series_a.defaultMultiplier).toBe(4.5);
    expect(FUNDING_DILUTION_BENCHMARKS.series_b_c_growth.defaultMultiplier).toBe(5.5);
    expect(FUNDING_DILUTION_BENCHMARKS.general_venture.defaultMultiplier).toBe(5.0);
  });

  it('detects AI / Infra / Compute / DevTools categories', () => {
    const aiQueries = [
      'AI Infrastructure',
      'Autonomous Coding Agents',
      'Compute & GPU Cloud',
      'Hardware Chipmaker',
      'Deep Tech LLM Lab',
      'Developer Tooling & SDKs',
      'Machine Learning Platform',
      'Foundation Model Research',
    ];
    for (const q of aiQueries) {
      const benchmark = detectCategoryBenchmark(q);
      expect(benchmark.key).toBe('ai_infra_compute');
      expect(benchmark.defaultArrPerFte).toBe(220_000);
      expect(benchmark.minArrPerFte).toBe(180_000);
      expect(benchmark.maxArrPerFte).toBe(240_000);
    }
  });

  it('detects Marketplace / E-commerce categories', () => {
    const marketplaceQueries = [
      'Marketplaces & Exchanges',
      'B2B Wholesale Marketplace',
      'E-commerce Platform',
      'Consumer Retail Network',
      'D2C Brand Aggregator',
      'Delivery Reseller Channel',
    ];
    for (const q of marketplaceQueries) {
      const benchmark = detectCategoryBenchmark(q);
      expect(benchmark.key).toBe('marketplace_ecommerce');
      expect(benchmark.defaultArrPerFte).toBe(300_000);
      expect(benchmark.minArrPerFte).toBe(250_000);
      expect(benchmark.maxArrPerFte).toBe(400_000);
    }
  });

  it('detects B2B / Vertical SaaS categories and general software fallback', () => {
    const saasQueries = [
      'B2B SaaS',
      'Vertical SaaS Healthcare',
      'Enterprise Workflow Software',
      'PLG Productivity Tool',
      'CRM System',
      'Fintech Application',
      'Unknown Niche Sector',
    ];
    for (const q of saasQueries) {
      const benchmark = detectCategoryBenchmark(q);
      expect(benchmark.key).toBe('b2b_vertical_saas');
      expect(benchmark.defaultArrPerFte).toBe(160_000);
      expect(benchmark.minArrPerFte).toBe(130_000);
      expect(benchmark.maxArrPerFte).toBe(180_000);
    }
  });

  it('handles null, undefined, and non-string category inputs gracefully', () => {
    expect(detectCategoryBenchmark(null).key).toBe('b2b_vertical_saas');
    expect(detectCategoryBenchmark(undefined).key).toBe('b2b_vertical_saas');
    expect(detectCategoryBenchmark('').key).toBe('b2b_vertical_saas');
  });
});

describe('Proxy Estimator — Funding Round Dilution Detection', () => {
  it('detects Seed / Pre-Seed / Angel rounds (~8x multiplier / ~12.5% dilution)', () => {
    const seedRounds = ['Seed', 'Pre-Seed', 'Angel Round', 'SAFE Note', 'Y Combinator Incubator', 'Grant'];
    for (const r of seedRounds) {
      const benchmark = detectFundingBenchmark(r);
      expect(benchmark.key).toBe('seed');
      expect(benchmark.defaultMultiplier).toBe(8.0);
      expect(benchmark.dilutionPercent).toBe(12.5);
    }
  });

  it('detects Series A rounds (~4.5x multiplier / ~22.0% dilution)', () => {
    const seriesARounds = ['Series A', 'series a', 'Series A Preferred'];
    for (const r of seriesARounds) {
      const benchmark = detectFundingBenchmark(r);
      expect(benchmark.key).toBe('series_a');
      expect(benchmark.defaultMultiplier).toBe(4.5);
      expect(benchmark.dilutionPercent).toBe(22.0);
    }
  });

  it('detects Series B / C / Growth rounds (~5.5x multiplier / ~18.0% dilution)', () => {
    const growthRounds = ['Series B', 'Series C', 'Series D', 'Growth Round', 'Late Stage Expansion'];
    for (const r of growthRounds) {
      const benchmark = detectFundingBenchmark(r);
      expect(benchmark.key).toBe('series_b_c_growth');
      expect(benchmark.defaultMultiplier).toBe(5.5);
      expect(benchmark.dilutionPercent).toBe(18.0);
    }
  });

  it('falls back to general venture benchmark for unspecified rounds', () => {
    const benchmark = detectFundingBenchmark('Strategic Capital Injection');
    expect(benchmark.key).toBe('general_venture');
    expect(benchmark.defaultMultiplier).toBe(5.0);
    expect(benchmark.dilutionPercent).toBe(20.0);
  });
});

describe('Proxy Estimator — Number & Currency Formatting Helpers', () => {
  it('formats currency cleanly across thousands, millions, and billions', () => {
    expect(formatCurrencyAuditable(40)).toBe('$40');
    expect(formatCurrencyAuditable(480)).toBe('$480');
    expect(formatCurrencyAuditable(160_000)).toBe('$160k');
    expect(formatCurrencyAuditable(220_000)).toBe('$220k');
    expect(formatCurrencyAuditable(1_200_000)).toBe('$1.2M');
    expect(formatCurrencyAuditable(6_300_000)).toBe('$6.3M');
    expect(formatCurrencyAuditable(54_000_000)).toBe('$54M');
    expect(formatCurrencyAuditable(110_000_000)).toBe('$110M');
    expect(formatCurrencyAuditable(1_000_000_000)).toBe('$1B');
    expect(formatCurrencyAuditable(2_500_000_000)).toBe('$2.5B');
    expect(formatCurrencyAuditable(0)).toBe('$0');
  });

  it('formats headcount and integer counts with commas', () => {
    expect(formatNumberAuditable(35)).toBe('35');
    expect(formatNumberAuditable(2500)).toBe('2,500');
    expect(formatNumberAuditable(100000)).toBe('100,000');
  });
});

describe('Proxy 1 — Headcount Multiplier (ARR Estimation)', () => {
  it('estimates ARR for AI / Infrastructure companies using $220k/FTE benchmark', () => {
    const result = estimateArrFromHeadcount(50, 'AI Infrastructure & DevTools');
    expect(result).not.toBeNull();
    expect(result!.metricType).toBe('arr');
    expect(result!.value).toBe(11_000_000); // 50 * $220k
    expect(result!.confidence).toBe('estimated');
    expect(result!.methodNote).toBe(
      'Estimated: 50 FTEs × $220k AI / Infra / Compute benchmark = ~$11M ARR.',
    );
  });

  it('estimates ARR for B2B / Vertical SaaS companies using $160k/FTE benchmark', () => {
    const result = estimateArrFromHeadcount(25, 'Vertical SaaS', [], {
      sourceNote: 'LinkedIn hiring data',
    });
    expect(result).not.toBeNull();
    expect(result!.metricType).toBe('arr');
    expect(result!.value).toBe(4_000_000); // 25 * $160k
    expect(result!.confidence).toBe('estimated');
    expect(result!.methodNote).toBe(
      'Estimated: 25 FTEs (LinkedIn hiring data) × $160k B2B / Vertical SaaS benchmark = ~$4M ARR.',
    );
  });

  it('estimates ARR for Marketplaces using $300k/FTE benchmark', () => {
    const result = estimateArrFromHeadcount(30, 'E-commerce Marketplace');
    expect(result).not.toBeNull();
    expect(result!.metricType).toBe('arr');
    expect(result!.value).toBe(9_000_000); // 30 * $300k
    expect(result!.confidence).toBe('estimated');
    expect(result!.methodNote).toBe(
      'Estimated: 30 FTEs × $300k Marketplace / E-commerce benchmark = ~$9M ARR.',
    );
  });

  it('supports custom ARR per FTE overrides', () => {
    const result = estimateArrFromHeadcount(40, 'B2B SaaS', [], {
      customArrPerFte: 200_000,
    });
    expect(result).not.toBeNull();
    expect(result!.value).toBe(8_000_000); // 40 * $200k
    expect(result!.methodNote).toContain('$200k');
  });

  it('returns null for missing, zero, or negative headcount', () => {
    expect(estimateArrFromHeadcount(null, 'AI')).toBeNull();
    expect(estimateArrFromHeadcount(undefined, 'AI')).toBeNull();
    expect(estimateArrFromHeadcount(0, 'AI')).toBeNull();
    expect(estimateArrFromHeadcount(-10, 'AI')).toBeNull();
    expect(estimateArrFromHeadcount(Number.NaN, 'AI')).toBeNull();
  });
});

describe('Proxy 2 — VC Funding Dilution Valuation Model', () => {
  it('estimates valuation for Seed rounds ($3M Seed -> ~$24M valuation at 8x / 12.5% dilution)', () => {
    const result = estimateValuationFromFunding({
      amount: 3_000_000,
      roundType: 'Seed Round',
    });
    expect(result).not.toBeNull();
    expect(result!.metricType).toBe('valuation');
    expect(result!.value).toBe(24_000_000); // $3M * 8
    expect(result!.confidence).toBe('estimated');
    expect(result!.methodNote).toBe(
      'Estimated: $3M Seed Round announcement at standard ~12.5% venture dilution (8x multiplier) = ~$24M post-money valuation.',
    );
  });

  it('estimates valuation for Series A rounds ($12M Series A -> ~$54M valuation at 4.5x / 22% dilution)', () => {
    const result = estimateValuationFromFunding({
      amount: 12_000_000,
      roundType: 'Series A',
      sourceUrl: 'https://techcrunch.com/2026/05/series-a',
      sourceTitle: 'TechCrunch Series A Coverage',
    });
    expect(result).not.toBeNull();
    expect(result!.metricType).toBe('valuation');
    expect(result!.value).toBe(54_000_000); // $12M * 4.5
    expect(result!.confidence).toBe('estimated');
    expect(result!.methodNote).toBe(
      'Estimated: $12M Series A announcement at standard ~22% venture dilution (4.5x multiplier) = ~$54M post-money valuation.',
    );
    expect(result!.citations).toEqual([
      {
        url: 'https://techcrunch.com/2026/05/series-a',
        title: 'TechCrunch Series A Coverage',
      },
    ]);
  });

  it('estimates valuation for Series B / C Growth rounds ($20M Series B -> ~$110M valuation at 5.5x / 18% dilution)', () => {
    const result = estimateValuationFromFunding({
      amount: 20_000_000,
      roundType: 'Series B',
    });
    expect(result).not.toBeNull();
    expect(result!.metricType).toBe('valuation');
    expect(result!.value).toBe(110_000_000); // $20M * 5.5
    expect(result!.confidence).toBe('estimated');
    expect(result!.methodNote).toBe(
      'Estimated: $20M Series B announcement at standard ~18% venture dilution (5.5x multiplier) = ~$110M post-money valuation.',
    );
  });

  it('supports custom dilution multiplier overrides', () => {
    const result = estimateValuationFromFunding(
      { amount: 10_000_000, roundType: 'Series A' },
      [],
      { customFundingMultiplier: 6.0 },
    );
    expect(result).not.toBeNull();
    expect(result!.value).toBe(60_000_000); // $10M * 6
    expect(result!.methodNote).toContain('6x multiplier');
  });

  it('returns null for missing, zero, or negative funding amounts', () => {
    expect(estimateValuationFromFunding(null)).toBeNull();
    expect(estimateValuationFromFunding(undefined)).toBeNull();
    expect(estimateValuationFromFunding({ amount: 0, roundType: 'Seed' })).toBeNull();
    expect(estimateValuationFromFunding({ amount: -5_000_000, roundType: 'Seed' })).toBeNull();
    expect(estimateValuationFromFunding({ amount: Number.NaN, roundType: 'Seed' })).toBeNull();
  });
});

describe('Proxy 3 — Pricing Tier × Customer Footprint', () => {
  it('estimates ARR from monthly pricing and active team footprint', () => {
    const result = estimateArrFromPricingAndFootprint(
      { monthlyPrice: 40 },
      2_500,
      [],
      { footprintLabel: 'active teams' },
    );
    expect(result).not.toBeNull();
    expect(result!.metricType).toBe('arr');
    expect(result!.value).toBe(1_200_000); // 2,500 * ($40 * 12) = $1.2M
    expect(result!.confidence).toBe('estimated');
    expect(result!.methodNote).toBe(
      'Estimated: 2,500 active teams × $40/mo standard tier ($480/yr) = ~$1.2M ARR.',
    );
  });

  it('estimates ARR from annual enterprise contract pricing', () => {
    const result = estimateArrFromPricingAndFootprint(
      { annualPrice: 12_000, tierName: 'Enterprise' },
      50,
      [],
      { footprintLabel: 'verified customer logos' },
    );
    expect(result).not.toBeNull();
    expect(result!.metricType).toBe('arr');
    expect(result!.value).toBe(600_000); // 50 * $12,000 = $600k
    expect(result!.confidence).toBe('estimated');
    expect(result!.methodNote).toBe(
      'Estimated: 50 verified customer logos × $1k/mo standard Enterprise tier ($12k/yr) = ~$600k ARR.',
    );
  });

  it('estimates ARR from price ranges (lowestPrice & highestPrice midpoint)', () => {
    const result = estimateArrFromPricingAndFootprint(
      { lowestPrice: 20, highestPrice: 60 },
      1_000,
      [],
      { footprintLabel: 'active subscriptions' },
    );
    expect(result).not.toBeNull();
    expect(result!.metricType).toBe('arr');
    expect(result!.value).toBe(480_000); // 1,000 * (($20+$60)/2 * 12) = 1,000 * $480 = $480k
    expect(result!.confidence).toBe('estimated');
    expect(result!.methodNote).toBe(
      'Estimated: 1,000 active subscriptions × $40/mo standard tier ($480/yr) = ~$480k ARR.',
    );
  });

  it('returns null for missing pricing or zero/negative footprint', () => {
    expect(estimateArrFromPricingAndFootprint(null, 100)).toBeNull();
    expect(estimateArrFromPricingAndFootprint({ monthlyPrice: 50 }, null)).toBeNull();
    expect(estimateArrFromPricingAndFootprint({ monthlyPrice: 50 }, 0)).toBeNull();
    expect(estimateArrFromPricingAndFootprint({ monthlyPrice: 50 }, -10)).toBeNull();
  });
});

describe('Proxy 4 & Orchestrated Engine — estimatePrivateCompanyMetrics', () => {
  it('computes full proxy estimates for a standard venture-backed AI startup', () => {
    const results = estimatePrivateCompanyMetrics(
      'PromptEngine Labs',
      'AI Infrastructure & Autonomous Agents',
      {
        headcount: 35,
        headcountSource: 'LinkedIn hiring data',
        lastFundingRound: {
          amount: 15_000_000,
          roundType: 'Series A',
          sourceUrl: 'https://news.example/promptengine-a',
          sourceTitle: 'PromptEngine Raises $15M Series A',
        },
      },
    );

    expect(results).toHaveLength(2);

    const arr = results.find((r) => r.metricType === 'arr')!;
    expect(arr).toBeDefined();
    expect(arr.value).toBe(7_700_000); // 35 * $220k = $7.7M
    expect(arr.confidence).toBe('estimated');
    expect(arr.methodNote).toBe(
      'Estimated: 35 FTEs (LinkedIn hiring data) × $220k AI / Infra / Compute benchmark = ~$7.7M ARR.',
    );

    const val = results.find((r) => r.metricType === 'valuation')!;
    expect(val).toBeDefined();
    expect(val.value).toBe(67_500_000); // $15M * 4.5 = $67.5M
    expect(val.confidence).toBe('estimated');
    expect(val.methodNote).toBe(
      'Estimated: $15M Series A announcement at standard ~22% venture dilution (4.5x multiplier) = ~$67.5M post-money valuation.',
    );
    expect(val.citations).toHaveLength(1);
    expect(val.citations[0]!.url).toBe('https://news.example/promptengine-a');
  });

  it('falls back to Pricing × Footprint ARR when headcount is missing', () => {
    const results = estimatePrivateCompanyMetrics(
      'WidgetFlow',
      'B2B SaaS',
      {
        publicUserFootprint: 2_500,
        footprintLabel: 'active teams',
        scrapedPricing: { monthlyPrice: 40 },
        lastFundingRound: { amount: 3_000_000, roundType: 'Seed' },
      },
    );

    expect(results).toHaveLength(2);

    const arr = results.find((r) => r.metricType === 'arr')!;
    expect(arr.value).toBe(1_200_000); // 2,500 * $480 = $1.2M
    expect(arr.methodNote).toContain('2,500 active teams × $40/mo');

    const val = results.find((r) => r.metricType === 'valuation')!;
    expect(val.value).toBe(24_000_000); // $3M * 8 = $24M
  });

  it('prioritizes Headcount (Tier 1) over Pricing × Footprint (Tier 3) when both are present', () => {
    const results = estimatePrivateCompanyMetrics(
      'HybridCo',
      'AI Infrastructure',
      {
        headcount: 20, // 20 * $220k = $4.4M ARR
        publicUserFootprint: 1_000,
        scrapedPricing: { monthlyPrice: 100 }, // 1000 * $1,200 = $1.2M ARR
      },
    );

    expect(results).toHaveLength(1);
    const arr = results[0]!;
    expect(arr.metricType).toBe('arr');
    expect(arr.value).toBe(4_400_000);
    expect(arr.methodNote).toContain('20 FTEs × $220k');
  });

  it('handles stealth/pre-launch companies with honest nulls (Proxy 4)', () => {
    const results = estimatePrivateCompanyMetrics('Stealth AI Inc', 'AI Infrastructure', {});

    expect(results).toHaveLength(2);

    const arr = results.find((r) => r.metricType === 'arr')!;
    expect(arr.value).toBeNull();
    expect(arr.confidence).toBe('unknown');
    expect(arr.methodNote).toContain('No verified headcount or customer pricing footprint disclosed');

    const val = results.find((r) => r.metricType === 'valuation')!;
    expect(val.value).toBeNull();
    expect(val.confidence).toBe('unknown');
    expect(val.methodNote).toContain('No verified venture funding rounds disclosed');
  });

  it('includes explicit unknown records when includeUnknowns option is enabled', () => {
    const results = estimatePrivateCompanyMetrics(
      'BootstrapCo',
      'B2B SaaS',
      { headcount: 15 },
      { includeUnknowns: true },
    );

    expect(results).toHaveLength(2);

    const arr = results.find((r) => r.metricType === 'arr')!;
    expect(arr.value).toBe(2_400_000); // 15 * $160k = $2.4M
    expect(arr.confidence).toBe('estimated');

    const val = results.find((r) => r.metricType === 'valuation')!;
    expect(val.value).toBeNull();
    expect(val.confidence).toBe('unknown');
    expect(val.methodNote).toContain('No verified venture funding rounds disclosed');
  });

  it('propagates citations attached to grounded facts', () => {
    const citations = [
      { url: 'https://sec.gov/filing', title: 'SEC Filing' },
      { url: 'https://bloomberg.com/news', title: 'Bloomberg Report' },
    ];

    const results = estimatePrivateCompanyMetrics(
      'Alpha Co',
      'Vertical SaaS',
      {
        headcount: 50,
        citations,
      },
    );

    expect(results[0]!.citations).toEqual(citations);
  });
});

describe('Deep-Module Interface & 4-Tier Hierarchy Architecture', () => {
  it('exports helper formatting utilities (formatUsd, formatPercent, formatMultiple)', async () => {
    const { formatUsd, formatPercent, formatMultiple, parseIndustryCategory, parseFundingRoundType } =
      await import('./proxy-estimator');

    expect(formatUsd(15_000_000)).toBe('$15,000,000');
    expect(formatPercent(12.5)).toBe('12.5%');
    expect(formatPercent(22.0)).toBe('22%');
    expect(formatMultiple(8.0)).toBe('8.0x');
    expect(formatMultiple(4.5)).toBe('4.5x');

    expect(parseIndustryCategory('AI Cloud Infrastructure')).toBe('ai_infra_compute');
    expect(parseIndustryCategory('E-commerce Marketplace')).toBe('marketplace_ecommerce');
    expect(parseIndustryCategory('B2B Vertical SaaS')).toBe('b2b_vertical_saas');

    expect(parseFundingRoundType('Seed Round')).toBe('seed');
    expect(parseFundingRoundType('Series A')).toBe('series_a');
    expect(parseFundingRoundType('Series B')).toBe('series_b');
    expect(parseFundingRoundType('Series C')).toBe('series_c');
    expect(parseFundingRoundType('Growth')).toBe('growth');
  });

  it('runs estimateGroundedProxies composite engine with investor auditable transparency', async () => {
    const { estimateGroundedProxies } = await import('./proxy-estimator');

    const result = estimateGroundedProxies({
      companyId: 'cmp_anthropic',
      name: 'Anthropic PBC',
      category: 'ai_infra_compute',
      employees: 500,
      funding: {
        amount: 4_000_000_000,
        roundType: 'Series C',
      },
      citations: [
        { url: 'https://anthropic.com', title: 'Anthropic Official' },
      ],
    });

    expect(result.companyId).toBe('cmp_anthropic');
    expect(result.arr).toBeDefined();
    expect(result.arr?.value).toBe(110_000_000); // 500 * $220k = $110M
    expect(result.arr?.confidence).toBe('estimated');
    expect(result.arr?.methodNote).toContain('500 FTEs');
    expect(result.arr?.methodNote).toContain('AI / Infra / Compute benchmark');

    expect(result.valuation).toBeDefined();
    expect(result.valuation?.value).toBe(22_000_000_000); // $4B * 5.5 = $22B
    expect(result.valuation?.confidence).toBe('estimated');
    expect(result.valuation?.methodNote).toContain('$4B Series C announcement');
    expect(result.valuation?.methodNote).toContain('5.5x multiplier');

    expect(result.metrics).toHaveLength(2);
    expect(result.metrics[0]!.citations[0]?.url).toBe('https://anthropic.com');
  });

  it('enforces strictly zero fabricated numbers on incomplete inputs', async () => {
    const { estimateGroundedProxies } = await import('./proxy-estimator');

    const emptyResult = estimateGroundedProxies({
      companyId: 'cmp_mystery',
      name: 'Mystery Startup',
      category: 'ai_infra_compute',
    });

    expect(emptyResult.arr?.value).toBeNull();
    expect(emptyResult.arr?.confidence).toBe('unknown');
    expect(emptyResult.arr?.methodNote).toContain('Unknown: No verified headcount or customer pricing footprint disclosed');

    expect(emptyResult.valuation?.value).toBeNull();
    expect(emptyResult.valuation?.confidence).toBe('unknown');
    expect(emptyResult.valuation?.methodNote).toContain('Unknown: No verified venture funding rounds disclosed');
  });
});

describe('funding round type as a constrained outcome (issue #48)', () => {
  it('exposes the canonical round vocabulary a model may report', () => {
    expect(FUNDING_ROUND_TYPES).toContain('series_a');
    expect(FUNDING_ROUND_TYPES).toContain('pre_seed');
    expect(FUNDING_ROUND_TYPES).not.toContain('Series A'); // prose is not a value
  });

  it('maps every canonical round value to a dilution bracket', () => {
    // The regex classifier was written for prose ("Series A"). Fed the canonical
    // `series_a`, its `series[- ]a` pattern misses the underscore and silently
    // falls through to general_venture — a different multiplier, so a different
    // valuation. Every enum value must land on its intended bracket.
    expect(detectFundingBenchmark('pre_seed').key).toBe('seed');
    expect(detectFundingBenchmark('seed').key).toBe('seed');
    expect(detectFundingBenchmark('series_a').key).toBe('series_a');
    expect(detectFundingBenchmark('series_b').key).toBe('series_b_c_growth');
    expect(detectFundingBenchmark('series_c').key).toBe('series_b_c_growth');
    expect(detectFundingBenchmark('series_d_plus').key).toBe('series_b_c_growth');
    expect(detectFundingBenchmark('growth').key).toBe('series_b_c_growth');
  });

  it('still classifies legacy prose, so decks stored before the enum keep working', () => {
    expect(detectFundingBenchmark('Series A').key).toBe('series_a');
    expect(detectFundingBenchmark('Seed round').key).toBe('seed');
    expect(detectFundingBenchmark(null).key).toBe('general_venture');
  });
});
