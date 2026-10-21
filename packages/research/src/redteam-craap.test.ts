/**
 * Independent red-team of the Source check (PLAN-CRAAP WP8). Every case attacks one trust
 * guarantee with fakes only. Fixed now: 2026-10-20T12:00:00Z. Item numbers match the brief.
 */
import { describe, expect, it, vi } from 'vitest';
import type { CompanyMetric } from '@mi/contracts';
import { assessFacts } from './assess-facts';
import { assessFigure } from './source-assessment';
import { compareObservations, resolveWrite } from './compare-observations';
import { deckRivalWebsites, displayedCompanyFacts, projectCompanyCardFacts } from './displayed-facts';
import { huntSearchQueries } from './web-search';
import { GeminiRepository, type RepoSnapshot } from './repository';
import type { LlmClient } from './types';
import { LATEST_PERIOD_RULE, FIGURE_DATE_RULE, heldFigureLines } from './prompts';

const NOW = new Date('2026-10-20T12:00:00Z');
const company = { id: 'cmp', name: 'Acme Inc.', websiteUrl: 'https://acme.com' };
const ctx = { now: NOW, companyWebsite: 'https://acme.com' };

function passage(over: Partial<CompanyMetric> & { asOf?: string; url?: string; quote?: string; type?: string } = {}): CompanyMetric {
  const { asOf = '2026-10-01', url = 'https://www.sec.gov/Archives/acme', quote = 'Acme Inc. reported 45 employees as of the date.', type = 'employees', ...rest } = over;
  return {
    id: 'm1', companyId: 'cmp', metricType: type, value: 45, confidence: 'verified', source: url,
    citations: [{ title: 'SEC', url }], methodNote: 'Verified.', capturedAt: '2026-10-02T00:00:00.000Z',
    lastVerifiedAt: '2026-10-02T00:00:00.000Z',
    passageSupport: { sourceUrl: url, quote, basis: type, asOf, unit: 'count' },
    ...rest,
  } as CompanyMetric;
}
function fig(over: Partial<CompanyMetric> & { asOf?: string; url?: string; quote?: string } = {}): CompanyMetric {
  const { asOf = '2026-09-01', url = 'https://www.sec.gov/Archives/acme', quote = 'Acme reported revenue of $40 million.', ...rest } = over;
  return {
    id: 'm1', companyId: 'cmp', metricType: 'revenue', value: 40_000_000, confidence: 'verified', source: url,
    citations: [{ title: 'SEC', url }], methodNote: null, capturedAt: '2026-10-01T00:00:00.000Z',
    passageSupport: { sourceUrl: url, quote, basis: 'revenue', asOf, unit: 'USD' },
    ...rest,
  } as CompanyMetric;
}
const article = (value: number, asOf: string, url = 'https://www.reuters.com/a'): CompanyMetric => ({
  ...fig({ asOf, value, confidence: 'estimated', url, passageSupport: undefined }),
  passageSupport: null,
  quotedSupport: { sourceUrl: url, quote: `Acme revenue was ${value}.`, asOf, value, unit: 'USD', basis: 'revenue' },
}) as unknown as CompanyMetric;
const assess = (m: CompanyMetric, extra: Record<string, unknown> = {}) => assessFigure(m, { ...ctx, ...extra })!;

describe('1. a future-dated asOf never looks current or fresher than now', () => {
  it('reads as undated, flagged, and never as current', () => {
    for (const asOf of ['2026-10-21', '2027-01-01', '2099-12-31']) {
      const a = assess(passage({ asOf }));
      expect(a.currency.state).toBe('undated');
      expect(a.currency.asOf).toBeNull();
      expect(a.relevance.issues).toContain('date_in_future');
    }
  });
  it('never beats a real dated figure on date alone, in either direction of arrival', () => {
    const real = fig({ asOf: '2026-03-31' });
    expect(compareObservations(fig({ asOf: '2099-01-01', value: 99_000_000 }), real, ctx).decision).toBe('keep');
    // a stored future-dated row is replaced by a real dated one rather than shielding itself
    expect(compareObservations(real, fig({ asOf: '2099-01-01', value: 99_000_000 }), ctx).decision).toBe('replace');
  });
  it('a future-dated verified figure is not shown as current', () => {
    const [row] = assessFacts([passage({ asOf: '2099-01-01' })], { company, now: NOW });
    expect(row!.assessment!.currency.state).not.toBe('current');
    expect(row!.assessment!.score).toBeLessThan(100);
  });
});

describe('2. a newer page date can only make a figure older, never fresher', () => {
  const old = passage({ asOf: '2025-01-10', url: 'https://acme.com/news/hiring' });
  it('a page published after the figure leaves the figure date alone', () => {
    const a = assess(old, { pageDates: { 'https://acme.com/news/hiring': '2026-10-10' } });
    expect(a.currency.asOf).toBe('2025-01-10');
    expect(a.currency.state).toBe('stale');
  });
  it('a page published before the stated date caps it', () => {
    const a = assess(passage({ asOf: '2026-09-01', url: 'https://acme.com/news/hiring' }), { pageDates: { 'https://acme.com/news/hiring': '2024-03-05' } });
    expect(a.currency.asOf).toBe('2024-03-05');
    expect(a.currency.state).toBe('stale');
  });
  it('an undated figure on a freshly published page does not become current', () => {
    const undated = { ...passage({ url: 'https://acme.com/news/hiring' }), passageSupport: undefined, quotedSupport: undefined, reportedSupport: undefined } as CompanyMetric;
    const a = assess(undated, { pageDates: { 'https://acme.com/news/hiring': '2026-10-10' } });
    expect(a.currency.state).toBe('undated');
    expect(a.currency.asOf).toBeNull();
  });
  it('at write time a URL-dated page caps a mis-dated figure, so it cannot freshen itself past the held one', () => {
    const held = article(40_000_000, '2026-03-31');
    const misdated = article(55_000_000, '2026-09-01', 'https://www.reuters.com/2024/03/05/acme-revenue');
    expect(compareObservations(misdated, held, ctx).decision).toBe('keep');
  });
});

describe('3. reprints of one press release are one source, the company', () => {
  const press = 'Acme Inc. announced it now has 45 employees.';
  const base = (cites: string[], primaryUrl: string, quote = press) => passage({
    url: primaryUrl, quote, source: primaryUrl, confidence: 'estimated',
    citations: [primaryUrl, ...cites].map((url) => ({ title: new URL(url).hostname, url })),
  });
  it('the company site plus Yahoo and MarketScreener copies count once', () => {
    const a = assess(base(['https://finance.yahoo.com/news/acme-45', 'https://www.marketscreener.com/quote/acme/news/x'], 'https://acme.com/news/hiring'));
    expect(a.accuracy.independentSources).toBe(1);
    expect(a.accuracy.corroboration).toBe('single');
  });
  it('a wire-dateline reprint on Yahoo plus a MarketScreener copy plus the wire count once', () => {
    const dateline = 'NEW YORK, Oct. 1 /PRNewswire/ -- Acme Inc. announced it now has 45 employees.';
    const a = assess(base(['https://www.marketscreener.com/quote/acme/news/x', 'https://www.prnewswire.com/news/acme'], 'https://finance.yahoo.com/news/acme-45', dateline));
    expect(a.accuracy.independentSources).toBe(1);
  });
  it('an unread aggregator copy never corroborates an editorial article', () => {
    const a = assess(base(['https://finance.yahoo.com/news/acme-45'], 'https://www.reuters.com/business/acme'));
    expect(a.accuracy.independentSources).toBe(1);
  });
  it('two genuinely different outlets still corroborate', () => {
    const a = assess(base(['https://techcrunch.com/acme'], 'https://www.reuters.com/business/acme'));
    expect(a.accuracy.independentSources).toBe(2);
    expect(a.accuracy.corroboration).toBe('corroborated');
  });
});

describe('4. sponsored and contributor pages do not verify a figure', () => {
  const on = (url: string, quote?: string) => passage({ url, quote, source: url, citations: [{ title: 'Forbes', url }] });
  it('a BrandVoice path or a sponsored path is demoted to estimated, value kept', () => {
    for (const url of ['https://www.forbes.com/sites/brandvoice/2026/09/acme/', 'https://www.forbes.com/sponsored/acme-growth/', 'https://news.example.com/partner-content/acme']) {
      const [row] = assessFacts([on(url)], { company, now: NOW });
      expect(row!.assessment!.purpose.kind).toBe('sponsored_or_contributor');
      expect(row!.assessment!.effect).toBe('demoted_authority');
      expect(row!.confidence).toBe('estimated');
      expect(row!.value).toBe(45);
    }
  });
  it('sponsored wording in the retained sentence counts too', () => {
    const [row] = assessFacts([on('https://www.forbes.com/sites/jane/2026/09/acme/', 'Sponsored content: Acme Inc. reported 45 employees as of the date.')], { company, now: NOW });
    expect(row!.confidence).toBe('estimated');
  });
  it('a plain forbes.com/sites contributor page alone is not a sponsored signal (plan 1.5)', () => {
    const [row] = assessFacts([on('https://www.forbes.com/sites/jane/2026/09/acme/')], { company, now: NOW });
    expect(row!.assessment!.purpose.kind).not.toBe('sponsored_or_contributor');
  });
});

describe('5. a figure on a competitor domain', () => {
  const on = (url: string) => passage({ url, source: url, citations: [{ title: 'x', url }] });
  it('is marked a competitor source and scored down, never silently strong', () => {
    const own = assessFacts([on('https://www.sec.gov/Archives/acme')], { company, now: NOW, rivalWebsites: ['https://rival.com'] })[0]!.assessment!;
    const rival = assessFacts([on('https://blog.rival.com/acme-has-45-staff')], { company, now: NOW, rivalWebsites: ['https://www.rival.com'] })[0]!.assessment!;
    expect(rival.purpose.kind).toBe('competitor');
    expect(rival.score!).toBeLessThan(own.score!);
  });
  it('a look-alike domain is not a rival', () => {
    const a = assessFacts([on('https://notrival.com/acme')], { company, now: NOW, rivalWebsites: ['https://rival.com'] })[0]!.assessment!;
    expect(a.purpose.kind).not.toBe('competitor');
  });
});

describe('6. a parent figure is not silently shown for an acquired company', () => {
  const acquired = (acquirer: string) => ({ ...company, ownership: { status: 'acquired' as const, acquirer, citations: [], confidence: 'estimated' as const } });
  const parentText = 'Globex reported 120,000 employees worldwide.';
  const row = () => passage({ quote: parentText, value: 120_000 });
  it('flags a sentence naming the acquirer exactly', () => {
    expect(assessFacts([row()], { company: acquired('Globex'), now: NOW })[0]!.assessment!.relevance.issues).toContain('entity_may_be_parent');
  });
  it('flags it when the registered name carries a corporate suffix the sentence drops', () => {
    for (const acquirer of ['Globex Corporation', 'Globex Inc.', 'Globex Holdings Ltd']) {
      expect(assessFacts([row()], { company: acquired(acquirer), now: NOW })[0]!.assessment!.relevance.issues).toContain('entity_may_be_parent');
    }
  });
  it('does not flag an independent company or an unrelated sentence', () => {
    expect(assessFacts([row()], { company, now: NOW })[0]!.assessment!.relevance.issues).not.toContain('entity_may_be_parent');
    expect(assessFacts([passage()], { company: acquired('Globex Corporation'), now: NOW })[0]!.assessment!.relevance.issues).not.toContain('entity_may_be_parent');
  });
  it('does not flag a word that merely contains the acquirer', () => {
    const r = passage({ quote: 'Acme Inc. reported 45 employees, up from Globexton.' });
    expect(assessFacts([r], { company: acquired('Globex'), now: NOW })[0]!.assessment!.relevance.issues).not.toContain('entity_may_be_parent');
  });
});

describe('7. TTM revenue never replaces fiscal-year revenue', () => {
  const fy = fig({ quote: 'Fiscal year revenue was $40 million.', asOf: '2025-12-31' });
  const ttm = fig({ quote: 'Trailing twelve months revenue was $44 million.', asOf: '2026-06-30', value: 44_000_000 });
  it('both stay: the FY row is put back and the TTM one is kept dated beside it', () => {
    const metric = structuredClone(ttm);
    expect(resolveWrite(metric, fy, ctx)).toBe(false);
    expect(metric.value).toBe(40_000_000);
    expect(metric.priorFigures).toEqual([expect.objectContaining({ value: 44_000_000, asOf: '2026-06-30' })]);
  });
  it('and the other way round', () => {
    expect(compareObservations(fy, ttm, ctx).decision).toBe('not_comparable');
  });
});

describe('8. a stale 10-K against a fresh trade-press article', () => {
  const stale10k = fig({ asOf: '2023-12-31', value: 40_000_000 });
  it('the older strong figure stays, labelled out of date, and the newer one is named', () => {
    const metric = structuredClone(article(55_000_000, '2026-09-15'));
    expect(resolveWrite(metric, stale10k, ctx)).toBe(false);
    expect(metric.value).toBe(40_000_000);
    expect(metric.newerObservation).toMatchObject({ value: 55_000_000, asOf: '2026-09-15' });
    const [shown] = assessFacts([metric], { company, now: NOW });
    expect(shown!.confidence).toBe('estimated');
    expect(shown!.assessment!.effect).toBe('demoted_stale');
    expect(shown!.assessment!.accuracy.newerObservation).toMatchObject({ value: 55_000_000, asOf: '2026-09-15' });
    expect(shown!.assessment!.summary).toMatch(/newer/);
    expect(shown!.value).toBe(40_000_000);
  });
});

describe('9. a human-verified figure is never altered or demoted', () => {
  const human = fig({ confidence: 'user_verified', asOf: '2019-01-01', value: 12_345 });
  it('read-time assessment leaves the row as it was', () => {
    const [row] = assessFacts([human], { company, now: NOW });
    expect(row).toEqual(human);
  });
  it('the whole read composition keeps it user_verified, undemoted, with no assessment', () => {
    const rows = displayedCompanyFacts({ company: company as never, metrics: [human], attempts: [], evidence: [], now: NOW });
    const shown = rows.find((r) => r.metricType === 'revenue')!;
    expect(shown).toMatchObject({ confidence: 'user_verified', value: 12_345 });
    expect(shown.assessment).toBeUndefined();
    expect(shown.methodNote ?? '').not.toMatch(/window|out of date/i);
  });
  it('no automated write replaces it', () => {
    const metric = structuredClone(fig({ asOf: '2026-10-01', value: 99 }));
    expect(resolveWrite(metric, human, ctx)).toBe(false);
    expect(metric).toMatchObject({ confidence: 'user_verified', value: 12_345 });
  });
});

describe('10. a legacy pre-CRAAP snapshot', () => {
  const legacy = [
    { id: 'a', companyId: 'cmp', metricType: 'employees', value: 900, confidence: 'estimated', source: 'https://example.com/e', citations: [{ title: 'example.com', url: 'https://example.com/e' }], methodNote: 'Estimated.', capturedAt: '2023-01-05T00:00:00.000Z' },
    { id: 'b', companyId: 'cmp', metricType: 'valuation', value: null, confidence: 'unknown', source: null, citations: [], methodNote: null, capturedAt: '2023-01-05T00:00:00.000Z' },
    { id: 'c', companyId: 'cmp', metricType: 'revenue', value: 5, confidence: 'user_verified', source: null, citations: [], methodNote: null, capturedAt: '2022-01-05T00:00:00.000Z' },
  ] as unknown as CompanyMetric[];
  it('differs from the stored rows only by the added assessment', () => {
    const out = assessFacts(legacy, { company, now: NOW });
    for (const [i, row] of out.entries()) {
      const { assessment, ...rest } = row;
      expect(rest).toEqual(legacy[i]);
      expect(assessment?.version ?? 1).toBe(1);
    }
    expect(out[1]!.assessment).toBeUndefined();
    expect(out[2]!.assessment).toBeUndefined();
  });
  it('an undated legacy estimate is not labelled stale or aged out and keeps its value', () => {
    const a = assessFacts(legacy, { company, now: NOW })[0]!.assessment!;
    expect(a.effect).not.toBe('demoted_stale');
    expect(a.currency.state).toBe('undated');
  });
  it('the only demotion of a legacy verified row is a documented stale one, value kept, note says why', () => {
    const stale = passage({ asOf: '2023-01-05' });
    const [row] = assessFacts([stale], { company, now: NOW });
    expect(row).toMatchObject({ value: 45, confidence: 'estimated' });
    expect(row!.methodNote).toMatch(/older than the \d+-month window/);
    expect(row!.assessment!.effect).toBe('demoted_stale');
  });
});

describe('12. the pure assessment path does not read the clock', () => {
  it('never calls Date.now and gives the same answer whatever the system time is', () => {
    const rows = [passage({ asOf: '2025-01-10' }), article(55_000_000, '2026-09-15'), fig()];
    const spy = vi.spyOn(Date, 'now').mockImplementation(() => { throw new Error('Date.now read in the pure path'); });
    try {
      const run = () => ({
        facts: assessFacts(rows, { company, now: NOW }),
        cmp: compareObservations(rows[1]!, rows[2]!, ctx),
        shown: displayedCompanyFacts({ company: company as never, metrics: rows, attempts: [], evidence: [], now: NOW }),
      });
      const first = run();
      expect(run()).toEqual(first);
    } finally { spy.mockRestore(); }
  });
  it('a different injected clock changes ages, nothing else', () => {
    const a = assess(passage({ asOf: '2026-01-10' }));
    const later = assessFigure(passage({ asOf: '2026-01-10' }), { ...ctx, now: new Date('2028-10-20T12:00:00Z') })!;
    expect(a.currency.state).toBe('current');
    expect(later.currency.state).toBe('stale');
    expect(later.assessedAt).toBe('2028-10-20T12:00:00.000Z');
  });
});

describe('14. prompts never carry today as a figure date', () => {
  it('the shared rules and held-figure lines carry no year or today', () => {
    const text = [LATEST_PERIOD_RULE, FIGURE_DATE_RULE, ...heldFigureLines([{ label: 'Employees', value: 900, asOf: null, publisher: 'example.com' }])].join('\n');
    expect(text).not.toMatch(/\b(19|20)\d{2}\b/);
    expect(text).not.toMatch(/today is|as of today|current date/i);
    expect(heldFigureLines([{ label: 'Employees', value: 900, asOf: null, publisher: null }])[1]).toContain('with no date');
  });
});

/** A hunt over a stored stale verified figure and an undated estimate, with fake model calls. */
async function huntRun(options?: { refreshStale?: boolean }) {
  const OLD = '2023-01-05T00:00:00.000Z';
  const snap = {
    schemaVersion: 2, markets: [], decks: [],
    companies: [{ id: 'cmp_1', name: 'OpenAI', oneLiner: 'Frontier AI research and deployment company.', websiteUrl: 'https://openai.com', logoUrl: null, hqLocation: null, brandTheme: null }],
    metrics: [
      { id: 'met_arr', companyId: 'cmp_1', metricType: 'arr', value: 13_000_000_000, confidence: 'verified', source: 'https://reuters.com/x',
        citations: [{ title: 'reuters.com', url: 'https://reuters.com/x' }], methodNote: null, capturedAt: OLD, lastVerifiedAt: OLD, staleAfterSeconds: 86_400,
        passageSupport: { sourceUrl: 'https://reuters.com/x', quote: 'q', asOf: '2023-01-05', value: 13_000_000_000, unit: 'USD', basis: 'arr' } },
      { id: 'met_emp', companyId: 'cmp_1', metricType: 'employees', value: 900, confidence: 'estimated', source: 'https://example.com/e',
        citations: [{ title: 'example.com', url: 'https://example.com/e' }], methodNote: null, capturedAt: OLD },
    ],
    cards: [], viceClaims: [], dashboards: {}, companyMarket: { cmp_1: 'Frontier AI' }, opportunity: {}, reports: [], savedCards: [], researchJobs: [], threads: [],
  } as unknown as RepoSnapshot;
  const ground = vi.fn(async (_prompt: string) => ({ text: 'No reliable figure.', citations: [], queries: [] }));
  const structure = vi.fn(async (_prompt: string, schema: { parse: (v: unknown) => unknown }) => schema.parse({ figures: [] }));
  const client = { ground, structure } as unknown as LlmClient;
  const repo = new GeminiRepository({ apiKey: 'test-placeholder', store: { read: () => snap, write: () => undefined }, client, now: () => NOW });
  await repo.huntCompanyMetrics('cmp_1', options);
  return { ground, structure };
}

describe('13/14. hunt: call counts are pinned and the prompts never carry today', () => {
  it('a hunt over the same stored figures makes the same fixed number of model calls, whatever the stale-refresh request', async () => {
    const plain = await huntRun();
    const refresh = await huntRun({ refreshStale: true });
    // Pinned from the code paths unchanged against the base ref (git diff shows no new ground/structure call site):
    // one grounded pass and one structuring pass.
    expect([plain.ground.mock.calls.length, plain.structure.mock.calls.length]).toEqual([1, 1]);
    expect([refresh.ground.mock.calls.length, refresh.structure.mock.calls.length]).toEqual([1, 1]);
  });
  it('no prompt names today, the current year or a month of the current date', async () => {
    const { ground, structure } = await huntRun({ refreshStale: true });
    const prompts = [...ground.mock.calls, ...structure.mock.calls].map(([p]) => String(p)).join('\n');
    // The prompts' own fixed worked example ("March 3, 2026", present before CRAAP) is not today.
    expect(prompts.replaceAll('March 3, 2026', 'EXAMPLE')).not.toMatch(/2026-10-20|20 October|October 20|\b2026\b/);
    expect(prompts).toContain('LATEST FIRST');
  });
});

describe('18. date edges are never read as fresher than they are', () => {
  const at = (iso: string, asOf: string) => assessFigure(passage({ asOf }), { ...ctx, now: new Date(iso) })!.currency;
  it('a date-only asOf on the day itself is current; the next UTC day is in the future', () => {
    expect(at('2026-10-20T00:00:01Z', '2026-10-20')).toMatchObject({ state: 'current', ageDays: 0 });
    expect(at('2026-10-20T23:59:59Z', '2026-10-20')).toMatchObject({ state: 'current', ageDays: 0 });
    expect(at('2026-10-20T23:59:59Z', '2026-10-21')).toMatchObject({ state: 'undated', asOf: null });
    expect(at('2026-10-21T00:00:00Z', '2026-10-21')).toMatchObject({ state: 'current', ageDays: 0 });
  });
  it('year-only and month-only dates are undated, not read as the newest day they could mean', () => {
    for (const asOf of ['2026', '2026-10', '2025-12']) {
      expect(at('2026-10-20T12:00:00Z', asOf)).toMatchObject({ state: 'undated', asOf: null });
    }
  });
  it('a malformed or impossible date is undated, not current', () => {
    for (const asOf of ['2026-13-01', '2026-02-30', 'yesterday', '20261001']) {
      expect(at('2026-10-20T12:00:00Z', asOf).state).toBe('undated');
    }
  });
});

describe('19. search queries carry no year token', () => {
  it('not even the fallback query used when no metric family matches', () => {
    for (const missing of [[], ['headcount'], ['market_cap_other']]) {
      for (const q of huntSearchQueries('Ramp', missing, { year: 2026 })) expect(q.query).not.toMatch(/\b(19|20)\d{2}\b/);
      for (const q of huntSearchQueries('Ramp', missing)) expect(q.query).not.toMatch(/\b(19|20)\d{2}\b/);
    }
  });
});

describe('20. the read-time composition is identical for identical input', () => {
  const quote = 'Acme reported 45 employees as of 2026-10-01.';
  const rivalUrl = 'https://blog.rival.com/acme';
  const rival = { ...passage({ url: rivalUrl, quote, source: rivalUrl, citations: [{ title: 'rival', url: rivalUrl }], confidence: 'estimated' }), passageSupport: null, reportedSupport: null, lastVerifiedAt: null } as CompanyMetric;
  // An estimate whose cited page is a retained original is shown as stored (the computation lane): enough to read purpose.
  const attempt = { id: 'src', companyId: 'cmp', metricType: 'company_profile', capturedAt: '2026-10-02T00:00:00.000Z',
    receipts: [{ requestedUrl: rivalUrl, finalUrl: rivalUrl, status: 'retrieved', httpStatus: 200, contentHash: 'a'.repeat(64), text: quote,
      retrievedAt: '2026-10-02T00:00:00.000Z' }] };
  const acme = { ...company, name: 'Acme', oneLiner: 'x', logoUrl: null, hqLocation: null, brandTheme: null };
  const cardOf = (cardType: string, id = 'k', co: Record<string, unknown> = acme, metrics = [rival]) => ({
    card: { id, deckId: 'd', companyId: co.id, cardType, tier: 5, createdAt: '2026-10-01T00:00:00.000Z', title: null, summary: null, tierReason: null, citations: [], keyPoints: [] },
    company: co, metrics, viceClaims: [],
  }) as never;
  const kindOf = (rows: CompanyMetric[]) => rows.find((m) => m.metricType === 'employees')!.assessment!.purpose.kind;
  it('card projection equals the getCompanyFacts composition for the same rivals', () => {
    const rivalWebsites = ['https://rival.com'];
    const viaCard = projectCompanyCardFacts(cardOf('company'), [attempt], { now: NOW, rivalWebsites }).metrics;
    const viaFacts = displayedCompanyFacts({ company: acme as never, metrics: [rival], attempts: [attempt] as never, evidence: [], now: NOW, rivalWebsites });
    expect(viaCard).toEqual(viaFacts);
    expect(kindOf(viaCard)).toBe('competitor');
  });
  it('a signal card gets no facts and no assessment', () => {
    expect(projectCompanyCardFacts(cardOf('culture'), [attempt], { now: NOW }).metrics).toEqual([]);
  });
  it('the rivals of a card are the other companies in its deck, so every read path agrees on the competitor purpose', () => {
    const other = { id: 'rv', name: 'Rival', websiteUrl: 'https://www.rival.com/' };
    const deck = [cardOf('company', 'k'), cardOf('company', 'k2', other, []), cardOf('culture', 'k3', { ...other, id: 'sig', websiteUrl: 'https://signal.example' }, [])];
    expect(deckRivalWebsites(deck[0]!, deck)).toEqual(['https://www.rival.com/']);
    const rivalWebsites = deckRivalWebsites(deck[0]!, deck);
    expect(kindOf(projectCompanyCardFacts(deck[0]!, [attempt], { now: NOW, rivalWebsites }).metrics)).toBe('competitor');
    expect(deckRivalWebsites(deck[1]!, deck)).toEqual([acme.websiteUrl]);
  });
});
