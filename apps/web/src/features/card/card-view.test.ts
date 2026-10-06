import { describe, expect, it } from 'vitest';
import { buildDataset } from '@mi/mocks';
import type { CardWithCompany, CompanyMetric } from '@mi/contracts';
import { buildCardView, buildMetricViews } from './card-view';

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
    expect(result.position).toBe('Stage pending');
    expect(result.maturity).toBeNull();
  });
  it('marks single-source tiers as indicative instead of a confident ranking', () => {
    const result = view([metric({ metricType: 'users', value: 1200 })], {
      card: { ...card, tier: 6 },
    });
    expect(result.position).toBe('Indicative · T6');
  });
  it('withholds even a recorded high tier from the face when no source backs any figure', () => {
    const result = view([metric({ metricType: 'arr', value: 9_000_000, confidence: 'estimated', citations: [] })], {
      card: { ...card, tier: 8 },
    });
    expect(result.profileMetrics[1]!.display).toBe('Unknown');
    expect(result.maturity).toBeNull();
    expect(result.position).toBe('Stage pending');
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

    expect(result.frontDescription).toBe('A regulator opened a documented inquiry.');
    expect(result.frontFinding).toBeNull();
    expect(result.sourceCount).toBe(1);
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
});
