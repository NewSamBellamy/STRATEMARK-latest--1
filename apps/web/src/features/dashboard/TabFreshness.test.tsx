import { describe, expect, it, vi } from 'vitest';
import { screen, within } from '@testing-library/react';
import { BackgroundResearchControl } from '@/lib/living/BackgroundResearchControl';
import type { DashboardTab } from '@mi/contracts';
import { buildDataset } from '@mi/mocks';
import { useDashboardTab } from '@/hooks/data';
import { makeRepo, renderWithProviders } from '@/test/test-utils';
import { TabFreshness } from './TabFreshness';

const NOW = Date.parse('2026-10-12T12:00:00.000Z');

function Filled({ tab, ...props }: { tab: DashboardTab; onRefresh: () => void; refreshing?: boolean; disabled?: boolean }) {
  // The tab itself fills the shared cache, as it does under the dashboard page.
  useDashboardTab('cmp_1', tab);
  return <TabFreshness companyId="cmp_1" tab={tab} refreshing={props.refreshing ?? false} disabled={props.disabled ?? false} onRefresh={props.onRefresh} now={NOW} />;
}

function show(tab: DashboardTab, refreshedAt: string | null, props: { refreshing?: boolean; disabled?: boolean; onRefresh?: () => void } = {}) {
  const repository = Object.assign(makeRepo(), {
    getDashboardTab: vi.fn(async () => (refreshedAt
      ? { companyId: 'cmp_1', tab, content: { markdown: '' }, citations: [], lastRefreshedAt: refreshedAt } : null)),
  });
  const onRefresh = props.onRefresh ?? vi.fn();
  return { onRefresh, ...renderWithProviders(<Filled tab={tab} {...props} onRefresh={onRefresh} />, { repository }) };
}

describe('tab freshness', () => {
  it('says how old the research is and refreshes on request', async () => {
    const { user, onRefresh } = show('overview', '2026-10-12T09:00:00.000Z');
    expect(await screen.findByText('Researched 3h ago')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /Refresh/ }));
    expect(onRefresh).toHaveBeenCalledTimes(1);
  });

  it('puts the freshness text, Refresh and the pause icon in one row', async () => {
    const repository = Object.assign(makeRepo(), {
      getDashboardTab: vi.fn(async () => ({ companyId: 'cmp_1', tab: 'overview' as const, content: { markdown: '' }, citations: [], lastRefreshedAt: '2026-08-01T00:00:00.000Z' })),
    });
    function WithControl() {
      useDashboardTab('cmp_1', 'overview');
      return <TabFreshness companyId="cmp_1" tab="overview" refreshing={false} disabled={false} onRefresh={vi.fn()} now={NOW}
        control={<BackgroundResearchControl />} />;
    }
    renderWithProviders(<WithControl />, { repository });
    await screen.findByText(/over a month old/);
    const row = screen.getByTestId('freshness-row');
    expect(screen.getAllByTestId('freshness-row')).toHaveLength(1);
    expect(row).toHaveTextContent(/Researched .*over a month old/);
    expect(within(row).getByRole('button', { name: /Refresh/ })).toBeInTheDocument();
    const pause = within(row).getByRole('button', { name: 'Pause background research' });
    expect(pause).toHaveAttribute('title', expect.stringContaining('Background research is on'));
    expect(pause).not.toHaveTextContent(/\S/);
  });

  it('keeps the pause icon on a tab with no freshness line', async () => {
    const repository = Object.assign(makeRepo(), { getDashboardTab: vi.fn(async () => null) });
    renderWithProviders(<TabFreshness companyId="cmp_1" tab="live_intel" refreshing={false} disabled={false} onRefresh={vi.fn()}
      control={<BackgroundResearchControl />} />, { repository });
    const row = await screen.findByTestId('freshness-row');
    expect(within(row).getByRole('button', { name: 'Pause background research' })).toBeInTheDocument();
    expect(within(row).queryByText(/Researched/)).not.toBeInTheDocument();
  });

  it('names research over a month old', async () => {
    show('team_org', '2026-08-01T00:00:00.000Z');
    expect(await screen.findByText(/over a month old/)).toBeInTheDocument();
  });

  it('says how many stored figures are older than usual, next to the Refresh action', async () => {
    const TYPES = ['employees', 'revenue', 'users', 'valuation'] as const;
    let n = 0;
    const make = (status: 'stale' | 'undated' | 'current', confidence: 'verified' | 'user_verified' = 'verified') => ({
      ...buildDataset().metrics[0]!, id: `m_${n}`, metricType: TYPES[n++]!, value: 10, confidence, source: 'https://sec.gov/x',
      citations: [{ title: 'SEC filing', url: 'https://sec.gov/x', credibility: 'primary' as const }],
      assessment: { version: 1 as const, assessedAt: '2026-10-20T12:00:00.000Z',
        currency: { asOf: status === 'undated' ? null : status === 'stale' ? `2025-0${n}-10` : '2026-09-10', asOfSource: status === 'undated' ? 'none' as const : 'figure' as const,
          notAfter: null, notAfterSource: null, ageDays: status === 'undated' ? null : 600, state: status, freshDays: 365, staleDays: 548 },
        relevance: { definition: null, period: 'point_in_time' as const, issues: [] },
        authority: { tier: 1, publisher: 'SEC filing', level: 'strong' as const },
        accuracy: { support: 'original_passage' as const, independentSources: 1, corroboration: 'single' as const, plausibility: 'ok' as const, newerObservation: null },
        purpose: { kind: 'regulatory_filing' as const, reportedBy: 'regulator' as const },
        score: 60, verdict: 'fair' as const, effect: 'none' as const, summary: 'x' },
    });
    const facts = [make('stale'), make('undated'), make('current'), make('stale', 'user_verified')];
    const repository = Object.assign(makeRepo(), {
      getCompanyFacts: vi.fn(async () => facts),
      getDashboardTab: vi.fn(async () => ({ companyId: 'cmp_1', tab: 'overview', content: { markdown: '' }, citations: [], lastRefreshedAt: '2026-10-12T09:00:00.000Z' })),
    });
    renderWithProviders(<Filled tab="overview" onRefresh={vi.fn()} />, { repository });
    expect(await screen.findByText(/Figures: 1 current, 1 out of date, 1 undated · oldest: Employees, Jan 2025/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Refresh/ })).toBeInTheDocument();
  });

  it('says nothing about figures when none are old', async () => {
    show('overview', '2026-10-12T09:00:00.000Z');
    await screen.findByText('Researched 3h ago');
    expect(screen.queryByText(/out of date/)).not.toBeInTheDocument();
  });

  it('cannot refresh without a key, or while it is already refreshing', async () => {
    show('history', '2026-10-12T09:00:00.000Z', { disabled: true });
    expect(await screen.findByRole('button', { name: /Refresh/ })).toBeDisabled();
  });

  it('shows nothing for a tab that has no research yet, or one with its own refresh', async () => {
    show('overview', null);
    show('live_intel', '2026-10-12T09:00:00.000Z');
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(screen.queryByRole('button', { name: /Refresh/ })).not.toBeInTheDocument();
  });
});
