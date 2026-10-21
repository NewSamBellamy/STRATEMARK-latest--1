import { describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';
import type { Market } from '@mi/contracts';
import { makeRepo, renderWithProviders } from '@/test/test-utils';
import { formatUpdated } from '@/features/markets/deck-library';
import { Sidebar } from './Sidebar';

describe('Sidebar recent decks', () => {
  it('labels the date "Updated" and uses the deck refresh date, like All Decks', async () => {
    const repository = makeRepo();
    const market = {
      id: 'mkt_a', name: 'Solar', scopeDefinition: { vertical: 'v', geography: null, notes: null },
      refreshCadence: 'manual', createdAt: '2026-01-01T00:00:00Z',
    } as unknown as Market;
    vi.spyOn(repository, 'listMarkets').mockResolvedValue([market]);
    vi.spyOn(repository, 'getDeckByMarket').mockResolvedValue({
      id: 'dk_a', marketId: 'mkt_a', createdAt: '2026-01-01T00:00:00Z', lastRefreshedAt: '2026-03-05T12:00:00Z',
    } as never);
    vi.spyOn(repository, 'listCards').mockResolvedValue([]);
    renderWithProviders(<Sidebar />, { repository });
    const want = `Updated ${formatUpdated('2026-03-05T12:00:00Z')}`;
    expect(await screen.findByText(want)).toBeInTheDocument();
  });
});
