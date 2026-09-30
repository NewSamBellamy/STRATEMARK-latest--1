/**
 * MarketIntelRepository — the transport-agnostic data contract.
 *
 * This is the seam between the UI and everything native. The renderer only ever
 * talks to this interface, so the exact same UI runs against:
 *   - MockRepository (in-memory fixtures) — today, the whole front-end phase
 *   - IpcRepository (Electron main ⇄ SQLite/Drizzle over IPC) — the real back end
 *   - (optionally) a cloud HTTP adapter later — no UI changes
 *
 * Swapping implementations is a one-line provider change (see the web app's
 * RepositoryProvider). Adding a method here is the single place the back end and
 * the UI agree on new capability.
 */
import type {
  CardType,
  Confidence,
  DashboardTab,
  MaturityTier,
  MetricType,
  RefreshCadence,
} from './enums';
import type {
  Card,
  Company,
  CompanyMetric,
  DashboardContentFor,
  Deck,
  Market,
  ScopeDefinition,
  ViceClaim,
} from './types';

export interface CreateMarketInput {
  name: string;
  scopeDefinition: ScopeDefinition;
  refreshCadence: RefreshCadence;
}

/** A user's free-text request to research a new deck (the "New deck" screen). */
export interface DeckResearchBrief {
  prompt: string;
  region: string | null;
}

export type ResearchStage = 'scope' | 'catalog' | 'summary' | 'metrics' | 'signals' | 'dashboard';
export type ResearchJobStatus = 'queued' | 'running' | 'completed' | 'failed' | 'cancelled';

export interface ResearchCatalogCandidate {
  name: string;
  domain: string | null;
  descriptor: string;
  primaryRole?: 'company' | 'infrastructure' | 'distribution';
  cardTypes: CardType[];
}

export interface ResearchJob {
  id: string;
  status: ResearchJobStatus;
  stage: ResearchStage;
  brief: DeckResearchBrief;
  marketPlan?: {
    marketName: string;
    vertical: string;
    geography: string | null;
    notes: string | null;
    searchThemes: string[];
  };
  market?: Market;
  deck?: Deck;
  catalog?: ResearchCatalogCandidate[];
  catalogNames: string[];
  completedEntityNames: string[];
  partialCards: CardWithCompany[];
  warnings: string[];
  error: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ResearchProgress {
  message: string;
  /** High-level stage so consumers can reveal data progressively without UI coupling. */
  stage?: ResearchStage;
  /** 0..1 when known. */
  progress?: number;
  /** Log-line flavor for glass-box terminals: step (phase), find (discovery), warn. */
  kind?: 'step' | 'find' | 'warn';
  /** Partial card emitted as soon as its backend enrichment finishes. */
  card?: CardWithCompany;
}

export interface ResearchHandlers {
  onProgress?: (progress: ResearchProgress) => void;
  signal?: AbortSignal;
}

/** Source class used to decide whether evidence can support a verified claim. */
export type SourceCredibility =
  'primary' | 'reputable_secondary' | 'industry' | 'user_generated' | 'unknown';

/** A grounded source. */
export interface Citation {
  title: string;
  url: string;
  credibility?: SourceCredibility;
}

/** A focused "dig deeper" request on a company + a specific topic (spec: research-intuitive drill-down). */
export interface DeepDiveInput {
  companyId: string | null;
  companyName: string;
  /** The thing to expand on, e.g. "Annual Recurring Revenue", "the founding team". */
  topic: string;
  /** Optional extra framing (market name, current value, etc.). */
  context?: string | null;
}

export interface DeepDiveResult {
  markdown: string;
  citations: Citation[];
}

/** Grounded verification of a single claim (the "fact-check" action). */
export type FactCheckVerdict = 'supported' | 'contradicted' | 'unverified';

export interface FactCheckInput {
  /** The claim to verify, e.g. "Seedlip's ARR is $15M". */
  claim: string;
  companyName: string | null;
  context?: string | null;
  /**
   * When the claim IS a stored metric, identify it so a contradiction can be
   * turned into a sourced correction instead of dying in the verdict pill.
   */
  companyId?: string | null;
  metricType?: MetricType | null;
  /** The currently stored value, for the checker to compare against. */
  storedValue?: number | null;
}

export interface FactCheckResult {
  verdict: FactCheckVerdict;
  rationale: string;
  citations: Citation[];
  /**
   * When the check contradicts a stored METRIC and the evidence names a better
   * figure, this carries it (metric's native unit: USD, count, or percent).
   * Null when unavailable — a correction without a citation is never emitted
   * (no-fabrication rule).
   */
  correctedValue?: number | null;
  /** ISO date the corrected figure is reported as-of, when the evidence says. */
  correctedAsOf?: string | null;
}

// ---------------------------------------------------------------------------
// Live metric verification — the write-back primitive behind the living deck.
//
// Fact-check answers "is this claim right?"; verifyMetric goes one step
// further: re-research the figure, and if the grounded evidence disagrees
// with what we stored, REVISE the stored metric (with citations) and re-tier
// the company. This is what turns a static deck into one that heals itself.
// ---------------------------------------------------------------------------

export interface VerifyMetricInput {
  companyId: string;
  metricType: MetricType;
  /**
   * A pre-verified correction from an immediately-preceding fact-check pass.
   * When present (and its citations clear the credibility gate) the repository
   * applies it DIRECTLY — no second research pass. This is why an on-screen
   * "Contradicted → corrected" now takes milliseconds instead of re-running
   * the whole grounded hunt the fact-check just finished.
   */
  correction?: {
    value: number;
    citations: Citation[];
    rationale?: string | null;
    asOf?: string | null;
  } | null;
}

export interface VerifyMetricResult {
  /** The stored metric AFTER verification (revised or confirmed). */
  metric: CompanyMetric;
  /** What the verification concluded about the previously stored figure. */
  verdict: FactCheckVerdict;
  /** True when the stored value was actually changed. */
  changed: boolean;
  /** Card ids whose tier moved as a result (deck UIs should refresh these). */
  retieredCardIds: string[];
  rationale: string;
  citations: Citation[];
}

/**
 * One targeted research pass over EVERY soft figure a company still has —
 * missing rows, unknowns, and unverified estimates. The "find more metrics"
 * button: one grounded hunt, many figures filled, one re-tier.
 */
export interface HuntMetricsResult {
  /** Metric types that gained a grounded value in this hunt. */
  filledTypes: MetricType[];
  /** The company's full metric set AFTER the hunt. */
  metrics: CompanyMetric[];
  /** Card ids whose tier moved as a result. */
  retieredCardIds: string[];
}

/** A saved research report composed by the AI from deck/company evidence. */
export interface ReportRequest {
  kind: 'deck' | 'company';
  /** deckId when kind='deck'; companyId when kind='company'. */
  subjectId: string;
  /**
   * The user's framing for what the report should concentrate on
   * ("who is winning enterprise", "risks to a new entrant"). The evidence rules
   * don't change — focus steers emphasis, never sourcing.
   */
  focus?: string | null;
  /** Fold a research conversation's findings into the report. */
  threadId?: string | null;
}

// ---------------------------------------------------------------------------
// Research conversations — the "second brain" primitive.
//
// Every Dig starts (or continues) a thread: a grounded conversation anchored to
// something concrete — a deck, a company, a set of selected cards, or a single
// data point. Threads persist alongside the deck, so the questions an analyst
// asked become part of the deck's accumulated intelligence, and any thread can
// be distilled into a saved report.
// ---------------------------------------------------------------------------

export interface ResearchScope {
  kind: 'deck' | 'company' | 'cards' | 'datapoint';
  deckId: string | null;
  companyId?: string | null;
  /** Cards anchoring this thread: a single detail view or a comparison set. */
  cardIds?: string[];
  /** Optional single-card context for relevant research prompts in the UI. */
  cardType?: CardType;
  /** Human label for what this thread is anchored to, e.g. "ARR", "GPT-5", "Jane Doe". */
  subject?: string | null;
}

export interface ThreadMessage {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  /** Grounded sources behind an assistant turn. Always [] for user turns. */
  citations: Citation[];
  at: string;
}

export interface DistilledSemanticFact {
  id: string;
  fact: string;
  category?: 'metric' | 'finding' | 'competitor' | 'trend' | 'risk' | 'general';
  companyId?: string | null;
  subject?: string | null;
  citations: Citation[];
  extractedAt: string;
  userVerified?: boolean;
}

export interface SemanticMemory {
  threadId: string;
  distilledFacts: DistilledSemanticFact[];
  lastDistilledTurnIndex: number;
  totalTurnsDistilled: number;
  distilledAt: string;
}

export interface ResearchThread {
  id: string;
  scope: ResearchScope;
  title: string;
  messages: ThreadMessage[];
  /** Set when the thread has been distilled into a saved report. */
  reportId: string | null;
  /** Structured, scoped semantic facts extracted after turn threshold (issue #56). */
  semanticMemory?: SemanticMemory | null;
  createdAt: string;
  updatedAt: string;
}

export interface AskResearchInput {
  /** Continue an existing thread… */
  threadId?: string;
  /** …or start a new one anchored to this scope. */
  scope?: ResearchScope;
  question: string;
  /**
   * Pinned references: saved reports and prior conversations folded into the
   * grounding as the MAIN FOCUS of the answer. This is how a landing-page
   * audit or a metrics report becomes the context of a new conversation.
   */
  attachments?: { reportIds?: string[]; threadIds?: string[] };
}

// ---------------------------------------------------------------------------
// Daily Briefing — the deck's overnight desk report.
//
// One grounded pass hunts the LAST N HOURS of real developments across every
// tracked company, and the result is a structured briefing: high-signal
// one-liners (the unboxing reveal), full detail paragraphs (the report body),
// and desk insights (what the day means). Gated on deckBakedState — a digest
// of a half-formed deck would launder skeletons into prose. Every update must
// carry at least one verification-grade citation or it is dropped, the same
// no-fabrication contract metrics live under.
// ---------------------------------------------------------------------------

export interface BriefingUpdate {
  companyName: string;
  /** Resolved against the deck's tracked companies; null for unmatched names. */
  companyId: string | null;
  /** 'high' updates headline the unboxing; 'notable' fill out the report. */
  signal: 'high' | 'notable';
  /** One tight sentence — what happened. */
  oneLiner: string;
  /** Why it matters — the report paragraph. */
  detail: string;
  /** ISO date the development was published, when the sources say. */
  publishedDate: string | null;
  citations: Citation[];
}

export interface DeckBriefing {
  id: string;
  marketId: string;
  deckId: string;
  marketName: string;
  generatedAt: string;
  /** Lookback window the updates were hunted in (hours). */
  windowHours: number;
  /** The day's editorial headline for this market. */
  headline: string;
  updates: BriefingUpdate[];
  /** Desk insights — what the day's updates mean for the balance of power. */
  insights: string[];
}

// ---------------------------------------------------------------------------
// Site Audit — the landing-page teardown, delivered as a real report.
//
// One grounded pass reads how a site presents itself (copy, offers, coverage,
// reviews) through a CRO/UX auditor's framework, and the result is structured
// so the viewer can render a legit visual report: scorecard, what's working,
// what's missing (with impact), the design language, and what to test first.
// Works on ANY url — your own site or a competitor's.
// ---------------------------------------------------------------------------

export type SiteAuditArea =
  | 'value_proposition'
  | 'messaging'
  | 'cta'
  | 'trust'
  | 'design'
  | 'seo';

export interface SiteAuditScore {
  area: SiteAuditArea;
  /** 1–10, clamped by the engine. */
  score: number;
  verdict: string;
}

export interface SiteAuditFinding {
  title: string;
  detail: string;
  /** For gaps: what the miss is costing (conversions, trust, traffic). */
  impact?: string | null;
}

export interface SiteAuditContent {
  url: string;
  siteName: string;
  /** 0–100 composite (mean of area scores ×10). */
  overall: number;
  scores: SiteAuditScore[];
  working: SiteAuditFinding[];
  missing: SiteAuditFinding[];
  designStyle: { summary: string; notes: string[] };
  testFirst: SiteAuditFinding[];
}

export interface SiteAuditInput {
  url: string;
  siteName?: string | null;
  /** When auditing a tracked company's site, anchor the report to it. */
  companyId?: string | null;
}

export interface Report {
  id: string;
  kind: 'deck' | 'company' | 'site_audit';
  subjectId: string;
  title: string;
  markdown: string;
  citations: Citation[];
  /** The compact, source-linked evidence digest the report was allowed to use. */
  evidenceDigest?: string;
  evidenceCitations?: Citation[];
  /** Structured content when kind='site_audit' — drives the visual report. */
  audit?: SiteAuditContent;
  createdAt: string;
}

/** Targeted micro-research to fill a gap in an existing deck (intelligent empty states). */
export interface ExpandFocus {
  tier?: MaturityTier;
  cardType?: CardType;
}

/** A conflicting observation retained when repeated research disagrees. */
export interface MetricConflict {
  metricType: MetricType;
  observations: Array<{
    value: number | null;
    confidence: Confidence;
    source: string | null;
    capturedAt: string;
  }>;
  detectedAt: string;
  preferredObservation: number;
}

/** A user's manual correction to a metric (human-in-the-loop override). */
export interface OverrideMetricInput {
  companyId: string;
  metricType: MetricType;
  /** Raw number (USD for money, count for users/employees, percent for share); null clears to Unknown. */
  value: number | null;
  /** The user's source note, e.g. "Confirmed by their VP Sales at dinner 07/2026". */
  note: string | null;
}

export interface CardFilter {
  cardType?: CardType;
  tier?: MaturityTier;
}

/** A card denormalized with everything the card face + reader needs in one shot. */
export interface CardWithCompany {
  card: Card;
  company: Company | null; // null for Barrier cards (not company-specific, spec §4)
  metrics: CompanyMetric[];
  viceClaims: ViceClaim[]; // populated only for Vice cards
}

export interface DashboardTabResult<T extends DashboardTab> {
  companyId: string;
  tab: T;
  content: DashboardContentFor<T>;
  lastRefreshedAt: string | null;
}

/** Emitted after a deck refresh so the UI can reconcile without a full refetch (spec §9). */
export interface DeckRefreshEvent {
  marketId: string;
  deckId: string;
  refreshedAt: string;
  addedCardIds: string[];
  updatedCardIds: string[];
  prunedCardIds: string[];
}

export type DeckRefreshListener = (event: DeckRefreshEvent) => void;
export type Unsubscribe = () => void;

export interface SavedCard {
  cardId: string;
  savedAt: string;
}

export interface MarketIntelRepository {
  // Markets
  listMarkets(): Promise<Market[]>;
  getMarket(id: string): Promise<Market | null>;
  createMarket(input: CreateMarketInput): Promise<Market>;
  updateMarketCadence(id: string, cadence: RefreshCadence): Promise<Market>;
  deleteMarket?(id: string): Promise<boolean>;

  // Decks
  getDeckByMarket(marketId: string): Promise<Deck | null>;
  deleteDeck?(deckId: string): Promise<boolean>;
  /** Re-run the grounded-search research pass for the market scope (spec §9). */
  refreshDeck(marketId: string): Promise<Deck>;
  /**
   * Research a brand-new deck from a free-text brief (grounded pipeline).
   * Real implementations run Gemini; the demo implementation returns a sample.
   */
  createResearchedDeck(
    brief: DeckResearchBrief,
    handlers?: ResearchHandlers,
  ): Promise<{ market: Market; deck: Deck }>;

  // Cards
  listCards(deckId: string, filter?: CardFilter): Promise<CardWithCompany[]>;
  getCard(cardId: string): Promise<CardWithCompany | null>;
  listSavedCards(): Promise<CardWithCompany[]>;
  saveCard(cardId: string): Promise<SavedCard>;
  unsaveCard(cardId: string): Promise<void>;

  // Company detail
  getCompany(companyId: string): Promise<Company | null>;
  getCompanyMetrics(companyId: string): Promise<CompanyMetric[]>;
  getViceClaims(cardId: string): Promise<ViceClaim[]>;

  // Dashboard (spec §8)
  getDashboardTab<T extends DashboardTab>(
    companyId: string,
    tab: T,
    /** Bypass the cached result and re-research this tab (user-directed rerun). */
    force?: boolean,
  ): Promise<DashboardTabResult<T> | null>;

  /** Grounded, sourced deep-dive on a specific topic — the "dig deeper" drill-down. */
  deepDive(input: DeepDiveInput): Promise<DeepDiveResult>;

  /** Grounded verification of a single claim — verdict + rationale + sources. */
  factCheck(input: FactCheckInput): Promise<FactCheckResult>;

  /**
   * Re-research a stored metric and WRITE BACK the grounded result: revise the
   * value (citations required), bump freshness, re-tier the company. OPTIONAL —
   * live-research transports implement it; demo transports may confirm-only.
   */
  verifyMetric?(input: VerifyMetricInput): Promise<VerifyMetricResult>;

  /**
   * Hunt grounded values for ALL of a company's soft figures (missing rows,
   * unknowns, unverified estimates) in a single research pass, write them back
   * with citations, and re-tier. OPTIONAL — live-research transports only.
   */
  huntCompanyMetrics?(companyId: string): Promise<HuntMetricsResult>;

  /** Fill a gap in a deck via targeted micro-research (e.g. hunt Seed-stage companies). */
  expandDeck(
    marketId: string,
    focus: ExpandFocus,
    handlers?: ResearchHandlers,
  ): Promise<{ added: number }>;

  /** Human-in-the-loop metric correction → confidence 'user_verified' → CMS re-tier. */
  overrideMetric(input: OverrideMetricInput): Promise<CompanyMetric>;

  /** Deck-level whitespace analysis (2×2 positioning thesis), grounded + cached. */
  getMarketOpportunity(marketId: string, force?: boolean): Promise<DeepDiveResult>;

  // Reports — AI-composed research artifacts, kept in an organized library.
  generateReport(request: ReportRequest, handlers?: ResearchHandlers): Promise<Report>;
  listReports(): Promise<Report[]>;
  getReport(id: string): Promise<Report | null>;

  /**
   * The overnight desk: hunt the last N hours of real developments across the
   * deck's tracked companies and compose a structured Daily Briefing. Throws
   * when the deck is still forming (deckBakedState gate). OPTIONAL —
   * live-research transports only.
   */
  generateDeckBriefing?(
    marketId: string,
    opts?: { windowHours?: number },
  ): Promise<DeckBriefing>;
  /** Stored briefings for a market, newest first. OPTIONAL. */
  listDeckBriefings?(marketId: string): Promise<DeckBriefing[]>;

  /**
   * CRO/UX teardown of any landing page (yours or a competitor's), saved into
   * the Reports library as a structured visual report. OPTIONAL —
   * live-research transports only.
   */
  auditSite?(input: SiteAuditInput): Promise<Report>;

  // Research conversations. OPTIONAL so transports can adopt incrementally
  // (the Electron IPC bridge wires these when the desktop back end lands);
  // the UI feature-detects and hides chat affordances when absent.
  /** Ask a grounded question in a new or existing research thread. */
  askResearch?(input: AskResearchInput, handlers?: ResearchHandlers): Promise<ResearchThread>;
  /** Threads anchored to a deck and/or company, newest first. */
  listResearchThreads?(filter?: { deckId?: string; companyId?: string }): Promise<ResearchThread[]>;
  getResearchThread?(id: string): Promise<ResearchThread | null>;
  /** Durable research-job controls used by Electron and future orchestration agents. */
  listResearchJobs?(): Promise<ResearchJob[]>;
  getResearchJob?(id: string): Promise<ResearchJob | null>;
  cancelResearchJob?(id: string): Promise<ResearchJob | null>;
  resumeResearchJob?(id: string): Promise<ResearchJob | null>;
  /** Distill a conversation into a saved report (kept in the library + thread link). */
  saveThreadAsReport?(threadId: string, focus?: string | null): Promise<Report>;

  // Live refresh stream (spec §9). No-op-unsubscribe implementations are valid.
  subscribeDeckRefresh(listener: DeckRefreshListener): Unsubscribe;
}
