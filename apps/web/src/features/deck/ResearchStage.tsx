/**
 * The research stage — the most emotionally important screen in the app.
 *
 * Two views of the same live run, switchable:
 *  · Live log  — the glass box. The agent's actual steps, streaming. Earns trust.
 *  · Market brief — a cinematic, auto-advancing carousel that primes you on the
 *    market while you wait. Every card is built from data ALREADY streaming in
 *    (scope, search angles, companies found, gaps). Nothing is invented; the
 *    two "how this works" cards are labelled as method, not findings.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { Compass, Layers, ListTree, Loader2, Radio, ShieldCheck, Terminal } from 'lucide-react';
import { cn } from '@/lib/cn';

export interface LogLine {
  message: string;
  kind: 'step' | 'find' | 'warn';
  at: number;
}

interface Insight {
  id: string;
  eyebrow: string;
  body: string;
  icon: typeof Compass;
  /** Method explainers are labelled so they're never mistaken for findings. */
  method?: boolean;
}

/** Build carousel cards out of the real event stream. */
function deriveInsights(lines: LogLine[]): Insight[] {
  const out: Insight[] = [];
  const text = (re: RegExp) => lines.find((l) => re.test(l.message))?.message;

  const scope = text(/^Market defined/i);
  if (scope) {
    out.push({
      id: 'scope',
      eyebrow: 'The market, as defined',
      body: scope.replace(/^Market defined:\s*/i, ''),
      icon: Compass,
    });
  }

  const angles = text(/^Angles/i);
  if (angles) {
    out.push({
      id: 'angles',
      eyebrow: 'How we’re looking',
      body: angles.replace(/^Angles:\s*/i, ''),
      icon: ListTree,
    });
  }

  // Companies as they surface — the most satisfying beat to watch.
  const found = lines
    .filter((l) => l.kind === 'find' && /^(Found|Discovered|Added)/i.test(l.message))
    .map((l) => l.message.replace(/^(Found|Discovered|Added)[:\s]*/i, ''));
  if (found.length) {
    out.push({
      id: 'players',
      eyebrow: `Players surfacing · ${found.length}`,
      body: found.slice(-6).join(' · '),
      icon: Radio,
    });
  }

  const warns = lines.filter((l) => l.kind === 'warn');
  if (warns.length) {
    out.push({
      id: 'gaps',
      eyebrow: `Gaps we’re being honest about · ${warns.length}`,
      body: warns
        .slice(-2)
        .map((w) => w.message)
        .join(' · '),
      icon: ShieldCheck,
    });
  }

  // Method primers — always present, clearly labelled, so the carousel has
  // substance in the first seconds before findings arrive.
  out.push({
    id: 'signals',
    eyebrow: 'What we capture per company',
    body: 'Market share, ARR, valuation or market cap, team size, and user footprint — then a coarse scale band from available size signals, not a rating of growth or company quality.',
    icon: Layers,
    method: true,
  });
  out.push({
    id: 'discipline',
    eyebrow: 'The rule we don’t break',
    body: 'Every figure is tagged verified, estimated, or unknown, with a source. Anything we can’t stand behind stays Unknown — we never invent a number to fill a gap.',
    icon: ShieldCheck,
    method: true,
  });

  return out;
}

function LiveLog({ lines }: { lines: LogLine[] }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (ref.current) ref.current.scrollTop = ref.current.scrollHeight;
  }, [lines.length]);
  const color = (k: LogLine['kind']) =>
    k === 'find' ? 'text-[#9cf4df]' : k === 'warn' ? 'text-amber-300' : 'text-[#8ecdbf]';
  const prefix = (k: LogLine['kind']) => (k === 'find' ? '✓' : k === 'warn' ? '!' : '▸');
  return (
    <div
      ref={ref}
      className="h-60 overflow-y-auto rounded-xl bg-[#12352f] p-4 font-mono text-[12.5px] leading-relaxed shadow-inner"
      aria-live="polite"
      aria-label="Live research log"
    >
      {lines.map((l, i) => (
        <div key={i} className="flex gap-2">
          <span className={cn('shrink-0', color(l.kind))}>{prefix(l.kind)}</span>
          {/*
            Explicit hex, deliberately NOT `text-neutral-*`: this project's
            tailwind config redefines `neutral` as a single flat sentiment color,
            so `text-neutral-300` emits no class and the text silently inherits
            the app's dark ink — dark-on-black, invisible. That was the original
            "why is this panel so dark" bug.
          */}
          <span className={l.kind === 'find' ? 'text-white' : 'text-[#d6e7e1]'}>{l.message}</span>
        </div>
      ))}
      <div className="mt-1 text-[#76a69a]">
        <span className="animate-pulse">▮</span>
      </div>
    </div>
  );
}

function MarketBrief({ insights }: { insights: Insight[] }) {
  const [i, setI] = useState(0);
  const [paused, setPaused] = useState(false);
  const count = insights.length;

  // Keep the index in range as new insights stream in.
  useEffect(() => {
    if (i >= count) setI(0);
  }, [count, i]);

  useEffect(() => {
    if (paused || count <= 1) return;
    const t = setTimeout(() => setI((n) => (n + 1) % count), 5200);
    return () => clearTimeout(t);
  }, [i, paused, count]);

  if (!count) return null;
  const active = insights[Math.min(i, count - 1)]!;
  const Icon = active.icon;

  return (
    <div
      className="relative flex h-60 flex-col justify-between overflow-hidden rounded-xl border border-[#cfe1db] bg-gradient-to-br from-[#f9fbf7] to-[#eaf6f1] p-5"
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      aria-live="polite"
    >
      <div key={active.id} className="mi-brief-in">
        <div className="flex items-center gap-2 text-primary-ink">
          <Icon className="h-4 w-4" />
          <span className="text-[10.5px] font-semibold uppercase tracking-[0.18em]">
            {active.eyebrow}
          </span>
          {active.method && (
            <span className="chip border-border px-1.5 py-0 text-[9px] uppercase tracking-wide text-faint">
              how it works
            </span>
          )}
        </div>
        <p className="mt-3 max-w-2xl font-display text-[19px] font-medium leading-snug text-content">
          {active.body}
        </p>
      </div>

      <div className="flex items-center gap-1.5">
        {insights.map((s, n) => (
          <button
            key={s.id}
            type="button"
            aria-label={`Show ${s.eyebrow}`}
            onClick={() => setI(n)}
            className={cn(
              'h-1.5 rounded-full transition-all',
              n === i ? 'w-6 bg-primary' : 'w-1.5 bg-border hover:bg-faint',
            )}
          />
        ))}
        <span className="ml-auto text-[10px] text-faint">
          {paused ? 'paused' : 'auto-advancing'}
        </span>
      </div>
    </div>
  );
}

export function ResearchStage({
  lines,
  message,
  pct,
}: {
  lines: LogLine[];
  message: string;
  pct: number;
}) {
  const [tab, setTab] = useState<'log' | 'brief'>('log');
  const insights = useMemo(() => deriveInsights(lines), [lines]);

  return (
    <div className="mt-6 rounded-2xl border border-[#cfe1db] bg-surface p-6 shadow-soft">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <Loader2 className="h-5 w-5 animate-spin text-muted" />
          <span className="font-medium text-content">Researching your market…</span>
        </div>
        {/* Switch between watching the work and reading the brief. */}
        <div className="flex items-center gap-1 rounded-full border border-border bg-surface-2 p-1">
          {(
            [
              ['log', 'Live log', Terminal],
              ['brief', 'Market brief', Compass],
            ] as const
          ).map(([id, label, Icon]) => (
            <button
              key={id}
              type="button"
              onClick={() => setTab(id)}
              aria-pressed={tab === id}
              className={cn(
                'inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium transition-colors',
                tab === id
                  ? 'bg-surface text-content shadow-soft'
                  : 'text-muted hover:text-content',
              )}
            >
              <Icon className="h-3.5 w-3.5" />
              {label}
            </button>
          ))}
        </div>
      </div>

      <div className="mt-4 h-2 w-full overflow-hidden rounded-full bg-surface-2">
        <div
          className="h-full rounded-full bg-primary transition-all duration-500"
          style={{ width: `${Math.round(Math.min(1, pct) * 100)}%` }}
        />
      </div>
      <p className="mt-3 text-sm text-muted">{message}</p>

      <div className="mt-4">
        {tab === 'log' ? <LiveLog lines={lines} /> : <MarketBrief insights={insights} />}
      </div>

      <p className="mt-3 text-xs text-muted">
        {tab === 'log'
          ? 'You’re watching the agent’s actual research steps — grounded Google searches, companies found, and cards assembled. This typically takes a few minutes.'
          : 'A read on the market while the deck builds. Findings come from this run; “how it works” cards explain the method.'}
      </p>
    </div>
  );
}
