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
      'As of Sep 2026 (current)', 'SEC: regulator or official filing', 'The figure is stated on a saved copy of the page',
      'Filed with a regulator', '2 independent sources agree',
    ]);
    expect(box.textContent).not.toMatch(/CRAAP/i);
  });
  it('says why a stale figure is out of date, with its date', () => {
    const a = assessment({ currency: { asOf: '2025-01-10', ageDays: 648, state: 'stale' } });
    expect(sourceCheckLines(fig(a), 'Employees')[0]).toBe('As of Jan 2025 (out of date for employees: 21 months)');
  });
  it('does not repeat est. and says when only the company reported it', () => {
    const a = assessment({ purpose: { kind: 'press_release', reportedBy: 'company' }, accuracy: { support: 'page_quote', independentSources: 1, corroboration: 'single', plausibility: 'ok', newerObservation: null } });
    render(<SourceCheck metric={fig(a, { confidence: 'estimated' })} label="Revenue" />);
    expect(screen.queryByText('est.')).toBeNull(); // the figure row beside it already says estimated
    expect(screen.getByText('A press release (company-reported)')).toBeInTheDocument();
    expect(screen.getByText('One source, no independent confirmation')).toBeInTheDocument();
  });
  it('words an undated figure plainly', () => {
    const a = assessment({ currency: { asOf: null, asOfSource: 'none', ageDays: null, state: 'undated' } });
    expect(sourceCheckLines(fig(a), 'Revenue')[0]).toBe('The source gives no date for this figure');
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

  describe('newer, less authoritative figure', () => {
    const withNewer = (newer: { value: number | null; asOf: string | null; publisher: string | null } | null, patch: Patch = {}) => {
      const base = assessment(patch);
      return { ...base, accuracy: { ...base.accuracy, newerObservation: newer } };
    };
    const SENTENCE = 'A newer figure exists: 1.3K, dated 2 Oct 2026, from Some Blog - a less authoritative source than the one shown.';

    it('names the newer figure in the Source check, on the card of the Metrics tab and the expanded list', () => {
      const a = withNewer({ value: 1300, asOf: '2026-10-02', publisher: 'Some Blog' });
      expect(sourceCheckLines(fig(a), 'Employees').at(-1)).toBe(SENTENCE);
      render(<SourceCheck metric={fig(a)} label="Employees" />);
      expect(screen.getByText(SENTENCE)).toBeInTheDocument();
    });
    it('adds nothing when there is no newer figure, and keeps the shown figure dated', () => {
      expect(sourceCheckLines(fig(assessment()), 'Employees')).toHaveLength(5);
      const stale = withNewer({ value: 1300, asOf: '2026-10-02', publisher: 'Some Blog' }, { currency: { asOf: '2025-01-10', ageDays: 648, state: 'stale' } });
      const lines = sourceCheckLines(fig(stale), 'Employees');
      expect(lines[0]).toBe('As of Jan 2025 (out of date for employees: 21 months)');
      expect(lines).toHaveLength(6);
    });
    it('says what is missing instead of inventing a date or publisher', () => {
      const a = withNewer({ value: 1300, asOf: null, publisher: null });
      expect(sourceCheckLines(fig(a), 'Employees').at(-1)).toBe(
        'A newer figure exists: 1.3K, no stated date, from an unnamed source - a less authoritative source than the one shown.');
    });
    it('shows the currency as reported and never converts', () => {
      const a = withNewer({ value: 9_000_000_000, asOf: '2026-10-02', publisher: 'Some Blog' });
      const euro = { ...fig(a, { metricType: 'revenue' }), methodNote: 'Reported in euros by the company' };
      const line = sourceCheckLines(euro, 'Revenue').at(-1)!;
      expect(line).toContain('€9');
      expect(line).toContain('(reported in euros; not converted)');
      expect(line).not.toContain('$');
    });
  });
});
