import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, screen, waitFor } from '@testing-library/react';
import { DASHBOARD_TAB_LABELS, type DashboardTab } from '@mi/contracts';
import { AppRoutes } from '@/routes';
import { makeRepo, renderWithProviders } from '@/test/test-utils';
import { useApiKey } from '@/lib/settings/apiKey';

afterEach(() => act(() => useApiKey.setState({ hasKey: false, apiKey: '' })));

describe('company workspace cached-navigation journey', () => {
  it('keeps the overview and stored figures visible, visits every missing section for free, then researches explicitly', async () => {
    useApiKey.setState({ hasKey: false, apiKey: '' });
    const repository = makeRepo();
    const market = (await repository.listMarkets())[0]!;
    const deck = (await repository.getDeckByMarket(market.id))!;
    const card = (await repository.listCards(deck.id)).find((item) => item.company)!;
    const company = card.company!;
    const read = vi.spyOn(repository, 'getDashboardTab').mockResolvedValue(null);
    const { user } = renderWithProviders(<AppRoutes />, {
      repository,
      route: `/company/${company.id}/dashboard/overview?deck=${market.id}&card=${card.card.id}`,
    });
    expect(
      await screen.findByText('Company brief', undefined, { timeout: 5000 }),
    ).toBeInTheDocument();
    expect(screen.getByText('Most useful public figures')).toBeInTheDocument();
    expect(read).not.toHaveBeenCalled();
    await user.click(screen.getByRole('link', { name: 'Metrics' }));
    await waitFor(() => expect(read).toHaveBeenCalledWith(company.id, 'metrics'));
    expect(screen.queryByText('This section hasn’t been researched yet')).not.toBeInTheDocument();

    await user.click(screen.getByRole('link', { name: 'Live Intel' }));
    expect(await screen.findByText('This section hasn’t been researched yet')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Research this section' })).toBeDisabled();
    expect(screen.getAllByRole('button', { name: 'Settings' }).length).toBeGreaterThan(0);
    expect(read.mock.calls.every((call) => call[2] !== true)).toBe(true);

    // Exercise the actual navigation and parent state, not just the empty-state component.
    const tabs: DashboardTab[] = [
      'products_roadmap',
      'team_org',
      'history',
      'mission_governance',
      'live_landing',
    ];
    for (const [index, tab] of tabs.entries()) {
      await user.click(
        screen.getByRole('button', {
          name: index === 0 ? 'More' : DASHBOARD_TAB_LABELS[tabs[index - 1]!],
        }),
      );
      await user.click(screen.getByRole('link', { name: DASHBOARD_TAB_LABELS[tab] }));
      await waitFor(() => expect(read).toHaveBeenCalledWith(company.id, tab));
      expect(
        await screen.findByText('This section hasn’t been researched yet'),
      ).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Research this section' })).toBeDisabled();
    }
    expect(read.mock.calls.every((call) => call[2] !== true)).toBe(true);

    await user.click(screen.getByRole('button', { name: DASHBOARD_TAB_LABELS.live_landing }));
    await user.click(screen.getByRole('link', { name: DASHBOARD_TAB_LABELS.history }));
    act(() => useApiKey.setState({ hasKey: true })); // Synthetic capability only; no key or live client.
    read.mockResolvedValueOnce({
      companyId: company.id,
      tab: 'history',
      lastRefreshedAt: null,
      content: {
        founderStory: '',
        timeline: [
          { date: '2026', title: 'Synthetic sourced milestone', detail: 'Saved test detail' },
        ],
        quotes: [],
      },
    });
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Research this section' })).toBeEnabled(),
    );
    await user.click(screen.getByRole('button', { name: 'Research this section' }));
    await waitFor(() => expect(read).toHaveBeenCalledWith(company.id, 'history', true));
    expect(await screen.findByText('Synthetic sourced milestone')).toBeInTheDocument();
    expect(read.mock.calls.filter((call) => call[2] === true)).toHaveLength(1);
  });
});
