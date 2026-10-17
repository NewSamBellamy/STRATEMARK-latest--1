/**
 * Which dashboard sections have landed, and which are being researched right
 * now, so the page can show itself being assembled instead of sitting blank.
 * It reads what is stored (never researches). While research is in flight it
 * looks again every few seconds, so a section fills in the moment it lands.
 */
import { useEffect, useRef, useState } from 'react';
import { useIsFetching, useQuery, useQueryClient } from '@tanstack/react-query';
import { DASHBOARD_TAB_LABELS, type DashboardTab } from '@mi/contracts';
import { useRepository } from '@/lib/repository/RepositoryProvider';

export const ASSEMBLY_TABS: readonly DashboardTab[] = ['overview', 'metrics', 'team_org', 'history', 'products_roadmap', 'live_intel', 'mission_governance'];

export type SectionState = 'filled' | 'researching' | 'empty';

const count = (list: unknown): number => (Array.isArray(list) ? list.length : 0);
const text = (v: unknown): boolean => typeof v === 'string' && v.trim().length > 0;

/** A section counts as filled only when it holds real content. */
export function sectionFilled(tab: DashboardTab, content: unknown): boolean {
  if (!content || typeof content !== 'object') return false;
  const c = content as Record<string, unknown>;
  switch (tab) {
    case 'overview': return text(c.markdown);
    case 'team_org': return count(c.nodes) > 0;
    case 'products_roadmap': return count(c.products) > 0 || count(c.roadmap) > 0;
    case 'history': return count(c.timeline) > 0 || text(c.founderStory);
    case 'live_intel': return count(c.items) > 0;
    case 'mission_governance': return text(c.mission) || count(c.board) > 0;
    default: return Object.values(c).some((v) => count(v) > 0);
  }
}

/** How long a section that just landed keeps its highlight. */
const LANDED_MS = 6000;
const POLL_MS = 3000;

export interface Assembly {
  state: (tab: DashboardTab) => SectionState;
  /** Sections that filled while you were watching. */
  landed: ReadonlySet<DashboardTab>;
  filled: number;
  total: number;
  working: boolean;
  /** Labels of the sections being researched right now. */
  researching: string[];
}

export function useDashboardAssembly(companyId: string): Assembly {
  const repo = useRepository();
  const qc = useQueryClient();
  const inFlight = useIsFetching({ queryKey: ['dashboard', companyId] });
  const working = inFlight > 0;
  const supported = typeof repo.peekDashboardTab === 'function';
  const stored = useQuery({
    queryKey: ['assembly', companyId],
    enabled: supported,
    refetchInterval: working ? POLL_MS : false,
    queryFn: async () => {
      const out: Partial<Record<DashboardTab, boolean>> = {};
      await Promise.all(ASSEMBLY_TABS.map(async (tab) => {
        const found = await repo.peekDashboardTab?.(companyId, tab).catch(() => null);
        out[tab] = sectionFilled(tab, found?.content);
      }));
      return out;
    },
  });

  // One last look when the work finishes, so the final section is not missed.
  const wasWorking = useRef(false);
  useEffect(() => {
    if (wasWorking.current && !working) void qc.invalidateQueries({ queryKey: ['assembly', companyId] });
    wasWorking.current = working;
  }, [working, qc, companyId]);

  const [landed, setLanded] = useState<ReadonlySet<DashboardTab>>(new Set());
  const previous = useRef<Partial<Record<DashboardTab, boolean>> | null>(null);
  useEffect(() => {
    const now = stored.data;
    if (!now) return;
    const before = previous.current;
    previous.current = now;
    if (!before) return;
    const fresh = ASSEMBLY_TABS.filter((t) => now[t] && !before[t]);
    if (!fresh.length) return;
    setLanded((s) => new Set([...s, ...fresh]));
    const timer = setTimeout(() => setLanded((s) => new Set([...s].filter((t) => !fresh.includes(t)))), LANDED_MS);
    return () => clearTimeout(timer);
  }, [stored.data]);
  useEffect(() => { previous.current = null; setLanded(new Set()); }, [companyId]);

  const fetching = new Set<string>();
  if (working) {
    for (const q of qc.getQueryCache().getAll()) {
      if (Array.isArray(q.queryKey) && q.queryKey[0] === 'dashboard' && q.queryKey[1] === companyId && q.state.fetchStatus === 'fetching') {
        fetching.add(String(q.queryKey[2]));
      }
    }
  }
  const state = (tab: DashboardTab): SectionState =>
    fetching.has(tab) ? 'researching' : stored.data?.[tab] ? 'filled' : 'empty';
  return {
    state,
    landed,
    filled: ASSEMBLY_TABS.filter((t) => stored.data?.[t]).length,
    total: ASSEMBLY_TABS.length,
    working,
    researching: ASSEMBLY_TABS.filter((t) => fetching.has(t)).map((t) => DASHBOARD_TAB_LABELS[t]),
  };
}
