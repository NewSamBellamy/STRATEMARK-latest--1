import { describe, expect, it, vi } from 'vitest';
import type { ZodType } from 'zod';
import type { Company, Citation } from '@mi/contracts';
import type { LlmClient, MarketPlan } from './types';
import {
  BarrierToEntryAgent,
  CultureAgent,
  MarketInsightAgent,
  ViceAgent,
  createBarrierCard,
  createCultureCard,
  createInsightCard,
  createViceCard,
  deduplicateClaims,
  extractCultureNote,
  extractSourcedViceClaims,
  normalizeClaimTitle,
  offsetClaimSourceIndices,
  researchBarriersToEntry,
  researchCompanyCulture,
  researchCompanyVice,
  researchMarketInsights,
  researchMarketSignals,
  resolveClaimCitations,
  resolveClaimCitation,
} from './signal-agents';

const samplePlan: MarketPlan = {
  marketName: 'Foundation AI & LLMs',
  vertical: 'Artificial Intelligence',
  geography: 'Global',
  notes: 'Frontier AI models and inference platforms',
  searchThemes: ['frontier compute', 'inference scaling', 'enterprise licensing'],
};

const sampleCompany: Company = {
  id: 'cmp_anthropic_123',
  name: 'Anthropic',
  oneLiner: 'AI safety and research company building Claude.',
  logoUrl: 'https://anthropic.com/favicon.ico',
  hqLocation: 'San Francisco, CA',
  websiteUrl: 'https://anthropic.com',
  brandTheme: {
    primary: '#d97706',
    secondary: '#fef3c7',
    accent: '#2563eb',
    text: '#0f172a',
    background: '#ffffff',
    fontFamily: null,
    source: 'scraped',
  },
};

const sampleCitations: Citation[] = [
  { title: 'reuters.com', url: 'https://reuters.com/article/ai-compute-moats' },
  { title: 'sec.gov', url: 'https://sec.gov/edgar/filings/10k' },
  { title: 'techcrunch.com', url: 'https://techcrunch.com/2026/08/ai-pricing-shifts' },
  { title: 'bloomberg.com', url: 'https://bloomberg.com/news/articles/antitrust-probe' },
];

function createMockLlmClient(responses: {
  groundText?: string;
  citations?: Citation[];
  structureData?: Record<string, unknown>;
}): LlmClient {
  const citations = responses.citations ?? sampleCitations;
  const text = responses.groundText ?? 'Sample grounded research text with verified findings.';

  return {
    ground: vi.fn(async () => ({
      text,
      citations,
      queries: ['query 1', 'query 2'],
    })),
    structure: vi.fn(async (prompt: string, schema: ZodType<unknown>) => {
      if (responses.structureData) {
        return schema.parse(responses.structureData);
      }
      if (prompt.includes('barriers') && prompt.includes('insights')) {
        return schema.parse({
          barriers: [
            {
              title: 'Capital Intensity: $10B+ Frontier Training Clusters',
              summary: 'Training next-generation frontier models requires unprecedented CapEx.',
              sourceIndex: 0,
              keyPoints: [
                'Cluster capital requirements exceed $10B for 100k+ GPU deployments.',
                'Power purchase agreements require 1+ gigawatt dedicated substations.',
                'R&D amortisation cycles are under 18 months due to rapid architecture iteration.',
                'Only top hyperscalers and sovereign funds can fund leading cluster iterations.',
              ],
            },
          ],
          insights: [
            {
              title: 'Pricing Shift: Token-Based to Outcome-Based Enterprise Contracts',
              summary: 'Enterprise buyers are abandoning per-token billing for guaranteed SLA outcomes.',
              sourceIndex: 2,
              keyPoints: [
                'Per-token margins compressed 80% over 12 months across commodity models.',
                'Workday and Salesforce require workflow completion guarantees over raw tokens.',
                'Hybrid inference routing reduces average call cost by 62%.',
                'Enterprise ACVs rose 3.4x when structured around end-to-end task completion.',
              ],
            },
          ],
        });
      }
      if (prompt.includes('barriers')) {
        return schema.parse({
          barriers: [
            {
              title: 'Regulatory Hurdles: EU AI Act High-Risk Compliance',
              summary: 'Stringent conformity assessments create massive compliance barriers.',
              sourceIndex: 1,
              keyPoints: [
                'Article 6 mandates third-party safety audits before EU market deployment.',
                'Compliance costs average $3.2M per foundation model release.',
                'Pre-training data copyright disclosure requirements exclude opaque datasets.',
                'Penalties reach up to 35M EUR or 7% of global annual turnover.',
              ],
            },
          ],
        });
      }
      if (prompt.includes('insights')) {
        return schema.parse({
          insights: [
            {
              title: 'Talent Migration: Systems Engineers Out-Earning Research Scientists',
              summary: 'Inference optimization and distributed systems talent are commanding top premiums.',
              sourceIndex: 0,
              keyPoints: [
                'GPU kernel optimization engineers saw compensation packages surge 45% YoY.',
                'Frontier labs are actively poaching distributed CUDA talent from hardware OEMs.',
                'Quantization and spec-decoding specialists represent 40% of open engineering headcount.',
                'Talent concentration remains locked across SF, Seattle, and London hubs.',
              ],
            },
          ],
        });
      }
      if (prompt.includes('viceClaims')) {
        return schema.parse({
          viceClaims: [
            {
              text: 'Named as defendant in high-profile copyright infringement lawsuit.',
              sourceIndex: 3,
            },
            {
              text: 'Unsourced rumor without any public filing or news report.',
              sourceIndex: null,
            },
          ],
        });
      }
      if (prompt.includes('cultureNote')) {
        return schema.parse({
          cultureNote:
            'Committed to Responsible Scaling Policy with public safety pause commitments.',
        });
      }
      return schema.parse({});
    }) as LlmClient['structure'],
  };
}

describe('Signal Agents Deep Module', () => {
  describe('Helper Functions & Provenance Enforcers', () => {
    it('normalizes claim titles accurately for deduplication', () => {
      expect(normalizeClaimTitle('High Capital Intensity!')).toBe('highcapitalintensity');
      expect(normalizeClaimTitle('  Regulatory: EU AI Act (2026)  ')).toBe(
        'regulatoryeuaiact2026',
      );
      expect(normalizeClaimTitle('')).toBe('');
    });

    it('deduplicates claims preserving order and capping at limit', () => {
      const claims = [
        { title: 'High Capital Intensity', summary: 'A' },
        { title: 'high-capital-intensity', summary: 'B' },
        { title: 'Regulatory Hurdles', summary: 'C' },
        { title: 'REGULATORY HURDLES!!!', summary: 'D' },
        { title: 'Network Effects', summary: 'E' },
      ];
      const deduped = deduplicateClaims(claims, 2);
      expect(deduped).toHaveLength(2);
      expect(deduped[0]!.title).toBe('High Capital Intensity');
      expect(deduped[1]!.title).toBe('Regulatory Hurdles');
    });

    it('offsets claim source indices across multi-pass iterations', () => {
      const claims = [
        { title: 'A', sourceIndex: 0 },
        { title: 'B', sourceIndex: 2 },
        { title: 'C', sourceIndex: null },
      ];
      const offset = offsetClaimSourceIndices(claims, 5);
      expect(offset[0]!.sourceIndex).toBe(5);
      expect(offset[1]!.sourceIndex).toBe(7);
      expect(offset[2]!.sourceIndex).toBeNull();
    });

    it('resolves claim citations and classifies source credibility correctly', () => {
      const secCite = resolveClaimCitation(1, sampleCitations);
      expect(secCite).toHaveLength(1);
      expect(secCite[0]!.url).toBe('https://sec.gov/edgar/filings/10k');
      expect(secCite[0]!.credibility).toBe('primary');

      const reutersCite = resolveClaimCitation(0, sampleCitations);
      expect(reutersCite).toHaveLength(1);
      expect(reutersCite[0]!.credibility).toBe('reputable_secondary');

      // Invalid or out-of-bounds indices return empty array (zero hallucination)
      expect(resolveClaimCitation(null, sampleCitations)).toEqual([]);
      expect(resolveClaimCitation(-1, sampleCitations)).toEqual([]);
      expect(resolveClaimCitation(99, sampleCitations)).toEqual([]);
    });

    it('retains multiple distinct source receipts for one market finding', () => {
      const citations = resolveClaimCitations(0, [0, 1, 99], sampleCitations);
      expect(citations.map((citation) => citation.url)).toEqual([
        'https://reuters.com/article/ai-compute-moats',
        'https://sec.gov/edgar/filings/10k',
      ]);
    });

    it('extracts sourced vice claims dropping unsourced claims', () => {
      const raw = [
        { text: 'Sourced lawsuit', sourceIndex: 3 },
        { text: 'Unsourced rumor', sourceIndex: null },
        { text: 'Direct URL claim', sourceUrl: 'https://apnews.com/article/probe' },
        { text: 'Invalid URL claim', sourceUrl: 'ftp://invalid-url' },
      ];
      const claims = extractSourcedViceClaims(raw, sampleCitations, 'cmp_test');
      expect(claims).toHaveLength(2);
      expect(claims[0]!.claimText).toBe('Sourced lawsuit');
      expect(claims[0]!.sourceUrl).toBe('https://bloomberg.com/news/articles/antitrust-probe');
      expect(claims[0]!.sourceTitle).toBe('bloomberg.com');
      expect(claims[1]!.claimText).toBe('Direct URL claim');
      expect(claims[1]!.sourceUrl).toBe('https://apnews.com/article/probe');
    });

    it('extracts and cleans culture notes', () => {
      expect(extractCultureNote('  501(c)(3) non-profit partnership.  ')).toBe(
        '501(c)(3) non-profit partnership.',
      );
      expect(extractCultureNote('   ')).toBeNull();
      expect(extractCultureNote(null)).toBeNull();
      expect(extractCultureNote(undefined)).toBeNull();
    });
  });

  describe('Card Factory Constructors', () => {
    it('creates fully-formed barrier cards with key points and company: null', () => {
      const cardWithCompany = createBarrierCard(
        'Capital Intensity',
        'Capex requirements are massive.',
        [sampleCitations[0]!],
        ['$10B cluster costs', 'Gigawatt power lines', 'Short depreciation cycles'],
        'dck_test_123',
      );

      expect(cardWithCompany.company).toBeNull();
      expect(cardWithCompany.metrics).toEqual([]);
      expect(cardWithCompany.viceClaims).toEqual([]);
      expect(cardWithCompany.card.cardType).toBe('barrier');
      expect(cardWithCompany.card.deckId).toBe('dck_test_123');
      expect(cardWithCompany.card.companyId).toBeNull();
      expect(cardWithCompany.card.title).toBe('Capital Intensity');
      expect(cardWithCompany.card.summary).toBe('Capex requirements are massive.');
      expect(cardWithCompany.card.citations).toHaveLength(1);
      expect(cardWithCompany.card.citations[0]!.credibility).toBe('reputable_secondary');
      expect(cardWithCompany.card.keyPoints).toHaveLength(3);
    });

    it('creates fully-formed insight cards with macro key points and company: null', () => {
      const cardWithCompany = createInsightCard(
        'Pricing Model Transition',
        'Shifting from token billing to outcome pricing.',
        [sampleCitations[2]!],
        ['Token margins down 80%', 'Outcome SLAs standard in enterprise'],
        'dck_test_123',
      );

      expect(cardWithCompany.company).toBeNull();
      expect(cardWithCompany.metrics).toEqual([]);
      expect(cardWithCompany.viceClaims).toEqual([]);
      expect(cardWithCompany.card.cardType).toBe('insight');
      expect(cardWithCompany.card.deckId).toBe('dck_test_123');
      expect(cardWithCompany.card.title).toBe('Pricing Model Transition');
      expect(cardWithCompany.card.citations[0]!.credibility).toBe('industry');
      expect(cardWithCompany.card.keyPoints).toHaveLength(2);
    });

    it('creates culture cards without borrowing company metrics', () => {
      const cardWithCompany = createCultureCard(
        sampleCompany,
        'Active non-profit AI safety foundation contributor.',
        [sampleCitations[0]!],
        'dck_test_123',
      );

      expect(cardWithCompany.company).toEqual(sampleCompany);
      expect(cardWithCompany.metrics).toEqual([]); // Zero borrowed metrics
      expect(cardWithCompany.card.cardType).toBe('culture');
      expect(cardWithCompany.card.companyId).toBe(sampleCompany.id);
      expect(cardWithCompany.card.summary).toBe(
        'Active non-profit AI safety foundation contributor.',
      );
      expect(cardWithCompany.card.tier).toBeNull();
    });

    it('creates vice cards without borrowing company metrics', () => {
      const claims = extractSourcedViceClaims(
        [{ text: 'Federal antitrust investigation', sourceIndex: 3 }],
        sampleCitations,
        sampleCompany.id,
      );
      const cardWithCompany = createViceCard(sampleCompany, claims, 'dck_test_123');

      expect(cardWithCompany.company).toEqual(sampleCompany);
      expect(cardWithCompany.metrics).toEqual([]); // Zero borrowed metrics
      expect(cardWithCompany.card.cardType).toBe('vice');
      expect(cardWithCompany.card.companyId).toBe(sampleCompany.id);
      expect(cardWithCompany.viceClaims).toHaveLength(1);
      expect(cardWithCompany.viceClaims[0]!.cardId).toBe(cardWithCompany.card.id);
      expect(cardWithCompany.viceClaims[0]!.sourceUrl).toBe(
        'https://bloomberg.com/news/articles/antitrust-probe',
      );
    });
  });

  describe('BarrierToEntryAgent', () => {
    it('researches structural moats and produces grounded barrier cards', async () => {
      const client = createMockLlmClient({});
      const cards = await BarrierToEntryAgent.research(client, samplePlan, 'dck_ai_1', {
        target: 4,
      });

      expect(client.ground).toHaveBeenCalledOnce();
      expect(client.structure).toHaveBeenCalledOnce();
      expect(cards).toHaveLength(1);

      const barrierCard = cards[0]!;
      expect(barrierCard.card.cardType).toBe('barrier');
      expect(barrierCard.company).toBeNull();
      expect(barrierCard.card.title).toContain('Regulatory Hurdles');
      expect(barrierCard.card.citations).toHaveLength(1);
      expect(barrierCard.card.citations[0]!.url).toBe('https://sec.gov/edgar/filings/10k');
      expect(barrierCard.card.keyPoints.length).toBeGreaterThanOrEqual(4);
    });

    it('supports functional export researchBarriersToEntry', async () => {
      const client = createMockLlmClient({});
      const cards = await researchBarriersToEntry(client, samplePlan, 'dck_ai_1');
      expect(cards.length).toBeGreaterThan(0);
      expect(cards[0]!.card.cardType).toBe('barrier');
    });

    it('drops barrier items that lack valid citations (grounding discipline)', async () => {
      const client = createMockLlmClient({
        structureData: {
          barriers: [
            {
              title: 'Unsourced Barrier Claim',
              summary: 'Speculative barrier without sources.',
              sourceIndex: null,
              keyPoints: ['No evidence point'],
            },
            {
              title: 'Valid Sourced Barrier',
              summary: 'Verified regulatory hurdle.',
              sourceIndex: 1,
              keyPoints: ['Point 1', 'Point 2', 'Point 3', 'Point 4'],
            },
          ],
        },
      });

      const cards = await BarrierToEntryAgent.research(client, samplePlan, 'dck_ai_1');
      expect(cards).toHaveLength(1);
      expect(cards[0]!.card.title).toBe('Valid Sourced Barrier');
    });
  });

  describe('MarketInsightAgent', () => {
    it('researches macro trends and produces grounded insight cards', async () => {
      const client = createMockLlmClient({});
      const cards = await MarketInsightAgent.research(client, samplePlan, 'dck_ai_1', {
        target: 4,
      });

      expect(client.ground).toHaveBeenCalledOnce();
      expect(client.structure).toHaveBeenCalledOnce();
      expect(cards).toHaveLength(1);

      const insightCard = cards[0]!;
      expect(insightCard.card.cardType).toBe('insight');
      expect(insightCard.company).toBeNull();
      expect(insightCard.card.title).toContain('Talent Migration');
      expect(insightCard.card.citations).toHaveLength(1);
      expect(insightCard.card.citations[0]!.url).toBe(
        'https://reuters.com/article/ai-compute-moats',
      );
      expect(insightCard.card.keyPoints.length).toBeGreaterThanOrEqual(4);
    });

    it('supports functional export researchMarketInsights', async () => {
      const client = createMockLlmClient({});
      const cards = await researchMarketInsights(client, samplePlan, 'dck_ai_1');
      expect(cards.length).toBeGreaterThan(0);
      expect(cards[0]!.card.cardType).toBe('insight');
    });

    it('drops insight items that lack valid citations (grounding discipline)', async () => {
      const client = createMockLlmClient({
        structureData: {
          insights: [
            {
              title: 'Unsupported Market Rumor',
              summary: 'Pure speculation.',
              sourceIndex: null,
              keyPoints: ['Unsubstantiated trend'],
            },
          ],
        },
      });

      const cards = await MarketInsightAgent.research(client, samplePlan, 'dck_ai_1');
      expect(cards).toHaveLength(0);
    });
  });

  describe('CultureAgent', () => {
    it('extracts culture cards from company enrichment notes', () => {
      const card = CultureAgent.extract(
        sampleCompany,
        'Operates a public benefit governance structure.',
        sampleCitations,
        'dck_1',
      );

      expect(card).not.toBeNull();
      expect(card!.card.cardType).toBe('culture');
      expect(card!.card.summary).toBe('Operates a public benefit governance structure.');
      expect(card!.metrics).toEqual([]);
    });

    it('returns null and avoids minting empty culture cards when note is empty', () => {
      expect(CultureAgent.extract(sampleCompany, '', sampleCitations, 'dck_1')).toBeNull();
      expect(CultureAgent.extract(sampleCompany, null, sampleCitations, 'dck_1')).toBeNull();
      expect(CultureAgent.extract(sampleCompany, '   ', sampleCitations, 'dck_1')).toBeNull();
    });

    it('researches company culture autonomously with grounded search', async () => {
      const client = createMockLlmClient({});
      const card = await CultureAgent.research(client, sampleCompany, samplePlan, 'dck_1');

      expect(client.ground).toHaveBeenCalledOnce();
      expect(client.structure).toHaveBeenCalledOnce();
      expect(card).not.toBeNull();
      expect(card!.card.cardType).toBe('culture');
      expect(card!.card.summary).toContain('Responsible Scaling Policy');
    });

    it('supports functional export researchCompanyCulture', async () => {
      const client = createMockLlmClient({});
      const card = await researchCompanyCulture(client, sampleCompany, samplePlan, 'dck_1');
      expect(card).not.toBeNull();
      expect(card!.card.cardType).toBe('culture');
    });
  });

  describe('ViceAgent', () => {
    it('extracts vice cards containing only sourced claims', () => {
      const raw = [
        { text: 'DOJ Antitrust Lawsuit', sourceIndex: 3 },
        { text: 'Unverified blog rumor', sourceIndex: null },
      ];
      const card = ViceAgent.extract(sampleCompany, raw, sampleCitations, 'dck_1');

      expect(card).not.toBeNull();
      expect(card!.card.cardType).toBe('vice');
      expect(card!.viceClaims).toHaveLength(1);
      expect(card!.viceClaims[0]!.claimText).toBe('DOJ Antitrust Lawsuit');
      expect(card!.metrics).toEqual([]);
    });

    it('returns null and avoids minting empty vice cards when claims are empty or unsourced', () => {
      expect(ViceAgent.extract(sampleCompany, [], sampleCitations, 'dck_1')).toBeNull();
      expect(
        ViceAgent.extract(
          sampleCompany,
          [{ text: 'Unsourced rumor', sourceIndex: null }],
          sampleCitations,
          'dck_1',
        ),
      ).toBeNull();
    });

    it('researches company controversies autonomously with grounded search', async () => {
      const client = createMockLlmClient({});
      const card = await ViceAgent.research(client, sampleCompany, samplePlan, 'dck_1');

      expect(client.ground).toHaveBeenCalledOnce();
      expect(client.structure).toHaveBeenCalledOnce();
      expect(card).not.toBeNull();
      expect(card!.card.cardType).toBe('vice');
      expect(card!.viceClaims).toHaveLength(1);
      expect(card!.viceClaims[0]!.claimText).toContain('copyright infringement lawsuit');
    });

    it('supports functional export researchCompanyVice', async () => {
      const client = createMockLlmClient({});
      const card = await researchCompanyVice(client, sampleCompany, samplePlan, 'dck_1');
      expect(card).not.toBeNull();
      expect(card!.card.cardType).toBe('vice');
    });
  });

  describe('researchMarketSignals (Unified Orchestration)', () => {
    it('orchestrates joint macro research pass producing barrier and insight cards', async () => {
      const client = createMockLlmClient({});
      const cards = await researchMarketSignals(client, samplePlan, 'dck_macro_1', {
        minBarriers: 1,
        minInsights: 1,
      });

      expect(cards).toHaveLength(2);
      const barrier = cards.find((c) => c.card.cardType === 'barrier');
      const insight = cards.find((c) => c.card.cardType === 'insight');

      expect(barrier).toBeDefined();
      expect(barrier!.company).toBeNull();
      expect(barrier!.card.title).toContain('Capital Intensity');
      expect(barrier!.card.citations[0]!.url).toBe(
        'https://reuters.com/article/ai-compute-moats',
      );
      expect(barrier!.card.keyPoints).toHaveLength(4);

      expect(insight).toBeDefined();
      expect(insight!.company).toBeNull();
      expect(insight!.card.title).toContain('Pricing Shift');
      expect(insight!.card.citations[0]!.url).toBe(
        'https://techcrunch.com/2026/08/ai-pricing-shifts',
      );
      expect(insight!.card.keyPoints).toHaveLength(4);
    });

    it('triggers fallback passes when initial yield is below minimum coverage targets', async () => {
      let callCount = 0;
      const client: LlmClient = {
        ground: vi.fn(async () => {
          callCount += 1;
          if (callCount === 1) {
            // First pass only returns 1 barrier and 0 insights (below min 2)
            return {
              text: 'First pass notes',
              citations: [{ title: 'tc.com', url: 'https://tc.com/p1' }],
              queries: ['q1'],
            };
          }
          // Fallback pass returns more items
          return {
            text: 'Second pass notes',
            citations: [{ title: 'sec.gov', url: 'https://sec.gov/p2' }],
            queries: ['q2'],
          };
        }),
        structure: vi.fn(async (_prompt: string, schema: ZodType<unknown>) => {
          if (callCount === 1) {
            return schema.parse({
              barriers: [
                {
                  title: 'Barrier 1',
                  summary: 'Initial barrier',
                  sourceIndex: 0,
                  keyPoints: ['Point 1'],
                },
              ],
              insights: [],
            });
          }
          return schema.parse({
            barriers: [
              {
                title: 'Barrier 2',
                summary: 'Fallback barrier',
                sourceIndex: 0,
                keyPoints: ['Point 2'],
              },
            ],
            insights: [
              {
                title: 'Insight 1',
                summary: 'Fallback insight',
                sourceIndex: 0,
                keyPoints: ['Insight point 1'],
              },
            ],
          });
        }) as LlmClient['structure'],
      };

      const cards = await researchMarketSignals(client, samplePlan, 'dck_macro_fallback', {
        minBarriers: 2,
        minInsights: 1,
      });

      expect(client.ground).toHaveBeenCalledTimes(2);
      expect(cards.filter((c) => c.card.cardType === 'barrier')).toHaveLength(2);
      expect(cards.filter((c) => c.card.cardType === 'insight')).toHaveLength(1);

      // Verify citation sourceIndex offsetting
      const barrier2 = cards.find((c) => c.card.title === 'Barrier 2')!;
      expect(barrier2.card.citations[0]!.url).toBe('https://sec.gov/p2');
    });

    it('respects AbortSignal and cancels gracefully', async () => {
      const controller = new AbortController();
      controller.abort();

      const client = createMockLlmClient({});
      await expect(
        researchMarketSignals(client, samplePlan, 'dck_abort', {
          signal: controller.signal,
        }),
      ).rejects.toThrow();
    });
  });
});
