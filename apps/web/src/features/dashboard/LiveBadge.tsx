import { Radio } from 'lucide-react';
import { formatRelative } from '@/lib/format';

/**
 * Marks a tab whose data is refreshed live by the research pipeline (spec §8/§9).
 * In the front-end phase this documents the integration point; the cadence/last-
 * refreshed wiring is already in place via the repository.
 */
export function LiveBadge({ lastRefreshedAt }: { lastRefreshedAt?: string | null }) {
  return (
    <span
      className="chip border-primary/40 bg-primary/10 text-primary-ink"
      title="Refreshed by the live research pipeline."
    >
      <Radio className="h-3.5 w-3.5" />
      {lastRefreshedAt ? `Live · updated ${formatRelative(lastRefreshedAt)}` : 'Live'}
    </span>
  );
}
