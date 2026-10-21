import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { CompanyMetric, FigureAssessment } from '@mi/contracts';
import { FreshnessMark, SourceCheck, figureCounts, figureCurrency, sourceCheckLines, staleFigureCount } from './SourceCheck';

type Patch = Partial<Omit<FigureAssessment, 'currency'>> & { currency?: Partial<FigureAssessment['currency']> };
export const assessment = ({ currency, ...patch }: Patch = {}): FigureAssessment => ({
  version: 1, assessedAt: '2026-10-20T12:00:00.000Z',
  currency: { asOf: '2026-09-04', asOfSource: 'figure', notAfter: null, notAfterSource: null, ageDays: 46, state: 'current', freshDays: 365, staleDays: 548, ...currency },
  relevance: { definition: 'employees', period: 'point_in_time', issues: [] },
  authority: { tier: 1, publisher: 'SEC', level: 'strong' },
  accuracy: { support: 'original_passage', independentSources: 2, corroboration: 'corroborated', plausibility: 'ok', newerObservation: null },
  purpose: { kind: 'regulatory_filing', reportedBy: 'regulator' },
  score: 100, verdict: 'strong', effect: 'none', summary: 'Dated 4 Sep 2026, current; from SEC',
  ...patch,
});
const fig = (a: FigureAssessment | null, patch: Partial<Pick<CompanyMetric, 'value' | 'confidence' | 'metricType'>> = {}) =>
  ({ value: 5, confidence: 'verified' as const, metricType: 'employees' as const, assessment: a, ...patch });

describe('Source check', () => {
  it('shows a one-line summary and the five plain-English lines', () => {
    render(<SourceCheck metric={fig(assessment())} label="Employees" />);
    const box = screen.getByLabelText('Source check for Employees');
    expect(box).toHaveTextContent('Source check: As of Sep 2026 (current)');
    expect(screen.getAllByRole('listitem').map((li) => li.textContent)).toEqual([
      'As of Sep 2026 (current)', 'SEC (regulator or official filing)', 'The figure is stated on a saved copy of the page',
      'Filed with a regulator', '2 independent sources agree',
    ]);
    expect(box.textContent).not.toMatch(/CRAAP/i);
  });
  it('says why a stale figure is out of date, with its date', () => {
    const a = assessment({ currency: { asOf: '2025-01-10', ageDays: 648, state: 'stale' } });
    expect(sourceCheckLines(fig(a), 'Employees')[0]).toBe('As of Jan 2025 (out of date for employees: 21 months)');
  });
  it('marks an estimate with est. and says when only the company reported it', () => {
    const a = assessment({ purpose: { kind: 'press_release', reportedBy: 'company' }, accuracy: { support: 'page_quote', independentSources: 1, corroboration: 'single', plausibility: 'ok', newerObservation: null } });
    render(<SourceCheck metric={fig(a, { confidence: 'estimated' })} label="Revenue" />);
    expect(screen.getByText('est.')).toBeInTheDocument();
    expect(screen.getByText('A press release (company-reported)')).toBeInTheDocument();
    expect(screen.getByText('One source, no independent confirmation')).toBeInTheDocument();
  });
  it('words an undated figure plainly', () => {
    const a = assessment({ currency: { asOf: null, asOfSource: 'none', ageDays: null, state: 'undated' } });
    expect(sourceCheckLines(fig(a), 'Revenue')[0]).toBe('No stated date: age unknown');
    render(<FreshnessMark metric={fig(a)} />);
    expect(screen.getByText('Undated')).toHaveAttribute('data-freshness', 'undated');
  });
  it('shows nothing without an assessment, a value, or for a human figure', () => {
    expect(sourceCheckLines(fig(null), 'Revenue')).toEqual([]);
    expect(sourceCheckLines(fig(assessment(), { value: null }), 'Revenue')).toEqual([]);
    expect(figureCurrency(fig(assessment(), { confidence: 'user_verified' }))).toBeNull();
  });
  it('counts figures by currency and names the oldest', () => {
    const stale = assessment({ currency: { asOf: '2024-03-01', state: 'stale', ageDays: 598 } });
    const undated = assessment({ currency: { asOf: null, asOfSource: 'none', state: 'undated', ageDays: null } });
    const rows = [fig(stale, { metricType: 'employees' }), fig(assessment()), fig(undated), fig(null), fig(stale, { confidence: 'user_verified' })];
    expect(staleFigureCount(rows)).toBe(2);
    expect(figureCounts(rows)).toEqual({ current: 1, outOfDate: 1, undated: 1, oldest: { label: 'employees', asOf: '2024-03-01' } });
  });
});
