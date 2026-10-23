import { describe, expect, it } from 'vitest';
import { screen, within } from '@testing-library/react';
import type { Report, SiteAuditContent } from '@mi/contracts';
import { renderWithProviders } from '@/test/test-utils';
import { SiteAuditView, } from './SiteAuditView';
import { sortFixes } from './SiteAuditEvidence';

const report = { id: 'r1', kind: 'site_audit', title: 'Audit', createdAt: '2026-10-22T12:00:00Z', citations: [], markdown: '' } as unknown as Report;

const old: SiteAuditContent = {
  url: 'https://acme.example', siteName: 'Acme', overall: 62,
  scores: [{ area: 'cta', score: 6, verdict: 'One clear button.' }],
  working: [{ title: 'Clear headline', detail: 'Says what it sells.' }], missing: [], designStyle: { summary: '', notes: [] }, testFirst: [],
};

const v2: SiteAuditContent = {
  ...old, version: 2,
  criteria: [
    { area: 'cta', label: 'Primary call to action', weight: 25, score: 7, observable: true, scoredBy: 'model', verdict: 'Clear.',
      findings: [{ title: 'One main button', detail: '', quote: 'Start free trial', evidenceSource: 'page' }] },
    { area: 'trust', label: 'Trust and social proof', weight: 15, score: null, observable: false, scoredBy: 'model', verdict: '',
      findings: [{ title: 'Reviews', detail: '', notObservable: true }] },
  ],
  checklist: [
    { id: 'h1', area: 'value_proposition', label: 'One clear H1', status: 'pass', detail: 'H1: "Robots that ship"' },
    { id: 'form', area: 'friction', label: 'Short form', status: 'unknown', detail: 'The page could not be read for forms.' },
  ],
  fixes: [
    { title: 'Add reviews', detail: '', impact: 'medium', effort: 'high' },
    { title: 'Shorten the headline', detail: '', impact: 'high', effort: 'low' },
  ],
  confidence: { level: 'medium', coverage: 0.6, pageRead: true, note: 'Reviews could not be judged.' },
  droppedFindings: 2,
};

describe('Site audit view', () => {
  it('shows a weighted rubric with the page\'s own words, unscored criteria as not observable, the checklist and fixes by priority', () => {
    renderWithProviders(<SiteAuditView report={report} audit={v2} />);
    expect(screen.getByTestId('audit-confidence')).toHaveTextContent('60% of the rubric could be judged');
    expect(screen.getByTestId('audit-confidence')).toHaveTextContent('2 findings were removed');
    const rubric = screen.getByRole('region', { name: 'Rubric' });
    expect(within(rubric).getByText('“Start free trial”', { exact: false })).toBeInTheDocument();
    expect(within(rubric).getByText('Not observable from what was supplied, so it is not scored.')).toBeInTheDocument();
    expect(within(screen.getByRole('region', { name: 'Checklist' })).getByText('One clear H1')).toBeInTheDocument();
    const fixes = within(screen.getByRole('region', { name: 'Prioritised fixes' })).getAllByRole('heading', { level: 3 }).map((h) => h.textContent);
    expect(fixes).toEqual(['Shorten the headline', 'Add reviews']);
  });

  it('still renders an audit stored before the evidence-based rubric', () => {
    renderWithProviders(<SiteAuditView report={report} audit={old} />);
    expect(screen.getByText('Scorecard')).toBeInTheDocument();
    expect(screen.queryByTestId('audit-confidence')).not.toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'Rubric' })).not.toBeInTheDocument();
  });

  it('orders fixes by impact, then least effort', () => {
    const f = (impact: 'high' | 'medium' | 'low', effort: 'high' | 'medium' | 'low') => ({ title: `${impact}-${effort}`, detail: '', impact, effort });
    expect(sortFixes([f('low', 'low'), f('high', 'high'), f('high', 'low')]).map((x) => x.title)).toEqual(['high-low', 'high-high', 'low-low']);
  });
});
