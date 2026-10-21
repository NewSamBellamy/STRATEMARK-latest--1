import { describe, expect, it } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import { makeRepo, renderWithProviders } from '@/test/test-utils';
import { useMoves, useRefreshMoves } from './today';

function Probe() {
  const refresh = useRefreshMoves();
  const moves = useMoves();
  return (
    <div>
      <button type="button" onClick={() => refresh.mutate(false)}>Check</button>
      <span data-testid="check">{refresh.isPending ? 'checking' : refresh.isSuccess ? 'checked' : 'idle'}</span>
      <span data-testid="list">{moves.isFetching ? 'loading' : 'ready'}</span>
    </div>
  );
}

describe('the daily check on Today', () => {
  it('is over when the check is over, even if the list that follows it is slow to refresh', async () => {
    // The first list read answers; the one after the check never does (a slow store, a busy tab).
    let reads = 0;
    const repository = Object.assign(makeRepo(), {
      listMoves: () => (reads++ === 0 ? Promise.resolve([]) : new Promise<never>(() => undefined)),
      refreshMoves: async () => ({ added: 0, refreshed: 3, refreshedAt: new Date().toISOString() }),
    });
    const { user } = renderWithProviders(<Probe />, { repository });
    await waitFor(() => expect(screen.getByTestId('list')).toHaveTextContent('ready'));
    await user.click(screen.getByRole('button', { name: 'Check' }));
    // Before the fix the page said "checking now" for as long as the list refresh hung, though the check had finished.
    await waitFor(() => expect(screen.getByTestId('check')).toHaveTextContent('checked'), { timeout: 2000 });
    expect(screen.getByTestId('list')).toHaveTextContent('loading');
  });

  it('still refreshes the list when the check ends, and when it fails', async () => {
    let reads = 0;
    const failing = Object.assign(makeRepo(), {
      listMoves: async () => { reads += 1; return []; },
      refreshMoves: async () => { throw new Error('the feed is down'); },
    });
    const { user } = renderWithProviders(<Probe />, { repository: failing });
    await waitFor(() => expect(reads).toBe(1));
    await user.click(screen.getByRole('button', { name: 'Check' }));
    await waitFor(() => expect(reads).toBe(2));
    await waitFor(() => expect(screen.getByTestId('check')).toHaveTextContent('idle'));
  });
});
