import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { CompanyMetric, SourceAssessment } from '@mi/contracts';
import { FreshnessMark, SourceCheck, figureCurrency, sourceCheckLines, staleFigureCount } from './SourceCheck';

const assessment = (patch: Partial<SourceAssessment> = {}, currency: Partial<SourceAssessment['currency']> = {}): SourceAssessment => ({
  currency: { status: 'current', ageMonths: 2, horizonMonths: 12, basis: 'publishedDate', date: '2026-03-04', ...currency },
  authority: { tier: 'primary', reason: 'SEC filing' },
  purpose: 'regulatory_filing', independentSources: 2, companyReportedOnly: false, grade: 'strong',
  plainEnglish: ['Published Mar 2026 (current)', 'SEC filing (primary source)', '2 independent sources'],
  ...patch,
});
const fig = (a: SourceAssessment | null, patch: Partial<Pick<CompanyMetric, 'value' | 'confidence'>> = {}) =>
  ({ value: 5, confidence: 'verified' as const, assessment: a, ...patch });

describe('Source check', () => {
  it('renders the assessment lines from a fixture', () => {
    render(<SourceCheck metric={fig(assessment())} label="Revenue" />);
    expect(screen.getByLabelText('Source check for Revenue')).toHaveTextContent(
      'Source check: Published Mar 2026 (current) · SEC filing (primary source) · 2 independent sources');
  });
  it('says why a stale figure is old, with its date', () => {
    const a = assessment({ plainEnglish: ['Published Jan 2025 (stale: 18 months old)', 'Established newspaper (established publisher)', 'No independent corroboration'] },
      { status: 'stale', ageMonths: 18.4, date: '2025-01' });
    expect(sourceCheckLines(fig(a), 'Employees')[0]).toBe('Published Jan 2025 (older than usual for employees: 18 months)');
  });
  it('marks an estimate with est. and says when only the company reported it', () => {
    const a = assessment({ independentSources: 0, companyReportedOnly: true, plainEnglish: ['Published Mar 2026 (current)', 'Company site (company-issued)', 'Company-reported only'] });
    render(<SourceCheck metric={fig(a, { confidence: 'estimated' })} label="Revenue" />);
    expect(screen.getByText('est.')).toBeInTheDocument();
    expect(screen.getByLabelText('Source check for Revenue')).toHaveTextContent('Company-reported only');
  });
  it('words an undated figure plainly', () => {
    const a = assessment({ plainEnglish: ['No publication date: age unknown', 'x (y)'] }, { status: 'undated', ageMonths: null, basis: 'none', date: null });
    expect(sourceCheckLines(fig(a), 'Revenue')[0]).toBe('No publication date: age unknown');
    render(<FreshnessMark metric={fig(a)} />);
    expect(screen.getByText('Undated')).toHaveAttribute('data-freshness', 'undated');
  });
  it('shows nothing without an assessment, a value, or for a human figure', () => {
    expect(sourceCheckLines(fig(null), 'Revenue')).toEqual([]);
    expect(sourceCheckLines(fig(assessment(), { value: null }), 'Revenue')).toEqual([]);
    expect(figureCurrency(fig(assessment(), { confidence: 'user_verified' }))).toBeNull();
  });
  it('counts stale and undated figures only', () => {
    const stale = assessment({}, { status: 'stale', ageMonths: 20 });
    expect(staleFigureCount([fig(stale), fig(assessment()), fig(null), fig(stale, { confidence: 'user_verified' })])).toBe(1);
  });
});
