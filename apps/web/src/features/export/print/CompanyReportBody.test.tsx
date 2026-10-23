import { describe, expect, it } from 'vitest';
import { screen } from '@testing-library/react';
import type { CompanyReport } from '@mi/contracts';
import { renderWithProviders } from '@/test/test-utils';
import { PrintDocument } from '../PrintDocument';

const report: CompanyReport = {
  companyId: 'cmp_a', companyName: 'Acme', generatedAt: '2026-10-22T12:00:00Z',
  headline: 'Acme sells warehouse robots on subscription', abstract: 'Acme builds robots for retailers.', abstractCitations: ['s1'],
  basedOn: { dataHash: 'h', sources: 1, notes: 0, tabs: 1, tabNames: ['overview'], figures: 1 }, status: 'ai',
  sections: [
    { id: 'executive_summary', title: 'Executive summary', blocks: [
      { type: 'paragraph', text: 'Acme leases robots.', citations: ['s1'] },
      { type: 'analyst_view', text: 'Leasing smooths revenue.', citations: [] },
    ] },
    { id: 'business_model', title: 'Business model & figures', blocks: [
      { type: 'figures', text: '', citations: [], figures: [{ metricType: 'valuation', label: 'Valuation', display: null, trust: 'unknown', asOf: null, citations: [] }] },
    ] },
  ],
  sources: [{ id: 's1', kind: 'web', title: 'Reuters', url: 'https://www.reuters.com/acme', excerpt: null, asOf: null }],
};

describe('the company report as a PDF', () => {
  it('opens on the Stratemark cover, keeps unknown figures unknown and lists numbered sources', () => {
    const { container } = renderWithProviders(<PrintDocument job={{ kind: 'companyReport', report, card: null }} />);
    expect(screen.getByTestId('print-cover')).toHaveTextContent('Stratemark');
    expect(screen.getByTestId('print-cover')).toHaveTextContent('Company report');
    const text = container.textContent ?? '';
    expect(text).toContain('Acme sells warehouse robots on subscription');
    expect(text).toContain('Analyst view.');
    expect(text).toMatch(/Valuation.*Unknown/);
    expect(text).toContain('Reuters');
  });
});
