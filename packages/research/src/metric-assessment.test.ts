import { describe, expect, it } from 'vitest';
import type { CompanyMetric } from '@mi/contracts';
import { assessedForDisplay, assessMetric, settleMetric } from './metric-assessment';

const NOW = new Date('2026-10-21T12:00:00.000Z');

function metric(over: Partial<CompanyMetric> & { asOf?: string | null; url?: string } = {}): CompanyMetric {
  const { asOf = null, url = 'https://www.reuters.com/markets/openai-valuation', ...rest } = over;
  return {
    id: 'met_1', companyId: 'cmp_1', metricType: 'valuation', value: 500_000_000_000, confidence: 'verified',
    source: url, citations: [{ title: 'Reuters', url }], methodNote: 'Reported.', capturedAt: NOW.toISOString(),
    lastVerifiedAt: NOW.toISOString(), staleAfterSeconds: 86_400,
    reportedSupport: asOf ? ({ asOf } as never) : null, ...rest,
  } as CompanyMetric;
}

describe('settleMetric: a figure the evidence cannot support is never verified', () => {
  it('keeps a recent, independently sourced figure verified and stores its assessment', () => {
    const row = metric({ asOf: '2026-09-15' });
    settleMetric(row, NOW, 'openai.com');
    expect(row.confidence).toBe('verified');
    expect(row.assessment?.currency.status).toBe('current');
    expect(row.assessment?.assessedAt).toBe(NOW.toISOString());
  });

  it('stores a stale figure as estimated, keeps the value, and says why', () => {
    const row = metric({ asOf: '2024-01-10' });
    settleMetric(row, NOW, 'openai.com');
    expect(row.value).toBe(500_000_000_000);
    expect(row.confidence).toBe('estimated');
    expect(row.lastVerifiedAt).toBeNull();
    expect(row.assessment?.currency.status).toBe('stale');
    expect(row.methodNote).toMatch(/Not verified: .*stale/);
  });

  it('an undated figure cannot be verified', () => {
    const row = metric({ asOf: null });
    settleMetric(row, NOW, 'openai.com');
    expect(row.confidence).toBe('estimated');
    expect(row.assessment?.currency.status).toBe('undated');
    expect(row.methodNote).toMatch(/Not verified: .*publication date/i);
  });

  it('a 1970 placeholder date is not a date', () => {
    const row = metric({ asOf: '1970-01-01' });
    settleMetric(row, NOW, 'openai.com');
    expect(row.confidence).toBe('estimated');
    expect(row.assessment?.currency.status).toBe('undated');
  });

  it('a figure backed only by weak sources cannot be verified', () => {
    const row = metric({ asOf: '2026-09-15', url: 'https://en.wikipedia.org/wiki/OpenAI', citations: [{ title: 'Wikipedia', url: 'https://en.wikipedia.org/wiki/OpenAI' }] });
    settleMetric(row, NOW, 'openai.com');
    expect(row.assessment?.authority.tier).toMatch(/weak|reference/);
    expect(row.confidence).toBe('estimated');
    expect(row.methodNote).toMatch(/Not verified: .*weak/i);
  });

  it('never touches a human-verified figure, and never raises an estimate', () => {
    const human = metric({ confidence: 'user_verified', asOf: null });
    expect(settleMetric(human, NOW)).toBeNull();
    expect(human.confidence).toBe('user_verified');
    expect(human.assessment).toBeUndefined();
    const estimate = metric({ confidence: 'estimated', asOf: '2026-09-15' });
    settleMetric(estimate, NOW);
    expect(estimate.confidence).toBe('estimated');
  });

  it('an empty slot has nothing to assess', () => {
    expect(assessMetric(metric({ value: null, confidence: 'unknown' }), NOW)).toBeNull();
  });

  it('re-labelling twice does not stack the reason', () => {
    const row = metric({ asOf: null });
    settleMetric(row, NOW);
    row.confidence = 'verified';
    settleMetric(row, NOW);
    expect(row.methodNote!.match(/Not verified:/g)).toHaveLength(1);
  });
});

describe('assessedForDisplay: old snapshots assess lazily at read time', () => {
  it('assesses a stored figure that has no assessment, without mutating the stored row', () => {
    const stored = metric({ asOf: '2023-03-01' });
    expect(stored.assessment).toBeUndefined();
    const shown = assessedForDisplay(stored, NOW, 'openai.com');
    expect(shown.value).toBe(stored.value);
    expect(shown.confidence).toBe('estimated');
    expect(shown.assessment?.currency.status).toBe('stale');
    expect(shown.assessment?.assessedAt).toBeUndefined();
    expect(stored.confidence).toBe('verified');
    expect(stored.assessment).toBeUndefined();
  });

  it('keeps the period stated at acceptance once the support blocks are cleared', () => {
    const accepted = metric({ asOf: '2026-09-15' });
    settleMetric(accepted, NOW);
    accepted.reportedSupport = null;
    const shown = assessedForDisplay(accepted, NOW);
    expect(shown.confidence).toBe('verified');
    expect(shown.assessment?.currency.status).toBe('current');
  });

  it('a stored figure that ages past its horizon is relabelled on the next read', () => {
    const accepted = metric({ asOf: '2026-09-15' });
    settleMetric(accepted, NOW);
    const later = new Date('2028-01-01T00:00:00.000Z');
    expect(assessedForDisplay(accepted, later).confidence).toBe('estimated');
  });
});
