/**
 * AgentActivityFeed — the visible heartbeat of a living deck.
 *
 * A quiet strip under the deck header: a status pill (pulsing dot while the
 * desks are working) plus the most recent research actions — verifications,
 * corrections, audit findings, tab warm-ups — each with its source count and
 * age. This is the difference between claiming the research is alive and the
 * user WATCHING it happen.
 */
import { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  BadgeCheck,
  ChevronDown,
  ChevronUp,
  CircleDot,
  Moon,
  Pause,
  Play,
  Radar,
  Wand2,
} from 'lucide-react';
import { cn } from '@/lib/cn';
import type { LivingDeckState } from '@/lib/living/useLivingDeck';
import type { AgentActivityEvent } from '@/lib/living/runtime';
import { useResearchControl } from '@/lib/living/researchControl';

function ago(at: number, now: number): string {
  const s = Math.max(0, Math.round((now - at) / 1000));
  if (s < 5) return 'just now';
  if (s < 60) return `${s}s ago`;
  const m = Math.round(s / 60);
  return m < 60 ? `${m}m ago` : `${Math.round(m / 60)}h ago`;
}

function EventRow({ event, now }: { event: AgentActivityEvent; now: number }) {
  const icon =
    event.kind === 'corrected' ? (
      <Wand2 className="h-3 w-3 text-positive" />
    ) : event.kind === 'verified' ? (
      <BadgeCheck className="h-3 w-3 text-positive" />
    ) : event.kind === 'prefetched' ? (
      <Radar className="h-3 w-3 text-primary-ink" />
    ) : event.kind === 'finding' ? (
      <AlertTriangle
        className={cn(
          'h-3 w-3',
          event.severity === 'critical' ? 'text-negative' : 'text-amber-500',
        )}
      />
    ) : event.kind === 'resting' ? (
      <Moon className="h-3 w-3 text-faint" />
    ) : (
      <Radar className="h-3 w-3 text-primary-ink" />
    );
  return (
    <div className="flex items-start gap-2 py-1">
      <span className="mt-0.5 shrink-0">{icon}</span>
      <p className="min-w-0 flex-1 text-[11px] leading-snug text-muted">
        {event.message}
        {event.citations != null && event.citations > 0 && (
          <span className="text-faint"> · {event.citations} source{event.citations === 1 ? '' : 's'}</span>
        )}
      </p>
      <span className="shrink-0 text-[10px] tabular-nums text-faint">{ago(event.at, now)}</span>
    </div>
  );
}

export function AgentActivityFeed({ living }: { living: LivingDeckState }) {
  const storageError = useResearchControl(state => state.storageError);
  const [expanded, setExpanded] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 5000);
    return () => clearInterval(t);
  }, []);

  const latest = living.events[0];
  const visible = useMemo(
    () => (expanded ? living.events.slice(0, 12) : []),
    [expanded, living.events],
  );

  if (living.deskCount === 0) return null;

  const active = living.status === 'running';
  const paused = living.status === 'paused';

  return (
    <div className="mt-3 rounded-lg border border-border bg-surface">
      <div className="flex items-center gap-2 px-3 py-1.5">
        <span className="relative flex h-2 w-2 shrink-0">
          {active && living.canVerify && (
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-60" />
          )}
          <span
            className={cn(
              'relative inline-flex h-2 w-2 rounded-full',
              !living.canVerify
                ? 'bg-slate-400'
                : active
                  ? 'bg-emerald-500'
                  : paused
                    ? 'bg-amber-400'
                    : 'bg-slate-400',
            )}
          />
        </span>
        <span className="text-[11px] font-semibold text-content">
          {!living.canVerify
            ? 'Research snapshot — live updates off'
            : paused
              ? 'Live research paused'
              : active
                ? 'Live research'
                : 'Research resting'}
        </span>
        <span className="text-[11px] text-faint">
          {living.canVerify ? (
            <>
              · {living.deskCount} company desk{living.deskCount === 1 ? '' : 's'}
              {living.actionCount > 0 &&
                ` · ${living.actionCount} action${living.actionCount === 1 ? '' : 's'} this session`}
            </>
          ) : (
            <>· add your Gemini key in Settings to put desks on this deck</>
          )}
        </span>
        {!expanded && latest && (
          <span className="hidden min-w-0 flex-1 truncate text-[11px] text-muted sm:inline">
            <CircleDot className="mr-1 inline h-2.5 w-2.5 text-faint" />
            {latest.message}
          </span>
        )}
        <span className="ml-auto flex shrink-0 items-center gap-1">
          <button
            type="button"
            title={paused ? 'Resume live research' : 'Pause live research'}
            aria-label={paused ? 'Resume live research' : 'Pause live research'}
            className="rounded p-1 text-faint transition-colors hover:bg-surface-2 hover:text-content"
            onClick={() => (paused ? living.resume() : living.pause())}
          >
            {paused ? <Play className="h-3 w-3" /> : <Pause className="h-3 w-3" />}
          </button>
          <button
            type="button"
            title={expanded ? 'Collapse activity' : 'Show activity'}
            className="rounded p-1 text-faint transition-colors hover:bg-surface-2 hover:text-content"
            onClick={() => setExpanded((e) => !e)}
          >
            {expanded ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
          </button>
        </span>
      </div>
      {paused && <p className="px-3 pb-2 text-[11px] text-muted">Background research is paused across this app. Opening tabs and manual checks can still use your key; work already sent may finish.</p>}
      {storageError && <p role="alert" className="px-3 pb-2 text-[11px] text-muted">{storageError}</p>}
      {expanded && (
        <div className="border-t border-border px-3 py-1.5">
          {visible.length > 0 ? (
            visible.map((e) => <EventRow key={e.id} event={e} now={now} />)
          ) : (
            <p className="py-1 text-[11px] text-faint">No research activity yet this session.</p>
          )}
        </div>
      )}
    </div>
  );
}
