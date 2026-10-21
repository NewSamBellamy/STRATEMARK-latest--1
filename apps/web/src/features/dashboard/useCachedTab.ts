import { useQuery } from '@tanstack/react-query';
import type { DashboardTab, DashboardTabResult } from '@mi/contracts';
import { qk } from '@/lib/query/keys';
import { useRepository } from '@/lib/repository/RepositoryProvider';

/**
 * Read a sibling dashboard tab ONLY if it is already researched and cached.
 * `enabled: false` means this observer never starts a (paid) research pass; it
 * simply re-renders when the tab's own query fills the shared cache.
 */
export function useCachedDashboardTab<T extends DashboardTab>(companyId: string, tab: T) {
  const repo = useRepository();
  return useQuery({
    queryKey: qk.dashboard(companyId, tab),
    queryFn: () => repo.getDashboardTab(companyId, tab) as Promise<DashboardTabResult<T> | null>,
    enabled: false,
  });
}
