import { describe, expect, it, vi } from 'vitest';
import { screen, within } from '@testing-library/react';
import { buildDataset } from '@mi/mocks';
import type { CompanyMetric } from '@mi/contracts';
import { makeRepo, renderWithProviders } from '@/test/test-utils';
import { MetricsTab, dropRestatedRevenue } from './MetricsTab';
import { OverviewTab } from './OverviewTab';

const seed = buildDataset().metrics[0]!;
function show(patch: Partial<CompanyMetric>, overview = false) {
  const metric: CompanyMetric = { ...seed, metricType: 'employees', value: 123,
    confidence: 'verified', source: null, citations: [], ...patch };
  const repository = Object.assign(makeRepo(), {
    getCompanyMetrics: vi.fn().mockResolvedValue([metric]),
    getDashboardTab: vi.fn().mockResolvedValue(overview ? { companyId: metric.companyId, tab: 'overview', content: { markdown: 'Source-reported overview.' }, citations: [] } : null),
  });
  renderWithProviders(overview ? <OverviewTab companyId={metric.companyId} /> : <MetricsTab companyId={metric.companyId} />, { repository });
  return metric;
}

describe('dashboard metric evidence projection', () => {
  it.each([false, true])('preserves annual revenue rather than relabeling it ARR (overview: %s)', async overview => {
    show({ metricType: 'arr', value: 331839000000, confidence: 'verified',
      source: 'https://data.sec.gov/report', citations: [{ title: 'SEC filing', url: 'https://data.sec.gov/report' }],
      passageSupport: { sourceUrl: 'https://data.sec.gov/report', quote: 'Retained annual observation.',
        basis: 'arr', unit: 'USD', definition: 'annual_revenue', asOf: '2026-06-30', periodStart: '2025-07-01' },
    }, overview);
    expect((await screen.findAllByText('Annual revenue')).length).toBeGreaterThan(0);
    expect(screen.queryByText('ARR', { exact: true })).not.toBeInTheDocument();
    expect(screen.queryByTitle('Where this value sits on the T1–T8 signal band')).not.toBeInTheDocument();
  });
  it('makes the retained evidence failure available on the existing Unknown badge', async () => {
    show({ value: null, confidence: 'unknown', methodNote: 'Original source could not be read. Try an accessible original publisher.' });
    await screen.findByRole('button', { name: 'Correct Employees' });
    expect(screen.getByLabelText('Confidence: Unknown. Original source could not be read. Try an accessible original publisher.')).toBeInTheDocument();
    expect(screen.queryByText('123')).not.toBeInTheDocument();
  });
  it('lists found figures once, in the table, with no repeated headline strip', async () => {
    show({ confidence: 'estimated' });
    const table = await screen.findByRole('table');
    expect(within(table).getByText('Employees')).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'Company headline metrics' })).not.toBeInTheDocument();
  });
  it('shows the stored source check under the figure, with why a stale one is old', async () => {
    show({ source: 'https://sec.gov/Archives/report', citations: [{ title: 'Filing', url: 'https://sec.gov/Archives/report', credibility: 'primary' }],
      assessment: {
        version: 1, assessedAt: '2026-10-20T12:00:00.000Z',
        currency: { asOf: '2025-04-10', asOfSource: 'figure', notAfter: null, notAfterSource: null, ageDays: 558, state: 'stale', freshDays: 365, staleDays: 548 },
        relevance: { definition: 'employees', period: 'point_in_time', issues: [] }, authority: { tier: 1, publisher: 'SEC filing', level: 'strong' },
        accuracy: { support: 'original_passage', independentSources: 1, corroboration: 'single', plausibility: 'ok', newerObservation: null },
        purpose: { kind: 'regulatory_filing', reportedBy: 'regulator' }, score: 65, verdict: 'fair', effect: 'none', summary: 'x',
      } });
    const table = await screen.findByRole('table');
    const checks = within(table).getAllByLabelText('Source check for Employees');
    expect(checks[0]).toHaveTextContent('Source check: As of Apr 2025 (out of date for employees: 18 months)');
    expect(checks[0]).toHaveTextContent('One source, no independent confirmation');
    expect(within(table).getByText('123')).toBeInTheDocument();
  });
  it('does not label unsupported legacy figures as verified when cards reject them', async () => {
    const metric = show({ source: 'https://reuters.com.attacker.test/figure',
      citations: [{ title: 'Reuters', url: 'https://reuters.com.attacker.test/figure', credibility: 'primary' }] });
    await screen.findByRole('button', { name: 'Correct Employees' });
    expect(screen.queryByText('Verified')).not.toBeInTheDocument();
    expect(screen.getAllByText('Estimated').length).toBeGreaterThan(0);
    expect(metric.confidence).toBe('verified');
  });
  it.each([
    { metricType: 'employees' as const, value: -5 },
    { metricType: 'users' as const, value: 0 },
  ])('keeps invalid or unestablished figures unknown: %j', async patch => {
    show({ ...patch, source: 'https://sec.gov/Archives/report',
      citations: [{ title: 'Filing', url: 'https://sec.gov/Archives/report', credibility: 'primary' }] });
    expect((await screen.findAllByText('Unknown')).length).toBeGreaterThan(0);
    expect(screen.queryByText('Verified')).not.toBeInTheDocument();
  });

  it('shows a labelled gap with what would fill it for sparse companies, never a zero', async () => {
    show({ value: null, confidence: 'unknown' });
    await screen.findByRole('button', { name: 'Correct Employees' });
    expect(screen.getAllByText(/What would fill this/).length).toBeGreaterThan(0);
    expect(screen.getAllByText('Unknown').length).toBeGreaterThan(1);
    expect(screen.queryByText('0')).not.toBeInTheDocument();
  });
  it('keeps missing figures out of the table and opens what would fill one when selected', async () => {
    const { user } = (() => {
      const metrics = [
        { ...seed, id: 'm1', metricType: 'employees' as const, value: 120, confidence: 'estimated' as const, source: null, citations: [] },
        { ...seed, id: 'm2', metricType: 'valuation' as const, value: 5e9, confidence: 'estimated' as const, source: null, citations: [] },
      ];
      const repository = Object.assign(makeRepo(), {
        getCompanyMetrics: vi.fn().mockResolvedValue(metrics),
        getDashboardTab: vi.fn().mockResolvedValue(null),
      });
      return renderWithProviders(<MetricsTab companyId={seed.companyId} />, { repository });
    })();
    const table = await screen.findByRole('table');
    expect(within(table).getByText('Employees')).toBeInTheDocument();
    expect(within(table).queryByText('Unknown')).not.toBeInTheDocument();
    await user.click(within(table).getByText('Valuation'));
    expect(screen.getByRole('complementary', { name: 'Valuation detail' })).toBeInTheDocument();
    expect(screen.getByText(/Open this company from its deck to compare/)).toBeInTheDocument();
    const gap = screen.getByText('Not found yet:').parentElement!;
    await user.click(within(gap).getAllByRole('button')[0]!);
    expect(screen.getAllByText(/What would fill this/).length).toBeGreaterThan(0);
  });
  it('never claims a source for a figure that has no link', async () => {
    show({ confidence: 'estimated' });
    const table = await screen.findByRole('table');
    expect(within(table).getByText('No link recorded')).toBeInTheDocument();
    expect(within(table).getByText('Estimated')).toBeInTheDocument();
    expect(within(table).queryByText('Reported')).not.toBeInTheDocument();
    expect(screen.queryByText(/each with its source/)).not.toBeInTheDocument();
    expect(screen.getByText(/1 without a source link yet/)).toBeInTheDocument();
  });
  it('says every found figure has its source only when each one links to it', async () => {
    show({ confidence: 'estimated', source: 'https://sec.gov/Archives/report',
      citations: [{ title: 'Filing', url: 'https://sec.gov/Archives/report', credibility: 'primary' }] });
    expect(await screen.findByText(/each with its source/)).toBeInTheDocument();
  });
  it('never links an expiring grounding redirect directly', async () => {
    const redirect = 'https://vertexaisearch.cloud.google.com/grounding-api-redirect/AUZIYQabc';
    show({ confidence: 'estimated', source: redirect, citations: [{ title: 'reuters.com', url: redirect }] });
    await screen.findByRole('table');
    const links = screen.getAllByRole('link').map((a) => a.getAttribute('href') ?? '');
    expect(links.some((href) => href.startsWith('https://www.google.com/search?q='))).toBe(true);
    expect(links.some((href) => href.includes('vertexaisearch'))).toBe(false);
  });
  it.each([
    { quarters: [{ period: '2025-09-30', value: 7.7e10 }, { period: '2025-12-31', value: 8.1e10 }], shown: true },
    { quarters: [{ period: '2025-12-31', value: 8.1e10 }], shown: false },
    { quarters: undefined, shown: false },
  ])('charts quarterly revenue only from two or more filed quarters (%#)', async ({ quarters, shown }) => {
    const content = { revenue: [], users: [], churn: [], nps: [], capTable: [], ...(quarters ? { revenueQuarterly: quarters } : {}) };
    const repository = Object.assign(makeRepo(), {
      getCompanyMetrics: vi.fn().mockResolvedValue([{ ...seed, metricType: 'employees', value: 120, confidence: 'estimated', source: null, citations: [] }]),
      getDashboardTab: vi.fn().mockResolvedValue({ companyId: seed.companyId, tab: 'metrics', content, citations: [] }),
    });
    renderWithProviders(<MetricsTab companyId={seed.companyId} />, { repository });
    await screen.findByRole('table');
    if (shown) expect(await screen.findByText('Quarterly revenue')).toBeInTheDocument();
    else expect(screen.queryByText('Quarterly revenue')).not.toBeInTheDocument();
  });
  it('sorts found figures by value when a header is clicked', async () => {
    const metrics = [
      { ...seed, id: 'm1', metricType: 'employees' as const, value: 120, confidence: 'estimated' as const, source: null, citations: [] },
      { ...seed, id: 'm2', metricType: 'valuation' as const, value: 5e9, confidence: 'estimated' as const, source: null, citations: [] },
    ];
    const repository = Object.assign(makeRepo(), {
      getCompanyMetrics: vi.fn().mockResolvedValue(metrics),
      getDashboardTab: vi.fn().mockResolvedValue(null),
    });
    const { user } = renderWithProviders(<MetricsTab companyId={seed.companyId} />, { repository });
    const table = await screen.findByRole('table');
    await user.click(within(table).getByRole('button', { name: /Value/ }));
    const rows = within(table).getAllByRole('row').slice(1).map((r) => r.textContent ?? '');
    expect(rows[0]).toMatch(/Valuation/);
    expect(rows[1]).toMatch(/Employees/);
    expect(rows).toHaveLength(2);
  });
});

describe('dropRestatedRevenue', () => {
  const row = (patch: Partial<CompanyMetric>): CompanyMetric => ({ ...seed, source: null, citations: [], ...patch });
  const sec = row({ id: 'sec', metricType: 'arr', value: 1_203_500_000, confidence: 'verified',
    passageSupport: { sourceUrl: 'https://data.sec.gov/r', quote: 'q', basis: 'arr', unit: 'USD', definition: 'annual_revenue', asOf: '2025-12-31', periodStart: '2025-01-01' } });
  const reported = row({ id: 'rep', metricType: 'revenue', value: 1_200_000_000, confidence: 'estimated' });

  it('keeps the filed figure when a search-reported revenue says the same thing', () => {
    expect(dropRestatedRevenue([reported, sec]).map((m) => m.id)).toEqual(['sec']);
  });
  it('keeps the better-evidenced row whichever way round they arrive', () => {
    expect(dropRestatedRevenue([sec, reported]).map((m) => m.id)).toEqual(['sec']);
    expect(dropRestatedRevenue([{ ...reported, confidence: 'verified' }, { ...sec, confidence: 'estimated' }]).map((m) => m.id)).toEqual(['rep']);
  });
  it('shows both rows when the two figures disagree: that disagreement is information', () => {
    const different = { ...reported, value: 900_000_000 };
    expect(dropRestatedRevenue([different, sec]).map((m) => m.id)).toEqual(['rep', 'sec']);
  });
  it('touches nothing when only one of them is known', () => {
    expect(dropRestatedRevenue([sec])).toEqual([sec]);
    expect(dropRestatedRevenue([{ ...reported, value: null, confidence: 'unknown' }, sec]).map((m) => m.id)).toEqual(['rep', 'sec']);
  });
});

describe('distribution rows say what they count', () => {
  it('labels a country count "Countries" in the table, like the card, not a bare "Distribution 21"', async () => {
    show({ metricType: 'distribution', value: 21, confidence: 'estimated', source: 'https://investors.example.com/',
      methodNote: 'Source reported distribution (as of 2026-08-31); provider-grounded, not verified against an original. Source statement: "Tennant operates in 21 countries."' });
    expect((await screen.findAllByText('Countries')).length).toBeGreaterThan(0);
    expect(screen.queryByText('Distribution', { exact: true })).not.toBeInTheDocument();
  });
  it('does so for a stored figure whose definition is "distribution" and whose sentence says countries (Tennant: "21 countries")', async () => {
    show({ metricType: 'distribution', value: 21, confidence: 'estimated', source: 'https://investors.example.com/',
      methodNote: 'Source reported distribution (as of 2026-08-31); provider-grounded, not verified against an original.',
      reportedSupport: { provider: 'google-search', companyName: 'Tennant Company', basis: 'distribution', value: 21, unit: 'count', asOf: '2026-08-31', definition: 'distribution',
        support: { supportIndex: 0, text: 'Tennant Company sells products directly in more than 21 countries.', sources: [{ chunkIndex: 0, url: 'https://investors.example.com/', title: 'Investors' }] } } });
    expect((await screen.findAllByText('Countries')).length).toBeGreaterThan(0);
    expect(screen.queryByText('Distribution', { exact: true })).not.toBeInTheDocument();
  });
  it('keeps "Distribution" when the source never says what is counted', async () => {
    show({ metricType: 'distribution', value: 21, confidence: 'estimated', source: 'https://investors.example.com/', methodNote: 'Source reported distribution.' });
    expect((await screen.findAllByText('Distribution')).length).toBeGreaterThan(0);
  });
});
