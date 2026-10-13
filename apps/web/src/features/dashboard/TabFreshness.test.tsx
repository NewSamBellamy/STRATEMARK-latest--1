import { describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';
import type { DashboardTab } from '@mi/contracts';
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
