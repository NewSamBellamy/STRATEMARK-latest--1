/**
 * Macro & Signal Subagents Deep Module (§3 Phase 3 & §4)
 *
 * Implements a Deep-Module Clean Architecture for market-level macro signals
 * and entity-level risk/culture intelligence under the Stratemark Backend Specification.
 *
 * Deep Module Core Principles:
 *   1. High-Leverage Interfaces: `researchMarketSignals`, `BarrierToEntryAgent`,
 *      `MarketInsightAgent`, `CultureAgent`, and `ViceAgent` hide complex grounded
 *      prompt formulations, multi-pass citation offsets, deduplication, and schema validation.
 *   2. BarrierToEntryAgent:
 *      - Discovers stage-specific structural moats (regulatory hurdles, capital intensity,
 *        network effects, distribution moats, brand trust).
 *      - Outputs `barrier` cards with claim-linked evidence details and `company: null`.
 *   3. MarketInsightAgent:
 *      - Synthesizes 4-6 non-obvious macro trend cards (pricing shifts, talent migration,
 *        AI integration, whitespace opportunities) grounded in recent 3-6 month search.
 *      - Outputs `insight` cards with claim-linked evidence details and `company: null`.
 *   4. CultureAgent & ViceAgent:
 *      - Manages sourced company-level culture and controversy signals.
 *      - Grounding discipline: strictly drops unsourced claims, never borrows entity metrics,
 *        and never mints empty signal cards.
 *   5. Citation & Provenance Integrity:
 *      - Strict mapping from 0-based source indices to full `Citation` metadata.
 *      - Deduplicates overlapping barrier/insight themes cleanly.
 *      - Never invents source URLs; claim-to-source links are model-attributed,
 *        not independently verified.
 */

import { z } from 'zod';
import {
  classifySource,
  type Card,
  type CardEvidencePoint,
  type CardWithCompany,
  type Company,
  type ViceClaim,
} from '@mi/contracts';
import { marketCardsOutSchema } from './schemas';
import { GROUNDED_SYSTEM, STRUCTURE_SYSTEM } from './prompts';
import { slugify, throwIfAborted } from './util';
import type {
  Citation,
  LlmClient,
  MarketPlan,
  OnResearchEvent,
  ResearchCoverage,
} from './types';

// ============================================================================
// 1. Domain Types & Subagent Schemas
// ============================================================================

export type BarrierMoatCategory =
  | 'regulatory'
  | 'capital_intensity'
  | 'network_effects'
  | 'distribution'
  | 'brand_trust'
  | 'supply_chain'
  | 'other';

export type MarketInsightCategory =
  | 'pricing'
  | 'talent'
  | 'ai_integration'
  | 'whitespace'
  | 'regulatory_shift'
  | 'unit_economics'
  | 'other';

export interface RawMarketClaim {
  title: string;
  summary: string;
  sourceIndex: number | null;
  keyPoints?: string[];
  evidencePoints?: RawEvidencePoint[];
  category?: string;
}

interface RawEvidencePoint {
  text: string;
  sourceIndices: number[];
  timeWindow: string | null;
}

export interface SignalAgentOptions {
  signal?: AbortSignal;
  min?: number;
  target?: number;
  max?: number;
}

export interface MarketSignalsResearchOptions {
  signal?: AbortSignal;
  coverage?: Partial<ResearchCoverage>;
  minBarriers?: number;
  minInsights?: number;
  targetBarriers?: number;
  targetInsights?: number;
  onEvent?: OnResearchEvent;
}

export interface MarketSignalsResult {
  cards: CardWithCompany[];
  barriers: CardWithCompany[];
  insights: CardWithCompany[];
  citations: Citation[];
}

export interface RawViceClaimInput {
  text: string;
  sourceIndex?: number | null;
  sourceUrl?: string | null;
  sourceTitle?: string | null;
}

// Zod schemas for dedicated agent structured passes
const rawClaimSchema = z.object({
  title: z.string().min(1),
  summary: z.string().default(''),
  sourceIndex: z.number().int().nullable().default(null),
  keyPoints: z.array(z.string()).default([]),
  evidencePoints: z
    .array(
      z.object({
        text: z.string().min(1),
        sourceIndices: z.array(z.number().int()).default([]),
        timeWindow: z.string().nullable().default(null),
      }),
    )
    .default([]),
});

export const barrierAgentOutSchema = z.preprocess(
  (v) => (Array.isArray(v) ? { barriers: v } : v),
  z.object({
    barriers: z.array(rawClaimSchema).default([]),
  }),
);

export const insightAgentOutSchema = z.preprocess(
  (v) => (Array.isArray(v) ? { insights: v } : v),
  z.object({
    insights: z.array(rawClaimSchema).default([]),
  }),
);

export const viceAgentOutSchema = z.preprocess(
  (v) => (Array.isArray(v) ? { viceClaims: v } : v),
  z.object({
    viceClaims: z
      .array(
        z.object({
          text: z.string().min(1),
          sourceIndex: z.number().int().nullable().default(null),
        }),
      )
      .default([]),
  }),
);

export const cultureAgentOutSchema = z.object({
  cultureNote: z.string().nullable().default(null),
});

// ============================================================================
// 2. Utility & Provenance Helpers
// ============================================================================

const uid = (prefix: string, slug: string): string =>
  `${prefix}_${slug}_${Math.random().toString(36).slice(2, 7)}`;

const now = (): string => new Date().toISOString();

/**
 * Normalizes claim titles to facilitate semantic deduplication.
 */
export function normalizeClaimTitle(title: string): string {
  return title
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
}

/**
 * Deduplicates claims based on normalized title keys, preserving insertion order.
 */
export function deduplicateClaims<T extends { title: string }>(
  claims: T[],
  limit = 10,
): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const claim of claims) {
    const key = normalizeClaimTitle(claim.title);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(claim);
    if (out.length >= limit) break;
  }
  return out;
}

/**
 * Adjusts sourceIndex values when chaining multiple research passes.
 */
export function offsetClaimSourceIndices<
  T extends {
    sourceIndex: number | null;
    evidencePoints?: Array<{ sourceIndices: number[] }>;
  },
>(claims: T[], offset: number): T[] {
  return claims.map((claim) => ({
    ...claim,
    sourceIndex: claim.sourceIndex == null ? null : claim.sourceIndex + offset,
    evidencePoints: claim.evidencePoints?.map((point) => ({
      ...point,
      sourceIndices: point.sourceIndices.map((index) => index + offset),
    })),
  }));
}

/**
 * Resolves and validates citations attached to a claim index.
 */
export function resolveClaimCitation(
  sourceIndex: number | null | undefined,
  citations: readonly Citation[],
): Citation[] {
  if (sourceIndex == null || sourceIndex < 0 || sourceIndex >= citations.length) {
    return [];
  }
  const cite = citations[sourceIndex];
  if (!cite || !cite.url || !/^https?:\/\//i.test(cite.url.trim())) {
    return [];
  }
  return [
    {
      title: cite.title || 'Source',
      url: cite.url.trim(),
      credibility: cite.credibility ?? classifySource(cite.url, cite.title),
    },
  ];
}

/**
 * Attach only citations explicitly assigned to a detail by the structured pass.
 * The card's headline source is never borrowed to make a detail look sourced.
 */
export function resolveClaimEvidencePoints(
  points: readonly RawEvidencePoint[] | undefined,
  citations: readonly Citation[],
): CardEvidencePoint[] {
  return (points ?? [])
    .slice(0, 8)
    .map((point) => {
      const text = point.text.trim();
      const byUrl = new Map<string, Citation>();
      for (const sourceIndex of point.sourceIndices) {
        for (const citation of resolveClaimCitation(sourceIndex, citations)) {
          byUrl.set(citation.url, citation);
        }
      }
      const pointCitations = [...byUrl.values()].slice(0, 4);
      if (!text || pointCitations.length === 0) return null;
      const timeWindow = point.timeWindow?.trim() || null;
      return { text, citations: pointCitations, timeWindow };
    })
    .filter((point): point is CardEvidencePoint => point !== null);
}

// ============================================================================
// 3. Card Factory Constructors
// ============================================================================

/**
 * Constructs a fully compliant Barrier CardWithCompany.
 */
export function createBarrierCard(
  title: string,
  summary: string,
  citations: Citation[],
  keyPoints: string[] = [],
  deckId = '',
  evidencePoints?: CardEvidencePoint[],
): CardWithCompany {
  const validCitations = citations
    .filter((c) => c && c.url && /^https?:\/\//i.test(c.url))
    .map((c) => ({
      title: c.title || 'Source',
      url: c.url,
      credibility: c.credibility ?? classifySource(c.url, c.title),
    }));

  const cardId = uid('crd', `${slugify(title)}-barrier`);
  const card: Card = {
    id: cardId,
    deckId,
    companyId: null,
    cardType: 'barrier',
    title: title.trim(),
    summary: summary.trim() || null,
    tier: null,
    tierReason: null,
    citations: validCitations,
    keyPoints:
      evidencePoints === undefined
        ? Array.isArray(keyPoints)
          ? keyPoints.map((p) => p.trim()).filter(Boolean)
          : []
        : evidencePoints.map((point) => point.text),
    ...(evidencePoints === undefined ? {} : { evidencePoints }),
    createdAt: now(),
  };

  return {
    card,
    company: null,
    metrics: [],
    viceClaims: [],
  };
}

/**
 * Constructs a fully compliant Insight CardWithCompany.
 */
export function createInsightCard(
  title: string,
  summary: string,
  citations: Citation[],
  keyPoints: string[] = [],
  deckId = '',
  evidencePoints?: CardEvidencePoint[],
): CardWithCompany {
  const validCitations = citations
    .filter((c) => c && c.url && /^https?:\/\//i.test(c.url))
    .map((c) => ({
      title: c.title || 'Source',
      url: c.url,
      credibility: c.credibility ?? classifySource(c.url, c.title),
    }));

  const cardId = uid('crd', `${slugify(title)}-insight`);
  const card: Card = {
    id: cardId,
    deckId,
    companyId: null,
    cardType: 'insight',
    title: title.trim(),
    summary: summary.trim() || null,
    tier: null,
    tierReason: null,
    citations: validCitations,
    keyPoints:
      evidencePoints === undefined
        ? Array.isArray(keyPoints)
          ? keyPoints.map((p) => p.trim()).filter(Boolean)
          : []
        : evidencePoints.map((point) => point.text),
    ...(evidencePoints === undefined ? {} : { evidencePoints }),
    createdAt: now(),
  };

  return {
    card,
    company: null,
    metrics: [],
    viceClaims: [],
  };
}

/**
 * Constructs a Culture CardWithCompany for a company entity.
 * Guarantees: Never borrows company metrics; requires non-empty culture summary.
 */
export function createCultureCard(
  company: Company,
  summary: string,
  citations: Citation[] = [],
  deckId = '',
): CardWithCompany {
  const validCitations = citations
    .filter((c) => c && c.url && /^https?:\/\//i.test(c.url))
    .map((c) => ({
      title: c.title || 'Source',
      url: c.url,
      credibility: c.credibility ?? classifySource(c.url, c.title),
    }));

  const cardId = uid('crd', `${slugify(company.name)}-culture`);
  const card: Card = {
    id: cardId,
    deckId,
    companyId: company.id,
    cardType: 'culture',
    title: null,
    summary: summary.trim(),
    tier: null,
    tierReason: null,
    citations: validCitations,
    keyPoints: [],
    createdAt: now(),
  };

  return {
    card,
    company,
    metrics: [], // Signal cards never borrow financial/operational metrics
    viceClaims: [],
  };
}

/**
 * Constructs a Vice CardWithCompany for a company entity.
 * Guarantees: Never borrows company metrics; requires at least one sourced ViceClaim.
 */
export function createViceCard(
  company: Company,
  claims: ViceClaim[],
  deckId = '',
): CardWithCompany {
  const cardId = uid('crd', `${slugify(company.name)}-vice`);
  const card: Card = {
    id: cardId,
    deckId,
    companyId: company.id,
    cardType: 'vice',
    title: null,
    summary: null,
    tier: null,
    tierReason: null,
    citations: [],
    keyPoints: [],
    createdAt: now(),
  };

  const stampedClaims = claims.map((c) => ({
    ...c,
    cardId: cardId,
  }));

  return {
    card,
    company,
    metrics: [], // Signal cards never borrow financial/operational metrics
    viceClaims: stampedClaims,
  };
}

/**
 * Filters and validates vice claims ensuring only verified, clickable sources survive.
 */
export function extractSourcedViceClaims(
  rawClaims: readonly RawViceClaimInput[],
  citations: readonly Citation[],
  companyId: string,
): ViceClaim[] {
  const out: ViceClaim[] = [];
  rawClaims.forEach((vc, index) => {
    let sourceUrl: string | null = null;
    let sourceTitle: string | null = null;

    if (vc.sourceIndex != null && citations[vc.sourceIndex]) {
      const cite = citations[vc.sourceIndex]!;
      if (cite.url && /^https?:\/\//i.test(cite.url.trim())) {
        sourceUrl = cite.url.trim();
        sourceTitle = cite.title?.trim() || null;
      }
    } else if (vc.sourceUrl && /^https?:\/\//i.test(vc.sourceUrl.trim())) {
      sourceUrl = vc.sourceUrl.trim();
      sourceTitle = vc.sourceTitle?.trim() || null;
    }

    // Grounding discipline: strictly drop unsourced vice claims
    if (!sourceUrl) return;

    out.push({
      id: uid('vcl', `${companyId}-${index}`),
      cardId: '',
      claimText: vc.text.trim(),
      sourceUrl,
      sourceTitle,
      capturedAt: now(),
    });
  });
  return out;
}

/**
 * Validates and extracts a culture note string.
 */
export function extractCultureNote(rawNote: string | null | undefined): string | null {
  const cleaned = (rawNote ?? '').trim();
  return cleaned.length > 0 ? cleaned : null;
}

// ============================================================================
// 4. Subagent Implementations
// ============================================================================

/**
 * BarrierToEntryAgent:
 * Discovers stage-specific structural moats in the target market:
 *   - Regulatory hurdles (licensing, compliance, jurisdiction restrictions)
 *   - Capital intensity (high CapEx, custom hardware/compute infrastructure, long R&D cycles)
 *   - Network effects (data flywheels, two-sided marketplace liquidity, ecosystem lock-in)
 *   - Distribution moats (exclusive OEM/carrier partnerships, deep enterprise workflow integration)
 *   - Brand trust & switching friction (mission-critical certifications, zero-error enterprise tolerance)
 */
export class BarrierToEntryAgent {
  static formatPrompt(plan: MarketPlan, target = 6): string {
    const geo = plan.geography ? ` in ${plan.geography}` : '';
    return [
      `Using Google Search, research the market "${plan.marketName}" (${plan.vertical})${geo}.`,
      `Identify ${target} distinct STRUCTURAL BARRIERS TO ENTRY and moats protecting incumbents from new entrants.`,
      `Focus specifically on discovering stage-specific structural moats across these five categories:`,
      `  1. Regulatory Hurdles & Compliance (licenses, data governance, safety mandates, cross-border restrictions)`,
      `  2. Capital Intensity & Infrastructure (heavy upfront CapEx, compute clusters, specialized hardware, long R&D)`,
      `  3. Network Effects & Data Flywheels (two-sided liquidity, user density, proprietary training feedback loops)`,
      `  4. Distribution Moats & Channel Lock-in (exclusive partner ties, high switching costs, embedded workflows)`,
      `  5. Brand Trust & Mission-Critical Inertia (enterprise reputational risk, zero-defect tolerance, certified vendors)`,
      ``,
      `For each barrier, provide:`,
      `- Sourced title naming the specific barrier`,
      `- 1-2 sentence executive summary`,
      `- 2 to 5 concise evidence points, each with one or more source indices that directly support that exact point`,
      `- For each evidence point, include a timeWindow only when the claim/event period is explicitly stated in the notes; otherwise null. Do not substitute the source's publication date.`,
      ``,
      `STRICT GROUNDING: Ground every barrier and key point in what search results actually confirm. Do not extrapolate generic claims.`,
    ].join('\n');
  }

  static formatStructurePrompt(groundedText: string, citations: Citation[]): string {
    const sourcesText =
      citations.map((c, i) => `[${i}] ${c.title} — ${c.url}`).join('\n') || '(none)';
    return [
      `Convert the research notes into JSON: { "barriers": [ { "title": string, "summary": string, "sourceIndex": number | null, "evidencePoints": [{ "text": string, "sourceIndices": number[], "timeWindow": string | null }] } ] }.`,
      `Rules:`,
      `- Return 4-10 distinct structural barrier cards.`,
      `- "sourceIndex" must be the 0-based index into SOURCES supporting the barrier. Null if unsourced.`,
      `- Every evidence point must be a discrete factual detail (1-2 sentences) and list one or more 0-based SOURCES indices that directly support that exact detail. Drop any point whose source cannot be identified.`,
      `- "timeWindow" is the period the claim/event describes, only if explicitly stated in NOTES; otherwise null. Never infer it from a publication date.`,
      `- Deduplicate overlapping barriers.`,
      ``,
      `SOURCES:`,
      sourcesText,
      ``,
      `NOTES:`,
      groundedText,
    ].join('\n');
  }

  /**
   * Researches market structural barriers autonomously and returns verified barrier cards.
   */
  static async research(
    client: LlmClient,
    plan: MarketPlan,
    deckId = '',
    options: SignalAgentOptions = {},
  ): Promise<CardWithCompany[]> {
    throwIfAborted(options.signal);
    const target = options.target ?? 6;

    const grounded = await client.ground(this.formatPrompt(plan, target), {
      system: GROUNDED_SYSTEM,
      signal: options.signal,
    });

    throwIfAborted(options.signal);

    const structured = await client.structure(
      this.formatStructurePrompt(grounded.text, grounded.citations),
      barrierAgentOutSchema,
      { system: STRUCTURE_SYSTEM, signal: options.signal },
    );

    const deduplicated = deduplicateClaims(structured.barriers ?? [], options.max ?? 10);
    const cards: CardWithCompany[] = [];

    for (const item of deduplicated) {
      const claimCitations = resolveClaimCitation(item.sourceIndex, grounded.citations);
      // Grounding discipline: drop unsupported claims lacking a real citation
      if (claimCitations.length === 0) continue;

      cards.push(
        createBarrierCard(
          item.title,
          item.summary,
          claimCitations,
          item.keyPoints,
          deckId,
          resolveClaimEvidencePoints(item.evidencePoints, grounded.citations),
        ),
      );
    }

    return cards;
  }

  static createCard(
    title: string,
    summary: string,
    citations: Citation[],
    keyPoints: string[] = [],
    deckId = '',
  ): CardWithCompany {
    return createBarrierCard(title, summary, citations, keyPoints, deckId);
  }

  async research(
    client: LlmClient,
    plan: MarketPlan,
    deckId = '',
    options: SignalAgentOptions = {},
  ): Promise<CardWithCompany[]> {
    return BarrierToEntryAgent.research(client, plan, deckId, options);
  }
}

/**
 * MarketInsightAgent:
 * Synthesizes 4-6 non-obvious macro trend cards grounded in recent 3-6 month search:
 *   - Pricing & monetization shifts (seat-to-usage transitions, margin compression, pricing power)
 *   - Talent & engineering migration (AI talent concentration, executive churn, specialized skills)
 *   - AI & technological integration (open-source vs closed APIs, edge inference, tooling commoditization)
 *   - Whitespace & unserved opportunities (unaddressed customer segments, regulatory tailwinds)
 */
export class MarketInsightAgent {
  static formatPrompt(plan: MarketPlan, target = 6): string {
    const geo = plan.geography ? ` in ${plan.geography}` : '';
    return [
      `Using Google Search, research recent macro shifts, industry dynamics, and strategic developments in "${plan.marketName}" (${plan.vertical})${geo} from roughly the last 3-6 months.`,
      `Synthesize ${target} non-obvious, actionable MACRO INSIGHT cards that a sophisticated investor or operator needs to know.`,
      `Focus specifically on these four key macro themes:`,
      `  1. Pricing & Monetization Shifts (seat-based to usage/outcome billing, token economics, margin pressure)`,
      `  2. Talent & Engineering Migration (specialized AI talent movement, key executive turnover, hub shifts)`,
      `  3. AI & Technological Integration (foundation model commoditization, fine-tuning vs RAG, inference costs)`,
      `  4. Whitespace Opportunities & Market Gaps (unmet demand segments, emerging niches created by regulatory or tech changes)`,
      ``,
      `For each insight, provide:`,
      `- Sourced title capturing the core strategic shift`,
      `- 1-2 sentence executive summary`,
      `- 2 to 5 concise evidence points, each with one or more source indices that directly support that exact point`,
      `- For each evidence point, include a timeWindow only when the claim/event period is explicitly stated in the notes; otherwise null. Do not substitute the source's publication date.`,
      ``,
      `STRICT GROUNDING: Ground every insight in real search findings from recent reporting, announcements, or analysis. Do not speculate.`,
    ].join('\n');
  }

  static formatStructurePrompt(groundedText: string, citations: Citation[]): string {
    const sourcesText =
      citations.map((c, i) => `[${i}] ${c.title} — ${c.url}`).join('\n') || '(none)';
    return [
      `Convert the research notes into JSON: { "insights": [ { "title": string, "summary": string, "sourceIndex": number | null, "evidencePoints": [{ "text": string, "sourceIndices": number[], "timeWindow": string | null }] } ] }.`,
      `Rules:`,
      `- Return 4-10 non-obvious macro insight cards.`,
      `- "sourceIndex" must be the 0-based index into SOURCES supporting the insight. Null if unsourced.`,
      `- Every evidence point must be a discrete factual detail (1-2 sentences) and list one or more 0-based SOURCES indices that directly support that exact detail. Drop any point whose source cannot be identified.`,
      `- "timeWindow" is the period the claim/event describes, only if explicitly stated in NOTES; otherwise null. Never infer it from a publication date.`,
      `- Deduplicate overlapping insight themes.`,
      ``,
      `SOURCES:`,
      sourcesText,
      ``,
      `NOTES:`,
      groundedText,
    ].join('\n');
  }

  /**
   * Researches market macro insights autonomously and returns verified insight cards.
   */
  static async research(
    client: LlmClient,
    plan: MarketPlan,
    deckId = '',
    options: SignalAgentOptions = {},
  ): Promise<CardWithCompany[]> {
    throwIfAborted(options.signal);
    const target = options.target ?? 6;

    const grounded = await client.ground(this.formatPrompt(plan, target), {
      system: GROUNDED_SYSTEM,
      signal: options.signal,
    });

    throwIfAborted(options.signal);

    const structured = await client.structure(
      this.formatStructurePrompt(grounded.text, grounded.citations),
      insightAgentOutSchema,
      { system: STRUCTURE_SYSTEM, signal: options.signal },
    );

    const deduplicated = deduplicateClaims(structured.insights ?? [], options.max ?? 10);
    const cards: CardWithCompany[] = [];

    for (const item of deduplicated) {
      const claimCitations = resolveClaimCitation(item.sourceIndex, grounded.citations);
      // Grounding discipline: drop unsupported claims lacking a real citation
      if (claimCitations.length === 0) continue;

      cards.push(
        createInsightCard(
          item.title,
          item.summary,
          claimCitations,
          item.keyPoints,
          deckId,
          resolveClaimEvidencePoints(item.evidencePoints, grounded.citations),
        ),
      );
    }

    return cards;
  }

  static createCard(
    title: string,
    summary: string,
    citations: Citation[],
    keyPoints: string[] = [],
    deckId = '',
  ): CardWithCompany {
    return createInsightCard(title, summary, citations, keyPoints, deckId);
  }

  async research(
    client: LlmClient,
    plan: MarketPlan,
    deckId = '',
    options: SignalAgentOptions = {},
  ): Promise<CardWithCompany[]> {
    return MarketInsightAgent.research(client, plan, deckId, options);
  }
}

/**
 * CultureAgent:
 * Discovers positive community, culture, open-source giving, and mission signals for an entity.
 */
export class CultureAgent {
  static formatPrompt(company: Company, plan: MarketPlan): string {
    return [
      `Research positive community, culture, and ethos signals for "${company.name}" in the context of "${plan.marketName}".`,
      `Find documented signals of:`,
      `- Open-source contributions, developer community grants, or academic research partnerships`,
      `- Philanthropic commitments, non-profit foundations, or public benefit governance (e.g. PBC, B-Corp)`,
      `- Notable organizational culture, employee satisfaction, or mission-driven initiatives`,
      ``,
      `Report only documented, sourced facts. If no notable positive culture signal is publicly reported, state that plainly.`,
    ].join('\n');
  }

  static formatStructurePrompt(groundedText: string): string {
    return [
      `From the notes, extract any notable community or culture signal as JSON: { "cultureNote": string | null }.`,
      `If no distinct culture signal was found, return { "cultureNote": null }.`,
      ``,
      `NOTES:`,
      groundedText,
    ].join('\n');
  }

  static async research(
    client: LlmClient,
    company: Company,
    plan: MarketPlan,
    deckId = '',
    options: SignalAgentOptions = {},
  ): Promise<CardWithCompany | null> {
    throwIfAborted(options.signal);

    const grounded = await client.ground(this.formatPrompt(company, plan), {
      system: GROUNDED_SYSTEM,
      signal: options.signal,
    });

    throwIfAborted(options.signal);

    const structured = await client.structure(
      this.formatStructurePrompt(grounded.text),
      cultureAgentOutSchema,
      { system: STRUCTURE_SYSTEM, signal: options.signal },
    );

    const note = extractCultureNote(structured.cultureNote);
    if (!note) return null;

    return createCultureCard(company, note, grounded.citations, deckId);
  }

  static extract(
    company: Company,
    cultureNote: string | null | undefined,
    citations: Citation[] = [],
    deckId = '',
  ): CardWithCompany | null {
    const note = extractCultureNote(cultureNote);
    if (!note) return null;
    return createCultureCard(company, note, citations, deckId);
  }

  static createCard(
    company: Company,
    summary: string,
    citations: Citation[] = [],
    deckId = '',
  ): CardWithCompany {
    return createCultureCard(company, summary, citations, deckId);
  }

  async research(
    client: LlmClient,
    company: Company,
    plan: MarketPlan,
    deckId = '',
    options: SignalAgentOptions = {},
  ): Promise<CardWithCompany | null> {
    return CultureAgent.research(client, company, plan, deckId, options);
  }
}

/**
 * ViceAgent:
 * Discovers negative risk signals, lawsuits, regulatory fines, and integrity issues for an entity.
 */
export class ViceAgent {
  static formatPrompt(company: Company, plan?: MarketPlan): string {
    const marketContext = plan?.marketName ? ` in the context of "${plan.marketName}"` : '';
    return [
      `Research documented controversy, regulatory enforcement, litigation, or governance risks for "${company.name}"${marketContext}.`,
      `Search for:`,
      `- Active or settled federal/state lawsuits (intellectual property, antitrust, employment, consumer protection)`,
      `- Regulatory investigations, FTC/SEC/DOJ/EU fines, or compliance sanctions`,
      `- Executive integrity controversies, data breaches, or verified whistleblower allegations`,
      ``,
      `STRICT EVIDENCE MANDATE: Return ONLY claims supported by concrete reporting or court filings. Every finding MUST cite its specific source.`,
    ].join('\n');
  }

  static formatStructurePrompt(groundedText: string, citations: Citation[]): string {
    const sourcesText =
      citations.map((c, i) => `[${i}] ${c.title} — ${c.url}`).join('\n') || '(none)';
    return [
      `Convert the research notes into JSON: { "viceClaims": [ { "text": string, "sourceIndex": number | null } ] }.`,
      `Rules:`,
      `- Every claim MUST have a sourceIndex pointing to a listed source in SOURCES.`,
      `- Drop any rumor or unverified assertion.`,
      ``,
      `SOURCES:`,
      sourcesText,
      ``,
      `NOTES:`,
      groundedText,
    ].join('\n');
  }

  static async research(
    client: LlmClient,
    company: Company,
    plan: MarketPlan,
    deckId = '',
    options: SignalAgentOptions = {},
  ): Promise<CardWithCompany | null> {
    throwIfAborted(options.signal);

    const grounded = await client.ground(this.formatPrompt(company, plan), {
      system: GROUNDED_SYSTEM,
      signal: options.signal,
    });

    throwIfAborted(options.signal);

    const structured = await client.structure(
      this.formatStructurePrompt(grounded.text, grounded.citations),
      viceAgentOutSchema,
      { system: STRUCTURE_SYSTEM, signal: options.signal },
    );

    const claims = extractSourcedViceClaims(
      structured.viceClaims ?? [],
      grounded.citations,
      company.id,
    );

    if (claims.length === 0) return null;
    return createViceCard(company, claims, deckId);
  }

  static extractClaims(
    rawClaims: readonly RawViceClaimInput[],
    citations: readonly Citation[],
    companyId: string,
  ): ViceClaim[] {
    return extractSourcedViceClaims(rawClaims, citations, companyId);
  }

  static extract(
    company: Company,
    rawClaims: readonly RawViceClaimInput[],
    citations: readonly Citation[] = [],
    deckId = '',
  ): CardWithCompany | null {
    const claims = extractSourcedViceClaims(rawClaims, citations, company.id);
    if (claims.length === 0) return null;
    return createViceCard(company, claims, deckId);
  }

  static createCard(
    company: Company,
    claims: ViceClaim[],
    deckId = '',
  ): CardWithCompany {
    return createViceCard(company, claims, deckId);
  }

  async research(
    client: LlmClient,
    company: Company,
    plan: MarketPlan,
    deckId = '',
    options: SignalAgentOptions = {},
  ): Promise<CardWithCompany | null> {
    return ViceAgent.research(client, company, plan, deckId, options);
  }
}

// ============================================================================
// 5. Unified Macro & Market Signals Orchestration
// ============================================================================

/**
 * Unified entry point to research and synthesize all market-level macro signals
 * (Barriers to Entry + Market Insights) with multi-pass fallback and strict citation reconciliation.
 */
export async function researchMarketSignals(
  client: LlmClient,
  plan: MarketPlan,
  deckId: string,
  options: MarketSignalsResearchOptions = {},
): Promise<CardWithCompany[]> {
  throwIfAborted(options.signal);

  const minBarriers = options.minBarriers ?? options.coverage?.barrier?.min ?? 4;
  const minInsights = options.minInsights ?? options.coverage?.insight?.min ?? 4;
  const targetBarriers = options.targetBarriers ?? options.coverage?.barrier?.target ?? 6;
  const targetInsights = options.targetInsights ?? options.coverage?.insight?.target ?? 6;

  const where = plan.geography ? ` in ${plan.geography}` : '';

  // 1. Joint Research Pass (Optimized for Free-Tier Quotas: 2 card types in 1 grounded call)
  const runGroundedPass = async (focus: 'both' | 'barrier' | 'insight') => {
    const prompt = [
      `Using Google Search, research the market "${plan.marketName}" (${plan.vertical})${where}.`,
      focus === 'both' || focus === 'barrier'
        ? `BARRIERS — find at least ${targetBarriers} and up to 10 structural barriers to entry: regulatory, capital intensity, network effects, brand trust, or distribution moats.`
        : ``,
      focus === 'both' || focus === 'insight'
        ? `INSIGHTS — find at least ${targetInsights} and up to 10 non-obvious dynamics from roughly the last 3-6 months that a smart operator or investor would want to know: pricing shifts, talent migration, AI integration, whitespace opportunities.`
        : ``,
      `Ground every point in what you actually find. Do not speculate or pad the list with generic claims.`,
    ]
      .filter(Boolean)
      .join('\n');

    const grounded = await client.ground(prompt, {
      system: GROUNDED_SYSTEM,
      signal: options.signal,
    });

    const structurePrompt = [
      `From the notes, output JSON { "barriers": [ { "title", "summary", "sourceIndex", "evidencePoints": [{ "text", "sourceIndices", "timeWindow" }] } ], "insights": [ { "title", "summary", "sourceIndex", "evidencePoints": [{ "text", "sourceIndices", "timeWindow" }] } ] }.`,
      `Return 4-10 distinct sourced items for each requested category. If the notes do not support four, return fewer rather than inventing.`,
      `"sourceIndex" is the 0-based index of the source that supports the point, or null if none of the listed sources do.`,
      `Each evidence point is one short factual detail (1-2 sentences) with one or more 0-based sourceIndices that directly support that exact detail. Drop details that cannot be source-linked; never borrow the card's sourceIndex for a detail.`,
      `timeWindow is the claim/event period only when stated in NOTES; otherwise null. Do not infer from source publication dates.`,
      ``,
      `SOURCES:`,
      grounded.citations.map((c, i) => `[${i}] ${c.title} — ${c.url}`).join('\n') || '(none)',
      ``,
      `NOTES:`,
      grounded.text,
    ]
      .filter(Boolean)
      .join('\n');

    const out = await client.structure(structurePrompt, marketCardsOutSchema, {
      system: STRUCTURE_SYSTEM,
      signal: options.signal,
    });

    return { out, citations: grounded.citations };
  };

  const firstPass = await runGroundedPass('both');
  const usableClaimCount = (
    claims: z.infer<typeof rawClaimSchema>[],
    citations: Citation[],
  ): number =>
    deduplicateClaims(claims, 10).filter(
      (claim) => resolveClaimCitation(claim.sourceIndex, citations).length > 0,
    ).length;
  const firstBarrierCount = usableClaimCount(firstPass.out.barriers ?? [], firstPass.citations);
  const firstInsightCount = usableClaimCount(firstPass.out.insights ?? [], firstPass.citations);

  // 2. Bounded Fallback Pass if initial yield is below minimums
  let secondPass: {
    out: z.infer<typeof marketCardsOutSchema>;
    citations: Citation[];
  } | null = null;

  if (firstBarrierCount < minBarriers || firstInsightCount < minInsights) {
    const focus: 'both' | 'barrier' | 'insight' =
      firstBarrierCount < minBarriers && firstInsightCount < minInsights
        ? 'both'
        : firstBarrierCount < minBarriers
          ? 'barrier'
          : 'insight';

    try {
      secondPass = await runGroundedPass(focus);
    } catch {
      // If fallback pass fails, continue with first pass results honestly
    }
  }

  // 3. Reconcile Citations & Offset Indices
  const allCitations = [...firstPass.citations, ...(secondPass?.citations ?? [])];

  const rawBarriers = [
    ...(firstPass.out.barriers ?? []),
    ...offsetClaimSourceIndices(
      secondPass?.out.barriers ?? [],
      firstPass.citations.length,
    ),
  ];

  const rawInsights = [
    ...(firstPass.out.insights ?? []),
    ...offsetClaimSourceIndices(
      secondPass?.out.insights ?? [],
      firstPass.citations.length,
    ),
  ];

  // 4. Deduplicate Claims
  const deduplicatedBarriers = deduplicateClaims(rawBarriers, 10);
  const deduplicatedInsights = deduplicateClaims(rawInsights, 10);

  // 5. Assemble Cards with Provenance Enforcement
  const assembledCards: CardWithCompany[] = [];

  for (const barrier of deduplicatedBarriers) {
    const claimCitations = resolveClaimCitation(barrier.sourceIndex, allCitations);
    if (claimCitations.length === 0) continue; // Grounding contract: drop unsourced cards

    assembledCards.push(
      createBarrierCard(
        barrier.title,
        barrier.summary,
        claimCitations,
        barrier.keyPoints,
        deckId,
        resolveClaimEvidencePoints(barrier.evidencePoints, allCitations),
      ),
    );
  }

  for (const insight of deduplicatedInsights) {
    const claimCitations = resolveClaimCitation(insight.sourceIndex, allCitations);
    if (claimCitations.length === 0) continue; // Grounding contract: drop unsourced cards

    assembledCards.push(
      createInsightCard(
        insight.title,
        insight.summary,
        claimCitations,
        insight.keyPoints,
        deckId,
        resolveClaimEvidencePoints(insight.evidencePoints, allCitations),
      ),
    );
  }

  return assembledCards;
}

// Functional helper exports matching camelCase naming convention
export const researchBarriersToEntry = BarrierToEntryAgent.research.bind(BarrierToEntryAgent);
export const researchMarketInsights = MarketInsightAgent.research.bind(MarketInsightAgent);
export const researchCompanyCulture = CultureAgent.research.bind(CultureAgent);
export const researchCompanyVice = ViceAgent.research.bind(ViceAgent);
