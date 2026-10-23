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
  ReportTopic,
} from './enums';
import type { MarketProfile } from './market-profile';
import type { CompanyReportResult } from './company-report';
import type {
  Card,
  Company,
  CompanyMetric,
  DashboardContentFor,
  Ownership,
  ProductBrief,
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
export type CompanyScope = {
  mode: 'market' | 'selected_only';
  names: string[];
};

export interface DeckResearchBrief {
  prompt: string;
  region: string | null;
  /** Optional hard scope from the user's explicit company selection. */
  companyScope?: CompanyScope;
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
  /** The answer so far, as it streams in (engines whose transport can stream). The returned thread is authoritative. */
  onDraft?: (textSoFar: string) => void;
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
  /** Original-page attempts, not accepted claims. Optional for older transports. */
  originalSources?: {
    requestedUrl: string;
    finalUrl?: string;
    status: 'retrieved' | 'blocked' | 'unavailable';
    retrievedAt: string;
    reason?: string;
    text?: string;
    truncated?: boolean;
  }[];
}

export interface BatchMetricVerification {
  metricType: MetricType;
  verdict: FactCheckVerdict;
  changed: boolean;
  /** Stored confidence AFTER verification applied (or was skipped). */
  confidence: Confidence;
  /** Stored value AFTER verification applied (or was skipped). */
  value: number | null;
  rationale: string;
}

/**
 * ONE grounded pass re-checking every estimated figure a company has — the
 * promote-to-verified / demote-on-contradiction lane. Unknown slots are the
 * hunt's job; user-verified rows are law. One action instead of two calls per
 * metric is what makes background verification affordable at deck scale.
 */
export interface VerifyCompanyMetricsResult {
  /** Metric types the batch pass examined. */
  examined: MetricType[];
  /** Types whose stored value or confidence actually changed. */
  changedTypes: MetricType[];
  retieredCardIds: string[];
  results: BatchMetricVerification[];
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

/** Escalation knob for a repeated metric hunt. */
export interface HuntMetricsOptions {
  /**
   * 0 = first attempt for this company this session; N ≥ 1 = N earlier
   * general searches for these figures came back empty, so the hunt must
   * vary its approach rather than repeat the same query shape.
   */
  escalation?: number;
  /**
   * Face sweep: ask ONLY for the metric types whose card-face slots are still
   * empty (PROFILE_CORE_SLOTS alternatives), nothing else from the profile.
   */
  faceSlotsOnly?: boolean;
  /**
   * Also re-hunt figures whose assessment says stale or undated (the dashboard
   * refresh sets this). Such a figure is only replaced by a newer,
   * at-least-as-authoritative one; otherwise it stays, labelled.
   */
  refreshStale?: boolean;
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
  /** Fold several conversations of one card into the report (the card's memory). `threadId` is kept for older callers. */
  threadIds?: string[];
  /** The card the report is about, so it is kept with that card's memory. */
  cardId?: string | null;
  /**
   * Company reports only: the sections to include, mirroring the dashboard
   * tabs. When given, the report runs the four-step flow (read what is stored,
   * find the gaps, research those gaps more deeply, write it up) and returns
   * structured `sections`. Absent keeps the older single-pass report.
   */
  topics?: ReportTopic[];
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
  /** Selected card ids for deck-level comparisons. */
  cardIds?: string[];
  /** Human label for what this thread is anchored to, e.g. "ARR", "GPT-5", "Jane Doe". */
  subject?: string | null;
}

export interface ThreadMessage {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  /** Grounded sources behind an assistant turn. Always [] for user turns. */
  citations: Citation[];
  /** Where an assistant turn came from: research already on file for the card, or a fresh search. Absent on older turns. */
  origin?: 'memory' | 'fresh';
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
  /** Search again: skip the answer from research on file and run a fresh search. */
  fresh?: boolean;
  /** Answer on the stronger, slower reasoning model instead of the fast one. */
  deep?: boolean;
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

/** One written section of a topic-based company report. */
export interface ReportSection {
  topic: ReportTopic;
  title: string;
  markdown: string;
  /** Sources behind this section, shown as numbered footnotes. */
  citations: Citation[];
  /** What the stored research lacked for this topic, in plain words. Empty when nothing was missing. */
  gaps: string[];
  /** True when the section needed a deeper research pass beyond what was stored. */
  researchedDeeper: boolean;
}

/** What building a report cost. Unknown is null, never zero. */
export interface ReportCost {
  /** Estimated USD at deliberately high list prices; null when the provider reported no usage. */
  estUsd: number | null;
  /** Provider calls made while building this report; null when not measured. */
  calls: number | null;
  /** Google searches those calls ran; null when not measured. */
  searches: number | null;
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
  /** Topic-based company reports: the topics asked for and the written sections. */
  topics?: ReportTopic[];
  sections?: ReportSection[];
  cost?: ReportCost;
  /** The card, deck and conversations this report belongs to, so a card's memory can list it. Absent on older reports. */
  cardId?: string | null;
  deckId?: string | null;
  threadIds?: string[];
  /** What the report was asked to concentrate on: everything on the card, one conversation, or a topic. */
  focusKind?: 'all' | 'thread' | 'topic';
  createdAt: string;
}

/** One sourced point of a signal card's brief. A point with no source is never kept. */
export interface SignalBriefPoint {
  text: string;
  /** Pages the search itself attributed this point to; at least one. */
  sources: Citation[];
}

/**
 * The body behind a signal card (risk, culture, barrier, insight): a short, sourced mini-report built when the card is first
 * opened and then kept with the card. `lead` is one sentence; `points` is at most eight, none padded.
 */
export interface SignalBrief {
  cardId: string;
  cardType: CardType;
  builtAt: string;
  lead: string;
  points: SignalBriefPoint[];
  /** Every distinct source behind the points. */
  sources: Citation[];
  cost: ReportCost;
}

/** What the app remembers about one card: its conversations, its reports and its brief. Read-only; never researches. */
export interface CardMemory {
  cardId: string;
  /** Newest first. */
  threads: ResearchThread[];
  /** Newest first. */
  reports: Report[];
  brief: SignalBrief | null;
}

/**
 * A read-only copy of researched work, for a share link: what a recipient needs
 * to browse a card or a deck (cards, companies, figures with their sources, and
 * every stored dashboard tab) and nothing private (no chats, notes, saved
 * flags, reports, keys or evidence vault). Shaped like the demo seed so the
 * same viewer code renders it. Built from what is stored; it never runs research.
 */
/** One website the research engine just searched, read or found a source on. */
export interface SourceActivity {
  id: number;
  at: string;
  /** The site only (no path, no query): enough to show where research is looking. */
  domain: string;
  kind: 'searched' | 'read' | 'found';
  company: string | null;
}

export interface ShareSnapshot {
  v: 1;
  kind: 'card' | 'deck';
  /** The card a card share opens on; null for a whole deck. */
  focusCardId: string | null;
  sharedAt: string;
  markets: Market[];
  decks: Deck[];
  companies: Company[];
  metrics: CompanyMetric[];
  cards: Card[];
  viceClaims: ViceClaim[];
  /** Stored dashboard tabs per company, exactly as the dashboard shows them. */
  dashboards: Record<string, Partial<Record<DashboardTab, { content: unknown; lastRefreshedAt: string }>>>;
  /** Briefs of the signal cards in this share, by card id. Absent in shares made before briefs existed. */
  signalBriefs?: Record<string, SignalBrief>;
}

/** Targeted micro-research to fill a gap in an existing deck (intelligent empty states). */
export interface ExpandFocus {
  tier?: MaturityTier;
  cardType?: CardType;
  /** Add this one named company (confirmed by the person) instead of hunting for unknown ones. */
  company?: { name: string; domain?: string | null; descriptor?: string | null };
}

/** What kind of link was pasted. */
export type CapturedLinkKind = 'x_post' | 'x_profile' | 'website' | 'article';

/** Where a candidate company's identity came from; always shown with the candidate. */
export interface LinkCandidateSource {
  /** The pasted link, or a public page found by search. */
  url: string;
  title: string | null;
  how: 'link_address' | 'page' | 'pasted_text' | 'search';
}

/** A link read into a candidate company. Never a guess: `unidentified` says why, and the person types the name. */
export type LinkCandidate =
  | {
      status: 'identified';
      kind: CapturedLinkKind;
      name: string;
      websiteUrl: string | null;
      /** One plain line from a source, or null. */
      descriptor: string | null;
      /** At least one. */
      sources: LinkCandidateSource[];
    }
  | { status: 'unidentified'; kind: CapturedLinkKind | null; reason: string };

export interface CompanyLinkInput {
  url: string;
  /** Text the person pasted with the link (a post's wording, an article's headline). */
  text?: string;
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
  /** Search attribution for this section, not independently verified claims.
   * Absent on legacy cached sections; never inferred from unrelated research. */
  citations?: Citation[];
  /** Sanitized original-page acquisition outcomes; not citations or proof of claims. */
  sourceDiagnostics?: DashboardSourceDiagnostics;
}

export interface DashboardSourceDiagnostics {
  reads: Array<{
    host: string;
    outcome: 'retrieved' | 'blocked' | 'unavailable';
    httpStatus?: number;
  }>;
  eligibleSourceCount: number;
  acceptedExcerptCount: number;
}

/** Emitted after a deck refresh so the UI can reconcile without a full refetch (spec §9). */
export interface DeckRefreshEvent {
  marketId: string;
  deckId: string;
  refreshedAt: string;
  addedCardIds: string[];
  updatedCardIds: string[];
  prunedCardIds: string[];
  /** Companies whose stored figures or dashboards changed — lets the UI
   * invalidate live-updating dashboard/company queries precisely. Optional
   * for older emitters. */
  companyIds?: string[];
}

export type DeckRefreshListener = (event: DeckRefreshEvent) => void;
export type Unsubscribe = () => void;

/** What a followed company did: Today's kinds of move. */
export type MoveKind = 'funding' | 'launch' | 'hire' | 'deal' | 'filing';

/**
 * One dated move by a followed company, from a free source (a news feed or SEC
 * EDGAR). The title is the publisher's own headline, or EDGAR's form name and
 * filed items; nothing in it is written by a model.
 */
export interface CompanyMove {
  id: string;
  companyId: string;
  companyName: string;
  kind: MoveKind;
  /** 3 = major, 2 = notable, 1 = minor. */
  importance: 1 | 2 | 3;
  title: string;
  url: string;
  publisher: string | null;
  /** When the source published or filed it (ISO). */
  publishedAt: string;
  /** When Stratemark found it (ISO). */
  foundAt: string;
  source: 'news' | 'sec_filing';
  readAt: string | null;
}

export interface CompanyFollow {
  companyId: string;
  followedAt: string;
  /** The company's name, for listing follows without loading each company. */
  companyName?: string;
  /** When its moves were last looked for successfully (stored, so it survives a reload); absent or null when it has not been, or its last look failed. */
  lastCheckedAt?: string | null;
  /** Set while its last look failed (the news or SEC filings could not be reached) and it is waiting to be tried again. */
  checkFailedAt?: string | null;
}

export interface MovesRefreshResult {
  added: number;
  /** Followed companies looked at successfully; 0 when every one was looked at in the last day. */
  refreshed: number;
  /** The latest successful look across the followed companies (a failed look is never counted). */
  refreshedAt: string | null;
  /** Companies this check could not fully reach and will try again within hours. */
  failed?: string[];
}


export interface SavedCard {
  cardId: string;
  savedAt: string;
}

/** Research the user dropped in about one company (a file, pasted text, or a page they supplied). */
export interface ResearchDocumentInput {
  companyId: string;
  companyName: string;
  /** What to call it: the file name, the page title, or the user's own label. */
  title: string;
  /** The document as plain text. The caller extracts it (PDF to text, page to text). */
  text: string;
  /** Where it came from, when it has an address. */
  sourceUrl?: string;
  kind: 'file' | 'text' | 'url';
}

/** The result of reading a dropped-in document. Every finding and figure carries a quote taken word for word from it. */
export interface ResearchDocumentResult {
  /** The first stored piece of the document. */
  evidenceId: string;
  title: string;
  summary: string;
  findings: Array<{ claim: string; quote: string }>;
  /** Proposals only. Nothing becomes a figure until a person applies it (which makes it user-verified). */
  figures: Array<{ metricType: MetricType; value: number; label: string; quote: string }>;
  /** The document was longer than the limit and was cut. */
  truncated: boolean;
  /** The document is kept and searchable, but the model read of it failed. */
  digestFailed: boolean;
}

/** A user-authored entry in the deck's research knowledge base. Structural
 * subset of the research package's evidence record (contracts cannot import
 * the research package). */
export interface ResearchNoteEntry {
  id: string;
  companyId: string;
  companyName: string;
  topic: string;
  capturedAt: string;
  text: string;
  citations: Citation[];
}

/** What the configured provider can actually do. Features must degrade
 * honestly when a capability is absent — never error, never fake. */
export interface ProviderCapabilities {
  /** Google-Search-grounded research. */
  ground: boolean;
  /** Structured JSON extraction. */
  structure: boolean;
  /** Image generation (Nano Banana covers). */
  image: boolean;
  /**
   * Repository methods this engine cannot run (they would only throw). The UI
   * hides the matching controls instead of offering a button that always fails.
   */
  unsupported?: readonly string[];
}

export interface ResearchPassage {
  evidenceId: string;
  companyId: string | null;
  companyName: string | null;
  topic: string;
  capturedAt: string;
  /** Best-matching window of the record, sentence-aligned and bounded. Verbatim record text. */
  snippet: string;
  citations: Citation[];
}

export interface ResearchCorpusQuery {
  query: string;
  /** Restrict to these companies (a deck's roster, a card's subject). Absent = the whole corpus. */
  companyIds?: readonly string[];
  topics?: readonly string[];
  /** Default 8, hard cap 25. */
  limit?: number;
}

/** One unfilled core slot on a company's card: which metric it concerns and
 * WHY it is a gap — a valueless row exists (`unknown`) or no row at all
 * (`absent`). A gap never carries a proposed value; filling is research's job. */
export interface CompanyCompletenessGap {
  metricType: MetricType;
  /** Human label for UI display (mirrors METRIC_TYPE_LABELS). */
  label: string;
  state: 'unknown' | 'absent';
}

/** The honest readiness of one company's report: every core slot of its market
 * profile that still lacks a value. `ready` is true only when `gaps` is empty. */
export interface CompanyCompleteness {
  companyId: string;
  name: string;
  profile: MarketProfile;
  gaps: CompanyCompletenessGap[];
  ready: boolean;
}

export interface MarketIntelRepository {
  /** Capability report for the active engine/key. OPTIONAL — engines without
   * capability plumbing are assumed fully capable by callers that need a
   * default, but honest UIs should prefer this. */
  capabilities?(): ProviderCapabilities;

  // Markets
  listMarkets(): Promise<Market[]>;
  getMarket(id: string): Promise<Market | null>;
  createMarket(input: CreateMarketInput): Promise<Market>;
  updateMarketCadence(id: string, cadence: RefreshCadence): Promise<Market>;
  deleteMarket?(id: string): Promise<boolean>;
  /** Archive (or restore) a deck by its market id. Nothing is deleted; an archived
   * deck is left out of the library, sidebar and scheduled refreshes. */
  setMarketArchived?(id: string, archived: boolean): Promise<Market>;

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
  /**
   * Take a card out of its deck because it does not belong in this market.
   * The company stays out of that deck even if later research finds it again.
   * OPTIONAL — engines without it simply do not offer the action.
   */
  removeCard?(cardId: string): Promise<void>;
  listSavedCards(): Promise<CardWithCompany[]>;
  /** Today: moves of followed companies, unread first, then importance, then newest. */
  listMoves?(): Promise<CompanyMove[]>;
  /** Look for new moves (free sources + one classification call). At most once a day unless forced. */
  refreshMoves?(options?: {
    force?: boolean;
    /** Look only at these followed companies (a single company's "Check news now"); omitted = every followed company. */
    companyIds?: readonly string[];
    /** Optional: called as companies are looked at ("12 of 104"). In-process engines only; never sent over IPC. */
    onProgress?: (done: number, total: number) => void;
  }): Promise<MovesRefreshResult>;
  markMoveRead?(moveId: string, read: boolean): Promise<void>;
  /** Mark several moves read in one write ("Mark all read"). Unknown ids are ignored. */
  markMovesRead?(moveIds: readonly string[]): Promise<void>;
  listFollows?(): Promise<CompanyFollow[]>;
  followCompanies?(companyIds: readonly string[]): Promise<void>;
  unfollowCompany?(companyId: string): Promise<void>;
  saveCard(cardId: string): Promise<SavedCard>;
  unsaveCard(cardId: string): Promise<void>;

  // Company detail
  getCompany(companyId: string): Promise<Company | null>;
  /** Raw observations for audit/correction, not a user-facing facts projection. */
  getCompanyMetrics(companyId: string): Promise<CompanyMetric[]>;
  /** Accepted current facts, not raw observation history; no provider calls. */
  getCompanyFacts?(companyId: string): Promise<CompanyMetric[]>;
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
   * ONE grounded pass re-checking every estimated figure this company has:
   * promote to verified on reputable corroboration, demote on contradiction,
   * leave unknowns to hunts and user-verified rows untouched. Optional — only
   * live-research transports implement it.
   */
  verifyCompanyMetrics?(companyId: string): Promise<VerifyCompanyMetricsResult>;

  /**
   * Hunt grounded values for ALL of a company's soft figures (missing rows,
   * unknowns, unverified estimates) in a single research pass, write them back
   * with citations, and re-tier. OPTIONAL — live-research transports only.
   * `options.escalation` marks a retry after empty earlier passes.
   */
  huntCompanyMetrics?(companyId: string, options?: HuntMetricsOptions): Promise<HuntMetricsResult>;

  /**
   * Make sure the deck holds its four market-signal kinds (barrier, insight, vice, culture). Barrier and insight cards
   * come from one market-level search; vice and culture cards from one search about the deck's own companies. Only the
   * kinds the deck is short of are searched for, every card needs a clickable source, and a market with nothing
   * documented gets no card (never padding). A kind counts its SOURCED cards only, searched kinds rest for a few days (the
   * rest is stored with the deck), and a search that errored rests briefly. `failed` is true when a search errored (worth
   * another try), not when it found nothing; `failedKinds` says which kinds. OPTIONAL; `force` searches for every kind
   * that has room, whatever its rest. Additive in the contract.
   */
  ensureSignalCards?(deckId: string, options?: { force?: boolean; signal?: AbortSignal }):
    Promise<{ added: Record<'barrier' | 'insight' | 'vice' | 'culture', number>; failed: boolean; failedKinds?: Array<'barrier' | 'insight' | 'vice' | 'culture'> }>;

  /**
   * Face hunt for several companies in one grounded search, each company still
   * held to its own per-figure gates. Returns the companies it hunted; one it
   * left out or failed is absent, for the caller to hunt alone. OPTIONAL.
   */
  huntFaceSlotsBatch?(companyIds: readonly string[]): Promise<Record<string, HuntMetricsResult>>;

  /**
   * Market-batch estimated fill: ONE grounded call proposes estimated-tier
   * figures for several gapped companies at once, per-claim provider support,
   * identity-guarded against the deck roster. Estimated tier only; structured
   * lanes and verified evidence always take precedence. Optional capability.
   */
  fillMissingMarketEstimates?(deckId: string): Promise<{ filledCompanies: number; filledTypes: number }>;

  /**
   * Cross-run evidence reuse: copy a same-company (root domain or normalized
   * legal name) twin's retained originals and evidence into this company so
   * free recovery can re-derive its facts without provider calls. Copies
   * evidence only — confidence is re-earned by the gates. Optional capability.
   */
  reuseCompanyEvidence?(companyId: string): Promise<number>;

  /**
   * Keep research the user dropped in (a file, pasted text, a page) and read it back: a summary, findings and
   * figure proposals, each backed by a word-for-word quote or dropped. The document stays searchable by chat and the
   * Research & Sources tab. It is the user's own material, never counted as independently verified. OPTIONAL.
   */
  addResearchDocument?(input: ResearchDocumentInput): Promise<ResearchDocumentResult>;

  /**
   * Add a user-authored note to the deck's research knowledge base. The note
   * is stored as a user_note evidence record so it flows through the same
   * rendering and export paths as provider research. OPTIONAL.
   */
  addResearchNote?(input: { companyId: string; companyName: string; text: string; sourceUrl?: string }):
    Promise<ResearchNoteEntry>;

  /**
   * Keyword retrieval over the accumulated research corpus (evidence notes,
   * hunts, verifications, user notes). This is how the agent and the Research
   * tab find things in weeks of research without loading it into a prompt.
   * Passages carry their own citations; empty query ranks by recency.
   * OPTIONAL — engines holding saved evidence locally.
   */
  searchResearchCorpus?(query: ResearchCorpusQuery): Promise<ResearchPassage[]>;

  /**
   * Persist a finished research artifact (e.g. a deep-dive story) as a Report
   * so it opens in the full-page reader and lives in the Reports library.
   * OPTIONAL — engines holding saved research locally.
   */
  saveReport?(input: { kind: 'company' | 'deck' | 'site_audit'; subjectId: string; title: string; markdown: string; citations: Citation[] }): Promise<Report>;

  /**
   * Re-project retained company_profile evidence through the reported-claims
   * validator and fill only rows that currently hold no value. Free: makes no
   * provider call. OPTIONAL — engines holding saved evidence locally.
   */
  recoverSavedCompanyMetrics?(companyId: string): Promise<HuntMetricsResult>;

  /**
   * The completeness gate before a report or deep-dive is served: compute each
   * company's honest core-slot gaps, and when any remain run one bounded fill
   * pass — free recovery, the structured lanes, then at most ONE hunt with no
   * escalation — before recomputing. `researched` lists companies any pass ran
   * for; `stillMissing` counts what research honestly could not fill, never a
   * proposed value. Optional — live-research transports only.
   */
  ensureReportReadiness?(
    companyIds: string[],
    options?: { signal?: AbortSignal },
  ): Promise<{ reports: CompanyCompleteness[]; researched: string[]; stillMissing: number }>;

  /**
   * Asset lane: resolve the company's real logo from its own site and store it
   * only over a guessed favicon (curated/Wikidata art stays). `read` must
   * return RAW-HTML receipts (the transport's asset reader). Optional — needs
   * a transport with web-read access; the result is honest-null when the site
   * yields nothing.
   */
  fillCompanyAssets?(
    companyId: string,
    read: (url: string) => Promise<unknown>,
  ): Promise<{ logo: { url: string; sourceUrl: string } | null }>;

  /**
   * Ownership lane (optional): acquired / acquisition pending / registry
   * parent, each with citations, persisted on `company.ownership`. Never
   * replaces a human-verified record; finding nothing keeps the stored one.
   */
  fillCompanyOwnership?(companyId: string): Promise<{ ownership: Ownership | null }>;

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
  /**
   * Package a card or a whole deck as a read-only snapshot for a share link.
   * Reads stored research only: a tab that was never researched is simply
   * absent. OPTIONAL — engines holding research locally.
   */
  exportShareSnapshot?(input: { deckId: string; cardId?: string | null }): Promise<ShareSnapshot>;
  /**
   * A dashboard tab only if it is already stored, exactly as the dashboard shows
   * it; null when it was never researched. Unlike `getDashboardTab` this never
   * starts research, so a screen can show what is known without spending.
   * OPTIONAL — engines holding research locally.
   */
  peekDashboardTab?<T extends DashboardTab>(companyId: string, tab: T): Promise<DashboardTabResult<T> | null>;
  /**
   * Research one product for its own page: key metrics, overview, how it is
   * received, its growth timeline, product-specific news and YouTube videos, every figure
   * sourced. Stores the result. A stored brief is returned free; only its news/videos re-run
   * when missing or stale (3 and 14 days). `force` re-runs everything.
   * Spends research credits, so only on request. OPTIONAL — live-research engines.
   */
  researchProductBrief?(input: { companyId: string; productName: string; force?: boolean }): Promise<ProductBrief>;
  /**
   * Read a pasted link (an X post or profile, a company site, an article) into a
   * CANDIDATE company with its source. Spends at most one lite structure call and
   * one grounded search, and nothing is saved. OPTIONAL — live-research engines.
   */
  identifyCompanyFromLink?(input: CompanyLinkInput, handlers?: ResearchHandlers): Promise<LinkCandidate>;
  /**
   * The websites research touched most recently, newest last, after `sinceId`.
   * Reported as they happen; nothing here is a forecast. OPTIONAL — live-research engines.
   */
  listSourceActivity?(sinceId?: number): Promise<{ items: SourceActivity[]; lastId: number }>;
  /** A stored product brief, or null when none was researched. Never researches. OPTIONAL. */
  peekProductBrief?(companyId: string, productName: string): Promise<ProductBrief | null>;
  /**
   * The company's living report, read from what is stored: never researches and never calls a model. Returns the
   * last written report with `stale` set when the research has moved on since, or, when none was written yet, a
   * report assembled from stored text alone (status 'stored_data'). Null only for an unknown company. OPTIONAL.
   */
  peekCompanyReport?(companyId: string): Promise<CompanyReportResult | null>;
  /**
   * Write (or, with `force`, rewrite) the company's report: one structured model call over everything stored,
   * checked by a deterministic gate (cited, no invented figures), then kept by data hash. A current report is
   * returned without spending. With no model or on failure it falls back to a report built from stored text.
   * Spends credits, so only on a person's request. OPTIONAL — engines holding research locally.
   */
  getCompanyReport?(companyId: string, options?: { force?: boolean; signal?: AbortSignal }): Promise<CompanyReportResult>;
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
  listResearchThreads?(filter?: { deckId?: string; companyId?: string; cardId?: string }): Promise<ResearchThread[]>;
  /** A stored signal-card brief, or null when none was built. Never researches. OPTIONAL — engines holding research locally. */
  peekSignalBrief?(cardId: string): Promise<SignalBrief | null>;
  /** Build (or, with `force`, rebuild) a signal card's sourced brief and keep it. Spends research credits, so only on request. OPTIONAL. */
  researchSignalBrief?(input: { cardId: string; force?: boolean; /** Aborted when the card is closed: a build still waiting for a slot (or not yet started) is dropped; one already paid for finishes. */ signal?: AbortSignal }): Promise<SignalBrief>;
  /** A card's conversations, reports and brief in one read. Never researches. OPTIONAL. */
  getCardMemory?(cardId: string): Promise<CardMemory>;
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
