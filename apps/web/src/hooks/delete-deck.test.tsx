import { describe, expect, it } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { GeminiRepository, migrateSnapshot, type LlmClient } from '@mi/research';
import { RepositoryProvider } from '@/lib/repository/RepositoryProvider';
import { useDeleteDeck, useMarkets } from './data';

type Snapshot = ReturnType<typeof migrateSnapshot>['snapshot'];

describe('useDeleteDeck in local (browser) mode', () => {
  it('deletes the deck the list row names by market id and refreshes the decks list', async () => {
    let saved: Snapshot = migrateSnapshot(null).snapshot;
    const store = { read: () => structuredClone(saved), write: (next: Snapshot) => { saved = structuredClone(next); } };
    const client = { ground: async () => { throw new Error('offline'); }, structure: async () => { throw new Error('offline'); } } as unknown as LlmClient;
    const repo = new GeminiRepository({ apiKey: 'test-placeholder', client, store });
    const market = await repo.createMarket({ name: 'Software', scopeDefinition: { vertical: 'SaaS', geography: null, notes: null }, refreshCadence: 'weekly' });

    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const wrapper = ({ children }: { children: ReactNode }) => <RepositoryProvider repository={repo}>
      <QueryClientProvider client={qc}>{children}</QueryClientProvider>
    </RepositoryProvider>;
    const { result, unmount } = renderHook(() => ({ markets: useMarkets(), del: useDeleteDeck() }), { wrapper });
    await waitFor(() => expect(result.current.markets.data).toHaveLength(1));

    let deleted: boolean | undefined;
    await act(async () => { deleted = await result.current.del.mutateAsync(market.id); });

    expect(deleted).toBe(true);
    await waitFor(() => expect(result.current.markets.data).toEqual([]));
    expect(saved.markets).toEqual([]);
    expect(saved.decks).toEqual([]);
    unmount(); qc.clear();
  });
});
