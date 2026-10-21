import { RefreshCw } from 'lucide-react';
import { METRIC_TYPE_LABELS, type DashboardTab } from '@mi/contracts';
import { formatRelative } from '@/lib/format';
import { cn } from '@/lib/cn';
import { useCompanyMetrics } from '@/hooks/data';
import { figureCounts, statedMonth } from './SourceCheck';
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
  // The overview refresh is what re-hunts stored figures, so only it names how many are old.
  const metrics = useCompanyMetrics(tab === 'overview' ? companyId : undefined).data;
  if (!REFRESHABLE_TABS.includes(tab) || !refreshedAt) return null;
  const age = now - new Date(refreshedAt).getTime();
  const old = Number.isFinite(age) && age > MONTH_MS;
  const counts = tab === 'overview' && metrics ? figureCounts(metrics) : null;
  const assessed = counts ? counts.current + counts.outOfDate + counts.undated : 0;
  return (
    <div className="mb-3 flex items-center justify-end gap-2 text-[11.5px] text-faint">
      <span title={new Date(refreshedAt).toLocaleString()}>
        Researched {formatRelative(refreshedAt, now)}
        {old && <span className="text-red-700 dark:text-negative"> · over a month old</span>}
      </span>
      {counts && assessed > 0 && <span className={cn(counts.outOfDate + counts.undated > 0 && 'text-red-700 dark:text-negative')}>
        · Figures: {[`${counts.current} current`, counts.outOfDate > 0 && `${counts.outOfDate} out of date`, counts.undated > 0 && `${counts.undated} undated`]
          .filter(Boolean).join(', ')}
        {counts.outOfDate > 0 && counts.oldest && ` · oldest: ${METRIC_TYPE_LABELS[counts.oldest.label]}, ${statedMonth(counts.oldest.asOf)}`}
      </span>}
      <button
        type="button"
        className="inline-flex items-center gap-1 rounded-md px-2 py-1.5 text-primary-ink hover:bg-surface-2 disabled:opacity-50"
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
