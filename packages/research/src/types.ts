/**
 * Types for the agentic research pipeline. Everything the pipeline emits is
 * shaped to the @mi/contracts domain types so it flows straight into the UI
 * (and is Zod-validated before it does).
 */
import type { ZodType, ZodTypeDef } from 'zod';
import type { OriginalSourceServices } from './original-source';
import type {
  CardType,
  CardWithCompany,
  CompanyScope,
  DashboardTab,
  Deck,
  Market,
  SourceCredibility,
} from '@mi/contracts';

/** Where the time of one settled provider call went. The honest answer to
 * "why is research slow": limiter queue wait, retry backoff, or the model. */
export interface CallMetrics {
  model: string;
  kind: 'ground' | 'structure';
  /** Dispatched attempts, including any 429/5xx retries. */
  attempts: number;
  retries: number;
  /** Time spent waiting for a rate-limiter slot before dispatches. */
  queuedMs: number;
  /** Dispatch → response of all attempts (body reads and JSON parse included). */
  requestMs: number;
  /** Retry-After / backoff sleeps between attempts. */
  retryWaitMs: number;
  totalMs: number;
}

/** Rolling spend/pacing totals since a client's construction, read through
 * LlmClient.metrics?.() — the honest answer to "why is research slow". */
export interface CallMetricsAggregate {
  calls: number;
  retries: number;
  rateLimitedMs: number;
  /** Ground calls answered by a fallback model line after the primary failed. */
  fallbacks: number;
}

/** What the user submits from the "New deck" screen. */
export interface ResearchBrief {
  /** Free-text market description, e.g. "Christian apparel companies". */
  prompt: string;
  /** Optional geography/region scope, e.g. "California, USA". */
  region: string | null;
  /** Explicit company-only scope; absent means discover the whole market. */
  companyScope?: CompanyScope;
}

/** Normalized market definition (output of the scope-interpreter step). */
export interface MarketPlan {
  marketName: string;
  vertical: string;
  geography: string | null;
  notes: string | null;
  /** Angles the discovery step should search along. */
  searchThemes: string[];
  /** Named companies are priority anchors by default; exact scope prevents market expansion. */
  companyScope?: CompanyScope;
}

export interface ResearchResumeState {
  plan: MarketPlan;
  market: Market;
  deck: Deck;
  candidates: CompanyCandidate[];
  completedCards: CardWithCompany[];
}

/** A grounded source (from Gemini's Google-Search grounding metadata). */
export interface Citation {
  title: string;
  url: string;
  credibility?: SourceCredibility;
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

export type OnResearchEvent = ((event: ResearchEvent) => void) | ((event: ResearchEvent) => Promise<void>);

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
  originalSources?: OriginalSourceServices;
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
  /** Streamed once the market is interpreted (plan + market + deck rows all
   * real), before discovery: lets the caller start hydration planning while
   * discovery runs. */
  onInterpreted?: (interpreted: { plan: MarketPlan; market: Market; deck: Deck }) => void;
  /** Streamed per discovery pass: each new entity as its stub card, alongside
   * the candidate it was built from. Lets the caller ingest and hydrate
   * entities while fallback discovery passes are still running. */
  onStubs?: (entries: Array<{ stub: CardWithCompany; candidate: CompanyCandidate }>) => void;
  /** Resume a durable job from its persisted catalog and completed cards. */
  resume?: ResearchResumeState;
}

/** The abstraction the pipeline steps talk to (implemented by the Gemini client). */
export interface ProviderGrounding {
  /** Provider attribution on generated answer text, NOT original-page evidence. */
  provider: 'google-search';
  answerText: string;
  supports: Array<{
    supportIndex: number;
    text: string;
    /** Provider offsets retained verbatim; never slice JS strings with them. */
    startIndex?: number;
    endIndex?: number;
    partIndex?: number;
    sources: Array<{ chunkIndex: number; url: string; title: string }>;
  }>;
}

export interface LlmClient {
  /** Rolling spend/pacing totals since construction. OPTIONAL - the concrete
   * Gemini clients provide it; mocks and test doubles may not. */
  metrics?: () => CallMetricsAggregate;
  /**
   * Grounded generation — ALWAYS sends the Google Search tool. Returns the
   * model's text plus the source citations Google attached. This is the only
   * way facts enter the pipeline (never from training data alone).
   */
  ground(
    prompt: string,
    opts?: { system?: string; signal?: AbortSignal; researchContext?: { companyId?: string; companyName?: string; topic: string } },
  ): Promise<{ text: string; citations: Citation[]; queries: string[]; grounding?: ProviderGrounding }>;

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
    opts?: { system?: string; signal?: AbortSignal },
  ): Promise<T>;
}

export interface DashboardResearchResult<T extends DashboardTab> {
  tab: T;
  citations: Citation[];
}
