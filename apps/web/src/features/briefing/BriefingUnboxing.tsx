/**
 * The unboxing — a Daily Briefing arrives as a sealed pack on a dark stage,
 * and opening it is a moment: foil edge, sheen, a 3D flip, then the day's
 * high-signal updates popping in one by one before the full report opens.
 *
 * Cinematic but honest: every number and one-liner on the card is real
 * briefing content. Pure CSS (no libraries), quiet under reduced-motion,
 * and brand-true — the stage glow, foil, and chips all run on the teal
 * primary rather than a borrowed casino palette.
 */
import { useMemo, useState } from 'react';
import { formatDateLong } from '@/lib/format';
import { ArrowRight, CalendarDays, Newspaper } from 'lucide-react';
import { cn } from '@/lib/cn';
import wordmark from '@/assets/wordmark.svg';

export interface UnboxingContent {
  marketName: string;
  generatedAt: string;
  windowHours: number;
  headline: string;
  /** High-signal one-liners, reveal order. */
  highSignal: string[];
  /** Total sourced updates in the briefing. */
  updateCount: number;
}

export function BriefingUnboxing({
  content,
  ctaLabel = 'Read the full briefing',
  onOpen,
}: {
  content: UnboxingContent;
  ctaLabel?: string;
  onOpen: () => void;
}) {
  const [flipped, setFlipped] = useState(false);
  const date = useMemo(
    () =>
      formatDateLong(content.generatedAt, { weekday: true }),
    [content.generatedAt],
  );
  const highs = content.highSignal.slice(0, 4);
  const quiet = content.updateCount === 0;

  return (
    <div className="brf-stage relative flex min-h-[540px] flex-col items-center justify-center overflow-hidden rounded-2xl border border-border px-4 py-10">
      {/* Stage caption */}
      <p className="mb-6 text-[11px] font-semibold uppercase tracking-[0.3em] text-teal-200/70">
        {flipped ? date : 'A briefing has arrived'}
      </p>

      <div className="brf-scene">
        {/* Burst ring fires once on flip. */}
        {flipped && (
          <span
            aria-hidden
            className="brf-burst pointer-events-none absolute left-1/2 top-1/2 h-[420px] w-[340px] -translate-x-1/2 -translate-y-1/2 rounded-[28px] border-2 border-teal-300/50"
          />
        )}
        <div
          className={cn('brf-card relative h-[440px] w-[320px] sm:h-[460px] sm:w-[340px]', flipped && 'brf-flipped')}
        >
          {/* ── Sealed face ── */}
          <button
            type="button"
            onClick={() => setFlipped(true)}
            disabled={flipped}
            aria-label="Unbox today's briefing"
            className={cn(
              'brf-face brf-foil brf-sheen absolute inset-0 flex flex-col items-center justify-between overflow-hidden rounded-[22px] p-7 text-left shadow-[0_24px_70px_-18px_rgba(13,148,136,0.45)]',
              !flipped && 'brf-float cursor-pointer',
            )}
          >
            <p className="self-start text-[10px] font-semibold uppercase tracking-[0.28em] text-teal-200/80">
              Stratemark
            </p>
            <div className="flex flex-col items-center gap-5">
              <img src={wordmark} alt="" className="h-16 w-16 opacity-95 drop-shadow-[0_0_24px_rgba(45,212,191,0.45)]" />
              <div className="text-center">
                <p className="font-display text-[22px] font-bold tracking-tight text-teal-50">
                  Daily Briefing
                </p>
                <p className="mt-1 max-w-[220px] truncate text-[13px] text-teal-100/70">{content.marketName}</p>
              </div>
            </div>
            <div className="flex w-full items-center justify-between">
              <span className="inline-flex items-center gap-1.5 text-[11px] text-teal-100/60">
                <CalendarDays className="h-3.5 w-3.5" />
                {date}
              </span>
              <span className="inline-flex items-center gap-1.5 rounded-full bg-teal-400/15 px-3 py-1.5 text-[11px] font-semibold text-teal-100 ring-1 ring-inset ring-teal-300/40">
                <ArrowRight className="h-3.5 w-3.5" />
                Tap to unbox
              </span>
            </div>
          </button>

          {/* ── Revealed face ── */}
          <div className="brf-face brf-back absolute inset-0 flex flex-col overflow-hidden rounded-[22px] border border-teal-400/25 bg-[#0c1626] p-6 shadow-[0_24px_70px_-18px_rgba(13,148,136,0.45)]">
            <div className="flex items-center justify-between">
              <p className="text-[10px] font-semibold uppercase tracking-[0.28em] text-teal-200/80">
                {content.marketName}
              </p>
              <Newspaper className="h-4 w-4 text-teal-300/70" />
            </div>
            <p className="mt-3 font-display text-[30px] font-bold leading-none tracking-tight text-teal-50">
              {content.updateCount}
              <span className="ml-2 align-middle text-[13px] font-medium tracking-normal text-teal-100/70">
                sourced update{content.updateCount === 1 ? '' : 's'} · last {content.windowHours}h
              </span>
            </p>
            <div className="mt-4 min-h-0 flex-1 space-y-2 overflow-hidden">
              {flipped &&
                (quiet ? (
                  <p
                    className="brf-item-in rounded-xl border border-teal-400/15 bg-teal-400/5 px-3.5 py-3 text-[13px] leading-snug text-teal-100/80"
                    style={{ animationDelay: '0.65s' }}
                  >
                    A quiet window — nothing credible was published about your tracked companies.
                    That silence is a finding, not a failure.
                  </p>
                ) : (
                  highs.map((line, i) => (
                    <p
                      key={i}
                      className="brf-item-in rounded-xl border border-teal-400/15 bg-teal-400/5 px-3.5 py-2.5 text-[12.5px] leading-snug text-teal-50/90"
                      style={{ animationDelay: `${0.65 + i * 0.35}s` }}
                    >
                      <span className="mr-1.5 font-bold text-teal-300">•</span>
                      {line}
                    </p>
                  ))
                ))}
            </div>
            {flipped && (
              <button
                type="button"
                onClick={onOpen}
                className="brf-item-in mt-4 inline-flex w-full items-center justify-center gap-2 rounded-xl bg-teal-400 px-4 py-3 text-[13px] font-semibold text-[#062a26] transition-colors hover:bg-teal-300"
                style={{ animationDelay: `${0.7 + Math.max(highs.length, 1) * 0.35}s` }}
              >
                {ctaLabel}
                <ArrowRight className="h-4 w-4" />
              </button>
            )}
          </div>
        </div>
      </div>

      <p className="mt-7 max-w-sm text-center text-[11px] leading-relaxed text-teal-100/40">
        {flipped
          ? content.headline
          : 'Every update inside is grounded in sources published within the window — nothing invented to fill space.'}
      </p>
    </div>
  );
}
