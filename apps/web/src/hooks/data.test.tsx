import type { ReactNode } from 'react';
import { QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import type { MarketIntelRepository } from '@mi/contracts';
import { describe, expect, it, vi } from 'vitest';
import { RepositoryProvider } from '@/lib/repository/RepositoryProvider';
import { createQueryClient } from '@/lib/query/queryClient';
import { useDashboardTab, useRerunDashboardTab } from './data';

describe('dashboard research navigation race', () => {
  it('a result resolves to its original company/tab after navigation, without carrying pending state', async () => {
    let finish!: (value: unknown) => void;
    const pending = new Promise((resolve) => {
      finish = resolve;
    });
    const getDashboardTab = vi.fn().mockReturnValue(pending);
    const repository = { getDashboardTab } as unknown as MarketIntelRepository;
    const client = createQueryClient();
    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <RepositoryProvider repository={repository}>
        <QueryClientProvider client={client}>{children}</QueryClientProvider>
      </RepositoryProvider>
    );
    const { result, rerender } = renderHook(
      ({ companyId, tab }: { companyId: string; tab: 'history' | 'team_org' }) =>
        useRerunDashboardTab(companyId, tab),
      { wrapper, initialProps: { companyId: 'company_first', tab: 'history' } },
    );
    act(() => result.current.mutate());
    await waitFor(() => expect(result.current.isPending).toBe(true));
    rerender({ companyId: 'company_second', tab: 'team_org' });
    await waitFor(() => expect(result.current.isPending).toBe(false));
    const oldResult = {
      companyId: 'company_first',
      tab: 'history',
      content: { founderStory: '', timeline: [], quotes: [] },
      lastRefreshedAt: null,
    };
    await act(async () => {
      finish(oldResult);
      await pending;
    });
    await waitFor(() =>
      expect(client.getQueryData(['dashboard', 'company_first', 'history'])).toEqual(oldResult),
    );
    expect(client.getQueryData(['dashboard', 'company_second', 'team_org'])).toBeUndefined();
    expect(result.current.isPending).toBe(false);
    expect(getDashboardTab).toHaveBeenCalledTimes(1);
  });
});

describe('dashboard cache compatibility', () => {
  it('normalizes an explicit research result just like a saved read', async () => {
    const repository = {
      getDashboardTab: vi.fn().mockResolvedValue({
        companyId: 'cmp_legacy',
        tab: 'mission_governance',
        lastRefreshedAt: null,
        content: { mission: 'Synthetic mission', board: [], positives: [], negatives: [] },
      }),
    } as unknown as MarketIntelRepository;
    const client = createQueryClient();
    const wrapper = ({ children }: { children: ReactNode }) => (
      <RepositoryProvider repository={repository}>
        <QueryClientProvider client={client}>{children}</QueryClientProvider>
      </RepositoryProvider>
    );
    const { result } = renderHook(() => useRerunDashboardTab('cmp_legacy', 'mission_governance'), {
      wrapper,
    });
    await act(async () => {
      await result.current.mutateAsync();
    });
    expect(client.getQueryData(['dashboard', 'cmp_legacy', 'mission_governance'])).toMatchObject({
      content: { fundingRounds: [], investors: [] },
    });
  });

  it('normalizes legacy mission data before a feature reads it', async () => {
    const repository = {
      getDashboardTab: vi.fn().mockResolvedValue({
        companyId: 'cmp_legacy',
        tab: 'mission_governance',
        content: {
          mission: 'Build useful systems.',
          ethos: '',
          governanceStructure: '',
          board: [],
          positives: [],
          negatives: [],
        },
        lastRefreshedAt: null,
      }),
    } as unknown as MarketIntelRepository;
    const wrapper = ({ children }: { children: ReactNode }) => (
      <RepositoryProvider repository={repository}>
        <QueryClientProvider client={createQueryClient()}>{children}</QueryClientProvider>
      </RepositoryProvider>
    );

    const { result } = renderHook(() => useDashboardTab('cmp_legacy', 'mission_governance'), {
      wrapper,
    });

    await waitFor(() => expect(result.current.data).not.toBeUndefined());
    expect(result.current.data?.content.fundingRounds).toEqual([]);
    expect(result.current.data?.content.investors).toEqual([]);
  });
});
