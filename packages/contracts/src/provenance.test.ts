import { describe, expect, it } from 'vitest';
import {
  UNRECORDED_PUBLISHER,
  UNSOURCED_DOWNGRADE_NOTE,
  classifySource,
  enforceMetricProvenance,
  enforceModelMetricProvenance,
  HUMAN_ONLY_CONFIDENCE_NOTE,
  isModelAssertable,
  reconcileMetric,
  reconcileMetrics,
  isRedirectCitation,
  publisherOf,
  usableCitations,
  isJunkSource,
  hasVerificationGradeCitation,
} from './provenance';
import type { CompanyMetric } from './types';

const base: CompanyMetric = {
  id: 'met_1',
  companyId: 'cmp_1',
  metricType: 'arr',
  value: 25_000_000_000,
  confidence: 'verified',
  source: null,
  citations: [],
  methodNote: null,
  capturedAt: '2026-07-29T00:00:00.000Z',
};

const cite = (url: string, title = '') => ({ url, title });

describe('provenance enforcement', () => {
  it('keeps issuer context scoped and never promotes a label without it', () => {
    const citations = [cite('https://acme.com/report')];
    expect(hasVerificationGradeCitation(citations, 'https://acme.com')).toBe(true);
    expect(hasVerificationGradeCitation(citations)).toBe(false);
    expect(enforceMetricProvenance({ ...base, citations }, 'https://acme.com').confidence).toBe('verified');
    expect(enforceMetricProvenance({ ...base, citations }, 'https://other.com').confidence).toBe('estimated');
  });
  it.each(['https://github.com', 'https://en.wikipedia.org'])('does not let shared user-content hosts gain issuer authority: %s', website => {
    expect(hasVerificationGradeCitation([cite(`${website}/user-content`)], website)).toBe(false);
  });
  it.each(['https://acme.com.evil.com/report', 'https://notacme.com/report', 'https://acme.com@evil.com/report',
    'https://reddit.com/report', 'https://other.acme.com/report'])('rejects issuer lookalikes and user content: %s', url => {
      expect(hasVerificationGradeCitation([cite(url)], 'https://acme.com')).toBe(false);
    });
  it.each([false, true])('retains a human override and conflicting observations already duplicated in storage (reverse=%s)', reverse => {
    const human = { ...base, id: 'human', value: 123, confidence: 'user_verified' as const, source: 'Human correction' };
    const machine = { ...base, id: 'machine', value: 456, citations: [cite('https://sec.gov/Archives/report')] };
    const rows = reverse ? [machine, human] : [human, machine];
    const merged = reconcileMetrics(rows, []);
    expect(merged).toHaveLength(1);
    expect(merged[0]).toMatchObject({ id: 'human', value: 123, confidence: 'user_verified' });
    expect(merged[0]!.conflicts?.[0]?.observations.map(o => o.value).sort()).toEqual([123, 456]);
    expect(rows).toHaveLength(2);
  });
  it('never merges different companies that happen to share a metric type', () => {
    const merged = reconcileMetrics([base], [{ ...base, id: 'other', companyId: 'cmp_other', value: 100 }]);
    expect(merged).toHaveLength(2);
    expect(merged.map(m => m.companyId)).toEqual(['cmp_1', 'cmp_other']);
  });
  it('demotes a "verified" figure that has no citation (the audit bug)', () => {
    const out = enforceMetricProvenance(base);
    expect(out.confidence).toBe('estimated');
    expect(out.methodNote).toContain(UNSOURCED_DOWNGRADE_NOTE);
    expect(out.value).toBe(base.value); // the number survives; only the claim changes
  });

  it('keeps "verified" when a recognized source is attached', () => {
    const out = enforceMetricProvenance({
      ...base,
      citations: [cite('https://reuters.com/report', 'reuters.com')],
    });
    expect(out.confidence).toBe('verified');
    expect(out.source).toBe('https://reuters.com/report');
  });

  it('never lets a model-supplied confidence outrank the evidence', () => {
    // Junk citations (non-http) and no written attribution == no evidence.
    const out = enforceMetricProvenance({ ...base, citations: [cite('not-a-url', 'nonsense')] });
    expect(out.confidence).toBe('estimated');
    expect(out.citations).toEqual([]);
  });

  it('retains written attribution without treating prose as verification', () => {
    const out = enforceMetricProvenance({
      ...base,
      source: 'Headcount published on the company team page.',
    });
    expect(out.confidence).toBe('estimated');
    expect(out.source).toBe('Headcount published on the company team page.');
    expect(out.citations).toEqual([]);
  });

  it.each([
    'https://reddit.com/r/stocks/example',
    'https://reuters.com.attacker.test/report',
    'https://unknown-publisher.test/report',
    'https://',
    'https://analyst:secret@reuters.com/report',
  ])('does not trust a forged primary label: %s', (url) => {
    const citation = { url, title: 'Reuters verified filing', credibility: 'primary' as const };
    expect(hasVerificationGradeCitation([citation])).toBe(false);
    expect(enforceMetricProvenance({ ...base, citations: [citation] }).confidence).toBe('estimated');
  });

  it('preserves unknown niche citations for attribution without granting verification', () => {
    const out = enforceMetricProvenance({ ...base, citations: [cite('https://niche-analyst.test/report')] });
    expect(out.confidence).toBe('estimated');
    expect(out.citations).toHaveLength(1);
    expect(out.citations[0]!.credibility).toBe('unknown');
  });

  it('does not replace a human-checked row with a same-value automated observation', () => {
    const current = { ...base, confidence: 'user_verified' as const, source: 'Confirmed by analyst',
      methodNote: 'Human review', citations: [], lastVerifiedAt: '2026-07-29T00:00:00.000Z' };
    const incoming = { ...base, citations: [cite('https://reuters.com/report')], capturedAt: '2026-08-01T00:00:00.000Z' };
    const merged = reconcileMetric(current, incoming);
    expect(merged.confidence).toBe('user_verified');
    expect(merged.source).toBe(current.source);
    expect(merged.methodNote).toBe(current.methodNote);
    expect(merged.lastVerifiedAt).toBe(current.lastVerifiedAt);
  });

  it('does not erase a stronger source or previous conflicts when a weaker observation repeats the value', () => {
    const conflict = { metricType: 'arr' as const, observations: [], detectedAt: base.capturedAt, preferredObservation: 0 };
    const current = { ...base, citations: [cite('https://sec.gov/Archives/report')], conflicts: [conflict] };
    const incoming = { ...base, confidence: 'estimated' as const,
      citations: [cite('https://niche-analyst.test/report')], capturedAt: '2026-08-01T00:00:00.000Z' };
    const merged = reconcileMetric(current, incoming);
    expect(merged.confidence).toBe('verified');
    expect(merged.citations[0]!.url).toBe(current.citations[0]!.url);
    expect(merged.conflicts).toEqual([conflict]);
  });

  it('retains a human value when a higher-ranked automated publisher disagrees', () => {
    const current = { ...base, confidence: 'user_verified' as const, source: 'Analyst override' };
    const incoming = { ...base, value: 40_000_000_000, citations: [cite('https://sec.gov/report')] };
    const merged = reconcileMetric(current, incoming);
    expect(merged.value).toBe(current.value);
    expect(merged.confidence).toBe('user_verified');
    expect(merged.conflicts?.[0]?.preferredObservation).toBe(0);
    expect(merged.conflicts?.[0]?.observations[1]?.value).toBe(incoming.value);
  });

  it('preserves a human override even without citations', () => {
    const out = enforceMetricProvenance({
      ...base,
      confidence: 'user_verified',
      source: 'Confirmed by their VP Sales',
    });
    expect(out.confidence).toBe('user_verified');
    expect(out.source).toBe('Confirmed by their VP Sales');
  });

  it('refuses to let an unknown figure carry a number', () => {
    const out = enforceMetricProvenance({ ...base, confidence: 'unknown' });
    expect(out.value).toBeNull();
  });

  it('treats a null value as unknown rather than a confident zero', () => {
    const out = enforceMetricProvenance({ ...base, value: null, confidence: 'verified' });
    expect(out.confidence).toBe('unknown');
    expect(out.value).toBeNull();
  });

  it('de-duplicates citations and fills missing publishers from the host', () => {
    const out = usableCitations([
      cite('https://reuters.com/a', 'reuters.com'),
      cite('https://reuters.com/a', 'reuters.com'),
      cite('https://www.ft.com/b'),
    ]);
    expect(out).toHaveLength(2);
    expect(out[1]!.title).toBe('ft.com');
  });

  it('classifies source families conservatively', () => {
    expect(classifySource('https://www.sec.gov/Archives/edgar/data/1', 'SEC filing')).toBe(
      'primary',
    );
    expect(classifySource('https://www.reuters.com/world/example', 'Reuters')).toBe(
      'reputable_secondary',
    );
    expect(classifySource('https://techcrunch.com/example', 'TechCrunch')).toBe('industry');
    expect(classifySource('https://reddit.com/r/example', 'Reddit')).toBe('user_generated');
    expect(classifySource('https://example.com/article', 'Unknown publisher')).toBe('unknown');
  });

  it('classifies real finance and data publishers that dominate grounded citations', () => {
    expect(classifySource('https://forbes.com/sites/example', 'forbes.com')).toBe('reputable_secondary');
    expect(classifySource('https://cnbc.com/2026/example', 'cnbc.com')).toBe('reputable_secondary');
    expect(classifySource('https://stockanalysis.com/stocks/tsla/', 'stockanalysis.com')).toBe('industry');
    expect(classifySource('https://companiesmarketcap.com/tesla/marketcap/', 'companiesmarketcap.com')).toBe('industry');
    expect(classifySource('https://investing.com/news/example', 'investing.com')).toBe('industry');
    expect(classifySource('https://tracxn.com/d/example', 'tracxn.com')).toBe('industry');
    expect(classifySource('https://www.woodmac.com/reports/example', 'woodmac.com')).toBe('industry');
    expect(classifySource('https://energy-storage.news/example', 'energy-storage.news')).toBe('industry');
    expect(classifySource('https://utilitydive.com/news/example', 'utilitydive.com')).toBe('industry');
  });

  it('resolves grounding redirects whose title records a publisher NAME, not a domain', () => {
    const redirect = 'https://vertexaisearch.cloud.google.com/grounding-api-redirect/AUxQabc';
    expect(classifySource(redirect, 'Reuters')).toBe('reputable_secondary');
    expect(classifySource(redirect, 'Wood Mackenzie')).toBe('industry');
    expect(classifySource(redirect, 'S&P Global')).toBe('industry');
    // A known name must never let a random blog through the gate.
    expect(classifySource(redirect, 'Reuters says something vague')).toBe('unknown');
    expect(classifySource(redirect, 'Some Random Blog')).toBe('unknown');
    expect(classifySource(redirect, '')).toBe('unknown');
  });

  it('retains contradictory observations and chooses the stronger source', () => {
    const current = enforceMetricProvenance({
      ...base,
      value: 100,
      citations: [cite('https://reddit.com/r/example', 'Reddit')],
      capturedAt: '2026-07-29T00:00:00.000Z',
    });
    const incoming = enforceMetricProvenance({
      ...base,
      value: 120,
      citations: [cite('https://www.sec.gov/Archives/edgar/data/1', 'SEC filing')],
      capturedAt: '2026-07-30T00:00:00.000Z',
    });
    const merged = reconcileMetric(current, incoming);
    expect(merged.value).toBe(120);
    expect(merged.conflicts).toHaveLength(1);
    expect(merged.conflicts?.[0]?.observations).toHaveLength(2);
  });

  it('keeps one canonical metric row per type during propagation', () => {
    const merged = reconcileMetrics(
      [base],
      [{ ...base, value: 30, citations: [cite('https://www.reuters.com/example', 'Reuters')] }],
    );
    expect(merged).toHaveLength(1);
    expect(merged[0]?.value).toBe(30);
    expect(merged[0]?.revision).toBe(1);
  });

  it('shows the publisher rather than the opaque grounding redirect', () => {
    const redirect = 'https://vertexaisearch.cloud.google.com/grounding-api-redirect/abc123';
    expect(isRedirectCitation(redirect)).toBe(true);
    // Publisher comes from the citation title Google supplies alongside the URL.
    expect(publisherOf(redirect, 'futuresearch.ai')).toBe('futuresearch.ai');
    // With no usable title we must NOT present the redirect host as the
    // publisher — that would imply Google published the figure. Admit the gap.
    expect(publisherOf(redirect, 'vertexaisearch.cloud.google.com')).toBe(UNRECORDED_PUBLISHER);
    expect(publisherOf(redirect, null)).toBe(UNRECORDED_PUBLISHER);
  });
});

describe('source credibility gate — junk domains can never verify a metric', () => {
  const base = {
    id: 'm1',
    companyId: 'c1',
    metricType: 'market_share' as const,
    value: 53.3,
    confidence: 'verified' as const,
    source: null,
    methodNote: null,
    capturedAt: new Date().toISOString(),
  };

  it('flags SEO/content-mill domains as junk (the fatjoe.com production case)', () => {
    expect(isJunkSource('https://fatjoe.com/some-post', 'fatjoe.com')).toBe(true);
    expect(isJunkSource('https://backlinko.com/stats', null)).toBe(true);
    expect(isJunkSource('https://best-promo-codes.example.com', null)).toBe(true);
  });

  it('does NOT flag legitimate niche analysts or trade press', () => {
    expect(isJunkSource('https://counterpointresearch.com/insights', null)).toBe(false);
    expect(isJunkSource('https://sacra.com/c/mistral/', null)).toBe(false);
    expect(isJunkSource('https://reuters.com/tech', null)).toBe(false);
  });

  it('downgrades a Verified badge whose only sources are junk, keeping the value', () => {
    const metric = {
      ...base,
      citations: [{ title: 'fatjoe.com', url: 'https://fatjoe.com/market-share-stats' }],
    };
    const out = enforceMetricProvenance(metric);
    expect(out.value).toBe(53.3);
    expect(out.confidence).toBe('estimated');
    expect(out.methodNote).toContain('low-credibility');
  });

  it('keeps Verified when at least one verification-grade source stands behind it', () => {
    const metric = {
      ...base,
      citations: [
        { title: 'fatjoe.com', url: 'https://fatjoe.com/market-share-stats' },
        { title: 'counterpointresearch.com', url: 'https://counterpointresearch.com/report' },
      ],
    };
    expect(enforceMetricProvenance(metric).confidence).toBe('verified');
  });

  it('user-generated sources alone cannot verify either', () => {
    const metric = {
      ...base,
      citations: [{ title: 'reddit.com', url: 'https://reddit.com/r/stocks/comments/x' }],
    };
    expect(enforceMetricProvenance(metric).confidence).toBe('estimated');
  });
});

// ---------------------------------------------------------------------------
// The Provenance Gate — issue #48
// ---------------------------------------------------------------------------

describe('the human-only confidence gate (automation may never claim a human)', () => {
  it('strips a model-asserted user_verified: automation cannot forge a human sign-off', () => {
    // A model returning `user_verified` is asserting that a PERSON checked this
    // figure. Nobody did. Left standing it would also outrank a genuinely
    // verified observation in reconcileMetric's evidence weighting.
    const out = enforceModelMetricProvenance({
      ...base,
      confidence: 'user_verified',
      citations: [cite('https://reuters.com/report', 'reuters.com')],
    });
    expect(out.confidence).toBe('verified'); // earned by the citation, not claimed
    expect(out.methodNote).toContain(HUMAN_ONLY_CONFIDENCE_NOTE);
  });

  it('a forged user_verified with no evidence lands on estimated, not verified', () => {
    const out = enforceModelMetricProvenance({ ...base, confidence: 'user_verified' });
    expect(out.confidence).toBe('estimated');
    expect(out.value).toBe(base.value); // the figure survives; only the claim drops
  });

  it('leaves confidences a model is allowed to assert untouched', () => {
    expect(
      enforceModelMetricProvenance({ ...base, confidence: 'estimated', value: 5 }).confidence,
    ).toBe('estimated');
    expect(enforceModelMetricProvenance({ ...base, confidence: 'unknown' }).confidence).toBe(
      'unknown',
    );
  });

  it('still applies the ordinary provenance rules on top of the gate', () => {
    // Unsourced "verified" is demoted by the same rules as the canonical path.
    const out = enforceModelMetricProvenance({ ...base, confidence: 'verified' });
    expect(out.confidence).toBe('estimated');
    expect(out.methodNote).toContain(UNSOURCED_DOWNGRADE_NOTE);
  });

  it('does NOT strip user_verified on the canonical path, where a human really did set it', () => {
    // The gate is for model input only. enforceMetricProvenance stays the
    // preserve-the-human path, so a refresh can never erase a real override.
    const out = enforceMetricProvenance({ ...base, confidence: 'user_verified' });
    expect(out.confidence).toBe('user_verified');
  });

  it('cannot smuggle a forged user_verified through a reconcile, once gated at ingestion', () => {
    // reconcileMetrics uses the PRESERVING path on both sides by design: it is a
    // merge primitive, and `existing` is the stored snapshot that legitimately
    // holds human overrides. The gate therefore belongs at ingestion. This test
    // pins that layering: gated model output cannot carry the forgery in, and a
    // real human override on the existing side survives the merge untouched.
    const forged = enforceModelMetricProvenance({
      ...base,
      metricType: 'users',
      value: 1_000,
      confidence: 'user_verified',
    });
    const humanOwned: CompanyMetric = {
      ...base,
      metricType: 'arr',
      confidence: 'user_verified',
      source: 'Confirmed by the CFO',
    };

    const merged = reconcileMetrics([humanOwned], [forged]);

    expect(merged.find((m) => m.metricType === 'users')!.confidence).not.toBe('user_verified');
    // The genuine human row is untouched by the same merge.
    expect(merged.find((m) => m.metricType === 'arr')!.confidence).toBe('user_verified');
  });

  it('reports which confidences a model may assert', () => {
    expect(isModelAssertable('estimated')).toBe(true);
    expect(isModelAssertable('unknown')).toBe(true);
    expect(isModelAssertable('verified')).toBe(false); // must be earned via citation
    expect(isModelAssertable('user_verified')).toBe(false); // human-only
  });
});
