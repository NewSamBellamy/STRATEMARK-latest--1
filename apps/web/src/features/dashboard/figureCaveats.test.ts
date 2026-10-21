import { describe, expect, it } from 'vitest';
import type { CompanyMetric } from '@mi/contracts';
import { figureCaveats, rowDates } from './figureCaveats';

const metric = (patch: Partial<CompanyMetric> = {}): CompanyMetric => ({
  id: 'm', companyId: 'c', metricType: 'valuation', value: 11.7e9, confidence: 'verified', source: null, citations: [],
  methodNote: null, capturedAt: '2026-07-30T15:11:40.256Z', ...patch,
}) as CompanyMetric;

describe('figure group caveats', () => {
  it('says once what is true of every figure: no dates, all captured the same day', () => {
    const group = figureCaveats([metric({ id: 'a' }), metric({ id: 'b', metricType: 'employees', value: 350 })]);
    expect(group.noPeriod).toBe(true);
    expect(group.line).toBe('Sources give no dates for these figures; all captured 30 Jul 2026.');
  });

  it('is not a group with fewer than two known figures (nothing repeats)', () => {
    expect(figureCaveats([metric()]).line).toBeNull();
    expect(figureCaveats([metric(), metric({ id: 'b', value: null, confidence: 'unknown' })]).line).toBeNull();
  });

  it('claims nothing about dates when any figure has a stated one, and keeps its own period', () => {
    const dated = metric({ id: 'b', metricType: 'employees', value: 350, reportedSupport: { asOf: '2026-03-01' } as CompanyMetric['reportedSupport'] });
    const group = figureCaveats([metric({ id: 'a' }), dated]);
    expect(group.noPeriod).toBe(false);
    expect(group.line).toBe('All captured 30 Jul 2026.');
    expect(rowDates(metric({ id: 'a' }), group).notReported).toBe(true);
    expect(rowDates(dated, group).period).toBe('1 Mar 2026');
  });

  it('says only the dates part when captured days differ', () => {
    const mixed = figureCaveats([metric({ id: 'a' }), metric({ id: 'b', capturedAt: '2026-08-02T10:00:00.000Z' })]);
    expect(mixed.record).toBeNull();
    expect(mixed.line).toBe('Sources give no dates for these figures.');
  });

  it('leaves a per-figure record only where it differs from the group', () => {
    const odd = metric({ id: 'b', capturedAt: '2026-08-02T10:00:00.000Z' });
    const group = figureCaveats([metric({ id: 'a' }), metric({ id: 'c' }), odd]);
    expect(group.record).toBeNull();
    const same = figureCaveats([metric({ id: 'a' }), metric({ id: 'c' })]);
    expect(rowDates(metric({ id: 'a' }), same)).toEqual({ period: null, notReported: false, record: null });
    expect(rowDates(odd, same)).toEqual({ period: null, notReported: false, record: 'captured 2 Aug 2026' });
  });

  it('keeps "Period not reported" on a row when the group did not already say it', () => {
    expect(rowDates(metric(), { noPeriod: false, record: null, line: null }).notReported).toBe(true);
  });
});
