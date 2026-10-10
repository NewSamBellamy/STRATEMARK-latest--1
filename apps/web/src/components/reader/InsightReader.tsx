/**
 * InsightReader v2 — clicking a claim opens a genuine trading card, not the
 * same sentence in a bigger window (the founder's exact complaint).
 *
 * Every card carries:
 *  1. A generated cover (nano banana, prompted from the item itself),
 *  2. The stored text, and
 *  3. THE FULL STORY — a grounded deep-dive the user explicitly requests
 *     (never auto-fired on open: reading a stored claim must not silently
 *     spend the key), cached per item for the session, with citations.
 */
import { useState } from 'react';
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
import { AiCover } from '@/components/media/AiCover';
import { DigDeeper } from '@/features/deepdive/DeepDive';
import { useRepository } from '@/lib/repository/RepositoryProvider';
import { isDirectSource, sourceHref } from '@/lib/sourceHref';
import { cn } from '@/lib/cn';

export type InsightTone = 'positive' | 'negative' | 'milestone' | 'roadmap';

const TONE: Record<InsightTone, { kicker: string; cls: string; Icon: typeof ThumbsUp }> = {
  positive: { kicker: 'Positive signal', cls: 'text-positive border-emerald-200 bg-emerald-50/60 dark:border-emerald-900 dark:bg-emerald-950/30', Icon: ThumbsUp },
  negative: { kicker: 'Concern', cls: 'text-negative border-rose-200 bg-rose-50/60 dark:border-rose-900 dark:bg-rose-950/30', Icon: ThumbsDown },
  milestone: { kicker: 'Milestone', cls: 'text-primary-ink border-border bg-surface-2/60', Icon: Milestone },
  roadmap: { kicker: 'Roadmap', cls: 'text-primary-ink border-border bg-surface-2/60', Icon: MapIcon },
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
  const [expandFailed, setExpandFailed] = useState(false);

  // THE DEPTH: on the user's explicit request, not on open. Opening a stored
  // claim costs nothing; expanding it is a deliberate research spend. The
  // completeness gate runs first so known gaps get their shot at evidence;
  // its failure never blocks the expansion itself.
  const runExpansion = () => {
    if (expansion || expanding) return;
    setExpandFailed(false);
    setExpanding(true);
    const readiness = repo.ensureReportReadiness
      ? repo.ensureReportReadiness([companyId]).catch(() => undefined)
      : Promise.resolve();
    readiness
      .then(() =>
        repo.deepDive({ companyId, companyName, topic: title, context: researchSeed }))
      .then((r) => {
        const value = { markdown: r.markdown, citations: r.citations };
        expansionCache.set(cacheKey, value);
        setExpansion(value);
      })
      .catch(() => {
        // The stored text still shows; the manual research path remains.
        setExpandFailed(true);
      })
      .finally(() => setExpanding(false));
  };

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
        {/* The card face: generated cover, prompted from the item itself. */}
        <div className="h-[180px] overflow-hidden rounded-xl border border-border">
          <AiCover
            cacheKey={`insight:${cacheKey}`}
            title={`${companyName} — ${title}`}
            context={body ?? researchSeed}
            url=""
            source="news"
          />
        </div>

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
              <Loader2 className="h-4 w-4 animate-spin" />
              A desk agent is researching the full story from live sources…
            </p>
          ) : expandFailed ? (
            <p className="py-1 text-sm italic text-muted">
              The grounded expansion couldn’t run here — use “Keep researching” below.
            </p>
          ) : (
            <div className="py-1">
              <button type="button" className="btn-ghost text-xs" onClick={runExpansion}>
                <Loader2 className="h-3.5 w-3.5" />
                Research the full story
              </button>
            </div>
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
