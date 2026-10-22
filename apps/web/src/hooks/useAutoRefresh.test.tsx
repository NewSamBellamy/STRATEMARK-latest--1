import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { QueryClientProvider } from '@tanstack/react-query';
import { MockRepository } from '@mi/mocks';
import { createQueryClient } from '@/lib/query/queryClient';
import { RepositoryProvider } from '@/lib/repository/RepositoryProvider';
import { useApiKey } from '@/lib/settings/apiKey';
import { useResearchControl } from '@/lib/living/researchControl';
import { useAutoRefresh } from './useAutoRefresh';

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  useApiKey.setState({ apiKey: '', hasKey: false, hosted: false });
  act(() => useResearchControl.setState({ paused: false, storageError: null }));
});

function setup() {
  vi.useFakeTimers();
  const repository = new MockRepository({ latencyMs: 0 });
  const listMarkets = vi.spyOn(repository, 'listMarkets');
  const wrapper = ({ children }: { children: ReactNode }) => <RepositoryProvider repository={repository}>
    <QueryClientProvider client={createQueryClient()}>{children}</QueryClientProvider>
  </RepositoryProvider>;
  return { listMarkets, wrapper };
}

describe('auto-refresh and the hosted covered allowance', () => {
  it('does not auto-refresh for a hosted visitor with no key of their own', async () => {
    useApiKey.setState({ apiKey: '', hasKey: true, hosted: true });
    const { listMarkets, wrapper } = setup();
    renderHook(() => useAutoRefresh(), { wrapper });
    await act(async () => { await vi.advanceTimersByTimeAsync(16 * 60 * 1000); });
    expect(listMarkets).not.toHaveBeenCalled();
  });
  it('still checks for due decks when the person has a key of their own', async () => {
    useApiKey.setState({ apiKey: 'sk-fake', hasKey: true, hosted: false });
    const { listMarkets, wrapper } = setup();
    renderHook(() => useAutoRefresh(), { wrapper });
    await act(async () => { await vi.advanceTimersByTimeAsync(9000); });
    expect(listMarkets).toHaveBeenCalled();
  });
});
