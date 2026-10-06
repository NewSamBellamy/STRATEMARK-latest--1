import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { BadgeCheck, CircleHelp, ExternalLink, Info, Sigma, UserCheck, X } from 'lucide-react';
import type { Citation, Confidence } from '@mi/contracts';
import { CONFIDENCE_LABELS, isRedirectCitation, publisherOf } from '@mi/contracts';
import { cn } from '@/lib/cn';
import { CONFIDENCE_STYLES } from '@/lib/format';
import { Tooltip } from '@/components/ui/Tooltip';

const ICON = {
  verified: BadgeCheck,
  estimated: Sigma,
  unknown: CircleHelp,
  user_verified: UserCheck,
} as const;

/**
 * "How do I know this is verified?" — the answer, one click away.
 *
 * A confidence badge with evidence becomes a button that opens the receipts:
 * every publisher behind that exact figure, linked. Grounding URLs are opaque
 * Google redirects, so we show the PUBLISHER name (which we get from the
 * citation title) and warn that the link itself may expire.
 */
export function ConfidenceBadge({
  confidence,
  note,
  source,
  citations = [],
  metricLabel,
}: {
  confidence: Confidence;
  note?: string | null;
  source?: string | null;
  citations?: Citation[];
  /** e.g. "ARR" — names the figure inside the evidence panel. */
  metricLabel?: string;
}) {
  const Icon = ICON[confidence];
  const [open, setOpen] = useState(false);
  const btnRef = useRef<HTMLButtonElement>(null);
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null);

  const sourceIsUrl = !!source && /^https?:\/\//i.test(source);
  const hasEvidence = citations.length > 0 || !!source;
  const interactive = hasEvidence && confidence !== 'unknown';

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  const tip = interactive
    ? 'Click to see the sources behind this figure'
    : confidence === 'estimated'
      ? (note ?? 'Estimated from indirect signals via a stated method.')
      : confidence === 'user_verified'
        ? (note ?? 'Manually corrected by you — treated as ground truth for scoring.')
        : (note?.trim() || 'No usable signal found — shown as Unknown (never scored as zero).');

  const badge = (
    <span
      className={cn('chip', CONFIDENCE_STYLES[confidence], interactive ? 'cursor-pointer' : 'cursor-help')}
      aria-label={`Confidence: ${CONFIDENCE_LABELS[confidence]}. ${tip}`}
    >
      <Icon className="h-3 w-3" aria-hidden />
      {CONFIDENCE_LABELS[confidence]}
    </span>
  );

  if (!interactive) return <Tooltip content={tip}>{badge}</Tooltip>;

  return (
    <>
      <button
        ref={btnRef}
        type="button"
        title={tip}
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={(e) => {
          e.stopPropagation();
          const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
          setPos({
            x: Math.min(r.left, window.innerWidth - 340),
            y: Math.min(r.bottom + 6, window.innerHeight - 220),
          });
          setOpen((o) => !o);
        }}
        className="inline-flex focus-visible:outline-none"
      >
        {badge}
      </button>

      {open &&
        pos &&
        createPortal(
          <>
            <div
              className="fixed inset-0 z-[80]"
              onClick={(e) => {
                e.stopPropagation();
                setOpen(false);
              }}
            />
            <div
              role="dialog"
              aria-label="Sources for this figure"
              className="mi-modal-in fixed z-[81] w-[320px] rounded-xl border border-border bg-surface p-3.5 shadow-card"
              style={{ left: pos.x, top: pos.y }}
              onClick={(e) => e.stopPropagation()}
            >
              <div className="mb-2 flex items-start justify-between gap-2">
                <div>
                  <p className="text-[10px] font-semibold uppercase tracking-widest text-muted">
                    {CONFIDENCE_LABELS[confidence]}
                    {metricLabel ? ` · ${metricLabel}` : ''}
                  </p>
                  <p className="font-display text-sm font-semibold text-content">
                    {citations.length > 0
                      ? `${citations.length} source${citations.length === 1 ? '' : 's'}`
                      : 'Attribution'}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setOpen(false)}
                  aria-label="Close sources"
                  className="rounded p-0.5 text-faint hover:text-content"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>

              {citations.length > 0 ? (
                <ul className="space-y-1.5">
                  {citations.map((c, i) => (
                    <li key={i}>
                      <a
                        href={c.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex items-start gap-1.5 rounded-md px-1.5 py-1 text-xs text-primary-ink hover:bg-surface-2"
                      >
                        <ExternalLink className="mt-0.5 h-3 w-3 shrink-0" />
                        <span className="min-w-0">
                          <span className="block truncate font-medium">
                            {publisherOf(c.url, c.title)}
                          </span>
                          {isRedirectCitation(c.url) && (
                            <span className="block text-[10px] text-faint">
                              via Google Search grounding
                            </span>
                          )}
                        </span>
                      </a>
                    </li>
                  ))}
                </ul>
              ) : sourceIsUrl ? (
                <a
                  href={source}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-1.5 text-xs text-primary-ink hover:underline"
                >
                  <ExternalLink className="h-3 w-3" />
                  {publisherOf(source)}
                </a>
              ) : (
                <p className="text-xs leading-relaxed text-content">{source}</p>
              )}

              {note && (
                <p className="mt-2.5 border-t border-border pt-2 text-[11px] italic leading-relaxed text-muted">
                  {note}
                </p>
              )}

              {citations.some((c) => isRedirectCitation(c.url)) && (
                <p className="mt-2.5 flex items-start gap-1.5 rounded-md bg-surface-2 px-2 py-1.5 text-[10px] leading-snug text-muted">
                  <Info className="mt-0.5 h-3 w-3 shrink-0" />
                  Grounding links are issued by Google Search and can expire. The publisher name
                  above is the durable record of where this figure came from.
                </p>
              )}
            </div>
          </>,
          document.body,
        )}
    </>
  );
}
