import type { ReactNode } from 'react';
import { QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import type { MarketIntelRepository } from '@mi/contracts';
import { describe, expect, it, vi } from 'vitest';
import { RepositoryProvider } from '@/lib/repository/RepositoryProvider';
import { createQueryClient } from '@/lib/query/queryClient';
import { useDashboardTab } from './data';

describe('dashboard cache compatibility', () => {
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
