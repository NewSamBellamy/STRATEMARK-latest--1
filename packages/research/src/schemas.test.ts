/**
 * The model-facing contract, tested as external behaviour (issue #48).
 *
 * These schemas are what a model's structured output is validated against, and
 * what `zodToGenAiSchema` turns into the native `responseSchema`. Two things
 * therefore matter and are asserted here: a constrained outcome must be a
 * closed vocabulary, and MALFORMED output must degrade to an honest gap rather
 * than either being trusted or destroying an otherwise-usable payload.
 */
import { describe, expect, it } from 'vitest';
import {
  discoveryOutSchema,
  enrichmentOutSchema,
  factCheckOutSchema,
  huntMetricsOutSchema,
  marketCardsOutSchema,
  metricOutSchema,
  redTeamOutSchema,
  tierReviewBatchOutSchema,
  tierReviewOutSchema,
  verifyMetricOutSchema,
} from './schemas';

describe('metricOutSchema — confidence a model may state', () => {
  it('accepts the proposable vocabulary unchanged', () => {
    expect(metricOutSchema.parse({ value: 5, confidence: 'verified' }).confidence).toBe('verified');
    expect(metricOutSchema.parse({ value: 5, confidence: 'estimated' }).confidence).toBe(
      'estimated',
    );
  });

  it('demotes a forged human sign-off instead of accepting it', () => {
    // `user_verified` means a PERSON checked this. A model saying so is wrong by
    // construction, so it drops to a claim that still has to be earned.
    const out = metricOutSchema.parse({ value: 5, confidence: 'user_verified' });
    expect(out.confidence).toBe('verified');
    expect(out.value).toBe(5); // the figure survives; only the claim changes
  });

  it('treats an unrecognisable confidence as unknown rather than trusting it', () => {
    expect(metricOutSchema.parse({ value: 5, confidence: 'extremely sure' }).confidence).toBe(
      'unknown',
    );
    expect(metricOutSchema.parse({ value: 5, confidence: 42 }).confidence).toBe('unknown');
  });

  it('defaults a missing confidence to unknown', () => {
    expect(metricOutSchema.parse({ value: null }).confidence).toBe('unknown');
  });
});

describe('enrichmentOutSchema — funding round as a closed vocabulary', () => {
  const payload = (lastFundingRound: unknown) => ({
    oneLiner: 'A company',
    facts: { headcount: 10, lastFundingRound },
  });

  it('accepts a canonical round value', () => {
    const out = enrichmentOutSchema.parse(payload({ amount: 10_000_000, roundType: 'series_a' }));
    expect(out.facts.lastFundingRound?.roundType).toBe('series_a');
  });

  it('normalises legacy prose from a non-conforming model', () => {
    // The enum constrains generation, but a model that ignores the schema must
    // not cost us the entire company enrichment over one field.
    const out = enrichmentOutSchema.parse(payload({ amount: 10_000_000, roundType: 'Series B' }));
    expect(out.facts.lastFundingRound?.roundType).toBe('series_b');
  });

  it('drops an unrecognisable round rather than discarding the whole payload', () => {
    const out = enrichmentOutSchema.parse(
      payload({ amount: 10_000_000, roundType: 'a friendly chat with investors' }),
    );
    expect(out.facts.lastFundingRound).toBeNull();
    expect(out.facts.headcount).toBe(10); // the rest of the enrichment survives
    expect(out.oneLiner).toBe('A company');
  });

  it('survives a malformed round object without losing the company', () => {
    expect(enrichmentOutSchema.parse(payload({ roundType: 'seed' })).facts.lastFundingRound).toBeNull();
    expect(enrichmentOutSchema.parse(payload('Series A')).facts.lastFundingRound).toBeNull();
    expect(enrichmentOutSchema.parse(payload(null)).facts.lastFundingRound).toBeNull();
  });
});

describe('malformed model output at every strict boundary (issue #48)', () => {
  /**
   * Each agent boundary is handed garbage a real model has plausibly produced:
   * a conversational verdict, a bare list where an object was asked for, a
   * string where a number belongs. None may throw (that costs a whole research
   * pass), and none may let the junk through as a finding.
   */

  it('a conversational verdict never reads as support', () => {
    // "unverified" is the only honest reading of output that states no verdict.
    expect(factCheckOutSchema.parse({ rationale: 'Probably right?' }).verdict).toBe('unverified');
    expect(verifyMetricOutSchema.parse({}).verdict).toBe('unverified');
    expect(verifyMetricOutSchema.parse({}).currentValue).toBeNull();
  });

  it('a figure the model could not state stays null rather than becoming a number', () => {
    const out = verifyMetricOutSchema.parse({ verdict: 'supported', currentValue: null });
    expect(out.currentValue).toBeNull();

    const hunt = huntMetricsOutSchema.parse({ figures: [{ metricType: 'arr' }] });
    expect(hunt.figures[0]!.value).toBeNull();
  });

  it('tolerates a bare list where an object was requested, on every list boundary', () => {
    // The recurring "Expected object, received array" crash class.
    expect(huntMetricsOutSchema.parse([{ metricType: 'users', value: 10 }]).figures).toHaveLength(1);
    expect(tierReviewBatchOutSchema.parse([{ name: 'Acme' }]).reviews).toHaveLength(1);
    expect(discoveryOutSchema.parse([{ name: 'Acme' }]).companies).toHaveLength(1);
  });

  it('refuses an out-of-range tier nudge instead of moving a company by it', () => {
    // A tier is a ±1 review, not a free integer. Anything else is not a nudge.
    expect(() => tierReviewOutSchema.parse({ nudge: 5 })).toThrow();
    expect(tierReviewOutSchema.parse({}).nudge).toBe(0); // silence means no change
  });

  it('rejects a hunted figure whose metric type is not a real metric', () => {
    expect(() =>
      huntMetricsOutSchema.parse({ figures: [{ metricType: 'vibes', value: 5 }] }),
    ).toThrow();
  });

  it('defaults a missing red-team verdict to the unverifiable reading', () => {
    expect(redTeamOutSchema.parse({}).findings).toEqual([]);
  });

  it('keeps an unsourced market claim out of the result by giving it no source', () => {
    const out = marketCardsOutSchema.parse({
      barriers: [{ title: 'Capital', summary: 'Heavy capex.' }],
    });
    expect(out.barriers[0]!.sourceIndex).toBeNull();
  });
});
