import { describe, expect, it, vi } from 'vitest';
import { screen, within } from '@testing-library/react';
import type { CompanyReport, CompanyReportResult } from '@mi/contracts';
import { makeRepo, renderWithProviders } from '@/test/test-utils';
import { CompanyReportHero } from './CompanyReportHero';
import { CompanyReportView } from './CompanyReportView';
import { companyReportToMarkdown } from './reportModel';

const report: CompanyReport = {
  companyId: 'cmp_a',
  companyName: 'Acme',
  generatedAt: new Date().toISOString(),
  headline: 'Acme sells warehouse robots on subscription',
  abstract: 'Acme builds robots for retailers [x]. It leases them by the month.',
  abstractCitations: ['s2'],
  basedOn: { dataHash: 'h1', sources: 2, notes: 1, tabs: 2, tabNames: ['overview', 'history'], figures: 1 },
  status: 'ai',
  sections: [
    { id: 'executive_summary', title: 'Executive summary', blocks: [
      { type: 'paragraph', text: 'Acme leases robots to retailers.', citations: ['s1'] },
      { type: 'analyst_view', text: 'The subscription model should smooth revenue.', citations: [] },
    ] },
    { id: 'business_model', title: 'Business model & figures', blocks: [
      { type: 'figures', text: '', citations: [], figures: [
        { metricType: 'employees', label: 'Employees', display: '310', trust: 'verified', asOf: '2026-09', citations: ['s1'] },
        { metricType: 'valuation', label: 'Valuation', display: null, trust: 'unknown', asOf: null, citations: [] },
      ] },
    ] },
    { id: 'sources', title: 'Sources', blocks: [] },
  ],
  sources: [
    { id: 's1', kind: 'web', title: 'Reuters', url: 'https://www.reuters.com/acme', excerpt: 'Acme employs 310 people.', asOf: '2026-09-01' },
    { id: 's2', kind: 'note', title: 'Founder call notes', url: null, excerpt: null, asOf: null },
  ],
};

function repoWith(result: CompanyReportResult | null) {
  return Object.assign(makeRepo(), { peekCompanyReport: vi.fn(async () => result), getCompanyReport: vi.fn(async () => result!) });
}

describe('Company report hero', () => {
  it('shows the headline, the abstract and how fresh it is, with the way in', async () => {
    const onOpen = vi.fn();
    const { user } = renderWithProviders(<CompanyReportHero companyId="cmp_a" onOpen={onOpen} />, { repository: repoWith({ report, stale: false }) });
    expect(await screen.findByText('Acme sells warehouse robots on subscription')).toBeInTheDocument();
    expect(screen.getByText(/It leases them by the month/)).toBeInTheDocument();
    expect(screen.getByText(/based on 2 sources, 1 of your note/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /Read company report/ }));
    expect(onOpen).toHaveBeenCalled();
  });
});

describe('Company report view', () => {
  it('writes sections with numbered sources, labels commentary, and shows unknown figures as not found', async () => {
    renderWithProviders(<CompanyReportView companyId="cmp_a" onClose={() => undefined} />, { repository: repoWith({ report, stale: false }) });
    expect(await screen.findByRole('heading', { level: 1, name: report.headline })).toBeInTheDocument();
    expect(screen.getByText('Analyst view')).toBeInTheDocument();
    const exec = screen.getByRole('region', { name: 'Executive summary' });
    expect(within(exec).getByRole('link', { name: 'Source 2' })).toHaveAttribute('href', '#report-src-2');
    const figures = screen.getByRole('region', { name: 'Business model & figures' });
    expect(within(figures).getByText('310')).toBeInTheDocument();
    expect(within(figures).getByText('Not found yet')).toBeInTheDocument();
    const sources = screen.getByRole('region', { name: 'Sources' });
    expect(within(sources).getByRole('link', { name: 'Reuters' })).toHaveAttribute('href', 'https://www.reuters.com/acme');
    expect(within(sources).getByText(/not independently verified/)).toBeInTheDocument();
  });

  it('says when the research has moved on, and never spends without a key', async () => {
    renderWithProviders(<CompanyReportView companyId="cmp_a" onClose={() => undefined} />, { repository: repoWith({ report, stale: true }) });
    expect(await screen.findByText('Research has changed since this was written')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Update report' })).toBeDisabled();
  });

  it('labels a report built without a model', async () => {
    renderWithProviders(<CompanyReportView companyId="cmp_a" onClose={() => undefined} />, { repository: repoWith({ report: { ...report, status: 'stored_data' }, stale: false }) });
    expect(await screen.findByText('Assembled from stored research, no AI commentary')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Write with AI' })).toBeInTheDocument();
  });
});

describe('Company report as markdown (what a share link carries)', () => {
  it('keeps numbered citations, labels analyst commentary and lists the sources', () => {
    const md = companyReportToMarkdown(report);
    expect(md).toContain('## Executive summary');
    expect(md).toContain('Acme leases robots to retailers. [2]');
    expect(md).toContain('> **Analyst view.**');
    expect(md).toContain('- Valuation: Not found yet');
    expect(md).toMatch(/2\. Reuters .*https:\/\/www\.reuters\.com\/acme/);
    expect(md).toMatch(/your own note, not independently verified/);
  });
});
