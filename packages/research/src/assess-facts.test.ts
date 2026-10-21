/**
 * Effects on read and the assessment itself (PLAN-CRAAP 1.2, 1.4-1.7, 2): everything is
 * computed from the stored figure with an injected clock, never from a stored assessment.
 * Fixed now: 2026-10-20T12:00:00Z.
 */
import { describe, expect, it } from 'vitest';
import type { CompanyMetric, FigureAssessment } from '@mi/contracts';
import { assessFacts } from './assess-facts';
import { AGED_OUT_NOTE_PREFIX, assessFigure, pageDatesOf } from './source-assessment';

const NOW = new Date('2026-10-20T12:00:00Z');
const company = { id: 'cmp', name: 'Acme Inc.', websiteUrl: 'https://acme.com' };

function passage(over: Partial<CompanyMetric> & { asOf?: string; url?: string; quote?: string } = {}): CompanyMetric {
  const { asOf = '2026-10-01', url = 'https://www.sec.gov/Archives/acme', quote = 'Acme Inc. reported 45 employees as of the date.', ...rest } = over;
  return {
    id: 'm1', companyId: 'cmp', metricType: 'employees', value: 45, confidence: 'verified', source: url,
    citations: [{ title: 'SEC', url }], methodNote: 'Verified.', capturedAt: '2026-10-02T00:00:00.000Z',
    lastVerifiedAt: '2026-10-02T00:00:00.000Z',
    passageSupport: { sourceUrl: url, quote, basis: 'employees', asOf, unit: 'count' },
    ...rest,
  } as CompanyMetric;
}

const forged: FigureAssessment = {
  version: 1, assessedAt: '2020-01-01T00:00:00.000Z',
  currency: { asOf: '2020-01-01', asOfSource: 'figure', notAfter: null, notAfterSource: null, ageDays: 1, state: 'current', freshDays: 365, staleDays: 548 },
  relevance: { definition: 'employees', period: 'point_in_time', issues: [] },
  authority: { tier: 1, publisher: 'Forger', level: 'strong' },
  accuracy: { support: 'original_passage', independentSources: 9, corroboration: 'corroborated', plausibility: 'ok', newerObservation: null },
  purpose: { kind: 'regulatory_filing', reportedBy: 'regulator' },
  score: 100, verdict: 'strong', effect: 'none', summary: 'Forged: perfect.',
};

const one = (m: CompanyMetric, extra: Partial<Parameters<typeof assessFacts>[1]> = {}) =>
  assessFacts([m], { company, now: NOW, ...extra })[0]!;

describe('a forged assessment is ignored', () => {
  it('replaces whatever came in with the computed one, on a stale verified row', () => {
    const row = one({ ...passage({ asOf: '2025-01-10' }), assessment: forged });
    expect(row.assessment!.summary).not.toContain('Forged');
    expect(row.assessment!.currency.state).toBe('stale');
    expect(row.assessment!.effect).toBe('demoted_stale');
    expect(row.assessment!.assessedAt).toBe(NOW.toISOString());
    expect(row.confidence).toBe('estimated');
  });
  it('drops it from human and unknown rows, which get none', () => {
    const human = one({ ...passage(), confidence: 'user_verified', assessment: forged });
    const unknown = one({ ...passage(), confidence: 'unknown', value: null, assessment: forged });
    expect(human.assessment).toBeUndefined();
    expect(unknown.assessment).toBeUndefined();
  });
  it('does not mutate its input', () => {
    const input = { ...passage({ asOf: '2025-01-10' }), assessment: forged };
    const copy = structuredClone(input);
    assessFacts([input], { company, now: NOW });
    expect(input).toEqual(copy);
  });
});

describe('effects on read', () => {
  it('demoted_stale: verified becomes estimated, keeping value, citations and passage; note carries the date', () => {
    const before = passage({ asOf: '2025-01-10' });
    const row = one(before);
    expect(row).toMatchObject({ confidence: 'estimated', value: 45, lastVerifiedAt: null });
    expect(row.citations).toEqual(before.citations);
    expect(row.passageSupport).toEqual(before.passageSupport);
    expect(row.methodNote).toContain('As of 10 Jan 2025 - older than the 18-month window for employees.');
    expect(row.assessment!.effect).toBe('demoted_stale');
  });
  it('a current verified row is untouched apart from its assessment', () => {
    const before = passage();
    const row = one(before);
    const { assessment, ...rest } = row;
    expect(rest).toEqual(before);
    expect(assessment).toMatchObject({ effect: 'none', verdict: 'strong', score: 100 });
  });
  it('labelled_stale: an estimated stale row keeps its label and value', () => {
    const est = passage({ asOf: '2025-01-10', confidence: 'estimated', lastVerifiedAt: null });
    const row = one(est);
    expect(row).toMatchObject({ confidence: 'estimated', value: 45, methodNote: est.methodNote });
    expect(row.assessment!.effect).toBe('labelled_stale');
  });
  it('shown_aged_out: a row the projection names is reported as such', () => {
    const row = one(passage({ confidence: 'estimated', lastVerifiedAt: null }), { shownAgedOut: new Set(['employees']) });
    expect(row.assessment!.effect).toBe('shown_aged_out');
  });
  it('shown_aged_out is structural: the dated note text alone decides nothing', () => {
    const row = one(passage({ confidence: 'estimated', lastVerifiedAt: null, methodNote: `${AGED_OUT_NOTE_PREFIX}as of 2025-01-10.` }));
    expect(row.assessment!.effect).not.toBe('shown_aged_out');
    expect(one(passage({ confidence: 'estimated', lastVerifiedAt: null }), { shownAgedOut: new Set(['revenue']) }).assessment!.effect)
      .not.toBe('shown_aged_out');
  });
  it('demoted_authority: a sponsored page cannot verify a figure', () => {
    const url = 'https://www.forbes.com/sites/brandvoice/2026/10/01/acme-grows';
    const row = one(passage({ url }));
    expect(row.confidence).toBe('estimated');
    expect(row.assessment).toMatchObject({ effect: 'demoted_authority', purpose: { kind: 'sponsored_or_contributor' } });
  });
  it('a human figure is returned unchanged, with no assessment', () => {
    const human = passage({ confidence: 'user_verified', asOf: '2019-01-01' });
    expect(one(human)).toEqual(human);
  });
  it('unknown rows stay unknown and null: nothing is zero-filled', () => {
    const unknown = { ...passage(), confidence: 'unknown', value: null, passageSupport: null, citations: [] } as CompanyMetric;
    expect(one(unknown)).toEqual(unknown);
  });
  it('an undated figure stays undated (never given the capture date)', () => {
    const undated = { ...passage(), passageSupport: null, source: 'https://example.com/post', citations: [{ title: 'example.com', url: 'https://example.com/post' }],
      confidence: 'estimated', lastVerifiedAt: null } as CompanyMetric;
    const row = one(undated);
    expect(row.assessment!.currency).toMatchObject({ asOf: null, state: 'undated' });
  });
  it('is deterministic for the same input and clock', () => {
    const rows = [passage(), passage({ asOf: '2025-01-10', id: 'm2' })];
    expect(assessFacts(rows, { company, now: NOW })).toEqual(assessFacts(rows, { company, now: NOW }));
  });
  it('moves with the injected clock, not the system clock', () => {
    const later = assessFacts([passage()], { company, now: new Date('2028-10-20T12:00:00Z') })[0]!;
    expect(later.assessment!.currency.state).toBe('stale');
    expect(later.confidence).toBe('estimated');
  });
});

describe('page publication dates feed the assessment as an upper bound only', () => {
  const page = 'https://example.com/post';
  const undated = () => ({ ...passage(), passageSupport: null, source: page, citations: [{ title: 'example.com', url: page }],
    confidence: 'estimated', lastVerifiedAt: null } as CompanyMetric);
  it('an undated figure on an old page becomes stale (it is at least that old)', () => {
    const row = one(undated(), { pageDates: pageDatesOf([{ requestedUrl: page, publishedAt: '2024-03-01' }]) });
    expect(row.assessment!.currency).toMatchObject({ asOf: null, notAfter: '2024-03-01', notAfterSource: 'page', state: 'stale' });
    expect(row.assessment!.effect).toBe('labelled_stale');
  });
  it('without a page date it stays undated', () => {
    expect(one(undated()).assessment!.currency).toMatchObject({ state: 'undated', notAfter: null });
  });
  it('a newer page date never freshens an old figure date', () => {
    const old = passage({ asOf: '2025-01-10' });
    const row = one(old, { pageDates: pageDatesOf([{ requestedUrl: old.passageSupport!.sourceUrl, publishedAt: '2026-10-15' }]) });
    expect(row.assessment!.currency).toMatchObject({ asOf: '2025-01-10', state: 'stale' });
  });
  it('a figure dated after its own page was published is dated by the page', () => {
    const row = one(passage({ asOf: '2026-10-01' }), { pageDates: pageDatesOf([{ requestedUrl: 'https://www.sec.gov/Archives/acme', publishedAt: '2024-03-01' }]) });
    expect(row.assessment!.currency).toMatchObject({ asOf: '2024-03-01', state: 'stale' });
    expect(row.assessment!.relevance.issues).toContain('figure_date_after_page_date');
  });
  it('is matched by the page the figure rests on, ignoring a fragment or trailing slash', () => {
    const dates = pageDatesOf([{ requestedUrl: `${page}/`, finalUrl: `${page}#top`, publishedAt: '2024-03-01' }, { requestedUrl: 'https://other.com/x', publishedAt: '2020-01-01' }]);
    expect(one(undated(), { pageDates: dates }).assessment!.currency.notAfter).toBe('2024-03-01');
    expect(dates).toEqual({ [page]: '2024-03-01', 'https://other.com/x': '2020-01-01' });
  });
  it('keeps the earliest date when a page has several, and ignores malformed ones', () => {
    expect(pageDatesOf([{ requestedUrl: page, publishedAt: '2025-05-05' }, { requestedUrl: page, publishedAt: '2024-03-01' }, { requestedUrl: 'https://a.com/b', publishedAt: 'soon' }],
      [{ finalUrl: page, publishedAt: '2023-01-01' }])).toEqual({ [page]: '2023-01-01' });
  });
});

describe('score, purpose and accuracy', () => {
  it('an original passage from a regulator scores 100 and reads as strong', () => {
    expect(assessFigure(passage(), { now: NOW })).toMatchObject({ score: 100, verdict: 'strong', purpose: { reportedBy: 'regulator' } });
  });
  it('a human figure reads human_checked with no score', () => {
    expect(assessFigure(passage({ confidence: 'user_verified' }), { now: NOW })).toMatchObject({ score: null, verdict: 'human_checked' });
  });
  it('a company-voice wire release is labelled company-reported and costs more on a self-interested metric', () => {
    const url = 'https://www.prnewswire.com/news-releases/acme-1.html';
    const users = assessFigure(passage({ url, metricType: 'users', quote: 'Acme has 5 million users.' }), { now: NOW })!;
    const staff = assessFigure(passage({ url, quote: 'Acme has 45 employees.' }), { now: NOW })!;
    expect(users.purpose).toEqual({ kind: 'press_release', reportedBy: 'company' });
    expect(users.score).toBe(staff.score! - 10);
  });
  it('a source on a roster rival reads as a competitor', () => {
    const a = assessFigure(passage({ url: 'https://www.rival.com/blog/acme' }), { now: NOW, rivalHosts: ['rival.com'] })!;
    expect(a.purpose.kind).toBe('competitor');
    expect(a.score).toBeLessThan(assessFigure(passage({ url: 'https://www.rival.com/blog/acme' }), { now: NOW })!.score!);
  });
  it('five wire reprints are one independent source, not five', () => {
    const hosts = ['prnewswire.com', 'businesswire.com', 'globenewswire.com', 'accesswire.com', 'prweb.com'];
    const row = passage({ url: 'https://www.prnewswire.com/a', citations: hosts.map((h) => ({ title: h, url: `https://www.${h}/a` })) });
    const a = assessFigure(row, { now: NOW })!;
    expect(a.accuracy.independentSources).toBe(1);
    expect(a.accuracy.corroboration).toBe('single');
  });
  it('two unrelated outlets corroborate', () => {
    const row = passage({ url: 'https://www.reuters.com/a', citations: [{ title: 'Reuters', url: 'https://www.reuters.com/a' }, { title: 'FT', url: 'https://www.ft.com/b' }] });
    expect(assessFigure(row, { now: NOW })!.accuracy).toMatchObject({ independentSources: 2, corroboration: 'corroborated' });
  });
  it('flags a figure that may belong to the parent company', () => {
    const row = passage({ quote: 'Globex Corp reported 45 employees across the group.' });
    const a = assessFigure(row, { now: NOW, ownership: { status: 'subsidiary', acquirer: 'Globex Corp' } })!;
    expect(a.relevance.issues).toContain('entity_may_be_parent');
    expect(a.score).toBe(90);
  });
  it('does not mistake a trailing-twelve-month revenue for a fiscal year', () => {
    const ttm = passage({ metricType: 'revenue', value: 10_000_000, quote: 'Trailing twelve months revenue was $10 million.' });
    const fy = passage({ metricType: 'revenue', value: 10_000_000, quote: 'Fiscal year revenue was $10 million.' });
    expect(assessFigure(ttm, { now: NOW })!.relevance.period).toBe('ttm');
    expect(assessFigure(fy, { now: NOW })!.relevance.period).toBe('fiscal_year');
  });
  it('a plausibility flag costs 25 points', () => {
    const base = assessFigure(passage(), { now: NOW })!;
    const flagged = assessFigure(passage(), { now: NOW, plausibilityFlagged: new Set(['employees']) })!;
    expect(flagged.accuracy.plausibility).toBe('flagged');
    expect(flagged.score).toBe(base.score! - 25);
  });
  it('a search-attributed figure with no page is weak on support', () => {
    const row = { ...passage(), passageSupport: null, confidence: 'estimated', lastVerifiedAt: null,
      reportedSupport: { value: 45, unit: 'count', asOf: '2026-10-01', basis: 'employees', companyName: 'Acme Inc.', provider: 'google-search',
        support: { text: 'Acme has 45 staff.', sources: [{ url: 'https://example.com/p', title: 'example.com', chunkIndex: 0, supportIndex: 0 }] } },
      citations: [] } as unknown as CompanyMetric;
    expect(assessFigure(row, { now: NOW })!.accuracy.support).toBe('search_attributed');
  });
});
