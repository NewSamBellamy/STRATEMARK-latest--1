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
import { SettingsLink } from '@/components/SettingsLink';
import type { LivingDeckState } from '@/lib/living/useLivingDeck';
import type { AgentActivityEvent } from '@/lib/living/runtime';

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
      <p className="min-w-0 flex-1 text-[11px] leading-snug text-white/75">
        {event.message}
        {event.citations != null && event.citations > 0 && (
          <span className="text-white/45">
            {' '}
            · {event.citations} source{event.citations === 1 ? '' : 's'}
          </span>
        )}
      </p>
      <span className="shrink-0 text-[10px] tabular-nums text-white/45">{ago(event.at, now)}</span>
    </div>
  );
}

export function AgentActivityFeed({ living }: { living: LivingDeckState }) {
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
  const status = !living.canVerify ? 'Snapshot' : paused ? 'Paused' : active ? 'Live' : 'Resting';

  return (
    <section
      className="mt-4 overflow-hidden rounded-xl border border-[#285149] bg-[#12352f] text-white shadow-soft"
      aria-label="Market research desk"
    >
      <div className="flex min-h-[58px] items-center gap-3 px-4 py-2.5">
        <span className="relative grid h-8 w-8 shrink-0 place-items-center rounded-full border border-white/10 bg-white/10 text-[#92ead7]">
          {active && living.canVerify && (
            <span className="absolute inset-0 animate-ping rounded-full border border-[#77dbc7]/40" />
          )}
          <Radar className="relative h-4 w-4" aria-hidden="true" />
        </span>
        <span className="min-w-0">
          <span className="flex items-center gap-2">
            <strong className="text-[11px] font-semibold tracking-wide">
              Market research desk
            </strong>
            <span
              className={cn(
                'rounded-full border px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-[.12em]',
                active && living.canVerify
                  ? 'border-[#77dbc7]/40 bg-[#77dbc7]/10 text-[#9cf4df]'
                  : paused
                    ? 'border-amber-300/30 bg-amber-300/10 text-amber-200'
                    : 'border-white/15 bg-white/5 text-white/55',
              )}
            >
              {status}
            </span>
          </span>
          <span className="mt-0.5 block truncate text-[10.5px] text-white/55">
            {living.canVerify
              ? `${living.deskCount} company researcher${living.deskCount === 1 ? '' : 's'}${living.actionCount > 0 ? ` · ${living.actionCount} verified action${living.actionCount === 1 ? '' : 's'} this session` : ''}`
              : `Connect Gemini to activate ${living.deskCount} company researcher${living.deskCount === 1 ? '' : 's'}`}
          </span>
        </span>
        {!expanded && latest && (
          <span className="hidden min-w-0 flex-1 truncate border-l border-white/10 pl-3 text-[10.5px] text-white/55 lg:inline">
            <CircleDot className="mr-1 inline h-2.5 w-2.5 text-[#77dbc7]" />
            {latest.message}
          </span>
        )}
        <span className="ml-auto flex shrink-0 items-center gap-1">
          {!living.canVerify && (
            <SettingsLink className="rounded-md border border-white/15 bg-white/10 px-2 py-1 text-[10px] font-semibold text-white hover:bg-white/15">
              Connect key
            </SettingsLink>
          )}
          {living.canVerify && (
            <button
              type="button"
              title={paused ? 'Resume live research' : 'Pause live research'}
              className="rounded p-1.5 text-white/55 transition-colors hover:bg-white/10 hover:text-white"
              onClick={() => (paused ? living.resume() : living.pause())}
            >
              {paused ? <Play className="h-3.5 w-3.5" /> : <Pause className="h-3.5 w-3.5" />}
            </button>
          )}
          <button
            type="button"
            title={expanded ? 'Collapse activity' : 'Show activity'}
            className="rounded p-1.5 text-white/55 transition-colors hover:bg-white/10 hover:text-white"
            onClick={() => setExpanded((e) => !e)}
          >
            {expanded ? (
              <ChevronUp className="h-3.5 w-3.5" />
            ) : (
              <ChevronDown className="h-3.5 w-3.5" />
            )}
          </button>
        </span>
      </div>
      {expanded && (
        <div className="border-t border-white/10 bg-black/10 px-4 py-2">
          {visible.length > 0 ? (
            visible.map((e) => <EventRow key={e.id} event={e} now={now} />)
          ) : (
            <p className="py-1 text-[11px] text-white/45">No research activity yet this session.</p>
          )}
        </div>
      )}
    </section>
  );
}
