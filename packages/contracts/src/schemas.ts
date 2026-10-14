/**
 * Zod schemas — the runtime contract that mirrors the SQLite/Drizzle data model
 * (spec §10) and every per-tab dashboard payload. Every value crossing the
 * repository boundary is validated against these, so malformed back-end data is
 * caught, never silently rendered (see Constraints).
 */
import { z } from 'zod';
import {
  CARD_TYPES,
  CONFIDENCE_LEVELS,
  DASHBOARD_TABS,
  METRIC_TYPES,
  MODEL_PROPOSABLE_CONFIDENCE,
  REFRESH_CADENCES,
  SUBSCRIPTION_STATUSES,
  SUBSCRIPTION_TIERS,
} from './enums';

// Enum schemas -------------------------------------------------------------
export const cardTypeSchema = z.enum(CARD_TYPES);
export const metricTypeSchema = z.enum(METRIC_TYPES);
export const confidenceSchema = z.enum(CONFIDENCE_LEVELS);

/**
 * Confidence as a MODEL may state it (issue #48). Use this — never
 * `confidenceSchema` — on any structured-output schema handed to a model.
 *
 * Two jobs. Declaring the narrow enum makes the generated native
 * `responseSchema` exclude `user_verified`, so a conforming model cannot emit a
 * forged human sign-off at all. Normalising first stops a NON-conforming model
 * from costing us an entire enrichment payload: the human-only value is demoted
 * to `verified` (which must then be earned from a citation downstream), and
 * anything unrecognisable becomes `unknown` rather than being trusted.
 * `enforceModelMetricProvenance` applies the same demotion for callers that
 * bypass this schema, so both entry points agree.
 */
export const modelConfidenceSchema = z
  .preprocess((raw) => {
    if (raw === undefined || raw === null) return undefined; // let .default() apply
    if (raw === 'user_verified') return 'verified'; // human-only: never asserted
    return (MODEL_PROPOSABLE_CONFIDENCE as readonly string[]).includes(raw as string)
      ? raw
      : 'unknown'; // malformed is a gap, not a figure to trust
  }, z.enum(MODEL_PROPOSABLE_CONFIDENCE))
  .default('unknown');

export const refreshCadenceSchema = z.enum(REFRESH_CADENCES);
export const dashboardTabSchema = z.enum(DASHBOARD_TABS);
export const subscriptionTierSchema = z.enum(SUBSCRIPTION_TIERS);
export const subscriptionStatusSchema = z.enum(SUBSCRIPTION_STATUSES);
export const maturityTierSchema = z.union([
  z.literal(1),
  z.literal(2),
  z.literal(3),
  z.literal(4),
  z.literal(5),
  z.literal(6),
  z.literal(7),
  z.literal(8),
]);

// ISO-8601 timestamps travel as strings across the boundary (SQLite text / JSON).
const isoTimestamp = z.string().min(1);

// User & Auth schemas -----------------------------------------------------
export const userSchema = z.object({
  id: z.string(),
  email: z.string().catch(''),
  subscriptionTier: subscriptionTierSchema.catch('free'),
  subscriptionStatus: subscriptionStatusSchema.catch('active'),
  stripeCustomerId: z.string().nullable().optional(),
  timezone: z.string().optional(),
  slackWebhookUrl: z.string().nullable().optional(),
  discordWebhookUrl: z.string().nullable().optional(),
  createdAt: isoTimestamp,
});

export const userMeResponseSchema = z.object({
  user: userSchema,
});

// Core tables (spec §10) ---------------------------------------------------
export const scopeDefinitionSchema = z.object({
  vertical: z.string().min(1),
  geography: z.string().nullable(),
  notes: z.string().nullable(),
});

export const marketSchema = z.object({
  id: z.string(),
  name: z.string().min(1),
  scopeDefinition: scopeDefinitionSchema,
  refreshCadence: refreshCadenceSchema,
  createdAt: isoTimestamp,
});

export const deckSchema = z.object({
  id: z.string(),
  marketId: z.string(),
  createdAt: isoTimestamp,
  lastRefreshedAt: isoTimestamp.nullable(),
});

export const brandThemeSchema = z.object({
  primary: z.string(),
  secondary: z.string(),
  accent: z.string(),
  text: z.string(),
  background: z.string(),
  fontFamily: z.string().nullable(),
  source: z.enum(['scraped', 'llm', 'manual', 'default']),
  /** Which extraction signal supplied a scraped primary (theme-color, css-vars, logo-svg, ...). */
  signal: z.string().optional(),
});

// Citation schema ----------------------------------------------------------
export const citationSchema = z.object({
  title: z.string(),
  url: z.string(),
  credibility: z
    .enum(['primary', 'reputable_secondary', 'industry', 'user_generated', 'unknown'])
    .optional(),
});

/**
 * Who owns the company, as its sources state it (ownership.ts has the rules).
 *
 * - `acquired`: a source says the deal CLOSED — a primary source (SEC filing,
 *   company press release, GLEIF parent record) or two independent ones.
 * - `acquisition_pending`: announced, not shown to have closed.
 * - `subsidiary`: a registry names a parent, no acquisition event is on file.
 * - `independent`: a registry explicitly states there is no parent.
 *
 * No citation, no status: `enforceOwnershipProvenance` drops a status nothing
 * states. `price` is what the acquirer paid — never a valuation of the
 * company. Additive and optional, so every snapshot written before it parses.
 */
export const OWNERSHIP_STATUSES = ['independent', 'acquired', 'acquisition_pending', 'subsidiary'] as const;
export const ownershipStatusSchema = z.enum(OWNERSHIP_STATUSES);
/** YYYY, YYYY-MM or YYYY-MM-DD: a source dated only to the month stays a month. */
const partialDate = z.string().regex(/^\d{4}(?:-\d{2}(?:-\d{2})?)?$/);
export const ownershipSchema = z.object({
  status: ownershipStatusSchema,
  acquirer: z.string().min(1).max(160).optional(),
  announcedOn: partialDate.nullish(),
  closedOn: partialDate.nullish(),
  price: z.object({ value: z.number().finite().positive(), currency: z.string().regex(/^[A-Z]{3}$/) }).nullish(),
  citations: z.array(citationSchema).default([]),
  confidence: confidenceSchema,
  /** One line on how the status was reached (which sources, why not closed). */
  methodNote: z.string().max(600).nullish(),
  checkedAt: isoTimestamp.optional(),
});

export const companySchema = z.object({
  id: z.string(),
  name: z.string().min(1),
  oneLiner: z.string(),
  logoUrl: z.string().nullable(),
  hqLocation: z.string().nullable(),
  websiteUrl: z.string().nullable(),
  brandTheme: brandThemeSchema.nullable(),
  /** Optional: absent means ownership has not been researched, not "independent". */
  ownership: ownershipSchema.nullish(),
});

/** Retained extraction evidence, never a model assertion of verification. */
export const metricPassageSupportSchema = z.object({
  sourceUrl: z.string().max(2048), quote: z.string().max(600), asOf: z.string().max(40),
  /**
   * Money metrics (arr, valuation, market_cap, aum) carry the ISO 4217 code the
   * SOURCE quotes — USD or one of the convertible majors. A non-USD figure is
   * stored converted to USD on the metric row; the quote and this code keep
   * the native observation. count and percent are non-monetary units.
   */
  basis: metricTypeSchema, unit: z.enum(['USD', 'count', 'percent',
    'EUR', 'GBP', 'JPY', 'CNY', 'KRW', 'TWD', 'INR', 'CAD', 'AUD', 'CHF', 'HKD', 'SGD', 'SEK', 'NOK', 'DKK', 'BRL', 'MXN']),
  /** basis is the legacy storage slot; definition is the actual measurement. */
  definition: z.enum(['arr', 'annual_revenue', 'users', 'active_users', 'monthly_active_users',
    'daily_active_users', 'customers', 'paying_customers', 'employees', 'valuation', 'market_cap', 'market_share', 'aum', 'revenue', 'funding_total', 'last_round', 'distribution']).optional(),
  /** Inclusive annual reporting interval; asOf is its end, not retrieval time. */
  periodStart: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  /** Deterministic retained SEC evidence, never generated prose. 'sec-adv' is
   * the IAPD Form ADV PDF report (Item 5.A employees, Item 5.F regulatory AUM). */
  format: z.enum(['sec-companyconcept', 'sec-filing', 'sec-adv']).optional(),
});

/** Who attributed a passage to its sources: Google Search grounding, or a
 * 'page-quote' — a sentence verified verbatim on the cited page's own text
 * (the search-key fallback when grounding quota is spent). */
export const groundingProviderSchema = z.enum(['google-search', 'page-quote']);

/** Provider-attributed reported claim, explicitly NOT original verification. */
export const reportedMetricSupportSchema = z.object({
  provider: groundingProviderSchema, companyName: z.string().min(1),
  basis: metricTypeSchema, value: z.number().finite().nonnegative(),
  unit: metricPassageSupportSchema.shape.unit,
  asOf: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable(),
  definition: metricPassageSupportSchema.shape.definition,
  periodStart: metricPassageSupportSchema.shape.periodStart,
  support: z.object({
    supportIndex: z.number().int().nonnegative(), text: z.string().min(1).max(12000),
    sources: z.array(z.object({ chunkIndex: z.number().int().nonnegative(), url: z.string().max(2048), title: z.string() })).min(1),
    startIndex: z.number().int().nonnegative().optional(), endIndex: z.number().int().nonnegative().optional(),
    partIndex: z.number().int().nonnegative().optional(),
  }),
});

/**
 * A headcount BAND ("51 to 100 employees") a source states instead of a point
 * value. A band is never a point: the metric row keeps `value: null` and the
 * band lives here, with the same provider support proof a reported figure has.
 * Additive: older snapshots without it parse unchanged.
 */
export const reportedBandSchema = z.object({
  provider: groundingProviderSchema, companyName: z.string().min(1),
  basis: z.literal('employees'),
  low: z.number().int().positive(), high: z.number().int().positive(),
  unit: z.literal('count'),
  asOf: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable(),
  support: reportedMetricSupportSchema.shape.support,
}).refine((band) => band.high > band.low, { message: 'band high must exceed low' });
export type ReportedBand = z.infer<typeof reportedBandSchema>;

/** A figure quoted word for word from a fetched original page; see companyMetricSchema.quotedSupport. */
export const quotedSupportSchema = z.object({
  sourceUrl: z.string().max(2048),
  quote: z.string().min(1).max(600),
  asOf: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  /** The figure as the source states it, before any USD conversion. */
  value: z.number(),
  unit: z.string().max(16),
});
export type QuotedSupport = z.infer<typeof quotedSupportSchema>;

export const companyMetricSchema = z.object({
  id: z.string(),
  companyId: z.string(),
  metricType: metricTypeSchema,
  value: z.number().nullable(), // null iff confidence === 'unknown'
  confidence: confidenceSchema,
  source: z.string().nullable(), // primary citation URL (back-compat; mirrors citations[0])
  /**
   * Every source behind THIS figure.
   *
   * `title` holds the publisher (e.g. "carnegieendowment.org") and is what the
   * UI shows: grounding URLs are opaque `vertexaisearch...` redirects that also
   * expire, so the publisher name is the durable half of the provenance.
   * Defaulted to [] so snapshots written before this field still parse.
   */
  citations: z.array(citationSchema).default([]),
  methodNote: z.string().nullable(), // "how we got this number" for estimated figures
  passageSupport: metricPassageSupportSchema.nullish(),
  reportedSupport: reportedMetricSupportSchema.nullish(),
  /** Employees only: a stated headcount range; `value` stays null (never a point). */
  reportedBand: reportedBandSchema.nullish(),
  /**
   * Estimated only: the exact sentence a fetched original page states this
   * figure in (press/news prose the verified gate does not accept). Kept so
   * every reader re-checks it instead of trusting the stored label.
   */
  quotedSupport: quotedSupportSchema.nullish(),
  capturedAt: isoTimestamp,
  /**
   * When a source last CONFIRMED this figure, as opposed to when we wrote the
   * row (`capturedAt`). The two diverge on a refresh that re-confirms an
   * unchanged value — and the confirmation is what freshness depends on, or
   * re-verifying a stable number would read as no progress at all.
   * Defaulted so snapshots written before freshness tracking still parse.
   */
  lastVerifiedAt: isoTimestamp.nullish(),
  /** Last completed check, including inconclusive attempts; not evidence of support. */
  lastVerificationAttemptAt: isoTimestamp.nullish(),
  /**
   * This figure's own decay window. Written onto the row rather than derived at
   * read time, so a later policy change cannot silently reinterpret the
   * freshness of data already on disk. Null = never auto-refresh.
   */
  staleAfterSeconds: z.number().int().positive().nullish(),
  conflicts: z
    .array(
      z.object({
        metricType: metricTypeSchema,
        observations: z.array(
          z.object({
            value: z.number().nullable(),
            confidence: confidenceSchema,
            source: z.string().nullable(),
            capturedAt: isoTimestamp,
            passageSupport: metricPassageSupportSchema.nullish(),
          }),
        ),
        detectedAt: isoTimestamp,
        preferredObservation: z.number().int().nonnegative(),
      }),
    )
    .optional(),
  revision: z.number().int().nonnegative().optional(),
});

export const cardSchema = z.object({
  id: z.string(),
  deckId: z.string(),
  // Nullable: Barrier-to-Entry cards are not company-specific (spec §4).
  companyId: z.string().nullable(),
  cardType: cardTypeSchema,
  // Used for non-company cards (Barrier); company cards derive these from the company.
  title: z.string().nullable(),
  summary: z.string().nullable(),
  tier: maturityTierSchema.nullable(), // only Company cards carry a tier
  tierReason: z.string().nullable(), // LLM ±1 review reasoning (spec §6.3)
  // Market-level cards (Barrier, Insight) state a claim rather than a figure, so
  // they carry their own evidence. Defaulted, so company cards and older stored
  // decks parse unchanged.
  citations: z
    .array(
      z.object({
        title: z.string(),
        url: z.string(),
        credibility: z
          .enum(['primary', 'reputable_secondary', 'industry', 'user_generated', 'unknown'])
          .optional(),
      }),
    )
    .default([]),
  /**
   * For market-level cards (Insight, Barrier): the researched key points behind
   * the headline — each one or two sentences, scannable. Empty for company
   * cards and for decks baked before this field existed.
   */
  keyPoints: z.array(z.string()).default([]),
  createdAt: isoTimestamp,
});

export const viceClaimSchema = z.object({
  id: z.string(),
  cardId: z.string(),
  claimText: z.string().min(1),
  sourceUrl: z.string().min(1), // REQUIRED — every Vice claim must be sourced (spec §4, §6.4)
  /**
   * The publisher behind the source (grounding supplies a title with every
   * URL). The URL alone is an opaque, expiring Google redirect — the publisher
   * name is the durable half of the provenance, same rule as metric citations.
   */
  sourceTitle: z.string().nullable().default(null),
  capturedAt: isoTimestamp,
});

// Dashboard per-tab content contracts (spec §8) ----------------------------
//
// These are TOLERANT by design. A research pass returns what the sources
// actually support, and an all-or-nothing schema turns one missing sub-field
// into a completely blank tab: measured on a live bake, 21% of tabs were lost
// because a single string (an `ethos`, a timeline `detail`) wasn't there.
//
// The product already treats "unknown" as a first-class state for figures. The
// same rule belongs here: render what was found, leave the rest visibly empty.
// Tolerance never invents anything — a dropped row is a gap, not a guess.

/** Prose that may simply not exist in the sources. */
const prose = () => z.string().catch('');

/**
 * An array that keeps the rows that parsed. A malformed row is discarded rather
 * than taking its siblings down with it, and a non-array becomes empty.
 */
const rows = <T extends z.ZodTypeAny>(item: T) =>
  z
    .array(item.nullable().catch(null))
    .catch([])
    .transform((list) => list.filter((r): r is z.output<T> => r !== null));

export const overviewContentSchema = z.object({
  markdown: prose(),
});

/** The Research & Sources tab renders retained evidence directly; the
// cached-content stub only satisfies the shared content contract. */
export const researchContentSchema = z.object({ markdown: z.string() });

export const liveIntelItemSchema = z.object({
  id: z.string(),
  source: z.enum(['news', 'x', 'reddit']),
  title: z.string(),
  url: z.string(),
  summary: z.string(),
  // Reader context: a short reported paragraph about the story — including a
  // direct quote when the sources carry one. Null when research found only
  // the headline; the UI degrades to the one-line summary.
  detail: prose().nullable().catch(null),
  // The article's REPORTED publish date (e.g. "2026-08-19"), when the sources
  // state it. publishedAt below is when OUR research found the item — showing
  // that as the story's date is how "just now" ends up on week-old news.
  publishedDate: prose().nullable().catch(null),
  sentiment: z.enum(['positive', 'neutral', 'negative']),
  publishedAt: isoTimestamp,
  stale: z.boolean(),
  // The publication's own name ("Reuters"), as the news feed or page reports it.
  publisher: z.string().max(120).nullable().optional().catch(null),
  // The article's own link-preview picture (og:image), when research read it.
  imageUrl: z.string().max(2048).nullable().optional().catch(null),
});
/** A video from the company's OWN YouTube channel, linked from its homepage. */
export const companyVideoSchema = z.object({
  id: z.string().regex(/^[\w-]{11}$/),
  title: z.string().max(300),
  /** As YouTube shows it ("2 weeks ago"); never converted into a fake date. */
  age: z.string().max(60).nullable().catch(null),
  views: z.string().max(40).nullable().catch(null),
  channelUrl: z.string().max(300),
});
export const liveIntelContentSchema = z.object({
  items: rows(liveIntelItemSchema),
  lastRefreshedAt: isoTimestamp.nullable().catch(null),
  cadence: refreshCadenceSchema.catch('weekly'),
  videos: rows(companyVideoSchema).optional(),
});

export const orgNodeSchema = z.object({
  id: z.string(),
  name: z.string(),
  role: prose(),
  // An unrecognised grouping is "other" — a real person in the wrong swimlane
  // beats losing the whole org chart.
  group: z.enum(['exec', 'ai', 'product', 'design', 'other']).catch('other'),
  parentId: z.string().nullable().catch(null),
  /** One-two sourced sentences about the person, when reporting exists. */
  bio: prose(),
  /** Reported tenure at the company, when available; never inferred. */
  tenure: prose().nullable().optional().catch(null),
  /** Most recent or notable prior company explicitly surfaced by research. */
  priorCompany: prose().nullable().optional().catch(null),
  /** Notable project or ownership area explicitly tied to the person. */
  notableProject: prose().nullable().optional().catch(null),
  /** Exact retained original that supports this person/title, when available. */
  sourceUrl: z.string().url().nullable().optional().catch(null),
  supportingQuote: prose().nullable().optional().catch(null),
  sourceRetrievedAt: isoTimestamp.nullable().optional().catch(null),
});
/**
 * Tolerant to the model returning the node list bare instead of wrapped in
 * `{ nodes: [...] }` — a real production failure ("Expected object, received
 * array") that crashed the Team & Org tab when a merge-style prompt led the
 * model to emit the array directly. Shape normalization is the parser's job;
 * the user should never see a structure error for a semantically valid list.
 */
export const teamOrgContentSchema = z.preprocess(
  (input) => (Array.isArray(input) ? { nodes: input } : input),
  z.object({
    nodes: rows(orgNodeSchema),
  }),
);

export const liveLandingContentSchema = z.object({
  url: z.string(),
  embeddable: z.boolean().catch(false),
  screenshotUrl: z.string().nullable().catch(null),
});

export const timePointSchema = z.object({ period: z.string(), value: z.number() });
export const capTableSliceSchema = z.object({ holder: z.string(), pct: z.number() });
export const metricsContentSchema = z.object({
  revenue: rows(timePointSchema),
  /** Three-month revenue periods exactly as filed (SEC 10-Q); empty when none are on file. */
  revenueQuarterly: rows(timePointSchema),
  users: rows(timePointSchema),
  churn: rows(timePointSchema),
  nps: rows(timePointSchema),
  capTable: rows(capTableSliceSchema),
});

export const boardMemberSchema = z.object({ name: z.string(), affiliation: prose() });
/** A reported funding round — every field is what sources SAY, never derived. */
export const fundingRoundSchema = z.object({
  round: z.string(), // e.g. "Series C", "Secondary", "Debt financing"
  /** Reported round size in USD; null when undisclosed. */
  amountUsd: z.number().nullable().catch(null),
  /** When it was reported (e.g. "2026 Mar"); null when unclear. */
  date: prose().nullable().catch(null),
  leadInvestors: rows(z.string()),
});
/** An investor with reported context — the investor-board treatment. */
export const investorSchema = z.object({
  name: z.string(),
  /** What kind of money this is, when reported. */
  kind: z.enum(['vc', 'corporate', 'sovereign', 'angel', 'debt', 'other']).catch('other'),
  /** One reported line of context (stake, board seat, round led), or "". */
  note: prose(),
});
export const missionGovernanceContentSchema = z.object({
  mission: prose(),
  ethos: prose(),
  governanceStructure: prose(),
  board: rows(boardMemberSchema),
  positives: rows(z.string()),
  negatives: rows(z.string()),
  // Additive (defaulted) so governance content cached before this ships still parses.
  fundingRounds: rows(fundingRoundSchema).catch([]),
  investors: rows(investorSchema).catch([]),
});

export const timelineEventSchema = z.object({
  date: prose(),
  title: z.string(),
  detail: prose(),
});
export const quoteSchema = z.object({
  text: z.string(),
  attribution: prose(),
  /** Provenance (red team #18): who said it needs when and where. All
   * optional so cached content parses; the dashboard builder drops source
   * fields that do not match the response's real citations. */
  date: prose().optional(),
  sourceTitle: prose().optional(),
  // A quote the notes carry but no link for arrives as "" or prose: that is
  // a quote without provenance, not a malformed row to discard.
  sourceUrl: z.string().url().optional().catch(undefined),
});
export const historyContentSchema = z.object({
  founderStory: prose(),
  timeline: rows(timelineEventSchema),
  quotes: rows(quoteSchema),
});

export const productSchema = z.object({
  name: z.string(),
  description: prose(),
  /**
   * What is publicly reported about this product's revenue contribution —
   * honest prose ("~70% of revenue per 2025 10-K", "not disclosed"), never an
   * invented figure. Ranking in the UI follows the researched order.
   */
  revenueNote: prose(),
  /** Official product page URL when sources name one — powers the live product
   * capture in the UI. Additive; null when not reported. */
  url: prose().nullable().catch(null),
  // null = the product is sourced but no source states its lifecycle: render no
  // badge. An unreadable (non-null, non-enum) status still drops the row rather
  // than asserting a lifecycle stage we did not find. Additive widening.
  status: z.enum(['live', 'beta', 'sunset']).nullable(),
});
export const roadmapItemSchema = z.object({
  title: z.string(),
  horizon: z.enum(['now', 'next', 'later']),
  detail: prose(),
  /** Announced/reported date when sources give one (e.g. "2026 H2"); additive. */
  date: prose().nullable().catch(null),
});
/** A named customer, supplier or partner, only as an exact reported sentence states it. */
export const businessRelationshipSchema = z.object({
  name: z.string(),
  kind: z.enum(['customer', 'supplier', 'partner']),
  /** The exact sentence that names both companies and the relationship. */
  quote: z.string(),
  sourceUrl: prose().nullable().catch(null),
  sourceTitle: prose().nullable().catch(null),
});
export const productsRoadmapContentSchema = z.object({
  products: rows(productSchema),
  roadmap: rows(roadmapItemSchema),
  /** Additive: absent when nothing is reported, and on content stored before it existed. */
  relationships: rows(businessRelationshipSchema).optional(),
});

/** Tab → content schema. Used to validate `dashboard_data.content_json` per tab. */
export const DASHBOARD_CONTENT_SCHEMAS = {
  overview: overviewContentSchema,
  research: researchContentSchema,
  live_intel: liveIntelContentSchema,
  team_org: teamOrgContentSchema,
  live_landing: liveLandingContentSchema,
  metrics: metricsContentSchema,
  mission_governance: missionGovernanceContentSchema,
  history: historyContentSchema,
  products_roadmap: productsRoadmapContentSchema,
} as const;

export const dashboardDataSchema = z.object({
  id: z.string(),
  companyId: z.string(),
  tab: dashboardTabSchema,
  contentJson: z.unknown(),
  lastRefreshedAt: isoTimestamp.nullable(),
});

// Semantic Memory & Research Thread Schemas (spec #56) -----------------------
export const distilledSemanticFactSchema = z.object({
  id: z.string(),
  fact: z.string().min(1),
  category: z
    .enum(['metric', 'finding', 'competitor', 'trend', 'risk', 'general'])
    .default('general'),
  companyId: z.string().nullable().optional(),
  subject: z.string().nullable().optional(),
  citations: z.array(citationSchema).default([]),
  extractedAt: isoTimestamp,
  userVerified: z.boolean().optional(),
});

export const semanticMemorySchema = z.object({
  threadId: z.string(),
  distilledFacts: z.array(distilledSemanticFactSchema).default([]),
  lastDistilledTurnIndex: z.number().int().nonnegative(),
  totalTurnsDistilled: z.number().int().nonnegative(),
  distilledAt: isoTimestamp,
});

export const distillationExtractionSchema = z.object({
  facts: z.array(
    z.object({
      fact: z.string().min(1),
      category: z
        .enum(['metric', 'finding', 'competitor', 'trend', 'risk', 'general'])
        .default('general'),
      companyId: z.string().nullable().optional(),
      subject: z.string().nullable().optional(),
      citations: z.array(citationSchema).default([]),
    }),
  ),
});

export const researchScopeSchema = z.object({
  kind: z.enum(['deck', 'company', 'cards', 'datapoint']),
  deckId: z.string().nullable(),
  companyId: z.string().nullable().optional(),
  cardIds: z.array(z.string()).optional(),
  subject: z.string().nullable().optional(),
});

export const threadMessageSchema = z.object({
  id: z.string(),
  role: z.enum(['user', 'assistant']),
  text: z.string(),
  citations: z.array(citationSchema).default([]),
  at: isoTimestamp,
});

export const researchThreadSchema = z.object({
  id: z.string(),
  scope: researchScopeSchema,
  title: z.string(),
  messages: z.array(threadMessageSchema),
  reportId: z.string().nullable().default(null),
  semanticMemory: semanticMemorySchema.nullable().optional(),
  createdAt: isoTimestamp,
  updatedAt: isoTimestamp,
});

