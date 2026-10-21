/**
 * Today: moves of the companies the user follows. Engines without Today
 * (the cloud engine) answer with empty lists and never refresh.
 */
import { useCallback, useState } from 'react';
import { useMutation, useQuery, useQueryClient, type UseQueryResult } from '@tanstack/react-query';
import type { CardWithCompany, CompanyFollow, CompanyMove, LiveIntelContent, MovesRefreshResult } from '@mi/contracts';
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
    // `companyIds` limits the look to those companies (one company's page); without it every followed company is looked at.
    mutationFn: (ask: boolean | { force: boolean; companyIds?: readonly string[] }): Promise<MovesRefreshResult> => {
      if (!repo.refreshMoves) return Promise.reject(new Error('Today isn’t available on this engine.'));
      return repo.refreshMoves(typeof ask === 'boolean' ? { force: ask } : ask);
    },
    // Not returned: a mutation waits for what onSettled returns, and the list refresh that follows the check can be slow
    // (a busy store, another tab). The page said "checking now" for as long as it took, though the check had finished.
    onSettled: () => { void Promise.all([qc.invalidateQueries({ queryKey: qk.moves }), qc.invalidateQueries({ queryKey: qk.follows })]); },
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

/** Mark many moves read in one write (engines without the batch call mark them one by one). */
export function useMarkMovesRead() {
  const repo = useRepository();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (ids: readonly string[]) => {
      if (repo.markMovesRead) await repo.markMovesRead(ids);
      else for (const id of ids) await repo.markMoveRead?.(id, true);
    },
    onMutate: (ids) => {
      const set = new Set(ids);
      const at = new Date().toISOString();
      qc.setQueryData<CompanyMove[]>(qk.moves, (moves) => moves?.map((move) => (set.has(move.id) && !move.readAt ? { ...move, readAt: at } : move)));
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

/** The company's stored Live Intel (news and social), read without ever starting research. */
export function useStoredLiveIntel(companyId: string | undefined): UseQueryResult<LiveIntelContent | null> {
  const repo = useRepository();
  return useQuery({
    queryKey: qk.todayIntel(companyId ?? ''),
    enabled: !!companyId,
    queryFn: async () => (await repo.peekDashboardTab?.(companyId as string, 'live_intel'))?.content ?? null,
  });
}

/** Look for fresh social sentiment now. This is a research pass (it uses research credits), so it only runs when asked. */
export function useRefreshSentiment(companyId: string | undefined) {
  const repo = useRepository();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      if (!companyId) throw new Error('Pick a company first.');
      await repo.getDashboardTab(companyId, 'live_intel', true);
    },
    onSettled: () => { void qc.invalidateQueries({ queryKey: qk.todayIntel(companyId ?? '') }); },
  });
}

/** The company's own card, from whichever deck holds it (the first deck that does). */
export function useCompanyCard(companyId: string | undefined): UseQueryResult<CardWithCompany | null> {
  const repo = useRepository();
  return useQuery({
    queryKey: qk.companyCard(companyId ?? ''),
    enabled: !!companyId,
    queryFn: async () => {
      for (const market of await repo.listMarkets()) {
        const deck = await repo.getDeckByMarket(market.id);
        if (!deck) continue;
        const card = (await repo.listCards(deck.id)).find((c) => c.card.companyId === companyId && c.card.cardType === 'company');
        if (card) return card;
      }
      return null;
    },
  });
}

const SOCIAL_READ_KEY = 'mi.today.socialRead';

/** Which social items were read on this device (they are research items, not moves, so the engine does not track them). */
export function useSocialRead(): { read: ReadonlySet<string>; set: (id: string, read: boolean) => void } {
  const [read, setRead] = useState<Set<string>>(() => {
    try { return new Set(JSON.parse(localStorage.getItem(SOCIAL_READ_KEY) ?? '[]') as string[]); } catch { return new Set(); }
  });
  const set = useCallback((id: string, isRead: boolean) => {
    setRead((current) => {
      const next = new Set(current);
      if (isRead) next.add(id); else next.delete(id);
      try { localStorage.setItem(SOCIAL_READ_KEY, JSON.stringify([...next].slice(-500))); } catch { /* read marks last for this visit only */ }
      return next;
    });
  }, []);
  return { read, set };
}
