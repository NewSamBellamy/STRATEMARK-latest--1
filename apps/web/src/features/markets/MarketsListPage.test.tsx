import { describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import { makeRepo, renderWithProviders } from '@/test/test-utils';
import MarketsListPage from './MarketsListPage';

async function deleteFirstDeck(deleteDeck: (id: string) => Promise<boolean>) {
  vi.spyOn(window, 'confirm').mockReturnValue(true);
  const repository = Object.assign(makeRepo(), { deleteDeck: vi.fn(deleteDeck) });
  const { user } = renderWithProviders(<MarketsListPage />, { repository });
  const menu = (await screen.findAllByRole('button', { name: /^More actions for / }))[0]!;
  const name = menu.getAttribute('aria-label')!.replace('More actions for ', '');
  await user.click(menu);
  await user.click(screen.getByRole('menuitem', { name: 'Delete deck' }));
  return { name, repository };
}

describe('deleting a deck from the library', () => {
  it('takes the tile away at once, even while the delete is still waiting on running research', async () => {
    let finish!: (deleted: boolean) => void;
    const { name } = await deleteFirstDeck(() => new Promise<boolean>((resolve) => { finish = resolve; }));
    await waitFor(() => expect(screen.queryByRole('button', { name: `Open ${name}` })).not.toBeInTheDocument());
    finish(true);
  });

  it('brings the tile back when the delete fails', async () => {
    const { name } = await deleteFirstDeck(async () => { throw new Error('Disk full'); });
    expect(await screen.findByRole('button', { name: `Open ${name}` })).toBeInTheDocument();
  });
});

describe('archiving a deck from the library', () => {
  it('moves the deck to Archived and restores it, without deleting it', async () => {
    const repository = makeRepo();
    const deleteDeck = vi.spyOn(repository, 'deleteDeck');
    const { user } = renderWithProviders(<MarketsListPage />, { repository });
    const menu = (await screen.findAllByRole('button', { name: /^More actions for / }))[0]!;
    const name = menu.getAttribute('aria-label')!.replace('More actions for ', '');

    await user.click(menu);
    await user.click(screen.getByRole('menuitem', { name: 'Archive deck' }));
    await waitFor(() => expect(screen.queryByRole('button', { name: `Open ${name}` })).not.toBeInTheDocument());

    await user.click(await screen.findByRole('button', { name: 'Archived (1)' }));
    expect(await screen.findByRole('button', { name: `Open ${name}` })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: `More actions for ${name}` }));
    await user.click(screen.getByRole('menuitem', { name: 'Restore deck' }));

    // Restoring the only archived deck returns to the library, with the deck back in it.
    expect(await screen.findByRole('button', { name: `Open ${name}` })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Archived/ })).not.toBeInTheDocument();
    expect(deleteDeck).not.toHaveBeenCalled();
  });

  it('offers no Archive where the engine cannot archive (cloud decks)', async () => {
    const repository = makeRepo();
    const capabilities = repository.capabilities!();
    repository.capabilities = () => ({ ...capabilities, unsupported: ['setMarketArchived'] });
    const { user } = renderWithProviders(<MarketsListPage />, { repository });
    await user.click((await screen.findAllByRole('button', { name: /^More actions for / }))[0]!);
    expect(screen.queryByRole('menuitem', { name: 'Archive deck' })).not.toBeInTheDocument();
  });
});
