import { describe, expect, it } from 'vitest';
import { buildDataset } from '@mi/mocks';
import type { CardWithCompany, CompanyMetric } from '@mi/contracts';
import { buildCardView, fitFaceLine, buildMetricViews, companyFrontName } from './card-view';

describe('card face company name', () => {
  it.each([
    ['SZ DJI Technology Co., Ltd. (DJI)', 'DJI'],
    ['Skydio, Inc.', 'Skydio'],
    ['Quantum-Systems GmbH', 'Quantum-Systems'],
    ['Pix4D SA', 'Pix4D'],
    ['Delair SAS', 'Delair'],
    ['Ondas Holdings Inc. (Ondas Autonomous Systems)', 'Ondas Holdings'],
    ['Measure (Adranos / Global Aerial Services channels)', 'Measure'],
    ['Radiant Nuclear (Radiant Industries, Inc.)', 'Radiant Nuclear'],
    ['Mastercard Open Banking / Finicity', 'Mastercard Open Banking / Finicity'],
    ['Vic.ai', 'Vic.ai'],
    ['Intuit QuickBooks', 'Intuit QuickBooks'],
  ])('%s → %s', (name, expected) => {
    expect(companyFrontName(name)).toBe(expected);
  });
});

const dataset = buildDataset();
const card = dataset.cards.find((c) => c.cardType === 'company' && c.companyId)!;
const company = dataset.companies.find((c) => c.id === card.companyId)!;
const seed = dataset.metrics.find((m) => m.companyId === company.id)!;
function metric(patch: Partial<CompanyMetric>): CompanyMetric {
  return { ...seed, value: 1200, metricType: 'users', confidence: 'verified', source: null,
    citations: [{ title: 'Annual report', url: 'https://sec.gov/Archives/report', credibility: 'primary' }], ...patch };
}
function view(metrics: CompanyMetric[], overrides: Partial<CardWithCompany> = {}) {
  return buildCardView({ card, company, metrics, viceClaims: [], ...overrides });
}

describe('collectible card evidence model', () => {
  it('shows provider-attributed reported figures, clearly distinguished from verification and estimates', () => {
    const input = metric({ metricType: 'employees', value: 123, confidence: 'estimated', reportedSupport: {
      provider: 'google-search', companyName: company.name, basis: 'employees', value: 123,
      unit: 'count', definition: 'employees', asOf: '2026-10-01', support: {
        supportIndex: 0, text: `${company.name} reported 123 employees as of 2026-10-01.`,
        sources: [{ chunkIndex: 0, title: 'Annual report', url: 'https://sec.gov/Archives/report' }],
      },
    } });
    expect(view([input]).profileMetrics[0]).toMatchObject({ display: '123', confidence: 'Source reported' });
    expect(view([{ ...input, reportedSupport: { ...input.reportedSupport!, companyName: 'Another company' } }]).profileMetrics[0]!.display).toBe('Unknown');
    expect(view([{ ...input, reportedSupport: null }]).profileMetrics[0]!.display).toBe('Unknown');
    expect(input.confidence).toBe('estimated');
  });
  it('keeps decimal prices and ratios intact on specialist card fronts', () => {
    const result = view([], { company: null, card: { ...card, cardType: 'insight', companyId: null,
      summary: 'Pricing shifts matter.', keyPoints: ['Reported tokens cost $0.97/M with a 3.5 month lag. More detail follows.'] } });
    expect(result.frontFinding).toBe('Reported tokens cost $0.97/M with a 3.5 month lag.');
  });
  it('uses typed measurement labels rather than conflicting model notes on cards and readers', () => {
    const input = metric({ methodNote: 'Users: annual revenue', passageSupport: { sourceUrl: 'https://sec.gov/report',
      quote: 'Acme reports 1200 monthly active users as of 2026-10-01.', asOf: '2026-10-01', basis: 'users', unit: 'count', definition: 'monthly_active_users' } });
    expect(view([input]).profileMetrics[2]!.label).toBe('Monthly active users');
    const revenue = metric({ metricType: 'arr', methodNote: 'ARR', passageSupport: { ...input.passageSupport!,
      basis: 'arr', unit: 'USD', definition: 'annual_revenue', periodStart: '2025-10-01' } });
    expect(view([revenue]).profileMetrics[1]!.label).toBe('Annual revenue');
  });
  it('preserves accepted issuer figures with matching company context only', () => {
    const input = metric({ metricType: 'employees', value: 45, citations: [{ title: 'Original passage', url: 'https://acme.com/report' }] });
    const issuer = { ...company, websiteUrl: 'https://acme.com' };
    expect(view([input], { company: issuer }).profileMetrics[0]!.display).toBe('45');
    expect(view([input], { company: { ...issuer, websiteUrl: 'https://other.com' } }).profileMetrics[0]!.display).toBe('Unknown');
  });
  it.each([false, true])('never resurrects an older sourced duplicate after a newer downgrade (reversed=%s)', reverse => {
    const old = metric({ id: 'old', value: 1_000_000_000, capturedAt: '2026-10-01T00:00:00Z' });
    const checked = metric({ id: 'checked', value: 900_000_000, confidence: 'estimated',
      capturedAt: '2026-09-30T00:00:00Z', lastVerificationAttemptAt: '2026-10-05T00:00:00Z' });
    const rows = reverse ? [checked, old] : [old, checked];
    const result = view(rows);
    expect(result.metrics).toHaveLength(1);
    expect(result.metrics[0]!.metric.id).toBe('checked');
    expect(result.metrics[0]!.metric.confidence).toBe('estimated');
    expect(result.profileMetrics[2]!.display).toBe('Unknown');
    expect(rows).toHaveLength(2);
    expect(old.confidence).toBe('verified');
  });
  it('withholds indistinguishable contradictory duplicates rather than arbitrarily picking a fact', () => {
    const rows = [metric({ id: 'a', value: 100 }), metric({ id: 'b', value: 200 })];
    for (const input of [rows, [...rows].reverse()]) {
      const result = view(input);
      expect(result.metrics).toHaveLength(1);
      expect(result.metrics[0]!.metric.confidence).toBe('unknown');
      expect(result.metrics[0]!.metric.value).toBeNull();
      expect(result.metrics[0]!.note).toMatch(/conflicting/i);
      expect(result.profileMetrics[2]!.display).toBe('Unknown');
    }
    expect(rows.map(m => m.value)).toEqual([100, 200]);
  });
  it('keeps human corrections ahead of newer automated duplicates and separates companies', () => {
    const human = metric({ id: 'human', value: 123, confidence: 'user_verified', citations: [], capturedAt: '2026-09-01T00:00:00Z' });
    const machine = metric({ id: 'machine', value: 456, capturedAt: '2026-10-05T00:00:00Z' });
    const other = metric({ id: 'other', companyId: 'other-company', value: 789 });
    const projected = buildMetricViews([machine, human, other]);
    expect(projected).toHaveLength(2);
    expect(projected.find(m => m.metric.companyId === human.companyId)!.metric.value).toBe(123);
    expect(projected.find(m => m.metric.companyId === 'other-company')!.metric.value).toBe(789);
  });
  it('keeps unrecognized or forged authority unknown on both card and reader profiles', () => {
    const input = metric({ citations: [{ title: 'Reuters annual report', url: 'https://reuters.com.attacker.test/report', credibility: 'primary' }] });
    const result = view([input]);
    expect(result.metrics[0]!.metric.confidence).toBe('estimated');
    expect(result.profileMetrics[2]!.display).toBe('Unknown');
    expect(result.profileMetrics[2]!.metric).toBeUndefined();
    expect(input.confidence).toBe('verified'); // do not mutate legacy stored rows
  });

  it('keeps unknown figures unknown, including contradictory non-null values', () => {
    const result = view([metric({ confidence: 'unknown', value: 500 })]);
    expect(result.metrics[0]!.display).toBe('Unknown');
    expect(result.knownCount).toBe(0);
    expect(result.metrics[0]!.metric.value).toBeNull();
    expect(result.profileMetrics[2]!.display).toBe('Unknown');
  });
  it('never presents an unverified zero-user claim as fact', () => {
    const result = view([metric({ value: 0, confidence: 'verified' })]);
    expect(result.profileMetrics[2]!.display).toBe('Unknown');
    expect(result.profileMetrics[2]!.confidence).toBe('Unknown');
  });
  it('never relabels users as customers or invents a plus sign', () => {
    const result = view([metric({ value: 1_200_000_000 })]);
    expect(result.metrics[0]!.label).toBe('Users');
    expect(result.metrics[0]!.display).toBe('1.2B');
    expect(result.metrics[0]!.display).not.toContain('+');
  });
  it('requires a clickable receipt before displaying model-verified confidence', () => {
    const input = metric({ citations: [], source: 'Annual report', methodNote: null });
    const result = view([input]);
    expect(result.metrics[0]!.metric.confidence).toBe('estimated');
    expect(result.metrics[0]!.note).toMatch(/clickable source/i);
    expect(result.sourcedCount).toBe(0);
    expect(input.confidence).toBe('verified'); // presentation never rewrites stored research
  });
  it('accepts legacy source URLs but does not promote estimates or human verification', () => {
    const result = view([
      metric({ id: 'a', citations: [], source: 'https://sec.gov/Archives/report' }),
      metric({ id: 'b', metricType: 'employees', confidence: 'estimated' }),
      metric({ id: 'c', metricType: 'arr', confidence: 'user_verified', citations: [], source: null }),
    ]);
    expect(result.metrics.map((m) => m.metric.confidence)).toEqual(['verified', 'estimated', 'user_verified']);
    expect(result.sourcedCount).toBe(2);
  });
  it('keeps a fixed four-field profile and falls back to market cap when valuation is unknown', () => {
    const result = view([
      metric({ id: 'v', metricType: 'valuation', value: null, confidence: 'unknown' }),
      metric({ id: 'c', metricType: 'market_cap', value: 100_000_000 }),
    ]);
    expect(result.profileMetrics).toHaveLength(4);
    expect(result.profileMetrics[3]!.label).toBe('Market cap');
    expect(result.profileMetrics[3]!.display).toBe('$100M');
  });
  it('swaps the reach slot for AUM on financial-firm cards and keeps the operating layout unchanged', () => {
    const firm = { ...company, name: 'Meridian Capital Partners',
      oneLiner: 'A venture capital firm investing in early-stage deep tech.' };
    const result = buildCardView({
      card, company: firm, viceClaims: [],
      metrics: [
        metric({ metricType: 'aum', value: 42_000_000_000 }),
        metric({ metricType: 'users', value: 1200 }),
      ],
    });
    expect(result.profileMetrics.map((m) => m.key)).toEqual(['aum', 'employees', 'company_value', 'revenue']);
    expect(result.profileMetrics[0]!.label).toBe('AUM');
    expect(result.profileMetrics[0]!.display).toBe('$42B');
    expect(result.profileMetrics.some((m) => m.key === 'reach')).toBe(false);
    expect(view([]).profileMetrics.map((m) => m.key)).toEqual(['employees', 'revenue', 'reach', 'company_value']);
  });
  it('shows the same core company fields across companies, independent of which facts were found', () => {
    const result = view([
      metric({ id: 'arr', metricType: 'arr', value: 9_000_000, confidence: 'estimated', citations: [] }),
      metric({ id: 'share', metricType: 'market_share', value: 24 }),
      metric({ id: 'people', metricType: 'employees', value: 270 }),
      metric({ id: 'reach', metricType: 'users', value: 2_400_000 }),
    ]);
    expect(result.profileMetrics.map((m) => m.key)).toEqual([
      'employees',
      'revenue',
      'reach',
      'company_value',
    ]);
    expect(result.profileMetrics.map((m) => m.display)).toEqual(['270', 'Unknown', '2.4M', 'Unknown']);
    expect(result.profileMetrics[0]!.label).toBe('Employees');
    expect(result.profileMetrics[3]!.display).toBe('Unknown');
    expect(result.profileMetrics[1]!.confidence).toBe('Unknown');
    expect(result.metrics.some((m) => m.label === 'Market share')).toBe(true);
  });
  it('uses one company-value field rather than duplicating valuation and market cap', () => {
    const result = view([
      metric({ id: 'private', metricType: 'valuation', value: 100_000_000 }),
      metric({ id: 'public', metricType: 'market_cap', value: 90_000_000 }),
      metric({ id: 'revenue', metricType: 'arr', value: 8_000_000 }),
    ]);
    expect(result.profileMetrics).toHaveLength(4);
    expect(result.profileMetrics[3]!.label).toBe('Valuation');
    expect(result.profileMetrics[3]!.display).toBe('$100M');
  });
  it('preserves annual-revenue and public-footprint labels instead of calling them ARR or users', () => {
    const result = view([
      metric({ id: 'revenue', metricType: 'arr', value: 12_000_000, methodNote: 'Reported annual revenue, FY2025' }),
      metric({ id: 'reach', metricType: 'users', value: 50_000, methodNote: 'GitHub stars' }),
    ]);
    expect(result.profileMetrics[1]!.label).toBe('Annual revenue');
    expect(result.profileMetrics[2]!.label).toBe('GitHub stars');
    expect(result.profileMetrics[1]!.label).not.toBe('ARR');
    const runRate = view([metric({ id: 'run-rate', metricType: 'arr', value: 70_000_000, methodNote: 'Annualized revenue run-rate' })]);
    expect(runRate.profileMetrics[1]!.label).toBe('Revenue run-rate');
  });
  it('shows unknown placeholders instead of hiding missing core facts or assigning an unsupported position', () => {
    const result = view([]);
    expect(result.profileMetrics).toHaveLength(4);
    expect(result.profileMetrics.every((m) => m.display === 'Unknown')).toBe(true);
    expect(result.position).toBe('0/4 figures sourced');
    expect(result.maturity).toBeNull();
  });
  it('reports sourced-figure coverage on the face instead of a tier grade', () => {
    const result = view([metric({ metricType: 'users', value: 1200 })], {
      card: { ...card, tier: 6 },
    });
    expect(result.position).toBe('1/4 figures sourced');
    expect(result.position).not.toMatch(/T\d|Tier|Maturity/);
  });
  it('withholds even a recorded high tier from the face when no source backs any figure', () => {
    const result = view([metric({ metricType: 'arr', value: 9_000_000, confidence: 'estimated', citations: [] })], {
      card: { ...card, tier: 8 },
    });
    expect(result.profileMetrics[1]!.display).toBe('Unknown');
    expect(result.maturity).toBeNull();
    expect(result.position).toBe('0/4 figures sourced');
  });
  it('keeps unscoped market share in Evidence, not on the face or as a tier receipt', () => {
    const result = view([metric({ metricType: 'market_share', value: 24 })], {
      card: { ...card, tier: 7 },
    });
    expect(result.profileMetrics[3]!.display).toBe('Unknown');
    expect(result.maturity).toBeNull();
    expect(result.metrics[0]!.display).toBe('24%');
  });
  it('treats infrastructure as a company profile, not a scored company card', () => {
    const result = view([metric({ metricType: 'users', value: 1200 })], {
      card: { ...card, cardType: 'infrastructure', tier: 8 },
    });
    expect(result.position).toBe('Entity profile');
    expect(result.maturity).toBeNull();
    expect(result.profileMetrics).toHaveLength(4);
  });
  it('shows invalid inputs as unknown rather than painting false precision', () => {
    for (const value of [NaN, Infinity, -1, 101]) {
      const result = view([metric({ metricType: 'market_share', value })]);
      expect(result.metrics[0]!.display).toBe('Unknown');
      expect(result.metrics[0]!.note).toMatch(/invalid/i);
    }
  });
  it('does not inherit company stats or a maturity tier on signal cards', () => {
    const result = view([metric({})], { card: { ...card, cardType: 'vice', tier: 8 } });
    expect(result.metrics).toEqual([]);
    expect(result.profileMetrics).toEqual([]);
    expect(result.maturity).toBeNull();
    expect(result.signal).toBe(true);
  });

  it('counts distinct source receipts rather than sourced metric fields', () => {
    const result = view([
      metric({ id: 'people', metricType: 'employees', value: 120, citations: [
        { title: 'Annual report', url: 'https://example.com/annual', credibility: 'primary' },
      ] }),
      metric({ id: 'revenue', metricType: 'arr', value: 9_000_000, citations: [
        { title: 'Annual report', url: 'https://example.com/annual', credibility: 'primary' },
        { title: 'Press coverage', url: 'https://news.example.com/company', credibility: 'reputable_secondary' },
      ] }),
    ], { card: { ...card, citations: [
      { title: 'Company profile', url: 'https://example.com/profile', credibility: 'primary' },
    ] } });

    expect(result.sourcedCount).toBe(2);
    expect(result.sourceCount).toBe(3);
  });

  it('turns signal research into concise front-of-card lines and counts vice receipts', () => {
    const result = buildCardView({
      card: { ...card, cardType: 'vice', title: null, summary: null, citations: [], keyPoints: [] },
      company,
      metrics: [],
      viceClaims: [{
        id: 'vice-1', cardId: card.id,
        claimText: 'A regulator opened a documented inquiry.',
        sourceTitle: 'Regulator filing', sourceUrl: 'https://regulator.example.gov/filing',
        capturedAt: '2026-10-01T00:00:00.000Z',
      }],
    });

    // The company is the subject; the finding is the claim, in full.
    expect(result.frontDescription).toBe(company.oneLiner.split(/(?<=[.!?])\s/)[0]);
    expect(result.frontFinding).toBe('A regulator opened a documented inquiry.');
    expect(result.sourceCount).toBe(1);
  });

  it('never shows an allegation that has no clickable source', () => {
    const claim = (id: string, claimText: string, sourceUrl: string) => ({
      id, cardId: card.id, claimText, sourceTitle: 'Source', sourceUrl, capturedAt: '2026-10-01T00:00:00.000Z',
    });
    const vice = { ...card, cardType: 'vice' as const, title: null, summary: null, citations: [], keyPoints: [] };
    // Whatever the face draws for a risk (its description and its findings), the unsourced claims are in none of it.
    const drawn = (result: ReturnType<typeof buildCardView>) => [result.description, result.frontDescription, result.frontFinding].filter(Boolean).join(' | ');
    const mixed = buildCardView({ card: vice, company, metrics: [], viceClaims: [
      claim('v1', 'An unsourced rumour about the company.', ''),
      claim('v2', 'A script link is not a source.', 'javascript:alert(1)'),
      claim('v3', 'A regulator opened a documented inquiry.', 'https://regulator.example.gov/filing'),
    ] });
    expect(drawn(mixed)).toContain('A regulator opened a documented inquiry.');
    expect(drawn(mixed)).not.toContain('unsourced rumour');
    expect(drawn(mixed)).not.toContain('script link');
    expect(mixed.sourceCount).toBe(1);

    const unsourced = buildCardView({ card: vice, company, metrics: [], viceClaims: [claim('v1', 'An unsourced rumour about the company.', '')] });
    expect(unsourced.description).toBeNull();
    expect(drawn(unsourced)).not.toContain('unsourced rumour');
    expect(unsourced.sourceCount).toBe(0);
  });

  it('keeps parenthetical detail in the report while using a complete short card headline', () => {
    const title = 'Bifurcation of Token Economics (The Sub-$1 Commodity Floor vs. High-End Inflation)';
    const result = buildCardView({
      card: { ...card, cardType: 'insight', companyId: null, title },
      company: null,
      metrics: [],
      viceClaims: [],
    });

    expect(result.title).toBe(title);
    expect(result.frontTitle).toBe('Bifurcation of Token Economics');
  });
  describe('ordered-alternative face slots for small private brands', () => {
    const funding = metric({ id: 'f', metricType: 'funding_total', value: 53_000_000, methodNote: 'Total raised to date, as of 2026-10-01.' });
    const people = metric({ id: 'p', metricType: 'employees', value: 120 });
    const countries = metric({ id: 'd', metricType: 'distribution', value: 60, methodNote: 'Sold in 60+ countries as of 2026-10-01.' });
    it('fills three slots with honest labels and never repeats a metric row', () => {
      const result = view([funding, people, countries]);
      expect(result.profileMetrics.map((m) => m.label)).toEqual(['Employees', 'Total raised', 'Countries', 'Valuation / market cap']);
      expect(result.profileMetrics.map((m) => m.display).slice(0, 3)).toEqual(['120', '$53M', '60+']);
      expect(result.profileMetrics.filter((m) => m.metric?.value != null)).toHaveLength(3);
      expect(result.profileMetrics[3]!.display).toBe('Unknown');
      const shown = result.profileMetrics.flatMap((m) => (m.metric ? [m.metric.id] : []));
      expect(new Set(shown).size).toBe(shown.length);
    });
    it('uses another metric for the value slot once funding_total is taken, and names stockists', () => {
      const round = metric({ id: 'r', metricType: 'last_round', value: 5_000_000, methodNote: 'Series A, 2026-10-01.' });
      const doors = metric({ id: 'd2', metricType: 'distribution', value: 1000, methodNote: '1,000+ retail stockists as of 2026-10-01.' });
      const result = view([funding, round, doors, people]);
      expect(result.profileMetrics.map((m) => m.label)).toEqual(['Employees', 'Total raised', 'Stockists', 'Latest round']);
      expect(result.profileMetrics[2]!.display).toBe('1K+');
      const valued = view([funding, metric({ id: 'v', metricType: 'valuation', value: 200_000_000 })]);
      expect(valued.profileMetrics.map((m) => m.label)).toEqual(['Employees', 'Total raised', 'Users / customers', 'Valuation']);
    });
    it('keeps revenue ahead of funding in the revenue slot', () => {
      const revenue = metric({ id: 'rev', metricType: 'revenue', value: 4_000_000 });
      const result = view([funding, revenue]);
      expect(result.profileMetrics[1]).toMatchObject({ label: 'Revenue', display: '$4M' });
      expect(result.profileMetrics[3]).toMatchObject({ label: 'Total raised', display: '$53M' });
    });
  });

  describe('card face: the four strongest sourced figures', () => {
    const asOf = new Date(Date.now() - 30 * 86_400_000).toISOString().slice(0, 10);
    const url = 'https://www.prnewswire.com/news-releases/raise.html';
    const quotedValuation = metric({ id: 'qv', metricType: 'valuation', value: 44_000_000_000, confidence: 'estimated',
      citations: [{ title: 'prnewswire.com (original page, quoted)', url, credibility: 'reputable_secondary' }],
      quotedSupport: { sourceUrl: url, asOf, unit: 'USD', value: 44_000_000_000,
        quote: `Today, ${company.name} announced a $750 million financing round, valuing the company at $44 billion.` } });
    const round = metric({ id: 'lr', metricType: 'last_round', value: 750_000_000 });
    const raised = metric({ id: 'ft', metricType: 'funding_total', value: 1_000_000_000 });
    const people = metric({ id: 'em', metricType: 'employees', value: 1200 });
    const share = metric({ id: 'ms', metricType: 'market_share', value: 12 });

    it('fills all four places from whatever is sourced, instead of leaving family holes', () => {
      // No users: the fixed slots leave a hole (and drop the latest round entirely).
      const result = view([quotedValuation, round, raised, people]);
      expect(result.profileMetrics.filter((m) => m.display === 'Unknown')).toHaveLength(1);
      expect(result.faceMetrics.map((m) => m.label)).toEqual(['Valuation', 'Employees', 'Total raised', 'Latest round']);
      expect(result.faceMetrics.every((m) => m.display !== 'Unknown' && m.display !== 'Not found yet')).toBe(true);
      expect(result.faceMetrics[0]).toMatchObject({ display: '$44B', confidence: 'Source reported' });
    });

    it('prefers verified over estimated, and one figure per family', () => {
      const verifiedCap = metric({ id: 'mc', metricType: 'market_cap', value: 50_000_000_000 });
      const result = view([quotedValuation, verifiedCap, round, raised, people, share]);
      const labels = result.faceMetrics.map((m) => m.label);
      expect(labels).toContain('Market cap');
      expect(labels).not.toContain('Valuation');
      expect(result.faceMetrics).toHaveLength(4);
    });

    it('never shows an estimate that cannot re-check, and says plainly what is missing', () => {
      const forged = metric({ id: 'x', metricType: 'valuation', value: 9e9, confidence: 'estimated', quotedSupport: null });
      const tampered = { ...quotedValuation, quotedSupport: { ...quotedValuation.quotedSupport!, quote: 'Another company is valued at $44 billion.' } };
      const result = view([forged, tampered, people]);
      expect(result.faceMetrics).toHaveLength(4);
      expect(result.faceMetrics.map((m) => m.display)).toEqual(['1.2K', 'Not found yet', 'Not found yet', 'Not found yet']);
      expect(result.faceMetrics.slice(1).every((m) => m.metric === undefined && m.citations.length === 0)).toBe(true);
    });

    it('shows a human-checked figure even without a link', () => {
      const human = metric({ id: 'h', metricType: 'arr', value: 5_000_000, confidence: 'user_verified', citations: [] });
      expect(view([human]).faceMetrics[0]).toMatchObject({ display: '$5M' });
    });

    it('re-checked quoted figures also fill the fixed slot used by reports', () => {
      expect(view([quotedValuation]).profileMetrics[3]).toMatchObject({ label: 'Valuation', display: '$44B', confidence: 'Source reported' });
    });
  });
});

describe('fitFaceLine: card-face text that never stops mid-thought', () => {
  it('keeps a short line whole and gives nothing for an empty one', () => {
    expect(fitFaceLine('A short line.', 100)).toBe('A short line.');
    expect(fitFaceLine('   ', 100)).toBeNull();
    expect(fitFaceLine(null, 100)).toBeNull();
  });

  it('takes the whole sentences that fit', () => {
    const text = 'The regulator fined the company in 2024 over misleading discounts. It also opened an inquiry into cancellations. A third sentence that will not fit at all in the space.';
    expect(fitFaceLine(text, 120)).toBe('The regulator fined the company in 2024 over misleading discounts. It also opened an inquiry into cancellations.');
    expect(fitFaceLine(text, 80)).toBe('The regulator fined the company in 2024 over misleading discounts.');
  });

  it('cuts one long sentence at its last clause, then at a word, and never inside a word', () => {
    const long = 'OpenAI faces consolidated class-action lawsuits and high-profile suits from media publishers and creators, including The New York Times v. Microsoft and OpenAI, over training data';
    const clause = fitFaceLine(long, 130)!;
    expect(clause.endsWith('…')).toBe(true);
    expect(clause.length).toBeLessThanOrEqual(131);
    expect(long.startsWith(clause.slice(0, -1))).toBe(true);
    expect(clause).not.toMatch(/\b(The New York Times v|Times v)\.?…$/);
    const noClause = fitFaceLine('Supercalifragilistic experiences without any punctuation continuing on and on for far too long to ever fit', 50)!;
    expect(noClause.endsWith('…')).toBe(true);
    expect('Supercalifragilistic experiences without any punctuation continuing on and on for far too long to ever fit'.startsWith(noClause.slice(0, -1))).toBe(true);
    expect(noClause.slice(0, -1).endsWith(' ')).toBe(false);
  });

  it('stops a run-on sentence where an added-on phrase begins, not inside a list (live culture findings)', () => {
    const sunrun = 'Sunrun Inc. states its core mission is "to create a planet run by the sun" by providing locally generated, affordable, and reliable renewable energy while fostering a workplace culture centered on sustainability, diversity, and community volunteerism.';
    expect(fitFaceLine(sunrun, 200)).toBe('Sunrun Inc. states its core mission is "to create a planet run by the sun"…');
    const goodleap = 'GoodLeap, LLC states its mission is "to connect a world in which everyone can live sustainably," supported by corporate values focused on financial technology innovation, contractor vetting and customer service.';
    expect(fitFaceLine(goodleap, 200)).toBe('GoodLeap, LLC states its mission is "to connect a world in which everyone can live sustainably,"…');
    const momentum = 'Momentum Solar states its mission is to enable customers to take control of rising electricity costs and achieve freedom from fossil fuels through clean energy, while building an energetic and mission-driven culture.';
    expect(fitFaceLine(momentum, 200)).toBe('Momentum Solar states its mission is to enable customers to take control of rising electricity costs and achieve freedom from fossil fuels through clean energy…');
    // The one-line description under the name, cut at 120 characters.
    expect(fitFaceLine('Momentum Solar is a full-service residential solar contractor that provides direct-to-consumer design and installation of solar systems across the United States.', 120)).toBe('Momentum Solar is a full-service residential solar contractor…');
    expect(fitFaceLine('GoodLeap is a leading fintech point-of-sale platform providing point-of-sale financing for residential solar and home improvement projects.', 120)).toBe('GoodLeap is a leading fintech point-of-sale platform…');
    expect(fitFaceLine('Enphase Energy is a global energy technology company and leading North American supplier of microinverter-based solar and battery systems.', 120)).toBe('Enphase Energy is a global energy technology company…');
    // Never inside a parenthesis.
    expect(fitFaceLine('Sunrun Inc. was named as a defendant in a consumer protection lawsuit filed in December 2024 (Lara v. Sunrun Inc., Case No. 2024-CV-001234) alleging that its sales agents misled homeowners about savings.', 150)).toBe('Sunrun Inc. was named as a defendant in a consumer protection lawsuit filed in December 2024…');
    // Nothing to break on: the old rule still applies.
    expect(fitFaceLine('Alpha beta gamma delta epsilon zeta eta theta iota kappa lambda mu nu xi omicron pi rho sigma tau upsilon phi chi psi omega', 60)!.endsWith('…')).toBe(true);
  });

  it('does not treat a decimal price or a domain as the end of a sentence', () => {
    expect(fitFaceLine('Tokens cost $0.97/M with a 3.5 month lag. More follows after that for readers who want it.', 60)).toBe('Tokens cost $0.97/M with a 3.5 month lag.');
  });
});

describe('the face of a risk or culture card names the company, then says the finding in whole sentences', () => {
  it('describes the company and quotes the claim, instead of showing the claim twice or a clipped fragment', () => {
    const claim = 'A regulator opened a documented inquiry into the company and fined it over misleading discount claims in March 2024. It has appealed.';
    const result = buildCardView({
      card: { ...card, cardType: 'vice', title: null, summary: null, citations: [], keyPoints: [] },
      company: { ...company, oneLiner: 'Acme builds warehouse robots for retailers. It was founded in 2014.' },
      metrics: [],
      viceClaims: [{ id: 'v1', cardId: card.id, claimText: claim, sourceTitle: 'Regulator', sourceUrl: 'https://regulator.example.gov/a', capturedAt: '2026-10-01T00:00:00.000Z' }],
    });
    expect(result.frontDescription).toBe('Acme builds warehouse robots for retailers.');
    expect(result.frontFinding).toBe(claim);
    const pending = buildCardView({
      card: { ...card, cardType: 'culture', title: null, summary: 'Acme publishes a values charter.', citations: [], keyPoints: [] },
      company: { ...company, oneLiner: 'No source-backed company snapshot is ready yet.' }, metrics: [], viceClaims: [],
    });
    expect(pending.frontDescription).toBeNull();
    expect(pending.frontFinding).toBe('Acme publishes a values charter.');
  });
});

describe('a signal card face holds only what its box can show', () => {
  it('keeps the description to 120 characters and the finding to 135, whatever the stored text', () => {
    const long = 'State-level utility commission rulings have slashed export compensation rates, compressing the return on investment for pure solar systems across several large states and utilities.';
    const barrier = buildCardView({
      card: { ...card, cardType: 'barrier', companyId: null, title: 'Net metering', summary: long, keyPoints: [long.replace('State-level', 'Many state-level'), 'Another point about the same barrier that is also fairly long and keeps going for a while.'], citations: [] },
      company: null, metrics: [], viceClaims: [],
    });
    expect(barrier.frontDescription!.length).toBeLessThanOrEqual(121);
    expect(barrier.frontFinding!.length).toBeLessThanOrEqual(136);
    const culture = buildCardView({
      card: { ...card, cardType: 'culture', title: null, summary: 'GoodLeap, LLC states its mission is "to connect a world in which everyone can live sustainably," supported by corporate values focused on financial technology innovation, contractor vetting and customer service.', citations: [], keyPoints: [] },
      company: { ...company, oneLiner: 'GoodLeap is a leading fintech point-of-sale platform providing point-of-sale financing for residential solar and home improvement projects across the United States.' },
      metrics: [], viceClaims: [],
    });
    expect(culture.frontDescription!.length).toBeLessThanOrEqual(121);
    expect(culture.frontFinding!.length).toBeLessThanOrEqual(136);
  });
});

describe('a risk card face leads with the claims, not a description of the company', () => {
  it('shows the sourced claim even when the stored summary only describes the company', () => {
    const description = 'Sunlight Financial LLC provides a point-of-sale financing platform that connects solar installers and homeowners.';
    const claim = 'Sunlight Financial LLC was named in an enforcement complaint brought by the Minnesota Attorney General in 2024.';
    const result = buildCardView({
      card: { ...card, cardType: 'vice', title: null, summary: description, citations: [], keyPoints: [] },
      company: { ...company, oneLiner: 'Sunlight Financial LLC is a lender.' }, metrics: [],
      viceClaims: [{ id: 'v1', cardId: card.id, claimText: claim, sourceTitle: 'ag.state.mn.us', sourceUrl: 'https://ag.state.mn.us/a', capturedAt: '2026-10-01T00:00:00.000Z' }],
    });
    expect(result.frontFinding?.startsWith(claim)).toBe(true);
    // A culture card still leads with its own summary.
    const culture = buildCardView({
      card: { ...card, cardType: 'culture', title: null, summary: 'Staff describe a flat structure.', citations: [], keyPoints: [] },
      company, metrics: [], viceClaims: [],
    });
    expect(culture.frontFinding).toBe('Staff describe a flat structure.');
  });
});

describe('a sentence is not ended by an abbreviation', () => {
  it('keeps "The U.S. Department of Justice ..." and "The New York Times v. Microsoft" whole on a card face', () => {
    const doj = 'The U.S. Department of Justice opened an antitrust probe and issued subpoenas.';
    const nyt = 'OpenAI faces suits from publishers, including The New York Times v. Microsoft and OpenAI. A ruling is expected.';
    const result = buildCardView({
      card: { ...card, cardType: 'vice', title: null, summary: null, citations: [], keyPoints: [] },
      company: { ...company, oneLiner: 'NVIDIA Corp. designs graphics processors. It was founded in 1993.' }, metrics: [],
      viceClaims: [
        { id: 'a', cardId: card.id, claimText: doj, sourceTitle: 'qz.com', sourceUrl: 'https://qz.com/a', capturedAt: '2026-10-01T00:00:00.000Z' },
        { id: 'b', cardId: card.id, claimText: nyt, sourceTitle: 'nyt.com', sourceUrl: 'https://nyt.com/b', capturedAt: '2026-10-01T00:00:00.000Z' }],
    });
    expect(result.frontDescription).toBe('NVIDIA Corp. designs graphics processors.');
    expect(result.frontFinding).toContain(doj);
    expect(result.frontFinding).not.toMatch(/Times v\.$/);
    const lines = buildCardView({ ...{ card: { ...card, cardType: 'insight', companyId: null, summary: nyt, keyPoints: [] }, company: null, metrics: [], viceClaims: [] } });
    expect(lines.frontDescription).toBe('OpenAI faces suits from publishers, including The New York Times v. Microsoft and OpenAI.');
    expect(lines.frontFinding).toBe('A ruling is expected.');
  });
});

describe('fitFaceLine: faces that stopped in the wrong place (red-team findings)', () => {
  const after = (text: string, line: string) => text.slice(line.replace(/…$/, '').length).trim();
  const endsOnHalfAnEmoji = (line: string) => { const code = line.charCodeAt(line.length - 1); return code >= 0xd800 && code <= 0xdbff; };

  describe('an abbreviation does not end a sentence', () => {
    it.each(['Gov.', 'Sen.', 'Rep.', 'Dr.', 'Mr.', 'Mrs.', 'Ms.', 'St.', 'Inc.', 'Corp.', 'Co.', 'Ltd.', 'U.S.', 'U.K.', 'e.g.', 'i.e.', 'vs.', 'No.', 'approx.'])('%s', (abbreviation) => {
      const text = `The investigation was led by ${abbreviation} Greg Abbott, who signed the sweeping consumer protection bill into law on Friday.`;
      const line = fitFaceLine(text, 60)!;
      expect(line).not.toBe(`The investigation was led by ${abbreviation}`);
      expect(line.endsWith(abbreviation)).toBe(false);
      expect(line.endsWith('…')).toBe(true);
    });

    it('keeps "Texas Gov. Greg Abbott signed the bill." as one sentence on a card face', () => {
      const lines = buildCardView({
        card: { ...card, cardType: 'insight', companyId: null, summary: 'Texas Gov. Greg Abbott signed the bill. It takes effect next year.', keyPoints: [] },
        company: null, metrics: [], viceClaims: [],
      });
      expect(lines.frontDescription).toBe('Texas Gov. Greg Abbott signed the bill.');
      expect(lines.frontFinding).toBe('It takes effect next year.');
    });

    it('does not stop a long sentence on a dangling title or "v."', () => {
      const text = 'The suit was brought against the company and its chief executive by the attorney general, Gov. Greg Abbott and the state legislature in Texas.';
      const at = text.indexOf('Gov.') + 'Gov.'.length;
      const line = fitFaceLine(text, at + 3)!;
      expect(line).not.toMatch(/\b(?:Gov|Sen|Rep|Dr|Mr|v|vs)\.…?$/);
      expect(fitFaceLine('The case was reported as The New York Times v. Microsoft and OpenAI over training data used without a licence.', 'The case was reported as The New York Times v.'.length + 3)).not.toMatch(/v\.…?$/);
    });
  });

  describe('a cut does not drop the clause that answers what it keeps', () => {
    const text = 'The company was fined by the regulator for misleading discount claims during 2022 and 2023, but the fines were overturned on appeal and no wrongdoing was found.';

    it('at no width: not before "but ...", and not in the middle of "2022 and 2023"', () => {
      let shown = 0;
      for (let max = 30; max < text.length; max++) {
        const line = fitFaceLine(text, max);
        if (line === null) continue;
        shown++;
        expect(line.length).toBeLessThanOrEqual(max);
        expect(after(text, line), `max ${max}: ${line}`).not.toMatch(/^[,;:—-]*\s*(?:and\s+)?(?:but|although|though|however|despite|unless)\b/i);
        expect(after(text, line), `max ${max}: ${line}`).not.toMatch(/^[,;]?\s*(?:and|or|to|through)\s+(?:in\s+)?\d/);
      }
      expect(shown).toBeGreaterThan(0);
    });

    it('backs up to before the clause that starts the claim when its answer cannot fit', () => {
      expect(fitFaceLine(text, 100)).toBe('The company was fined by the regulator for misleading discount claims…');
      const noComma = 'The company was fined by the regulator for misleading discount claims during 2022 and 2023 but the fines were later overturned on appeal.';
      expect(fitFaceLine(noComma, 110)).toBe('The company was fined by the regulator for misleading discount claims…');
    });

    it('keeps the answer once enough of it fits', () => {
      const line = fitFaceLine(text, 130)!;
      expect(line).toContain('during 2022 and 2023, but the fines were overturned');
      expect(line.length).toBeLessThanOrEqual(130);
    });

    it('keeps a claim away from the sentence that answers it ("However, ...")', () => {
      const earlier = 'Acme opened a new plant in Ohio last spring. The company was fined $5 million in 2022. However, the fine was overturned on appeal after review.';
      expect(fitFaceLine(earlier, 100)).toBe('Acme opened a new plant in Ohio last spring.');
      const only = 'The company was fined $5 million in 2022. However, the fine was overturned on appeal after a full review of the evidence.';
      expect(fitFaceLine(only, 60)).toBeNull();
    });

    it('cuts a date list whole or before it, never inside it', () => {
      const list = 'The regulator fined the company for misleading discount claims made in 2021, 2022 and 2023 across its retail stores nationwide.';
      for (let max = 40; max < list.length; max++) {
        const line = fitFaceLine(list, max);
        if (line === null) continue;
        expect(after(list, line), `max ${max}: ${line}`).not.toMatch(/^[,;]?\s*(?:and|or|to|through)\s+\d|^,\s*\d/);
      }
    });
  });

  describe('a number is not cut from its unit', () => {
    it.each([['roughly 4,200', 'people'], ['about 12', 'percent'], ['$5', 'million'], ['over 3,000', 'stores'], ['approximately $1.2', 'billion'], ['nearly 900', 'employees']])('never ends on "%s"', (quantity, unit) => {
      const text = `Acme reports that the company currently has ${quantity} ${unit} across its operations in the United States and Canada.`;
      const max = text.indexOf(unit) + 2;
      const line = fitFaceLine(text, max)!;
      expect(line.length).toBeLessThanOrEqual(max);
      expect(line).not.toMatch(/\d…?$/);
      expect(line).not.toMatch(/\b(?:about|roughly|approximately|over|under|nearly)…?$/i);
    });

    it('keeps a whole amount and a date, which carry their own unit', () => {
      expect(fitFaceLine('The company was fined $4.2 billion by the regulator over misleading claims about its products and services in several states.', 40)).toBe('The company was fined $4.2 billion…');
      expect(fitFaceLine('The company was fined by the regulator in March 2024 over misleading claims about its products in several states.', 60)).toBe('The company was fined by the regulator in March 2024…');
      // A month is not cut from its year.
      expect(fitFaceLine('The company was fined by the regulator in March 2024 over misleading claims about its products in several states.', 52)).toBe('The company was fined by the regulator…');
    });
  });

  describe('the line never exceeds max and never ends on half an emoji', () => {
    it('counts the ellipsis, for text with no spaces too', () => {
      const unbroken = fitFaceLine('x'.repeat(300), 200)!;
      expect(unbroken.length).toBe(200);
      expect(unbroken.endsWith('…')).toBe(true);
      for (const text of ['x'.repeat(300), 'word '.repeat(80), 'https://example.com/' + 'path'.repeat(80), 'a' + '\u{1F600}'.repeat(150)]) {
        for (const max of [1, 2, 3, 5, 10, 50, 120, 135, 199, 200, 201]) {
          const line = fitFaceLine(text, max);
          if (line === null) continue;
          expect(line.length, `max ${max}`).toBeLessThanOrEqual(max);
        }
      }
    });

    it('never leaves a lone high surrogate, at any width', () => {
      const text = 'a' + '\u{1F600}'.repeat(150);
      for (let max = 1; max <= 250; max++) {
        const line = fitFaceLine(text, max);
        if (line === null) continue;
        expect(endsOnHalfAnEmoji(line), `max ${max}`).toBe(false);
        expect(endsOnHalfAnEmoji(line.replace(/…$/, '')), `max ${max}`).toBe(false);
      }
    });
  });

  it('never returns a lone ellipsis', () => {
    expect(fitFaceLine('(((', 2)).toBe('((');
    for (const text of ['(((', '((((((((((((', '— — — — — —', ' ( ( ( ( ( (']) {
      for (let max = 1; max <= 20; max++) {
        const line = fitFaceLine(text, max);
        expect(line, `${text} at ${max}`).not.toBe('…');
        if (line !== null) {
          expect(line.length).toBeLessThanOrEqual(max);
          expect(line).not.toMatch(/^[(\s—…]*…$/);
        }
      }
    }
  });

  it('is linear on a long chain of "Inc." pieces, on the face and on a card built from it', () => {
    const chain = 'Inc. '.repeat(60_000);
    const started = performance.now();
    const line = fitFaceLine(chain, 200);
    const result = buildCardView({
      card: { ...card, cardType: 'insight', companyId: null, summary: chain, keyPoints: [] },
      company: null, metrics: [], viceClaims: [],
    });
    expect(performance.now() - started).toBeLessThan(250);
    expect(line!.length).toBeLessThanOrEqual(200);
    expect(result.frontDescription!.length).toBeLessThanOrEqual(120);
  });
});
