import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderHook } from '@testing-library/react';
import { QueryClientProvider } from '@tanstack/react-query';
import { MockRepository, type SeedSnapshot } from '@mi/mocks';
import sample from '@/sample/frontier-snapshot.json';
import { createQueryClient } from '@/lib/query/queryClient';
import { RepositoryProvider } from '@/lib/repository/RepositoryProvider';
import { useApiKey } from '@/lib/settings/apiKey';
import { useLivingDeck } from './useLivingDeck';
import { LivingDeckRuntime } from './runtime';
import { useAutoRefresh } from '@/hooks/useAutoRefresh';
import { useSentinel } from '@/lib/agentic/useSentinel';

afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs(); vi.restoreAllMocks(); useApiKey.setState({ apiKey: '', hasKey: false }); });
describe('keyless desktop browsing', () => {
  it('does not schedule automatic refresh or briefings without a user key', async () => {
    vi.useFakeTimers();
    vi.stubEnv('VITE_DESKTOP', '1');
    useApiKey.setState({ apiKey: '', hasKey: false });
    const repository = new MockRepository({ latencyMs: 0 });
    const liveRepository = Object.assign(repository, { generateDeckBriefing: vi.fn(), listDeckBriefings: vi.fn().mockResolvedValue([]) });
    const listMarkets = vi.spyOn(repository, 'listMarkets');
    const wrapper = ({ children }: { children: ReactNode }) => <RepositoryProvider repository={liveRepository}><QueryClientProvider client={createQueryClient()}>{children}</QueryClientProvider></RepositoryProvider>;
    renderHook(() => { useAutoRefresh(); useSentinel(); }, { wrapper });
    await vi.advanceTimersByTimeAsync(10000);
    expect(listMarkets).not.toHaveBeenCalled();
  });
  it('does not start background model research without a user key', async () => {
    vi.stubEnv('VITE_DESKTOP', '1');
    useApiKey.setState({ apiKey: '', hasKey: false });
    const repository = new MockRepository({ seedSnapshot: sample as unknown as SeedSnapshot, latencyMs: 0 });
    const liveRepository = Object.assign(repository, { verifyMetric: vi.fn() });
    const start = vi.spyOn(LivingDeckRuntime.prototype, 'start');
    const cards = await repository.listCards(sample.decks[0]!.id);
    const wrapper = ({ children }: { children: ReactNode }) => <RepositoryProvider repository={liveRepository}><QueryClientProvider client={createQueryClient()}>{children}</QueryClientProvider></RepositoryProvider>;
    const { result } = renderHook(() => useLivingDeck(sample.decks[0]!.id, cards), { wrapper });
    expect(result.current.canVerify).toBe(false);
    expect(start).not.toHaveBeenCalled();
  });
});
