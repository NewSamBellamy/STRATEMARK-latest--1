import { describe, expect, it } from 'vitest';
import { buildDataset } from '@mi/mocks';
import type { CardWithCompany, CompanyMetric } from '@mi/contracts';
import { buildCardView, sortCompanyCardsForBrowse } from './card-view';

const dataset = buildDataset();
const card = dataset.cards.find((c) => c.cardType === 'company' && c.companyId)!;
const company = dataset.companies.find((c) => c.id === card.companyId)!;
const seed = dataset.metrics.find((m) => m.companyId === company.id)!;
function metric(patch: Partial<CompanyMetric>): CompanyMetric {
  return {
    ...seed,
    value: 1200,
    metricType: 'users',
    confidence: 'verified',
    source: null,
    citations: [
      {
        title: 'Annual report',
        url: 'https://investor.example.com/report',
        credibility: 'primary',
      },
    ],
    ...patch,
  };
}
function view(metrics: CompanyMetric[], overrides: Partial<CardWithCompany> = {}) {
  return buildCardView({ card, company, metrics, viceClaims: [], ...overrides });
}

describe('collectible card evidence model', () => {
  it('keeps unknown figures unknown, including contradictory non-null values', () => {
    const result = view([metric({ confidence: 'unknown', value: 500 })]);
    expect(result.metrics[0]!.display).toBe('Unknown');
    expect(result.knownCount).toBe(0);
    expect(result.metrics[0]!.metric.value).toBeNull();
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
      metric({ id: 'a', citations: [], source: 'https://investor.example.com/report' }),
      metric({ id: 'b', confidence: 'estimated' }),
      metric({ id: 'c', confidence: 'user_verified', citations: [], source: null }),
    ]);
    expect(result.metrics.map((m) => m.metric.confidence)).toEqual([
      'verified',
      'estimated',
      'user_verified',
    ]);
    expect(result.sourcedCount).toBe(2);
  });
  it('falls back to known market cap when the valuation row is unknown', () => {
    const result = view([
      metric({ id: 'v', metricType: 'valuation', value: null, confidence: 'unknown' }),
      metric({ id: 'c', metricType: 'market_cap', value: 100_000_000 }),
    ]);
    expect(result.faceMetrics[0]!.label).toBe('Market cap');
    expect(result.faceMetrics[0]!.display).toBe('$100M');
  });
  it('puts the strongest usable company facts on the face across market types', () => {
    const result = view([
      metric({
        id: 'arr',
        metricType: 'arr',
        value: 9_000_000,
        confidence: 'estimated',
        citations: [],
      }),
      metric({ id: 'share', metricType: 'market_share', value: 24 }),
      metric({ id: 'people', metricType: 'employees', value: 270 }),
      metric({ id: 'reach', metricType: 'users', value: 2_400_000 }),
    ]);
    expect(result.faceMetrics.map((m) => m.label)).toEqual(['Users', 'Employees']);
    expect(result.metrics.some((m) => m.label === 'Market share')).toBe(true);
  });
  it('never uses both valuation and market cap as the two headline facts', () => {
    const result = view([
      metric({ id: 'private', metricType: 'valuation', value: 100_000_000 }),
      metric({ id: 'public', metricType: 'market_cap', value: 90_000_000 }),
      metric({ id: 'revenue', metricType: 'arr', value: 8_000_000 }),
    ]);
    expect(result.faceMetrics.map((m) => m.label)).toEqual(['ARR', 'Market cap']);
  });
  it('does not fill the card with unknown figures or assign an unsupported position', () => {
    const result = view([]);
    expect(result.faceMetrics).toEqual([]);
    expect(result.position).toBe('Scale unverified');
    expect(result.maturity).toBeNull();
  });
  it('shows a scale band only with two independent signals and a cited signal', () => {
    const result = view(
      [
        metric({ id: 'users', metricType: 'users', value: 1200 }),
        metric({ id: 'employees', metricType: 'employees', value: 120, citations: [] }),
      ],
      { card: { ...card, tier: 6 } },
    );
    expect(result.position).toBe('T6 · Large footprint');
  });
  it('withholds a recorded scale band when only one figure is available', () => {
    const result = view([metric({ metricType: 'users', value: 1200 })], {
      card: { ...card, tier: 6 },
    });
    expect(result.maturity).toBeNull();
    expect(result.position).toBe('Scale unverified');
  });
  it('carries the newest research date onto the card face', () => {
    const result = view([
      metric({ id: 'older', capturedAt: '2026-07-01T00:00:00.000Z' }),
      metric({ id: 'newer', capturedAt: '2026-08-15T00:00:00.000Z' }),
    ]);
    expect(result.latestCapturedAt).toBe(new Date('2026-08-15T00:00:00.000Z').getTime());
  });
  it('withholds even a recorded high tier from the face when no source backs any figure', () => {
    const result = view(
      [metric({ metricType: 'arr', value: 9_000_000, confidence: 'estimated', citations: [] })],
      {
        card: { ...card, tier: 8 },
      },
    );
    expect(result.faceMetrics[0]!.display).toBe('$9M');
    expect(result.maturity).toBeNull();
    expect(result.position).toBe('Scale unverified');
  });
  it('keeps unscoped market share in Evidence, not on the face or as a tier receipt', () => {
    const result = view([metric({ metricType: 'market_share', value: 24 })], {
      card: { ...card, tier: 7 },
    });
    expect(result.faceMetrics).toEqual([]);
    expect(result.maturity).toBeNull();
    expect(result.metrics[0]!.display).toBe('24%');
  });
  it('treats infrastructure as a company profile, not a scored company card', () => {
    const result = view([metric({ metricType: 'users', value: 1200 })], {
      card: { ...card, cardType: 'infrastructure', tier: 8 },
    });
    expect(result.position).toBe('Entity profile');
    expect(result.maturity).toBeNull();
  });
  it('shows invalid inputs as unknown rather than painting false precision', () => {
    for (const value of [NaN, Infinity, -1, 101]) {
      const result = view([metric({ metricType: 'market_share', value })]);
      expect(result.metrics[0]!.display).toBe('Unknown');
      expect(result.metrics[0]!.note).toMatch(/invalid/i);
    }
  });
  it('does not inherit company stats or a size band on signal cards', () => {
    const result = view([metric({})], { card: { ...card, cardType: 'vice', tier: 8 } });
    expect(result.metrics).toEqual([]);
    expect(result.faceMetrics).toEqual([]);
    expect(result.maturity).toBeNull();
    expect(result.signal).toBe(true);
  });

  it('orders company cards by sourced stage, then title, without mutating the input', () => {
    const makeCard = (name: string, tier: number | null, sourced: boolean) => ({
      card: { ...card, id: name, title: name, tier: tier as typeof card.tier },
      company: { ...company, id: `company-${name}`, name },
      metrics: [
        metric({
          id: `metric-${name}`,
          metricType: 'users',
          value: 1200,
          citations: sourced ? metric({}).citations : [],
        }),
        metric({
          id: `employees-${name}`,
          metricType: 'employees',
          value: 40,
          citations: [],
        }),
      ],
      viceClaims: [],
    });
    const input = [
      makeCard('Evidence Needed', 8, false),
      makeCard('Emerging', 3, true),
      makeCard('Largest footprint', 8, true),
    ];

    expect(sortCompanyCardsForBrowse(input).map((entry) => entry.company!.name)).toEqual([
      'Largest footprint',
      'Emerging',
      'Evidence Needed',
    ]);
    expect(input[0]!.company!.name).toBe('Evidence Needed');
  });
});
