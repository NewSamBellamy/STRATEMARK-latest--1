/**
 * Zod schemas for the model's structured outputs. Every structuring call is
 * validated against these before anything is assembled into a card — so a
 * malformed / hallucinated response is caught, not rendered. Defaults are
 * permissive (missing → Unknown/null) to honor the missing-data protocol.
 */
import { z } from 'zod';
import { cardTypeSchema, modelConfidenceSchema, metricPassageSupportSchema } from '@mi/contracts';
import { FUNDING_ROUND_TYPES, parseFundingRoundType } from './proxy-estimator';

/**
 * Coerce a model's funding round into the canonical vocabulary, or drop it.
 *
 * Dropping is the honest outcome for an unreadable round: the alternative is
 * either guessing a dilution bracket (an invented figure) or failing the entire
 * enrichment over a single optional fact.
 */
function normalizeFundingRound(raw: unknown): unknown {
  if (raw === undefined) return undefined; // let .default() apply
  if (raw === null || typeof raw !== 'object') return null;
  const round = raw as { amount?: unknown; roundType?: unknown };
  if (typeof round.amount !== 'number' || !Number.isFinite(round.amount)) return null;
  const roundType =
    typeof round.roundType === 'string' ? parseFundingRoundType(round.roundType) : null;
  if (roundType === null) return null;
  return { amount: round.amount, roundType };
}

const metricPassageSchema = metricPassageSupportSchema;

export const metricOutSchema = z.object({
  value: z.number().nullable().default(null),
  // Model-facing vocabulary: `user_verified` is human-only and is excluded from
  // the generated native responseSchema (issue #48).
  confidence: modelConfidenceSchema,
  /** Index into the grounded citations array; null if not attributable. */
  sourceIndex: z.number().int().nullable().default(null),
  /** One-line "how we got this" note for estimated figures. */
  method: z.string().nullable().default(null),
  passageSupport: metricPassageSchema.nullable().optional(),
  /** Claim selector only. Actual attribution comes from provider metadata. */
  reportedClaim: metricPassageSchema.omit({ format: true }).extend({
    asOf: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable(),
  }).nullish(),
});
export type MetricOut = z.infer<typeof metricOutSchema>;

export const marketPlanOutSchema = z.object({
  marketName: z.string().min(1),
  vertical: z.string().min(1),
  geography: z.string().nullable().default(null),
  notes: z.string().nullable().default(null),
  searchThemes: z.array(z.string()).default([]),
  companyScope: z.object({
    mode: z.enum(['market', 'selected_only']).default('market'),
    names: z.array(z.string().trim().min(1)).max(30).default([]),
  }).default({ mode: 'market', names: [] }),
});

// Tolerant of the model returning either { companies: [...] } or a bare [...].
const discoveryCompanySchema = z.object({
  name: z.string().min(1),
  domain: z.string().nullable().default(null),
  descriptor: z.string().default(''),
  primaryRole: z.enum(['company', 'infrastructure', 'distribution']).nullable().default(null),
  cardTypes: z.array(cardTypeSchema).default(['company']),
  reportedValuation: z.number().nullable().default(null),
  reportedArr: z.number().nullable().default(null),
  reportedHeadcount: z.number().nullable().default(null),
  fundingStage: z.string().nullable().default(null),
});

export const discoveryOutSchema = z.preprocess(
  (v) => (Array.isArray(v) ? { companies: v } : v),
  z.object({
    companies: z.array(discoveryCompanySchema).max(40).default([]),
  }),
);

/** Strict schema for the primary discovery pass. Focused fallback passes remain
 * tolerant because a sparse niche is better represented honestly than padded. */
export const discoveryMinimumOutSchema = discoveryOutSchema.superRefine((value, ctx) => {
  const unique = new Set(value.companies.map((company) => company.name.trim().toLowerCase()));
  if (unique.size < 10) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['companies'],
      message: `Primary discovery must return at least 10 unique companies; received ${unique.size}.`,
    });
  }
});

export const enrichmentOutSchema = z.object({
  oneLiner: z.string().default(''),
  hqLocation: z.string().nullable().default(null),
  website: z.string().nullable().default(null),
  /** Brand colors scraped/inferred from the company's site, hex. */
  brand: z
    .object({
      primary: z.string().nullable().default(null),
      secondary: z.string().nullable().default(null),
      accent: z.string().nullable().default(null),
    })
    .nullable()
    .default(null),
  // nullish (not just optional): the model often emits explicit null for
  // metrics it couldn't find — accept that and treat it as "absent".
  metrics: z
    .object({
      market_share: metricOutSchema.nullish(),
      valuation: metricOutSchema.nullish(),
      market_cap: metricOutSchema.nullish(),
      arr: metricOutSchema.nullish(),
      aum: metricOutSchema.nullish(),
      users: metricOutSchema.nullish(),
      employees: metricOutSchema.nullish(),
    })
    .default({}),
  facts: z
    .object({
      headcount: z.number().nullable().default(null),
      /**
       * Constrained outcome: the round selects a dilution bracket and so moves
       * the estimated valuation. The enum is what reaches the native
       * `responseSchema`, so a conforming model can only emit a canonical
       * value. The preprocess handles the non-conforming case without letting
       * one bad field cost us the whole company: recognisable prose is
       * normalised, and anything else drops the round to null rather than
       * inventing a bracket for it (issue #48).
       */
      lastFundingRound: z
        .preprocess(
          normalizeFundingRound,
          z
            .object({ amount: z.number(), roundType: z.enum(FUNDING_ROUND_TYPES) })
            .nullable(),
        )
        .default(null),
      scrapedPricing: z
        .object({
          monthlyPrice: z.number().nullable().default(null),
          annualPrice: z.number().nullable().default(null),
        })
        .nullable()
        .default(null),
      publicUserFootprint: z.number().nullable().default(null),
      footprintLabel: z.string().nullable().default(null),
    })
    .default({}),
  viceClaims: z
    .array(z.object({ text: z.string(), sourceIndex: z.number().int().nullable().default(null) }))
    .default([]),
  cultureNote: z.string().nullable().default(null),
});
export type EnrichmentOut = z.infer<typeof enrichmentOutSchema>;

export const tierReviewOutSchema = z.object({
  nudge: z.union([z.literal(-1), z.literal(0), z.literal(1)]).default(0),
  reason: z.string().nullable().default(null),
});

/**
 * Batched tier review: ALL companies in one call.
 *
 * Two wins over reviewing each company separately. (1) Cost: a 10-company deck
 * drops 9 requests, which matters against a 15 RPM free-tier ceiling. (2) Quality:
 * the model sees the whole cohort at once, so "who deserves T8 vs T4" becomes a
 * relative judgement instead of ten independent guesses — which is what makes the
 * ranking defensible.
 */
export const tierReviewBatchOutSchema = z.preprocess(
  // Bare-array tolerance: single-list schemas crash when the model emits the
  // list without its wrapper object. Normalizing shape is the parser's job.
  (input) => (Array.isArray(input) ? { reviews: input } : input),
  z.object({
    reviews: z
      .array(
        z.object({
          name: z.string(),
          nudge: z.union([z.literal(-1), z.literal(0), z.literal(1)]).default(0),
          reason: z.string().nullable().default(null),
        }),
      )
      .default([]),
  }),
);

export const factCheckOutSchema = z.object({
  verdict: z.enum(['supported', 'contradicted', 'unverified']).default('unverified'),
  rationale: z.string().default(''),
  /**
   * When the claim was a stored METRIC and the evidence names a better figure,
   * the corrected value in the metric's native unit (USD / count / percent).
   * Null when the evidence doesn't support a concrete number — a correction
   * without evidence is never emitted.
   */
  correctedValue: z.number().nullable().default(null),
  /** ISO date the corrected figure is reported as-of, when the evidence says. */
  correctedAsOf: z.string().nullable().default(null),
});

/** Structured output for a single-metric live verification (verifyMetric). */
export const verifyMetricOutSchema = z.object({
  verdict: z.enum(['supported', 'contradicted', 'unverified']).default('unverified'),
  /** Best current grounded value in the metric's native unit; null if unknown. */
  currentValue: z.number().nullable().default(null),
  rationale: z.string().default(''),
  /** One-line method note explaining where the figure comes from. */
  methodNote: z.string().nullable().default(null),
  passageSupport: metricPassageSchema.nullable().default(null),
});

/** Structured output for the batch verification pass (verifyCompanyMetrics):
 * one verdict per examined figure, keyed by metric type. Bare-array tolerant
 * like the hunt schema — single-list structured outputs get the wrapper. */
export const batchVerifyOutSchema = z.preprocess(
  (input) => (Array.isArray(input) ? { metrics: input } : input),
  z.object({
    metrics: z
      .array(
        z.object({
          metricType: z.enum([
            'market_cap',
            'valuation',
            'market_share',
            'arr',
            'aum',
            'users',
            'employees',
          ]),
          verdict: z.enum(['supported', 'contradicted', 'unverified']).default('unverified'),
          /** Best current grounded value in the metric's native unit; null if unknown. */
          currentValue: z.number().nullable().default(null),
          rationale: z.string().default(''),
          methodNote: z.string().nullable().default(null),
          passageSupport: metricPassageSchema.nullable().default(null),
        }),
      )
      .default([]),
  }),
);

/**
 * Output of the market-batch estimated fill (WS5): ONE grounded call proposes
 * estimated-tier figures for several companies at once, each with its own
 * support line. These land at estimated tier with provider attribution —
 * verified stays citation-earned through the original-source gates.
 */
export const marketBatchOutSchema = z.preprocess(
  (input) => (Array.isArray(input) ? { estimates: input } : input),
  z.object({
    estimates: z
      .array(
        z.object({
          companyName: z.string().min(1),
          metricType: z.enum([
            'market_cap',
            'valuation',
            'market_share',
            'arr',
            'aum',
            'users',
            'employees',
          ]),
          value: z.number(),
          /** The unit the figure is quoted in (USD, count, percent, or a convertible currency code). */
          unit: z.string().min(1).max(8),
          /** Literal as-of date the support names; null when none is stated. */
          asOf: z.string().max(40).nullable().default(null),
          /** One line naming who reported the figure and where. */
          methodNote: z.string().min(1).max(400),
        }),
      )
      .max(80)
      .default([]),
  }),
);

/**
 * Output of the multi-figure metrics hunt (huntCompanyMetrics): one grounded
 * pass, every soft figure the sources actually support. Bare-array tolerant —
 * single-list structured outputs get the preprocess wrapper by default (the
 * recurring "Expected object, received array" crash class).
 */
export const huntMetricsOutSchema = z.preprocess(
  (input) => (Array.isArray(input) ? { figures: input } : input),
  z.object({
    figures: z
      .array(
        z.object({
          metricType: z.enum([
            'market_cap',
            'valuation',
            'market_share',
            'arr',
            'aum',
            'users',
            'employees',
          ]),
          /** Grounded value in the metric's native unit; null when the notes name none. */
          value: z.number().nullable().default(null),
          /** One line naming where the figure comes from. */
          methodNote: z.string().nullable().default(null),
          passageSupport: metricPassageSchema.nullable().default(null),
        }),
      )
      .default([]),
  }),
);

/**
 * Market-level cards from ONE grounded pass: structural barriers to entry, plus
 * the non-obvious dynamics worth remembering (Insight cards). Both are claims
 * about the market rather than about a company, so they share a research call —
 * two card types for the price of one against a 15 RPM free-tier ceiling.
 *
 * `sourceIndex` preserves the primary receipt; `sourceIndexes` retains every
 * additional grounded source that directly supports the same finding.
 */
const marketClaimSchema = z.object({
  title: z.string(),
  summary: z.string(),
  sourceIndex: z.number().int().nullable().default(null),
  sourceIndexes: z.array(z.number().int()).default([]),
  /** The scannable substance behind the headline — 1-2 sentences each. */
  keyPoints: z.array(z.string()).default([]),
});

export const marketCardsOutSchema = z.preprocess(
  (v) => (Array.isArray(v) ? { barriers: v } : v),
  z.object({
    barriers: z.array(marketClaimSchema).default([]),
    insights: z.array(marketClaimSchema).default([]),
  }),
);

/**
 * Output of the Daily Briefing pass (generateDeckBriefing): the day's real
 * developments across a deck's tracked companies. Bare-array tolerant —
 * single-list structured outputs get the preprocess wrapper by default (the
 * recurring "Expected object, received array" crash class).
 */
export const briefingOutSchema = z.preprocess(
  (v) => (Array.isArray(v) ? { updates: v } : v),
  z.object({
    /** The day's editorial headline for this market. */
    headline: z.string().default(''),
    updates: z
      .array(
        z.object({
          companyName: z.string().default(''),
          signal: z.enum(['high', 'notable']).default('notable'),
          /** One tight sentence — what happened. */
          oneLiner: z.string().default(''),
          /** Why it matters — the report paragraph. */
          detail: z.string().default(''),
          /** ISO date the development was published, when the notes say. */
          publishedDate: z.string().nullable().default(null),
          /** Indexes into the grounded citations array. */
          sourceIndexes: z.array(z.number().int()).default([]),
        }),
      )
      .default([]),
    /** Desk insights — what the day means for the market's balance of power. */
    insights: z.array(z.string()).default([]),
  }),
);

/**
 * Output of the site audit pass (auditSite): a CRO/UX teardown structured for
 * the visual report. Scores clamp engine-side; permissive defaults keep a
 * partial answer rendering honestly instead of crashing.
 */
const auditFindingSchema = z.object({
  title: z.string().default(''),
  detail: z.string().default(''),
});

export const siteAuditOutSchema = z.object({
  scores: z
    .array(
      z.object({
        area: z.enum(['value_proposition', 'messaging', 'cta', 'trust', 'design', 'seo']),
        score: z.number().default(5),
        verdict: z.string().default(''),
      }),
    )
    .default([]),
  working: z.array(auditFindingSchema).default([]),
  missing: z
    .array(auditFindingSchema.extend({ impact: z.string().nullable().default(null) }))
    .default([]),
  designSummary: z.string().default(''),
  designNotes: z.array(z.string()).default([]),
  testFirst: z.array(auditFindingSchema).default([]),
});

/**
 * Output of the pre-report RED-TEAM pass (founder: "double-check the metrics
 * and kind of red-team it before formulating this report"). One grounded
 * audit of the report's face-value figures; confirmed-wrong figures write
 * back through the fast verify path before the report is composed.
 * Bare-array tolerant, like every single-list structured schema here.
 */
export const redTeamOutSchema = z.preprocess(
  (input) => (Array.isArray(input) ? { findings: input } : input),
  z.object({
    findings: z
      .array(
        z.object({
          companyName: z.string(),
          metricType: z.enum([
            'market_cap',
            'valuation',
            'market_share',
            'arr',
            'aum',
            'users',
            'employees',
          ]),
          verdict: z.enum(['holds', 'wrong', 'unverifiable']).catch('unverifiable'),
          /** Corrected value in native units — only meaningful for 'wrong'. */
          correctedValue: z.number().nullable().default(null),
          /** One line naming the source and as-of date. */
          note: z.string().nullable().default(null),
        }),
      )
      .default([]),
  }),
);
