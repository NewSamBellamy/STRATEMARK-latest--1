import { describe, expect, it } from 'vitest';
import { buildDataset } from '@mi/mocks';
import type { CardWithCompany, CompanyMetric, MaturityTier } from '@mi/contracts';
import { OVR_MAX, OVR_MIN, ovrColorTier, rateCardAlone, rateDeck, rateInputs, type OvrInput } from './rating';

const tiers: Array<MaturityTier> = [8, 8, 7, 7, 6, 5, 5, 4, 3, 2];
/** Ten companies whose scale tracks their tier, largest first. */
const deck: OvrInput[] = tiers.map((tier, i) => ({
  id: `c${i}`, tier,
  scale: { employees: 10_000 - i * 900, revenue: 5e9 - i * 4e8, value: 9e10 - i * 8e9 },
  sourcedCount: Math.max(1, 4 - Math.floor(i / 3)),
}));
const overall = (m: ReturnType<typeof rateInputs>, id: string) => m.get(id)!.overall;

describe('OVR rating', () => {
  it('spreads a typical deck from a high leader down to a credible floor, descending', () => {
    const r = rateInputs(deck);
    const scores = deck.map((d) => overall(r, d.id));
    expect(scores).toEqual([...scores].sort((a, b) => b - a));
    expect(scores[0]).toBeGreaterThanOrEqual(95);
    expect(scores[0]).toBeLessThanOrEqual(99);
    expect(scores[9]).toBeGreaterThanOrEqual(30);
    expect(scores[9]).toBeLessThan(50);
    expect(new Set(scores).size).toBeGreaterThanOrEqual(8);
  });
  it('clamps to 30..99', () => {
    const lo = rateInputs([
      { id: 'a', tier: 1, scale: { employees: 1 }, sourcedCount: 1 },
      { id: 'b', tier: 8, scale: { employees: 2 }, sourcedCount: 1 },
      { id: 'c', tier: 8, scale: { employees: 3 }, sourcedCount: 1 },
    ]);
    expect(overall(lo, 'a')).toBeGreaterThanOrEqual(OVR_MIN);
    const hi = rateInputs(Array.from({ length: 5 }, (_, i) => ({
      id: `t${i}`, tier: 8 as const, scale: { employees: i + 1, revenue: i + 1, value: i + 1, reach: i + 1, aum: i + 1 }, sourcedCount: 9,
    })));
    expect(Math.max(...[...hi.values()].map((b) => b!.overall))).toBe(OVR_MAX);
  });
  it('withholds the rating with no tier and no rankable sourced figure', () => {
    const r = rateInputs([{ id: 'x', tier: null, scale: {}, sourcedCount: 0 }, ...deck]);
    expect(r.get('x')).toBeNull();
    // one lone figure has no comparators, so it cannot be ranked either
    const lone = rateInputs([{ id: 'y', tier: null, scale: { aum: 5 }, sourcedCount: 1 }, ...deck]);
    expect(lone.get('y')).toBeNull();
  });
  it('never treats Unknown as zero', () => {
    const withUnknown = rateInputs(deck.map((d, i) => i === 4 ? { ...d, scale: { employees: d.scale.employees } } : d));
    const full = rateInputs(deck);
    // dropping revenue/value must not drag the company below its tier-only floor of 50% weight
    const only = withUnknown.get('c4')!;
    expect(only.percentiles.map((p) => p.family)).toEqual(['employees']);
    expect(only.overall).toBeGreaterThan(40);
    expect(only.overall).toBeLessThanOrEqual(overall(full, 'c4') + 6);
    // tier with zero comparable figures falls back to the tier alone, not to 30
    const tierOnly = rateInputs([{ id: 't', tier: 6, scale: {}, sourcedCount: 1 }]).get('t')!;
    expect(tierOnly.overall).toBe(Math.round(35 + (5 * 55) / 7));
    expect(tierOnly.percentiles).toEqual([]);
  });
  it('is deterministic and explainable', () => {
    const a = rateInputs(deck);
    const b = rateInputs([...deck].reverse());
    for (const d of deck) expect(a.get(d.id)).toEqual(b.get(d.id));
    const top = a.get('c0')!;
    expect(top.components.map((c) => c.key)).toEqual(['tier', 'scale', 'evidence']);
    expect(top.basis).toMatch(/tier/i);
    expect(top.percentiles.length).toBe(3);
  });
  it('maps rating bands onto the tier hue scale', () => {
    expect([30, 45, 55, 60, 70, 75, 85, 99].map(ovrColorTier)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
  });
});

describe('OVR from real cards', () => {
  const dataset = buildDataset();
  const card = dataset.cards.find((c) => c.cardType === 'company' && c.companyId)!;
  const company = dataset.companies.find((c) => c.id === card.companyId)!;
  const seed = dataset.metrics.find((m) => m.companyId === company.id)!;
  const m = (patch: Partial<CompanyMetric>): CompanyMetric => ({ ...seed, value: 1200, metricType: 'users', confidence: 'verified',
    source: null, citations: [{ title: 'Annual report', url: 'https://sec.gov/Archives/report', credibility: 'primary' }], ...patch });
  const make = (id: string, tier: number | null, metrics: CompanyMetric[]): CardWithCompany =>
    ({ card: { ...card, id, tier: tier as never }, company: { ...company, id: `co-${id}` }, metrics: metrics.map((x) => ({ ...x, companyId: `co-${id}` })), viceClaims: [] });

  it('withholds when the tier is recorded only from unsourced estimates', () => {
    const c = make('u', 8, [m({ metricType: 'arr', value: 9e9, confidence: 'estimated', citations: [] })]);
    expect(rateCardAlone(c)).toBeNull();
  });
  it('rates a sourced card on its tier alone when it is shown without a deck', () => {
    const r = rateCardAlone(make('s', 7, [m({ metricType: 'employees', value: 500 })]))!;
    expect(r.tier).toBe(7);
    expect(r.percentiles).toEqual([]);
  });
  it('ranks sourced figures within the deck and ignores unsourced ones', () => {
    const cards = [
      make('a', 6, [m({ metricType: 'employees', value: 9000 })]),
      make('b', 6, [m({ metricType: 'employees', value: 900 })]),
      make('c', 6, [m({ metricType: 'employees', value: 90 })]),
      make('d', 6, [m({ metricType: 'employees', value: 5, confidence: 'estimated', citations: [] }), m({ metricType: 'users', value: 10 })]),
    ];
    const r = rateDeck(cards);
    expect(r.get('a')!.overall).toBeGreaterThan(r.get('b')!.overall);
    expect(r.get('b')!.overall).toBeGreaterThan(r.get('c')!.overall);
    expect(r.get('d')!.percentiles).toEqual([]);
    expect(r.get('d')!.overall).toBe(r.get('d')!.components[0]!.score);
  });
});
