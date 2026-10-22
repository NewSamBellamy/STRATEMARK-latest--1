import { describe, expect, it } from 'vitest';
import type { CompanyMetric, MetricType } from '@mi/contracts';
import type { PeerEntry } from '../dashboardModel';
import { barScale, barShare, comparableTypes, deckComparison, niceTicks, scatterPoints, visibleBars } from './deckComparison';

function metric(companyId: string, type: MetricType, value: number | null, over: Partial<CompanyMetric> = {}): CompanyMetric {
  return {
    id: `m_${companyId}_${type}`, companyId, metricType: type, value, confidence: value == null ? 'unknown' : 'verified',
    source: 'https://www.reuters.com/a', citations: value == null ? [] : [{ title: 'Reuters', url: 'https://www.reuters.com/a' }],
    methodNote: null, capturedAt: '2026-10-01T00:00:00.000Z', ...over,
  } as CompanyMetric;
}
const peer = (id: string, name: string, metrics: CompanyMetric[]): PeerEntry => ({ companyId: id, name, metrics });

const PEERS: PeerEntry[] = [
  peer('a', 'Acme', [metric('a', 'valuation', 50e9), metric('a', 'employees', 900)]),
  peer('b', 'Beta', [metric('b', 'valuation', 80e9), metric('b', 'employees', null)]),
  peer('c', 'Gamma', [metric('c', 'valuation', null), metric('c', 'employees', 300)]),
  peer('d', 'Delta', [metric('d', 'valuation', 10e9, { confidence: 'estimated' }), metric('d', 'employees', 120)]),
];

describe('deckComparison', () => {
  it('charts only sourced figures, highest first, with this company ranked', () => {
    const c = deckComparison('a', 'valuation', PEERS);
    expect(c.bars.map((b) => b.companyId)).toEqual(['b', 'a', 'd']);
    expect(c.ranking.rank).toBe(2);
    expect(c.ranking.of).toBe(3);
    expect(c.bars.find((b) => b.isSelf)?.companyId).toBe('a');
  });

  it('lists a company with no figure as not charted, never as a zero bar', () => {
    const c = deckComparison('a', 'valuation', PEERS);
    expect(c.bars.some((b) => b.companyId === 'c')).toBe(false);
    expect(c.bars.every((b) => b.value > 0)).toBe(true);
    expect(c.notCharted.map((n) => n.companyId)).toEqual(['c']);
  });

  it('marks this company as not charted when it has no figure', () => {
    const c = deckComparison('b', 'employees', PEERS);
    expect(c.ranking.rank).toBeNull();
    expect(c.notCharted).toEqual([{ companyId: 'b', name: 'Beta', isSelf: true }]);
  });

  it('keeps the estimate flag, publisher and date for the hover detail', () => {
    const d = deckComparison('a', 'valuation', PEERS).bars.find((b) => b.companyId === 'd')!;
    expect(d.estimate).toBe(true);
    expect(d.publisher).toMatch(/reuters/i);
    expect(d.when).toMatch(/2026/);
    expect(deckComparison('a', 'valuation', PEERS).bars.find((b) => b.companyId === 'b')!.estimate).toBe(false);
  });
});

describe('visibleBars', () => {
  const bars = deckComparison('d', 'valuation', PEERS).bars;
  it('keeps this company in view when it ranks below the cut', () => {
    expect(visibleBars(bars, 1, false).map((b) => b.companyId)).toEqual(['b', 'd']);
    expect(visibleBars(bars, 1, true)).toHaveLength(3);
  });
});

describe('barShare', () => {
  it('is linear from zero and refuses to scale without a real maximum', () => {
    expect(barShare(25, 100)).toBe(25);
    expect(barShare(5, 0)).toBeNull();
    expect(barShare(Number.NaN, 100)).toBeNull();
  });
});

describe('barScale', () => {
  const bars = (values: number[]) => deckComparison('a', 'employees', values.map((v, i) => peer(`p${i}`, `Co${i}`, [metric(`p${i}`, 'employees', v)]))).bars;
  it('breaks only when the largest is more than 5x the second largest', () => {
    expect(barScale(bars([500, 100])).broken.size).toBe(0);
    expect(barScale(bars([501, 100])).broken.size).toBe(1);
    const s = barScale(bars([228000, 2300, 2200, 350, 312]));
    expect(s.max).toBe(2300);
    expect([...s.broken]).toEqual(['p0']);
    expect(barScale(bars([228000, 2300])).max).toBe(2300);
  });
  it('is linear and unbroken otherwise, and handles empty input', () => {
    const s = barScale(bars([300, 200, 100]));
    expect(s.max).toBe(300);
    expect(s.broken.size).toBe(0);
    expect(barScale([]).max).toBe(0);
  });
});

describe('scatterPoints', () => {
  it('places only companies with both figures and names the rest', () => {
    const { points, left } = scatterPoints('a', 'employees', 'valuation', PEERS);
    expect(points.map((p) => p.companyId).sort()).toEqual(['a', 'd']);
    expect(left.sort()).toEqual(['Beta', 'Gamma']);
    expect(points.find((p) => p.companyId === 'd')!.estimate).toBe(true);
  });
  it('offers only figures at least two companies have', () => {
    expect(comparableTypes(['valuation', 'employees', 'users'], PEERS)).toEqual(['valuation', 'employees']);
  });
});

describe('niceTicks', () => {
  it('starts at zero and covers the maximum', () => {
    const t = niceTicks(380e9);
    expect(t[0]).toBe(0);
    expect(t[t.length - 1]!).toBeGreaterThanOrEqual(380e9);
    expect(niceTicks(0)).toEqual([0]);
  });
});
