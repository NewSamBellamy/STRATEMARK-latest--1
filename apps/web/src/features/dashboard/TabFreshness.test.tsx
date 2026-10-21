import { describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';
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
      assessment: { currency: { status, ageMonths: status === 'undated' ? null : 20, horizonMonths: 12, basis: 'publishedDate' as const, date: status === 'undated' ? null : '2025-01' },
        authority: { tier: 'primary' as const, reason: 'SEC filing' }, purpose: 'regulatory_filing' as const, independentSources: 1,
        companyReportedOnly: false, grade: 'weak' as const, plainEnglish: ['x', 'y'] },
    });
    const facts = [make('stale'), make('undated'), make('current'), make('stale', 'user_verified')];
    const repository = Object.assign(makeRepo(), {
      getCompanyFacts: vi.fn(async () => facts),
      getDashboardTab: vi.fn(async () => ({ companyId: 'cmp_1', tab: 'overview', content: { markdown: '' }, citations: [], lastRefreshedAt: '2026-10-12T09:00:00.000Z' })),
    });
    renderWithProviders(<Filled tab="overview" onRefresh={vi.fn()} />, { repository });
    expect(await screen.findByText(/2 figures older than usual/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Refresh/ })).toBeInTheDocument();
  });

  it('says nothing about figures when none are old', async () => {
    show('overview', '2026-10-12T09:00:00.000Z');
    await screen.findByText('Researched 3h ago');
    expect(screen.queryByText(/older than usual/)).not.toBeInTheDocument();
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
