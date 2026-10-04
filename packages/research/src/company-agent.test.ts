import { describe, expect, it, vi } from 'vitest';
import type { ZodType } from 'zod';
import type { CompanyMetric } from '@mi/contracts';
import type { CompanyCandidate, LlmClient, MarketPlan } from './types';
import type { EnrichmentOut } from './schemas';
import {
  CompanyCardHydrator,
  askCompanyRepresentative,
  brandFrom,
  enrichCompanyWithProxies,
  executeCompanyAgent,
  hydrateCompanyCard,
  metricRows,
  primaryEntityType,
} from './company-agent';

function fakeClient(mockOverrides?: {
  enrichment?: Record<string, unknown>;
  groundedText?: string;
  citations?: Array<{ title: string; url: string }>;
}): LlmClient {
  const citations = mockOverrides?.citations ?? [
    { title: 'techcrunch.com', url: 'https://techcrunch.example/article' },
    { title: 'sec.gov', url: 'https://sec.gov/filing' },
  ];

  return {
    ground: vi.fn(async () => ({
      text: mockOverrides?.groundedText ?? 'Grounded company research notes',
      citations,
      queries: ['query'],
    })),
    structure: vi.fn(async (_prompt: string, schema: ZodType<unknown>) => {
      const enrichment = mockOverrides?.enrichment ?? {
        oneLiner: 'Innovative AI Developer Platform',
        hqLocation: 'San Francisco, CA',
        website: 'https://cognition.example',
        brand: { primary: '#6366f1', secondary: '#c7d2fe', accent: '#f43f5e' },
        metrics: {
          valuation: { value: null, confidence: 'unknown', sourceIndex: null, method: null },
          arr: { value: null, confidence: 'unknown', sourceIndex: null, method: null },
          employees: { value: 45, confidence: 'verified', sourceIndex: 0, method: null },
          users: { value: 12_000, confidence: 'estimated', sourceIndex: 0, method: 'active developers' },
        },
        viceClaims: [
          { text: 'Sued over code copyright claims in 2026', sourceIndex: 0 },
          { text: 'Unsourced online forum rumor', sourceIndex: null }, // Must be dropped
        ],
        cultureNote: 'Active contributor to open source dev tools and foundations.',
      };
      return schema.parse(enrichment);
    }) as LlmClient['structure'],
  };
}

const mockPlan: MarketPlan = {
  marketName: 'AI Developer Tooling & Coding Agents',
  vertical: 'ai_infra_compute',
  geography: 'United States',
  notes: 'Market research for agentic coding tools',
  searchThemes: ['coding agents', 'eval infrastructure'],
};

const mockCandidate: CompanyCandidate = {
  name: 'DevAgent Labs',
  domain: 'devagent.ai',
  descriptor: 'Autonomous code generation agent',
  cardTypes: ['company', 'vice', 'culture'],
};

describe('Company Agent — Brand & Helper Functions', () => {
  it('extracts brand theme when present or falls back to default', () => {
    const scraped = brandFrom({ primary: '#ff0000', secondary: '#00ff00', accent: '#0000ff' });
    expect(scraped.primary).toBe('#ff0000');
    expect(scraped.source).toBe('scraped');

    const fallback = brandFrom(null);
    expect(fallback.primary).toBe('#4f46e5');
    expect(fallback.source).toBe('default');
  });

  it('determines primary entity type accurately across candidate facets', () => {
    expect(primaryEntityType(['company'])).toBe('company');
    expect(primaryEntityType(['infrastructure'])).toBe('infrastructure');
    expect(primaryEntityType(['distribution'])).toBe('distribution');
    expect(primaryEntityType(['company', 'infrastructure'], 'Cloud Compute Corp')).toBe('infrastructure');
    expect(primaryEntityType(['company', 'distribution'], 'AI Model Marketplace Store')).toBe('distribution');
  });

  it('extracts metric rows and enforces provenance rules', () => {
    const citations = [{ title: 'sec.gov', url: 'https://sec.gov/filing' }];
    const metrics = metricRows(
      {
        oneLiner: 'Test',
        hqLocation: null,
        website: null,
        brand: null,
        metrics: {
          arr: { value: 10_000_000, confidence: 'verified', sourceIndex: 0, method: null },
          users: { value: 5_000, confidence: 'estimated', sourceIndex: null, method: 'est' },
        },
        facts: {
          headcount: null,
          lastFundingRound: null,
          scrapedPricing: null,
          publicUserFootprint: null,
          footprintLabel: null,
        },
        viceClaims: [],
        cultureNote: null,
      },
      citations,
      'cmp_test',
    );

    expect(metrics).toHaveLength(2);
    const arr = metrics.find((m) => m.metricType === 'arr')!;
    expect(arr.value).toBe(10_000_000);
    expect(arr.confidence).toBe('verified');
    expect(arr.citations[0]?.url).toBe('https://sec.gov/filing');
  });

  // ------------------------------------------------------------------------
  // The Provenance Gate — issue #48
  // ------------------------------------------------------------------------

  /** An enrichment payload with only the fields a given test cares about. */
  const enrichment = (metrics: Record<string, unknown>): EnrichmentOut =>
    ({
      oneLiner: 'Test',
      hqLocation: null,
      website: null,
      brand: null,
      metrics,
      facts: {
        headcount: null,
        lastFundingRound: null,
        scrapedPricing: null,
        publicUserFootprint: null,
        footprintLabel: null,
      },
      viceClaims: [],
      cultureNote: null,
    }) as unknown as EnrichmentOut;

  it('never lets a model mint a user_verified figure, even with a strong citation', () => {
    // A model claiming `user_verified` is claiming a PERSON signed this off.
    // Nobody did. It must not survive ingestion under any evidence.
    const metrics = metricRows(
      enrichment({
        valuation: { value: 9_000_000_000, confidence: 'user_verified', sourceIndex: 0, method: null },
      }),
      [{ title: 'sec.gov', url: 'https://sec.gov/filing' }],
      'cmp_forge',
    );

    const valuation = metrics.find((m) => m.metricType === 'valuation')!;
    expect(valuation.confidence).not.toBe('user_verified');
    expect(valuation.confidence).toBe('verified'); // earned by the citation instead
    expect(valuation.value).toBe(9_000_000_000); // the figure itself survives
  });

  it('drops a forged user_verified to estimated when no source backs it', () => {
    const metrics = metricRows(
      enrichment({
        arr: { value: 42_000_000, confidence: 'user_verified', sourceIndex: null, method: null },
      }),
      [],
      'cmp_forge2',
    );

    const row = metrics.find((m) => m.metricType === 'arr')!;
    expect(row.confidence).toBe('estimated');
    expect(row.value).toBe(42_000_000);
  });
});

describe('Company Agent — enrichCompanyWithProxies Deep Module', () => {
  it('preserves verified ARR and verified valuation from primary filings without overriding', () => {
    const verifiedMetrics: CompanyMetric[] = [
      {
        id: 'met_arr_1',
        companyId: 'cmp_alpha',
        metricType: 'arr',
        value: 50_000_000,
        confidence: 'verified',
        source: 'https://sec.gov/filing',
        citations: [{ title: 'SEC 10-K', url: 'https://sec.gov/filing' }],
        methodNote: null,
        capturedAt: new Date().toISOString(),
      },
      {
        id: 'met_val_1',
        companyId: 'cmp_alpha',
        metricType: 'market_cap',
        value: 1_200_000_000,
        confidence: 'verified',
        source: 'https://sec.gov/filing',
        citations: [{ title: 'SEC 10-K', url: 'https://sec.gov/filing' }],
        methodNote: null,
        capturedAt: new Date().toISOString(),
      },
      {
        id: 'met_emp_1',
        companyId: 'cmp_alpha',
        metricType: 'employees',
        value: 200,
        confidence: 'verified',
        source: 'https://sec.gov/filing',
        citations: [{ title: 'SEC 10-K', url: 'https://sec.gov/filing' }],
        methodNote: null,
        capturedAt: new Date().toISOString(),
      },
    ];

    const result = enrichCompanyWithProxies(
      { id: 'cmp_alpha', name: 'Alpha Inc', category: 'ai_infra_compute' },
      verifiedMetrics,
    );

    const arr = result.find((m) => m.metricType === 'arr')!;
    expect(arr.value).toBe(50_000_000);
    expect(arr.confidence).toBe('verified');

    const cap = result.find((m) => m.metricType === 'market_cap')!;
    expect(cap.value).toBe(1_200_000_000);
    expect(cap.confidence).toBe('verified');
  });

  it('never overwrites a human-verified figure with a proxy estimate (issue #48)', () => {
    // A user_verified figure is a person's decision. The proxy waterfall only
    // guarded `confidence === 'verified'`, so a human override fell through to
    // the estimator and was silently replaced — automation CLEARING a human
    // decision, which the provenance rules forbid outright.
    const humanOverridden: CompanyMetric[] = [
      {
        id: 'met_val_h',
        companyId: 'cmp_human',
        metricType: 'valuation',
        value: 3_000_000_000,
        confidence: 'user_verified',
        source: 'Confirmed with the founder directly',
        citations: [],
        methodNote: null,
        capturedAt: new Date().toISOString(),
      },
      {
        id: 'met_arr_h',
        companyId: 'cmp_human',
        metricType: 'arr',
        value: 75_000_000,
        confidence: 'user_verified',
        source: 'Confirmed with the CFO',
        citations: [],
        methodNote: null,
        capturedAt: new Date().toISOString(),
      },
      {
        id: 'met_emp_h',
        companyId: 'cmp_human',
        metricType: 'employees',
        value: 400,
        confidence: 'verified',
        source: 'https://sec.gov/filing',
        citations: [{ title: 'SEC 10-K', url: 'https://sec.gov/filing' }],
        methodNote: null,
        capturedAt: new Date().toISOString(),
      },
    ];

    // Headcount and a funding round are both present, so both estimator tiers
    // would fire if the human values were not protected.
    const result = enrichCompanyWithProxies(
      { id: 'cmp_human', name: 'Human Co', category: 'b2b_vertical_saas' },
      humanOverridden,
      { headcount: 400, lastFundingRound: { amount: 100_000_000, roundType: 'series_b' } },
    );

    const valuation = result.find((m) => m.metricType === 'valuation')!;
    expect(valuation.value).toBe(3_000_000_000);
    expect(valuation.confidence).toBe('user_verified');

    const arr = result.find((m) => m.metricType === 'arr')!;
    expect(arr.value).toBe(75_000_000);
    expect(arr.confidence).toBe('user_verified');
  });

  it('computes category-aware ARR proxy from headcount when private company ARR is unverified', () => {
    const initialMetrics: CompanyMetric[] = [
      {
        id: 'met_emp',
        companyId: 'cmp_beta',
        metricType: 'employees',
        value: 30, // 30 FTEs * $220k (AI benchmark) = $6.6M
        confidence: 'verified',
        source: 'https://techcrunch.example',
        citations: [{ title: 'TechCrunch', url: 'https://techcrunch.example' }],
        methodNote: null,
        capturedAt: new Date().toISOString(),
      },
    ];

    const result = enrichCompanyWithProxies(
      { id: 'cmp_beta', name: 'Beta AI', category: 'ai_infra_compute' },
      initialMetrics,
      {
        citations: [{ title: 'TechCrunch', url: 'https://techcrunch.example' }],
      },
    );

    const arr = result.find((m) => m.metricType === 'arr')!;
    expect(arr).toBeDefined();
    expect(arr.value).toBe(6_600_000); // 30 * 220,000
    expect(arr.confidence).toBe('estimated');
    expect(arr.methodNote).toBe(
      'Estimated: 30 FTEs × $220k AI / Infra / Compute benchmark = ~$6.6M ARR.',
    );
    expect(arr.citations.length).toBeGreaterThan(0);
  });

  it('computes VC funding dilution valuation proxy when funding announcement is provided', () => {
    const initialMetrics: CompanyMetric[] = [
      {
        id: 'met_emp',
        companyId: 'cmp_gamma',
        metricType: 'employees',
        value: 20,
        confidence: 'verified',
        source: 'https://techcrunch.example',
        citations: [{ title: 'TechCrunch', url: 'https://techcrunch.example' }],
        methodNote: null,
        capturedAt: new Date().toISOString(),
      },
    ];

    const result = enrichCompanyWithProxies(
      { id: 'cmp_gamma', name: 'Gamma SaaS', category: 'b2b_vertical_saas' },
      initialMetrics,
      {
        lastFundingRound: {
          amount: 10_000_000,
          roundType: 'Series A',
          sourceUrl: 'https://venturebeat.example/gamma-series-a',
          sourceTitle: 'VentureBeat Series A',
        },
        citations: [{ title: 'TechCrunch', url: 'https://techcrunch.example' }],
      },
    );

    const val = result.find((m) => m.metricType === 'valuation')!;
    expect(val).toBeDefined();
    expect(val.value).toBe(45_000_000); // $10M * 4.5 = $45M
    expect(val.confidence).toBe('estimated');
    expect(val.methodNote).toBe(
      'Estimated: $10M Series A announcement at standard ~22% venture dilution (4.5x multiplier) = ~$45M post-money valuation.',
    );
    expect(val.citations.some((c) => c.url === 'https://venturebeat.example/gamma-series-a')).toBe(
      true,
    );
  });

  it('computes ARR proxy from pricing tier and customer footprint when headcount is absent', () => {
    const result = enrichCompanyWithProxies({
      companyId: 'cmp_delta',
      name: 'Delta Platform',
      category: 'b2b_vertical_saas',
      metrics: [],
      pricingFootprint: {
        footprintCount: 500,
        monthlyPrice: 100,
        footprintLabel: 'enterprise customers',
      },
      citations: [{ title: 'Pricing Page', url: 'https://delta.example/pricing' }],
    });

    const arr = result.find((m) => m.metricType === 'arr')!;
    expect(arr).toBeDefined();
    expect(arr.value).toBe(600_000); // 500 * ($100 * 12) = $600k
    expect(arr.confidence).toBe('estimated');
    expect(arr.methodNote).toContain('500 enterprise customers × $100/mo');
  });

  it('emits honest null/unknown (Tier 4) when facts and anchors are completely missing (zero fabrication)', () => {
    const result = enrichCompanyWithProxies(
      { id: 'cmp_stealth', name: 'Stealth AI', category: 'ai_infra_compute' },
      [],
      null,
      { includeUnknowns: true },
    );

    const arr = result.find((m) => m.metricType === 'arr')!;
    expect(arr.value).toBeNull();
    expect(arr.confidence).toBe('unknown');
    expect(arr.methodNote).toContain('No verified headcount or customer pricing footprint disclosed');

    const val = result.find((m) => m.metricType === 'valuation')!;
    expect(val.value).toBeNull();
    expect(val.confidence).toBe('unknown');
    expect(val.methodNote).toContain('No verified venture funding rounds disclosed');
  });
});

describe('Company Agent — hydrateCompanyCard Full Orchestration', () => {
  it('hydrates a full company card with proxy estimation, CMS calculation, and signal separation', async () => {
    const client = fakeClient({
      enrichment: {
        oneLiner: 'Autonomous coding agents for enterprise teams',
        hqLocation: 'Seattle, WA',
        website: 'https://devagent.ai',
        brand: { primary: '#4f46e5', secondary: '#a5b4fc', accent: '#f59e0b' },
        metrics: {
          employees: { value: 50, confidence: 'verified', sourceIndex: 0, method: null },
          users: { value: 10_000, confidence: 'estimated', sourceIndex: 0, method: 'signups' },
          market_share: { value: 5, confidence: 'estimated', sourceIndex: 0, method: 'market estimate' },
        },
        viceClaims: [
          { text: 'Named in 2026 IP lawsuit regarding training data', sourceIndex: 0 },
          { text: 'Unverified blog rumor', sourceIndex: null }, // Dropped
        ],
        cultureNote: 'Hosts weekly open-source hackathons for students.',
      },
    });

    const result = await hydrateCompanyCard({
      candidate: mockCandidate,
      client,
      plan: mockPlan,
      deckId: 'dck_test_123',
    });

    // 1. Company identity
    expect(result.company.name).toBe('DevAgent Labs');
    expect(result.company.oneLiner).toBe('Autonomous coding agents for enterprise teams');
    expect(result.company.brandTheme?.primary).toBe('#4f46e5');
    expect(result.company.websiteUrl).toBe('https://devagent.ai');

    // 2. Proxies applied (50 FTEs * $220k AI benchmark = $11M ARR)
    const arr = result.metrics.find((m) => m.metricType === 'arr')!;
    expect(arr).toBeDefined();
    expect(arr.value).toBe(11_000_000);
    expect(arr.confidence).toBe('estimated');
    // The fixture's techcrunch.example URL is not TechCrunch. Its headcount
    // is now correctly unverified; retain that caveat in the proxy explanation.
    expect(arr.methodNote).toContain('50 FTEs');
    expect(arr.methodNote).toContain('not independently classified');
    expect(arr.methodNote).toContain('× $220k AI / Infra / Compute benchmark');
    expect(result.metrics.find((m) => m.metricType === 'employees')!.confidence).toBe('estimated');

    // 3. CMS Scoring and Tier Assignment
    expect(result.cmsResult.baseTier).not.toBeNull();
    expect(result.cmsResult.finalTier).toBeGreaterThanOrEqual(1);
    expect(result.cmsResult.finalTier).toBeLessThanOrEqual(8);
    expect(result.card.tier).toBe(result.cmsResult.finalTier);

    // 4. Signal cards emission & strict metric isolation
    expect(result.cards).toHaveLength(3); // company, vice, culture
    const companyCard = result.cards.find((c) => c.card.cardType === 'company')!;
    const viceCard = result.cards.find((c) => c.card.cardType === 'vice')!;
    const cultureCard = result.cards.find((c) => c.card.cardType === 'culture')!;

    expect(companyCard.metrics.length).toBeGreaterThan(0);
    expect(viceCard.metrics).toEqual([]); // Signal cards never carry metrics
    expect(cultureCard.metrics).toEqual([]);

    // 5. Sourced vice claims (1 kept, 1 dropped)
    expect(viceCard.viceClaims).toHaveLength(1);
    expect(viceCard.viceClaims[0]!.claimText).toBe('Named in 2026 IP lawsuit regarding training data');
    expect(viceCard.viceClaims[0]!.sourceUrl).toBe('https://techcrunch.example/article');

    // 6. Culture note
    expect(cultureCard.card.summary).toBe('Hosts weekly open-source hackathons for students.');

    // 7. Memory state
    expect(result.memory.companyId).toBe(result.company.id);
    expect(result.memory.companyName).toBe('DevAgent Labs');
    expect(result.memory.dashboard.financials?.arr).toBe(11_000_000);
    expect(result.memory.citations.length).toBeGreaterThan(0);
  });

  it('wires structured enrichment.facts into Grounded Proxy Estimator for private startups', async () => {
    const client = fakeClient({
      enrichment: {
        oneLiner: 'Next-gen private AI infrastructure',
        hqLocation: 'San Francisco, CA',
        website: 'https://infra-startup.example',
        brand: null,
        metrics: {
          market_share: null,
          valuation: null,
          market_cap: null,
          arr: null,
          users: null,
          employees: null,
        },
        facts: {
          headcount: 25,
          lastFundingRound: {
            amount: 20_000_000,
            roundType: 'Series A',
          },
          scrapedPricing: {
            monthlyPrice: 50,
            annualPrice: 500,
          },
          publicUserFootprint: 5_000,
          footprintLabel: 'active developers',
        },
        viceClaims: [],
        cultureNote: null,
      },
    });

    const candidate: CompanyCandidate = {
      name: 'Infra Startup',
      domain: 'infra-startup.example',
      descriptor: 'Specialized GPU cloud platform',
      cardTypes: ['infrastructure'],
    };

    const result = await hydrateCompanyCard({
      candidate,
      client,
      plan: mockPlan,
    });

    // 1. ARR estimated via facts.headcount (25 * $220k = $5.5M)
    const arr = result.metrics.find((m) => m.metricType === 'arr')!;
    expect(arr).toBeDefined();
    expect(arr.value).toBe(5_500_000);
    expect(arr.confidence).toBe('estimated');
    expect(arr.methodNote).toContain('25 FTEs × $220k AI / Infra / Compute benchmark');

    // 2. Valuation estimated via facts.lastFundingRound ($20M * 4.5x = $90M)
    const val = result.metrics.find((m) => m.metricType === 'valuation')!;
    expect(val).toBeDefined();
    expect(val.value).toBe(90_000_000);
    expect(val.confidence).toBe('estimated');
    expect(val.methodNote).toContain('$20M Series A announcement');

    // 3. Card summary fallback inherits candidate.descriptor
    expect(result.card.summary).toBe('Specialized GPU cloud platform');
  });

  it('ensures facet cards (infrastructure, distribution, culture, vice) inherit descriptor or oneLiner as card.summary', async () => {
    const client = fakeClient({
      enrichment: {
        oneLiner: 'Leading reseller and distributor of foundation models',
        hqLocation: 'New York, NY',
        website: 'https://dist-hub.example',
        brand: null,
        metrics: {},
        facts: {},
        viceClaims: [
          { text: 'Under regulatory inquiry for content licensing in 2025', sourceIndex: 0 },
        ],
        cultureNote: 'Commits 2% of equity to open source AI foundations.',
      },
    });

    const candidate: CompanyCandidate = {
      name: 'Model Hub Dist',
      domain: 'dist-hub.example',
      descriptor: 'Global channel distributor for enterprise AI models',
      cardTypes: ['distribution', 'vice', 'culture'],
    };

    const result = await hydrateCompanyCard({
      candidate,
      client,
      plan: mockPlan,
    });

    expect(result.cards).toHaveLength(3);
    const distCard = result.cards.find((c) => c.card.cardType === 'distribution')!;
    const viceCard = result.cards.find((c) => c.card.cardType === 'vice')!;
    const cultureCard = result.cards.find((c) => c.card.cardType === 'culture')!;

    // Distribution card inherits candidate.descriptor / enrichment.oneLiner
    expect(distCard.card.summary).toBe('Global channel distributor for enterprise AI models');
    // Vice card inherits fallback summary
    expect(viceCard.card.summary).toBe('Global channel distributor for enterprise AI models');
    // Culture card uses cultureNote
    expect(cultureCard.card.summary).toBe('Commits 2% of equity to open source AI foundations.');
  });

  it('supports positional arguments signature for hydrateCompanyCard', async () => {
    const client = fakeClient();
    const result = await hydrateCompanyCard(mockCandidate, client, mockPlan, {
      deckId: 'dck_positional',
    });

    expect(result.company.name).toBe('DevAgent Labs');
    expect(result.card.deckId).toBe('dck_positional');
  });

  it('aborts cleanly when signal is triggered', async () => {
    const controller = new AbortController();
    controller.abort();

    const client = fakeClient();
    await expect(
      hydrateCompanyCard({
        candidate: mockCandidate,
        client,
        plan: mockPlan,
        signal: controller.signal,
      }),
    ).rejects.toThrow();
  });
});

describe('Company Agent — Memory & Representative Q&A', () => {
  it('executes executeCompanyAgent returning valid multi-agent memory', async () => {
    const client = fakeClient();
    const memory = await executeCompanyAgent(mockCandidate, client, {
      plan: mockPlan,
      deckId: 'dck_mem_test',
    });

    expect(memory.companyId).toBeDefined();
    expect(memory.companyName).toBe('DevAgent Labs');
    expect(memory.card.company?.name).toBe('DevAgent Labs');
    expect(memory.lastUpdated).toBeDefined();
  });

  it('interactively answers representative questions grounded in company memory', async () => {
    const client = fakeClient();
    const result = await hydrateCompanyCard({
      candidate: mockCandidate,
      client,
      plan: mockPlan,
    });

    // 1. Without LLM client (offline fallback from memory state)
    const offlineAnswer = await askCompanyRepresentative(
      'What is your ARR and team size?',
      result.memory,
    );
    expect(offlineAnswer.answer).toContain('DevAgent Labs');
    expect(offlineAnswer.citations.length).toBeGreaterThan(0);

    // 2. With grounded LLM client
    const groundedAnswer = await askCompanyRepresentative(
      'What are your primary products and legal risks?',
      result.memory,
      client,
    );
    expect(groundedAnswer.answer).toBeDefined();
    expect(client.ground).toHaveBeenCalled();
  });
});

describe('Company Agent — CompanyCardHydrator Stateful Class', () => {
  it('manages stateful hydrations through the class instance', async () => {
    const hydrator = new CompanyCardHydrator(mockCandidate, mockPlan);
    expect(hydrator.getMemory()).toBeUndefined();

    const client = fakeClient();
    const result = await hydrator.hydrate(client, { deckId: 'dck_class_test' });

    expect(result.company.name).toBe('DevAgent Labs');
    expect(hydrator.getMemory()).toBeDefined();
    expect(hydrator.getMemory()?.companyName).toBe('DevAgent Labs');

    // Standalone proxy enrichment method on instance
    const proxies = hydrator.enrichMetricsWithProxies([
      {
        id: 'm1',
        companyId: 'c1',
        metricType: 'employees',
        value: 10,
        confidence: 'verified',
        source: null,
        citations: [],
        methodNote: null,
        capturedAt: new Date().toISOString(),
      },
    ]);
    const arr = proxies.find((m) => m.metricType === 'arr')!;
    expect(arr.value).toBe(2_200_000); // 10 * $220k
  });
});
