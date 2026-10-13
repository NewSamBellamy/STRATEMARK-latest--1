import { RefreshCw } from 'lucide-react';
import type { DashboardTab } from '@mi/contracts';
import { formatRelative } from '@/lib/format';
import { cn } from '@/lib/cn';
import { useCachedDashboardTab } from './useCachedTab';

/** Tabs that are one grounded research pass; the rest are projections or have their own refresh. */
export const REFRESHABLE_TABS: readonly DashboardTab[] = ['overview', 'team_org', 'mission_governance', 'history', 'products_roadmap'];

const MONTH_MS = 30 * 24 * 3_600_000;

/**
 * "Researched 3h ago · Refresh": how old the tab's research is, and a visible
 * way to redo it (the right-click menu was the only one). Appears once the tab
 * has research to date, and says so plainly when it is over a month old.
 */
export function TabFreshness({ companyId, tab, onRefresh, refreshing, disabled, now = Date.now() }: {
  companyId: string;
  tab: DashboardTab;
  onRefresh: () => void;
  refreshing: boolean;
  disabled: boolean;
  now?: number;
}) {
  const refreshedAt = useCachedDashboardTab(companyId, tab).data?.lastRefreshedAt ?? null;
  if (!REFRESHABLE_TABS.includes(tab) || !refreshedAt) return null;
  const age = now - new Date(refreshedAt).getTime();
  const old = Number.isFinite(age) && age > MONTH_MS;
  return (
    <div className="mb-3 flex items-center justify-end gap-2 text-[11.5px] text-faint">
      <span title={new Date(refreshedAt).toLocaleString()}>
        Researched {formatRelative(refreshedAt, now)}
        {old && <span className="text-negative"> · over a month old</span>}
      </span>
      <button
        type="button"
        className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-primary-ink hover:bg-surface-2 disabled:opacity-50"
        disabled={disabled || refreshing}
        title={disabled ? 'Add an API key to refresh research.' : 'Run a fresh grounded research pass for this tab.'}
        onClick={onRefresh}
      >
        <RefreshCw className={cn('h-3 w-3', refreshing && 'animate-spin')} aria-hidden />
        {refreshing ? 'Refreshing…' : 'Refresh'}
      </button>
    </div>
  );
}
