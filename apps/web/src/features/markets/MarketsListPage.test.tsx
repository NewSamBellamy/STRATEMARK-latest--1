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
