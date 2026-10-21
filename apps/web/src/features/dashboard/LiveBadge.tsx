import { Radio } from 'lucide-react';
import { formatRelative } from '@/lib/format';
import { isLiveFresh } from './tabs/tabHelpers';

/**
 * Marks a tab whose data is refreshed live by the research pipeline (spec §8/§9).
 * In the front-end phase this documents the integration point; the cadence/last-
 * refreshed wiring is already in place via the repository.
 */
export function LiveBadge({ lastRefreshedAt, now = Date.now() }: { lastRefreshedAt?: string | null; now?: number }) {
  // Older than a week is not "live": say when it was last checked, in a muted chip.
  const stale = !!lastRefreshedAt && !isLiveFresh(lastRefreshedAt, now);
  return (
    <span
      className={stale ? 'chip border-border bg-surface-2 text-muted' : 'chip border-primary/40 bg-primary/10 text-primary-ink'}
      title={stale ? new Date(lastRefreshedAt ?? '').toLocaleString() : 'Refreshed by the live research pipeline.'}
    >
      <Radio className="h-3.5 w-3.5" />
      {!lastRefreshedAt
        ? 'Live'
        : stale
          ? `Last checked ${new Date(lastRefreshedAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}`
          : `Live · updated ${formatRelative(lastRefreshedAt, now)}`}
    </span>
  );
}
