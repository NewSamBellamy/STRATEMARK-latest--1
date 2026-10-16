/**
 * Today: moves of the companies the user follows. Engines without Today
 * (the cloud engine) answer with empty lists and never refresh.
 */
import { useMutation, useQuery, useQueryClient, type UseQueryResult } from '@tanstack/react-query';
import type { CompanyFollow, CompanyMove, MovesRefreshResult } from '@mi/contracts';
import { useRepository } from '@/lib/repository/RepositoryProvider';
import { qk } from '@/lib/query/keys';

export function useMoves(): UseQueryResult<CompanyMove[]> {
  const repo = useRepository();
  return useQuery({ queryKey: qk.moves, queryFn: () => repo.listMoves?.() ?? Promise.resolve([]) });
}

export function useFollows(): UseQueryResult<CompanyFollow[]> {
  const repo = useRepository();
  return useQuery({ queryKey: qk.follows, queryFn: () => repo.listFollows?.() ?? Promise.resolve([]) });
}

/** Look for new moves; the engine skips companies it looked at in the last day unless forced. */
export function useRefreshMoves() {
  const repo = useRepository();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (force: boolean): Promise<MovesRefreshResult> => {
      if (!repo.refreshMoves) return Promise.reject(new Error('Today isn’t available on this engine.'));
      return repo.refreshMoves({ force });
    },
    onSettled: () => qc.invalidateQueries({ queryKey: qk.moves }),
  });
}

export function useMarkMoveRead() {
  const repo = useRepository();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, read }: { id: string; read: boolean }) => repo.markMoveRead?.(id, read) ?? Promise.resolve(),
    onMutate: ({ id, read }) => {
      qc.setQueryData<CompanyMove[]>(qk.moves, (moves) =>
        moves?.map((move) => (move.id === id ? { ...move, readAt: read ? new Date().toISOString() : null } : move)));
    },
    onSettled: () => qc.invalidateQueries({ queryKey: qk.moves }),
  });
}

export function useFollowCompanies() {
  const repo = useRepository();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (companyIds: readonly string[]) => repo.followCompanies?.(companyIds) ?? Promise.resolve(),
    onSettled: () => Promise.all([qc.invalidateQueries({ queryKey: qk.follows }), qc.invalidateQueries({ queryKey: qk.moves })]),
  });
}

export function useUnfollowCompany() {
  const repo = useRepository();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (companyId: string) => repo.unfollowCompany?.(companyId) ?? Promise.resolve(),
    onSettled: () => Promise.all([qc.invalidateQueries({ queryKey: qk.follows }), qc.invalidateQueries({ queryKey: qk.moves })]),
  });
}
