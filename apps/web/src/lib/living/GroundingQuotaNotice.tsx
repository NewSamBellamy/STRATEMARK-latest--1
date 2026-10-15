import { useEffect, useState } from 'react';
import { Info } from 'lucide-react';
import { getGroundingSpent, subscribeUsage, type GroundingSpent } from '@/lib/usage';

/** "about 2 hours", "about 40 minutes": a plain wait, never a countdown that ticks. */
export function waitLabel(ms: number): string {
  const minutes = Math.max(1, Math.round(ms / 60_000));
  if (minutes < 90) return `about ${minutes} minute${minutes === 1 ? '' : 's'}`;
  const hours = Math.round(minutes / 60);
  return `about ${hours} hour${hours === 1 ? '' : 's'}`;
}

/**
 * Says so plainly when Google Search grounding is out of quota for the day.
 * Research does not stop: it falls back to web pages, which is slower and finds
 * fewer sourced figures. Without this the only symptom is a deck that crawls.
 */
export function GroundingQuotaNotice({ now = Date.now }: { now?: () => number }) {
  const [state, setState] = useState<GroundingSpent | null>(() => getGroundingSpent(now()));
  useEffect(() => {
    const refresh = () => setState(getGroundingSpent(now()));
    const stop = subscribeUsage(refresh);
    const timer = setInterval(refresh, 60_000);
    return () => { stop(); clearInterval(timer); };
  }, [now]);
  if (!state) return null;
  return (
    <p role="status" className="mb-3 flex items-start gap-2 rounded-lg border border-border bg-surface-2/60 px-3 py-2 text-[12px] text-muted">
      <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
      <span>
        Google Search is out of quota for today, so research is running from web pages instead: slower, with fewer sourced figures.
        It should be back around midnight Pacific ({waitLabel(state.resetsAt - now())} from now). Nothing is lost; unfound figures stay Unknown.
      </span>
    </p>
  );
}
