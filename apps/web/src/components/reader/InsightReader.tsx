/**
 * InsightReader v2 — clicking a claim opens a genuine trading card, not the
 * same sentence in a bigger window (the founder's exact complaint).
 *
 * Every card carries the stored text and THE FULL STORY — a grounded
 * deep-dive that auto-runs on open (cached per
 *     item for the session), with citations. Depth is the point of the click.
 */
import { useEffect, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import {
  CalendarDays,
  ExternalLink,
  Loader2,
  ThumbsDown,
  ThumbsUp,
  Milestone,
  Map as MapIcon,
} from 'lucide-react';
import { publisherOf, type Citation } from '@mi/contracts';
import { Modal } from '@/components/ui/Modal';
import { DigDeeper } from '@/features/deepdive/DeepDive';
import { useRepository } from '@/lib/repository/RepositoryProvider';
import { isDirectSource, sourceHref } from '@/lib/sourceHref';
import { cn } from '@/lib/cn';

export type InsightTone = 'positive' | 'negative' | 'milestone' | 'roadmap';

const TONE: Record<InsightTone, { kicker: string; cls: string; Icon: typeof ThumbsUp }> = {
  positive: {
    kicker: 'Positive signal',
    cls: 'text-positive border-emerald-200 bg-emerald-50/60 dark:border-emerald-900 dark:bg-emerald-950/30',
    Icon: ThumbsUp,
  },
  negative: {
    kicker: 'Concern',
    cls: 'text-negative border-rose-200 bg-rose-50/60 dark:border-rose-900 dark:bg-rose-950/30',
    Icon: ThumbsDown,
  },
  milestone: {
    kicker: 'Milestone',
    cls: 'text-primary-ink border-border bg-surface-2/60',
    Icon: Milestone,
  },
  roadmap: {
    kicker: 'Roadmap',
    cls: 'text-primary-ink border-border bg-surface-2/60',
    Icon: MapIcon,
  },
};

/** One deep-dive per card per session — reopening is instant, never re-billed. */
const expansionCache = new Map<string, { markdown: string; citations: Citation[] }>();

export function InsightReader({
  open,
  onClose,
  tone,
  title,
  date,
  body,
  companyId,
  companyName,
  researchSeed,
}: {
  open: boolean;
  onClose: () => void;
  tone: InsightTone;
  title: string;
  date?: string | null;
  /** The stored text for this item. */
  body: string | null;
  companyId: string;
  companyName: string;
  /** What the grounded expansion should chase for the whole gist. */
  researchSeed: string;
}) {
  const repo = useRepository();
  const cacheKey = `${companyId}:${tone}:${title}`;
  const [expansion, setExpansion] = useState<{ markdown: string; citations: Citation[] } | null>(
    expansionCache.get(cacheKey) ?? null,
  );
  const [expanding, setExpanding] = useState(false);

  // THE DEPTH: auto-run the grounded deep-dive the moment the card opens.
  useEffect(() => {
    if (!open || expansion || expanding) return;
    const cached = expansionCache.get(cacheKey);
    if (cached) {
      setExpansion(cached);
      return;
    }
    let live = true;
    setExpanding(true);
    repo
      .deepDive({ companyId, companyName, topic: title, context: researchSeed })
      .then((r) => {
        const value = { markdown: r.markdown, citations: r.citations };
        expansionCache.set(cacheKey, value);
        if (live) setExpansion(value);
      })
      .catch(() => {
        /* the stored text still shows; the manual research path remains */
      })
      .finally(() => {
        if (live) setExpanding(false);
      });
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, cacheKey]);

  if (!open) return null;
  const t = TONE[tone];
  return (
    <Modal
      open
      onOpenChange={(o) => {
        if (!o) onClose();
      }}
      title={title}
      size="lg"
    >
      <div className="space-y-4">
        <div className="flex flex-wrap items-center gap-2">
          <span
            className={cn(
              'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[10px] font-semibold uppercase tracking-widest',
              t.cls,
            )}
          >
            <t.Icon className="h-3 w-3" />
            {t.kicker}
          </span>
          {date && (
            <span className="inline-flex items-center gap-1.5 text-xs text-muted">
              <CalendarDays className="h-3.5 w-3.5" />
              {date}
            </span>
          )}
        </div>

        {body && body.trim().length > 0 && (
          <p className="text-sm leading-relaxed text-content/90">{body}</p>
        )}

        {/* The full story — the reason the click exists. */}
        <div className="rounded-xl border border-border bg-surface-2/50 p-4">
          <h4 className="mb-2 text-[10px] font-semibold uppercase tracking-widest text-muted">
            The full story · grounded
          </h4>
          {expansion ? (
            <>
              <div className="markdown text-sm leading-relaxed text-content/90">
                <ReactMarkdown remarkPlugins={[remarkGfm]}>{expansion.markdown}</ReactMarkdown>
              </div>
              {expansion.citations.length > 0 && (
                <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1.5 border-t border-border pt-2.5">
                  {expansion.citations.slice(0, 5).map((c, i) => (
                    <a
                      key={i}
                      href={sourceHref(c.url, c.title)}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 text-[11px] text-primary-ink hover:underline"
                      title={isDirectSource(c.url) ? 'Read the source' : 'Find the original story'}
                    >
                      <ExternalLink className="h-3 w-3" />
                      {publisherOf(c.url, c.title)}
                    </a>
                  ))}
                </div>
              )}
            </>
          ) : expanding ? (
            <p className="flex items-center gap-2 py-2 text-sm text-muted">
              <Loader2 className="h-4 w-4 animate-spin" />A desk agent is researching the full story
              from live sources…
            </p>
          ) : (
            <p className="py-1 text-sm italic text-muted">
              The grounded expansion couldn’t run here — use "Keep researching" below.
            </p>
          )}
        </div>

        <div className="flex justify-end border-t border-border pt-3">
          <DigDeeper
            topic={title}
            companyId={companyId}
            companyName={companyName}
            context={researchSeed}
            label="Keep researching"
          />
        </div>
      </div>
    </Modal>
  );
}
