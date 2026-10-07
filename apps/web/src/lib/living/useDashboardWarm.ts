import { useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { DASHBOARD_TABS, DASHBOARD_TAB_LABELS, type DashboardTab } from '@mi/contracts';
import { useRepository } from '@/lib/repository/RepositoryProvider';
import { useAgentTrace } from '@/lib/agentic/agentTrace';
import { qk } from '@/lib/query/keys';
import { isLowPower } from '@/lib/usage';
import { useApiKey } from '@/lib/settings/apiKey';
import { isCommunityDesktop } from '@/lib/settings/runtime';
import { useResearchControl } from './researchControl';

/** One bounded sequential warm pass, sharing the deck's durable scheduling switch. */
export function useDashboardWarm(companyId: string | undefined, activeTab: DashboardTab, companyName?: string) {
  const repo = useRepository();
  const qc = useQueryClient();
  const paused = useResearchControl(state => state.paused);
  const hasKey = useApiKey(state => state.hasKey);
  const available = !isCommunityDesktop() || hasKey;
  const [failed, setFailed] = useState<string[]>([]);
  const latest = useRef({ activeTab, companyName });
  latest.current = { activeTab, companyName };
  useEffect(() => {
    setFailed([]);
    if (!companyId || paused || !available) return;
    let cancelled = false;
    const allowed = () => !cancelled && !useResearchControl.getState().paused && !isLowPower();
    void (async () => {
      // 'research' reads local evidence only — warming it would POST a doomed request.
      const pending = new Set<DashboardTab>(DASHBOARD_TABS.filter((t) => t !== 'research'));
      while (pending.size > 0 && allowed()) {
        const next = pending.has(latest.current.activeTab) ? latest.current.activeTab
          : DASHBOARD_TABS.find(tab => pending.has(tab))!;
        pending.delete(next);
        if (qc.getQueryData(qk.dashboard(companyId, next)) != null) continue;
        try {
          await qc.fetchQuery({
            queryKey: qk.dashboard(companyId, next),
            queryFn: () => {
              // Recheck at dispatch, not only when the effect started.
              if (!allowed()) throw new Error('Background research paused');
              useAgentTrace.getState().trace(`${latest.current.companyName ?? 'Company'} desk`,
                `Researching ${DASHBOARD_TAB_LABELS[next]} in the background`);
              return repo.getDashboardTab(companyId, next);
            },
            staleTime: Infinity,
            retry: false,
          });
        } catch {
          if (allowed()) setFailed(previous => [...new Set([...previous, next])]);
        }
      }
    })();
    return () => { cancelled = true; };
  }, [companyId, paused, available, qc, repo]);
  return failed;
}
