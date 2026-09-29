import { describe, expect, it } from 'vitest';
import { buildDataset } from '@mi/mocks';
import type { CardWithCompany, CompanyMetric } from '@mi/contracts';
import { buildCardView } from './card-view';

const dataset = buildDataset();
const card = dataset.cards.find((c) => c.cardType === 'company' && c.companyId)!;
const company = dataset.companies.find((c) => c.id === card.companyId)!;
const seed = dataset.metrics.find((m) => m.companyId === company.id)!;
function metric(patch: Partial<CompanyMetric>): CompanyMetric {
  return { ...seed, value: 1200, metricType: 'users', confidence: 'verified', source: null,
    citations: [{ title: 'Annual report', url: 'https://investor.example.com/report', credibility: 'primary' }], ...patch };
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
    expect(result.metrics.map((m) => m.metric.confidence)).toEqual(['verified', 'estimated', 'user_verified']);
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
  it('does not fill the card with unknown figures or assign an unsupported position', () => {
    const result = view([]);
    expect(result.faceMetrics).toEqual([]);
    expect(result.position).toBe('Position pending');
    expect(result.maturity).toBeNull();
  });
  it('marks single-source tiers as indicative instead of a confident ranking', () => {
    const result = view([metric({ metricType: 'users', value: 1200 })], {
      card: { ...card, tier: 6 },
    });
    expect(result.position).toBe('Indicative · T6');
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
    expect(result.faceMetrics).toEqual([]);
    expect(result.maturity).toBeNull();
    expect(result.signal).toBe(true);
  });
});
