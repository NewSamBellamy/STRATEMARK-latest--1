import { describe, expect, it } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import type { MarketIntelRepository } from '@mi/contracts';
import { RepositoryProvider } from '@/lib/repository/RepositoryProvider';
import { useResumableJob } from './data';

const base = {
  marketPlan: {}, market: {}, catalog: [],
  warnings: [], error: null, partialCards: [],
  createdAt: '2026-08-12T00:00:00.000Z', updatedAt: '2026-08-12T00:00:00.000Z',
};

function jobsFor(jobs: Array<Record<string, unknown>>) {
  const repo = {
    listResearchJobs: async () => jobs.map((job) => ({ ...base, deck: { marketId: 'mkt_a' }, ...job })),
    resumeResearchJob: async () => null,
  } as unknown as MarketIntelRepository;
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) => <RepositoryProvider repository={repo}>
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  </RepositoryProvider>;
  return renderHook(() => useResumableJob('mkt_a'), { wrapper });
}

describe('useResumableJob', () => {
  it('offers a completed job that still has roster companies without a researched card (a partial deck)', async () => {
    const { result } = jobsFor([{
      id: 'job_partial', status: 'completed',
      catalogNames: ['Alpha', 'Delta Labs'], completedEntityNames: ['Alpha'],
    }]);
    await waitFor(() => expect(result.current.data?.id).toBe('job_partial'));
  });

  it('offers nothing for a completed job whose whole roster is researched', async () => {
    const { result } = jobsFor([{
      id: 'job_done', status: 'completed',
      catalogNames: ['Alpha', 'Delta Labs'], completedEntityNames: ['alpha', 'Delta Labs'],
    }]);
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toBeNull();
  });

  it('still offers a failed job', async () => {
    const { result } = jobsFor([{
      id: 'job_failed', status: 'failed', catalogNames: ['Alpha'], completedEntityNames: [],
    }]);
    await waitFor(() => expect(result.current.data?.id).toBe('job_failed'));
  });
});
