/**
 * Types for the agentic research pipeline. Everything the pipeline emits is
 * shaped to the @mi/contracts domain types so it flows straight into the UI
 * (and is Zod-validated before it does).
 */
import type { ZodType, ZodTypeDef } from 'zod';
import type {
  CardType,
  CardWithCompany,
  DashboardTab,
  Deck,
  Market,
  SourceCredibility,
} from '@mi/contracts';

/** What the user submits from the "New deck" screen. */
export interface ResearchBrief {
  /** Free-text market description, e.g. "Christian apparel companies". */
  prompt: string;
  /** Optional geography/region scope, e.g. "California, USA". */
  region: string | null;
}

/** Normalized market definition (output of the scope-interpreter step). */
export interface MarketPlan {
  marketName: string;
  vertical: string;
  geography: string | null;
  notes: string | null;
  /** Angles the discovery step should search along. */
  searchThemes: string[];
}

export interface ResearchResumeState {
  plan: MarketPlan;
  market: Market;
  deck: Deck;
  candidates: CompanyCandidate[];
  completedCards: CardWithCompany[];
}

/** A source attached to a grounded research result. */
export interface Citation {
  title: string;
  url: string;
  credibility?: SourceCredibility;
}

export interface CallOptions {
  system?: string;
  signal?: AbortSignal;
}

/** Provider-neutral search result before provenance is stamped by Stratemark. */
export interface SearchHit {
  url: string;
  title?: string | null;
  snippet?: string | null;
  publishedAt?: string | null;
}

/** Normalized evidence retained while composing an externally grounded answer. */
export interface ResearchSource {
  url: string;
  title: string;
  snippet: string | null;
  publishedAt: string | null;
  retrievedAt: string;
  /** Connector identifier, not the publisher or intelligence model. */
  provider: string;
}

export interface GroundedResult {
  text: string;
  citations: Citation[];
  queries: string[];
  /** Additive so every existing LlmClient implementation remains compatible. */
  sources?: ResearchSource[];
}

export interface IntelligenceModel {
  readonly id: string;
  structure<T>(
    prompt: string,
    schema: ZodType<T, ZodTypeDef, unknown>,
    opts?: CallOptions,
  ): Promise<T>;
}

export interface NativeResearchProvider {
  readonly id: string;
  ground(prompt: string, opts?: CallOptions): Promise<GroundedResult>;
}

export interface SearchConnector {
  readonly id: string;
  search(
    query: string,
    opts: { limit: number; signal?: AbortSignal },
  ): Promise<readonly SearchHit[]>;
}

export const RESEARCH_PROVIDER_ERROR_CODES = [
  'CONFIG',
  'AUTH',
  'RATE_LIMIT',
  'TIMEOUT',
  'UPSTREAM',
  'BAD_RESPONSE',
  'BLOCKED',
  'NO_EVIDENCE',
  'INVALID_OUTPUT',
] as const;

export type ResearchProviderErrorCode = (typeof RESEARCH_PROVIDER_ERROR_CODES)[number];

/** Safe, provider-neutral failure surfaced across model and search adapters. */
export class ResearchProviderError extends Error {
  readonly code: ResearchProviderErrorCode;
  readonly provider: string;
  readonly status?: number;
  readonly retryable: boolean;

  constructor(
    message: string,
    options: {
      code: ResearchProviderErrorCode;
      provider: string;
      status?: number;
      retryable?: boolean;
      cause?: unknown;
    },
  ) {
    super(message, { cause: options.cause });
    this.name = 'ResearchProviderError';
    this.code = options.code;
    this.provider = options.provider;
    this.status = options.status;
    this.retryable = options.retryable ?? false;
  }
}

/** A discovered company before full enrichment. */
export interface CompanyCandidate {
  name: string;
  /** Root domain (drives the logo + live-site tab). */
  domain: string | null;
  descriptor: string;
  /** The single primary card class used for deck grouping and ranking. */
  primaryRole?: 'company' | 'infrastructure' | 'distribution';
  /** Which card type(s) this entity belongs to. */
  cardTypes: CardType[];
  reportedValuation?: number | null;
  reportedArr?: number | null;
  reportedHeadcount?: number | null;
  fundingStage?: string | null;
}

/** Progress events streamed to the UI so cards appear as they are researched. */
export type ResearchEvent =
  | { type: 'status'; step: ResearchStep; message: string; progress?: number }
  | { type: 'market'; market: MarketPlan }
  | { type: 'candidates'; candidates: CompanyCandidate[] }
  | { type: 'card'; card: CardWithCompany }
  | { type: 'warning'; message: string }
  | { type: 'error'; message: string }
  | { type: 'done'; total: number };

export type ResearchStep = 'interpret' | 'discover' | 'enrich' | 'barriers' | 'score' | 'assemble';

export type OnResearchEvent = (event: ResearchEvent) => void;

export interface GeminiConfig {
  apiKey: string;
  /** Grounded/reasoning model (search-capable). */
  model?: string;
  /** Lighter model for structuring/extraction. Defaults to `model`. */
  structureModel?: string;
}

export interface ResearchCoverage {
  /** Primary operating companies; this is the hard minimum for a usable deck. */
  companies: { min: number; target: number; max: number };
  /** Suppliers and platforms the market depends on. */
  infrastructure: { min: number; target: number; max: number };
  /** Channels, marketplaces, resellers, and integrators. */
  distribution: { min: number; target: number; max: number };
  /** Sourced company-level signals, never invented to fill a quota. */
  vice: { min: number; target: number; max: number };
  culture: { min: number; target: number; max: number };
  /** Market-level claims from the shared market pass. */
  barrier: { min: number; target: number; max: number };
  insight: { min: number; target: number; max: number };
}

export interface RunResearchOptions extends GeminiConfig {
  onEvent?: OnResearchEvent;
  signal?: AbortSignal;
  /** Cap concurrent enrichment calls (free-tier friendly). Default 2. */
  concurrency?: number;
  /** Backward-compatible total entity target; coverage targets take precedence. */
  targetCompanies?: number;
  /** Explicit coverage policy; defaults to the free-tier-safe market profile. */
  coverage?: Partial<ResearchCoverage>;
  /** Maximum unique players retained in the market catalog before enrichment. */
  catalogMax?: number;
  /** Maximum catalog search-angle passes; defaults to the market's search themes. */
  catalogPasses?: number;
  /** Resume a durable job from its persisted catalog and completed cards. */
  resume?: ResearchResumeState;
}

/** Provider-neutral abstraction used by every existing research pipeline step. */
export interface LlmClient {
  /**
   * Grounded generation backed by either a model's native research capability
   * or explicit external search connectors. Facts must come from returned
   * evidence, never from model memory alone.
   */
  ground(prompt: string, opts?: CallOptions): Promise<GroundedResult>;

  /**
   * Structured extraction — converts prior grounded text into strict JSON,
   * validated against a Zod schema. Not grounded (grounding + JSON mode can't be
   * combined in one call), so it must be given the grounded text to work from.
   */
  structure<T>(
    prompt: string,
    // Input param widened to `unknown` so T binds to the schema's OUTPUT type
    // (post-defaults), not its input type.
    schema: ZodType<T, ZodTypeDef, unknown>,
    opts?: CallOptions,
  ): Promise<T>;
}

export interface DashboardResearchResult<T extends DashboardTab> {
  tab: T;
  citations: Citation[];
}
