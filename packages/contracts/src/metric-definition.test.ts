import { describe, expect, it } from 'vitest';
import { companyMetricSchema } from './schemas';
import { applyMetricVerification, currentMetricRevision } from './metric-verification';
import { reconcileMetric } from './provenance';
import type { CompanyMetric } from './types';

const proof = { sourceUrl: 'https://sec.gov/report', quote: 'Acme reports 120 users as of 2026-10-01.',
  asOf: '2026-10-01', basis: 'users' as const, unit: 'count' as const, definition: 'users' as const };
const metric: CompanyMetric = { id: 'a', companyId: 'cmp', metricType: 'users', value: 120, confidence: 'verified',
  source: proof.sourceUrl, citations: [{ title: 'Original', url: proof.sourceUrl }], methodNote: null,
  capturedAt: '2026-10-02T00:00:00.000Z', passageSupport: proof };
describe('measurement identity survives storage and revision handling', () => {
  it.each(['definition', 'reporting-date'] as const)('does not treat equal values with a different %s as agreeing', change => {
    const other: CompanyMetric = { ...metric, id: 'b', passageSupport: change === 'definition'
      ? { ...proof, definition: 'customers' } : { ...proof, asOf: '2026-09-30' } };
    expect(currentMetricRevision([metric, other], 'cmp', 'users')!.ambiguous).toBe(true);
    expect(currentMetricRevision([other, metric], 'cmp', 'users')!.ambiguous).toBe(true);
    const saved = companyMetricSchema.parse(reconcileMetric(metric, other));
    expect(saved.conflicts).toHaveLength(1);
    expect(saved.conflicts![0]!.observations.map(row => row.passageSupport)).toEqual([metric.passageSupport, other.passageSupport]);
  });
  it('invalidates cached interpretations when the value is unchanged but its measured population changes', () => {
    const result = applyMetricVerification(metric, { verdict: 'supported', currentValue: 120, rationale: 'New source',
      methodNote: 'Paying customers, not total users', passageSupport: { ...proof, definition: 'paying_customers' } },
    metric.citations, '2026-10-03T00:00:00.000Z');
    expect(result.changed).toBe(true);
    expect(result.metric.methodNote).toBe('Paying customers, not total users');
    expect(result.metric.capturedAt).toBe('2026-10-03T00:00:00.000Z');
    expect(metric.methodNote).toBeNull();
  });
  it('preserves human corrections against automated changes of measurement', () => {
    const result = applyMetricVerification({ ...metric, confidence: 'user_verified' }, { verdict: 'supported', currentValue: 120,
      rationale: 'New source', methodNote: 'Customers', passageSupport: { ...proof, definition: 'customers' } }, metric.citations, metric.capturedAt);
    expect(result.changed).toBe(false);
    expect(result.metric.passageSupport).toEqual(proof);
    expect(result.metric.confidence).toBe('user_verified');
  });
});
