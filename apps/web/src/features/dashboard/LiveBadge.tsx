import { Radio } from 'lucide-react';
import { formatDate, formatDateTime, formatRelative } from '@/lib/format';
import { isLiveFresh } from './tabs/tabHelpers';

/**
 * Marks a tab whose data is refreshed live by the research pipeline (spec §8/§9).
 * In the front-end phase this documents the integration point; the cadence/last-
 * refreshed wiring is already in place via the repository.
 */
export function LiveBadge({ lastRefreshedAt, now = Date.now() }: { lastRefreshedAt?: string | null; now?: number }) {
  // Older than a week is not "live": say when it was last checked, in a muted chip.
  const stale = !!lastRefreshedAt && !isLiveFresh(lastRefreshedAt, now);
  const validDate = !!lastRefreshedAt && !Number.isNaN(Date.parse(lastRefreshedAt));
  return (
    <span
      // Roomy enough that the border never hugs the text, and as tall as the Refresh button beside it.
      className={`chip min-h-8 px-3.5 py-1.5 ${stale ? 'border-border bg-surface-2 text-muted' : 'border-primary/40 bg-primary/10 text-primary-ink'}`}
      title={stale && validDate ? formatDateTime(lastRefreshedAt) : stale ? undefined : 'Refreshed by the live research pipeline.'}
    >
      <Radio className="h-3.5 w-3.5" />
      {!lastRefreshedAt
        ? 'Live'
        : stale
          ? validDate
            ? `Last checked ${formatDate(lastRefreshedAt)}`
            : 'Last checked'
          : `Live · updated ${formatRelative(lastRefreshedAt, now)}`}
    </span>
  );
}
