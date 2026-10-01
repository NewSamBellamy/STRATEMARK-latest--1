import { describe, expect, it, vi } from 'vitest';
import type { ZodType } from 'zod';
import type { LlmClient } from './types';
import {
  IncrementalDeltaAgent,
  buildEntityIdentityKeys,
  buildExclusionClause,
  expandDeckWithDeltaAgent,
  normalizeEntityName,
  translateExpandFocus,
} from './delta-agent';
import { createResearchUsageMeter } from './usage-meter';

function fakeClient(mockOverrides?: {
  discoveryCompanies?: Array<{
    name: string;
    domain: string | null;
    descriptor?: string;
    primaryRole?: 'company' | 'infrastructure' | 'distribution' | null;
    cardTypes?: string[];
  }>;
  enrichment?: Record<string, unknown>;
  tierReview?: { nudge: -1 | 0 | 1; reason: string | null };
  citations?: Array<{ title: string; url: string }>;
}): LlmClient {
  const citations = mockOverrides?.citations ?? [
    { title: 'TechCrunch Article', url: 'https://techcrunch.example/news/delta' },
    { title: 'SEC Filing Report', url: 'https://sec.gov/filing/delta' },
  ];

  return {
    ground: vi.fn(async () => ({
      text: 'Grounded search output notes',
      citations,
      queries: ['grounded query'],
    })),
    structure: vi.fn(async (prompt: string, schema: ZodType<unknown>) => {
      // 1. Discovery Pass
      if (prompt.includes('"companies"')) {
        const companies = mockOverrides?.discoveryCompanies ?? [
          {
            name: 'Delta Stealth Inc',
            domain: 'deltastealth.ai',
            descriptor: 'Pre-product R&D research lab',
            cardTypes: ['company'],
          },
          {
            name: 'Epsilon Cloud Systems',
            domain: 'epsiloncloud.com',
            descriptor: 'GPU orchestration and serverless inference infrastructure',
            cardTypes: ['infrastructure'],
          },
          {
            name: 'Zeta Marketplace LLC',
            domain: 'zetamarket.io',
            descriptor: 'Model marketplace and distribution hub',
            cardTypes: ['distribution'],
          },
        ];
        return schema.parse({ companies });
      }

      // 2. Tier Review Pass
      if (prompt.includes('BASE TIER') || prompt.includes('EVIDENCE:')) {
        return schema.parse(mockOverrides?.tierReview ?? { nudge: 0, reason: null });
      }

      // 3. Company Enrichment Pass
      const enrichment = mockOverrides?.enrichment ?? {
        oneLiner: 'Cutting-edge AI startup',
        hqLocation: 'San Francisco, CA',
        website: 'https://deltastealth.ai',
        brand: { primary: '#4f46e5', secondary: '#a5b4fc', accent: '#f59e0b' },
        metrics: {
          arr: { value: null, confidence: 'unknown', sourceIndex: null, method: null },
          valuation: {
            value: 12_000_000,
            confidence: 'estimated',
            sourceIndex: 0,
            method: 'Seed round proxy',
          },
          employees: { value: 6, confidence: 'verified', sourceIndex: 0, method: null },
          users: { value: 500, confidence: 'estimated', sourceIndex: 0, method: 'Beta users' },
        },
        viceClaims: [
          { text: 'Previous domain dispute settled in 2025', sourceIndex: 0 },
          { text: 'Fabricated rumor with no source', sourceIndex: null }, // Dropped
        ],
        cultureNote: 'Active contributor to open-source agent frameworks.',
      };
      return schema.parse(enrichment);
    }) as LlmClient['structure'],
  };
}

describe('Incremental Delta Search Agent — Identity & Normalization', () => {
  it('normalizes entity names by stripping legal suffixes and special characters', () => {
    expect(normalizeEntityName('Alpha Technologies, Inc.')).toBe('alpha');
    expect(normalizeEntityName('Beta Systems LLC')).toBe('beta');
    expect(normalizeEntityName('Gamma Group Holdings Ltd.')).toBe('gamma');
    expect(normalizeEntityName('Delta Corporation PLC')).toBe('delta');
    expect(normalizeEntityName('Epsilon AG & Co.')).toBe('epsilon');
    expect(normalizeEntityName('Zeta Solutions GmbH')).toBe('zeta');
    expect(normalizeEntityName('   Theta Ventures   ')).toBe('theta');
    expect(normalizeEntityName('')).toBe('');
  });

  it('generates consistent identity keys for name and root domain', () => {
    const keys1 = buildEntityIdentityKeys('Cognition Labs, Inc.', 'https://app.cognition.ai/login');
    expect(keys1).toContain('cognition');
    expect(keys1).toContain('cognition.ai');

    const keys2 = buildEntityIdentityKeys('Scale AI', 'scale.com');
    expect(keys2).toContain('scaleai');
    expect(keys2).toContain('scale.com');

    const keysNoDomain = buildEntityIdentityKeys('Stealth AI');
    expect(keysNoDomain).toEqual(['stealthai']);
  });

  it('builds comprehensive exclusion clauses across string arrays, object arrays, and cards', () => {
    const exclusions = buildExclusionClause({
      names: ['Alpha Corp', 'Beta Technologies LLC'],
      domains: ['https://beta.com/about', 'gamma.io'],
      companies: [{ name: 'Delta Inc', domain: 'delta.ai' }],
      cards: [
        {
          card: {
            id: 'crd_1',
            deckId: 'd1',
            companyId: 'cmp_1',
            cardType: 'company',
            title: null,
            summary: null,
            tier: 1,
            tierReason: null,
            citations: [],
            keyPoints: [],
            createdAt: '',
          },
          company: {
            id: 'cmp_1',
            name: 'Epsilon AI',
            oneLiner: '',
            logoUrl: null,
            hqLocation: null,
            websiteUrl: 'https://epsilon.ai',
            brandTheme: {
              primary: '',
              secondary: '',
              accent: '',
              text: '',
              background: '',
              fontFamily: null,
              source: 'default',
            },
          },
          metrics: [],
          viceClaims: [],
        },
      ],
    });

    expect(exclusions.keys.has('alpha')).toBe(true);
    expect(exclusions.keys.has('beta')).toBe(true);
    expect(exclusions.keys.has('beta.com')).toBe(true);
    expect(exclusions.keys.has('gamma.io')).toBe(true);
    expect(exclusions.keys.has('delta')).toBe(true);
    expect(exclusions.keys.has('delta.ai')).toBe(true);
    expect(exclusions.keys.has('epsilonai')).toBe(true);
    expect(exclusions.keys.has('epsilon.ai')).toBe(true);

    expect(exclusions.exclusionText).toContain('Alpha Corp');
    expect(exclusions.exclusionText).toContain('Beta Technologies LLC');
    expect(exclusions.exclusionText).toContain('Delta Inc');
    expect(exclusions.exclusionText).toContain('Epsilon AI');
  });

  it('handles empty exclusion inputs gracefully', () => {
    const empty1 = buildExclusionClause(undefined);
    expect(empty1.exclusionText).toBe('(none)');
    expect(empty1.keys.size).toBe(0);

    const empty2 = buildExclusionClause([]);
    expect(empty2.exclusionText).toBe('(none)');
    expect(empty2.keys.size).toBe(0);
  });
});

describe('Incremental Delta Search Agent — Precision Focus Translation', () => {
  it('translates all 8 size bands into evidence-led scale search instructions', () => {
    const t1 = translateExpandFocus({ tier: 1 });
    expect(t1.targetTier).toBe(1);
    expect(t1.primaryCardType).toBe('company');
    expect(t1.focusPrompt).toContain('Minimal footprint');
    expect(t1.focusPrompt).toContain('size cues only');
    expect(t1.focusPrompt).not.toContain('pre-product');

    const t2 = translateExpandFocus({ tier: 2 });
    expect(t2.targetTier).toBe(2);
    expect(t2.focusPrompt).toContain('Very small footprint');

    const t3 = translateExpandFocus({ tier: 3 });
    expect(t3.targetTier).toBe(3);
    expect(t3.focusPrompt).toContain('Small footprint');

    const t4 = translateExpandFocus({ tier: 4 });
    expect(t4.targetTier).toBe(4);
    expect(t4.focusPrompt).toContain('Mid-sized footprint');

    const t5 = translateExpandFocus({ tier: 5 });
    expect(t5.targetTier).toBe(5);
    expect(t5.focusPrompt).toContain('Substantial footprint');

    const t6 = translateExpandFocus({ tier: 6 });
    expect(t6.targetTier).toBe(6);
    expect(t6.focusPrompt).toContain('Large footprint');

    const t7 = translateExpandFocus({ tier: 7 });
    expect(t7.targetTier).toBe(7);
    expect(t7.focusPrompt).toContain('Very large footprint');

    const t8 = translateExpandFocus({ tier: 8 });
    expect(t8.targetTier).toBe(8);
    expect(t8.focusPrompt).toContain('Largest footprint');
    expect(t8.focusPrompt).toContain('$1B+ ARR or 10,000+ employees');
    expect(t8.focusPrompt).not.toContain('category-defining');
    expect(t8.focusPrompt).toContain('leadership are not implied');
  });

  it('translates card types into role-specific search prompts', () => {
    const infra = translateExpandFocus({ cardType: 'infrastructure' });
    expect(infra.primaryCardType).toBe('infrastructure');
    expect(infra.discoveryFocus).toBe('infrastructure');
    expect(infra.focusPrompt).toContain('Infrastructure');
    expect(infra.focusPrompt).toContain('compute');

    const dist = translateExpandFocus({ cardType: 'distribution' });
    expect(dist.primaryCardType).toBe('distribution');
    expect(dist.discoveryFocus).toBe('distribution');
    expect(dist.focusPrompt).toContain('Distribution');
    expect(dist.focusPrompt).toContain('marketplaces');

    const vice = translateExpandFocus({ cardType: 'vice' });
    expect(vice.primaryCardType).toBe('vice');
    expect(vice.focusPrompt).toContain('Vice');
    expect(vice.focusPrompt).toContain('controversies');

    const culture = translateExpandFocus({ cardType: 'culture' });
    expect(culture.primaryCardType).toBe('culture');
    expect(culture.focusPrompt).toContain('Community');
    expect(culture.focusPrompt).toContain('community');
  });

  it('translates free-text strings and detects embedded tier or card-type intents', () => {
    const textTier1 = translateExpandFocus('Hunt for Tier 1 sandbox startups');
    expect(textTier1.targetTier).toBe(1);

    const textInfra = translateExpandFocus(
      'Search for GPU compute & infrastructure tooling providers',
    );
    expect(textInfra.primaryCardType).toBe('infrastructure');

    const freeQuery = translateExpandFocus('Autonomous robotics startups in Southern California');
    expect(freeQuery.focusPrompt).toContain('Autonomous robotics startups in Southern California');
    expect(freeQuery.primaryCardType).toBe('company');
  });
});

describe('Incremental Delta Search Agent — Execution, Diffing & Hydration', () => {
  it('executes delta search, filters already-known entities, and hydrates new companies', async () => {
    const client = fakeClient({
      discoveryCompanies: [
        {
          name: 'Existing Co Inc', // Should be excluded
          domain: 'existing.com',
          descriptor: 'Already in deck',
          cardTypes: ['company'],
        },
        {
          name: 'Novel AI Lab',
          domain: 'novelai.example',
          descriptor: 'New frontier lab',
          cardTypes: ['company', 'vice'],
        },
        {
          name: 'Novel AI Lab Duplicate', // Should be deduplicated
          domain: 'novelai.example',
          descriptor: 'Duplicate entry',
          cardTypes: ['company'],
        },
      ],
      enrichment: {
        oneLiner: 'Innovative research laboratory',
        hqLocation: 'New York, NY',
        website: 'https://novelai.example',
        brand: { primary: '#10b981', secondary: '#a7f3d0', accent: '#f59e0b' },
        metrics: {
          arr: { value: null, confidence: 'unknown', sourceIndex: null, method: null },
          valuation: { value: null, confidence: 'unknown', sourceIndex: null, method: null },
          employees: { value: 30, confidence: 'verified', sourceIndex: 0, method: null },
          users: { value: 10_000, confidence: 'estimated', sourceIndex: 0, method: 'est' },
        },
        viceClaims: [
          { text: 'Litigation pending regarding training dataset copyright', sourceIndex: 0 },
        ],
        cultureNote: 'Hosts monthly open AI safety roundtables.',
      },
    });

    const agent = new IncrementalDeltaAgent(client, {
      marketName: 'Generative Media',
      vertical: 'ai_infra_compute',
      deckId: 'deck_test_1',
      userFootprintCohort: { basis: 'unknown', values: [] },
    });

    const onEvent = vi.fn();
    const result = await agent.searchDelta({
      focus: { tier: 3 },
      target: 2,
      exclude: ['Existing Co Inc', 'existing.com'],
      onEvent,
    });

    expect(client.ground).toHaveBeenCalledTimes(2); // 1 discover + 1 enrich
    expect(result.stats.discoveredCount).toBe(3);
    expect(result.stats.excludedCount).toBe(1);
    expect(result.stats.deduplicatedCount).toBe(1);
    expect(result.stats.addedCount).toBeGreaterThanOrEqual(1);

    const primaryCard = result.cards.find((c) => c.card.cardType === 'company');
    expect(primaryCard).toBeDefined();
    expect(primaryCard!.company!.name).toBe('Novel AI Lab');
    expect(primaryCard!.company!.websiteUrl).toBe('https://novelai.example');

    // 4-tier proxy estimation: 30 headcount * $220k/head for AI category -> ~$6.6M estimated ARR
    const arrMetric = primaryCard!.metrics.find((m) => m.metricType === 'arr');
    expect(arrMetric).toBeDefined();
    expect(arrMetric!.confidence).toBe('estimated');
    expect(arrMetric!.value).toBe(6_600_000);

    // Facet card emission: Vice card
    const viceCard = result.cards.find((c) => c.card.cardType === 'vice');
    expect(viceCard).toBeDefined();
    expect(viceCard!.viceClaims.length).toBe(1);
    expect(viceCard!.viceClaims[0]?.claimText).toContain('Litigation pending');
    expect(viceCard!.metrics).toEqual([]); // Zero borrowed metrics on signal cards per spec §4

    expect(onEvent).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'status', step: 'discover' }),
    );
    expect(onEvent).toHaveBeenCalledWith(expect.objectContaining({ type: 'candidates' }));
    expect(onEvent).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'status', step: 'enrich' }),
    );
    expect(onEvent).toHaveBeenCalledWith(expect.objectContaining({ type: 'card' }));
  });

  it('tags infrastructure card types properly and retains entity metrics', async () => {
    const client = fakeClient({
      discoveryCompanies: [
        {
          name: 'HyperCompute Cloud',
          domain: 'hypercompute.io',
          descriptor: 'Dedicated AI GPU clustering',
          cardTypes: ['infrastructure'],
        },
      ],
      enrichment: {
        oneLiner: 'High-performance compute clusters',
        hqLocation: 'Austin, TX',
        website: 'https://hypercompute.io',
        brand: null,
        metrics: {
          arr: { value: 15_000_000, confidence: 'verified', sourceIndex: 0, method: null },
          employees: { value: 80, confidence: 'verified', sourceIndex: 0, method: null },
        },
        viceClaims: [],
        cultureNote: null,
      },
    });

    const agent = new IncrementalDeltaAgent(client, {
      marketName: 'Cloud AI Compute',
      vertical: 'ai_infra_compute',
      deckId: 'deck_infra_1',
    });

    const cards = await agent.expandDeck({
      focus: { cardType: 'infrastructure' },
      target: 1,
    });

    expect(cards).toHaveLength(1);
    const card = cards[0]!;
    expect(card.card.cardType).toBe('infrastructure');
    expect(card.company!.name).toBe('HyperCompute Cloud');
    expect(card.metrics.length).toBeGreaterThan(0);
    expect(card.card.tier).toBeGreaterThanOrEqual(1);
  });

  it('honors AbortSignal immediately without firing network passes', async () => {
    const client = fakeClient();
    const agent = new IncrementalDeltaAgent(client);
    const controller = new AbortController();
    controller.abort();

    await expect(
      agent.searchDelta({
        focus: { tier: 1 },
        signal: controller.signal,
      }),
    ).rejects.toThrow();

    expect(client.ground).not.toHaveBeenCalled();
  });

  it('returns empty results honestly when zero credible entities are found', async () => {
    const client = fakeClient({
      discoveryCompanies: [],
    });

    const agent = new IncrementalDeltaAgent(client, { marketName: 'Niche Tech', vertical: 'tech' });
    const result = await agent.searchDelta({
      focus: 'Very obscure quantum technology in Antarctica',
    });

    expect(result.cards).toHaveLength(0);
    expect(result.candidates).toHaveLength(0);
    expect(result.stats.addedCount).toBe(0);
  });

  it('top-level helper expandDeckWithDeltaAgent integrates seamlessly', async () => {
    const client = fakeClient();
    const cards = await expandDeckWithDeltaAgent({
      client,
      marketName: 'Robotics',
      vertical: 'robotics',
      focusPrompt: 'Stealth humanoid robotics labs',
      excludeNames: ['Boston Dynamics'],
      deckId: 'deck_robotics_1',
      userFootprintCohort: { basis: 'unknown', values: [] },
      target: 2,
    });

    expect(cards.length).toBeGreaterThan(0);
    expect(client.ground).toHaveBeenCalled();
  });

  it('propagates one usage meter through discovery, hydration, and tier review', async () => {
    const client = fakeClient({
      discoveryCompanies: [
        {
          name: 'Metered Labs',
          domain: 'metered.example',
          descriptor: 'Metered research company',
          cardTypes: ['company'],
        },
      ],
    });
    const usageMeter = createResearchUsageMeter({
      maxRequests: 20,
      maxInputTokens: 1_000_000,
      maxOutputTokens: 100_000,
    });

    await expandDeckWithDeltaAgent({
      client,
      marketName: 'Metered Market',
      vertical: 'technology',
      deckId: 'deck_metered',
      target: 1,
      usageMeter,
    });

    expect(
      vi.mocked(client.ground).mock.calls.every((call) => call[1]?.usageMeter === usageMeter),
    ).toBe(true);
    expect(
      vi.mocked(client.structure).mock.calls.every((call) => call[2]?.usageMeter === usageMeter),
    ).toBe(true);
  });

  it('applies LLM tier review nudges to adjust base tier and attach reason', async () => {
    const client = fakeClient({
      discoveryCompanies: [
        {
          name: 'Frontier Robotics Corp',
          domain: 'frontierrobotics.example',
          descriptor: 'High-growth humanoid systems',
          cardTypes: ['company'],
        },
      ],
      enrichment: {
        oneLiner: 'Humanoid robotics company',
        hqLocation: 'Boston, MA',
        website: 'https://frontierrobotics.example',
        brand: null,
        metrics: {
          arr: { value: 12_000_000, confidence: 'verified', sourceIndex: 0, method: null },
          employees: { value: 120, confidence: 'verified', sourceIndex: 0, method: null },
        },
        viceClaims: [],
        cultureNote: null,
      },
      tierReview: {
        nudge: 1,
        reason: 'Fastest-growing robotics player in the sector with breakthrough unit economics.',
      },
    });

    const agent = new IncrementalDeltaAgent(client, {
      marketName: 'Robotics',
      vertical: 'robotics',
      deckId: 'deck_123',
    });

    const result = await agent.searchDelta({
      focus: { tier: 4 },
      target: 1,
    });

    expect(result.cards).toHaveLength(1);
    const card = result.cards[0]!.card;
    expect(card.tierReason).toBe(
      'Fastest-growing robotics player in the sector with breakthrough unit economics.',
    );
    expect(card.tier).toBeGreaterThanOrEqual(4);
  });

  it('correctly handles distribution card type focus and sets primary role', async () => {
    const client = fakeClient({
      discoveryCompanies: [
        {
          name: 'ModelHub Exchange',
          domain: 'modelhub.example',
          descriptor: 'Model marketplace and distribution network',
          cardTypes: ['distribution'],
        },
      ],
      enrichment: {
        oneLiner: 'Unified AI model distribution hub',
        hqLocation: 'London, UK',
        website: 'https://modelhub.example',
        brand: null,
        metrics: {
          arr: { value: 8_000_000, confidence: 'verified', sourceIndex: 0, method: null },
          users: { value: 250_000, confidence: 'verified', sourceIndex: 0, method: null },
        },
        viceClaims: [],
        cultureNote: null,
      },
    });

    const agent = new IncrementalDeltaAgent(client, {
      marketName: 'AI Platforms',
      vertical: 'technology',
    });

    const cards = await agent.expandDeck({
      focus: { cardType: 'distribution' },
      target: 1,
    });

    expect(cards).toHaveLength(1);
    expect(cards[0]!.card.cardType).toBe('distribution');
    expect(cards[0]!.company!.name).toBe('ModelHub Exchange');
  });

  it('rejects signal-only candidates that lack a domain (topic dressed as company)', async () => {
    const client = fakeClient({
      discoveryCompanies: [
        {
          name: 'AI Safety Controversy Entity',
          domain: null,
          descriptor: 'Governance debates',
          cardTypes: ['vice'],
        },
        {
          name: 'Legit Startup',
          domain: 'legit.ai',
          descriptor: 'Real company',
          cardTypes: ['company'],
        },
      ],
      enrichment: {
        oneLiner: 'Real operating business',
        hqLocation: 'San Francisco, CA',
        website: 'https://legit.ai',
        brand: null,
        metrics: {
          arr: { value: 1_000_000, confidence: 'verified', sourceIndex: 0, method: null },
        },
        viceClaims: [],
        cultureNote: null,
      },
    });

    const agent = new IncrementalDeltaAgent(client, {
      marketName: 'AI',
      vertical: 'tech',
    });

    const result = await agent.searchDelta({
      focus: 'New entrants',
      target: 2,
    });

    expect(result.rejected).toContain('AI Safety Controversy Entity');
    expect(result.candidates).toHaveLength(1);
    expect(result.candidates[0]!.name).toBe('Legit Startup');
  });

  it('supports context updates and retrieval via setContext / getContext', () => {
    const client = fakeClient();
    const agent = new IncrementalDeltaAgent(client, {
      marketName: 'Initial Market',
      vertical: 'initial_vert',
    });

    expect(agent.getContext().marketName).toBe('Initial Market');
    expect(agent.getContext().vertical).toBe('initial_vert');

    agent.setContext({
      marketName: 'Updated Market',
      deckId: 'deck_updated_456',
    });

    expect(agent.getContext().marketName).toBe('Updated Market');
    expect(agent.getContext().deckId).toBe('deck_updated_456');
    expect(agent.getContext().vertical).toBe('initial_vert');
  });

  it('respects custom proxy estimation overrides (customArrPerFte)', async () => {
    const client = fakeClient({
      discoveryCompanies: [
        {
          name: 'Custom Estimate AI',
          domain: 'customest.ai',
          descriptor: 'AI company',
          cardTypes: ['company'],
        },
      ],
      enrichment: {
        oneLiner: 'AI company',
        hqLocation: 'Palo Alto, CA',
        website: 'https://customest.ai',
        brand: null,
        metrics: {
          arr: { value: null, confidence: 'unknown', sourceIndex: null, method: null },
          employees: { value: 10, confidence: 'verified', sourceIndex: 0, method: null },
        },
        viceClaims: [],
        cultureNote: null,
      },
    });

    const agent = new IncrementalDeltaAgent(client, {
      marketName: 'AI',
      vertical: 'ai_infra_compute',
    });

    const result = await agent.searchDelta({
      focus: { tier: 2 },
      target: 1,
      customArrPerFte: 350_000, // Custom override: $350k/head
    });

    const primaryCard = result.cards[0]!;
    const arrMetric = primaryCard.metrics.find((m) => m.metricType === 'arr');
    expect(arrMetric).toBeDefined();
    expect(arrMetric!.value).toBe(3_500_000); // 10 employees * $350,000
    expect(arrMetric!.methodNote).toContain('$350k');
  });
});
