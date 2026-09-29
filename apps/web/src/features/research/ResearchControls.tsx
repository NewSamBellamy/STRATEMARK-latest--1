/**
 * Shared research-conversation controls: the thread-history dropdown (a deck's
 * or company's accumulated questions) and the report button with a custom
 * focus prompt. Both feature-detect the conversational repository and hide
 * themselves on transports that haven't wired it.
 */
import { useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { FileText, History, MessagesSquare } from 'lucide-react';
import type { ResearchThread } from '@mi/contracts';
import { useRepository } from '@/lib/repository/RepositoryProvider';
import { useGenerateReport } from '@/hooks/data';
import { useDeepDive } from '@/features/deepdive/DeepDive';
import { formatRelative } from '@/lib/format';
import { cn } from '@/lib/cn';

/** Close-on-outside-click without a dependency. */
function useDismiss(onDismiss: () => void) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onDismiss();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onDismiss();
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [onDismiss]);
  return ref;
}

export function ThreadHistoryButton({
  deckId,
  companyId,
  className,
}: {
  deckId?: string;
  companyId?: string;
  className?: string;
}) {
  const repo = useRepository();
  const { openThread } = useDeepDive();
  const [open, setOpen] = useState(false);
  const ref = useDismiss(() => setOpen(false));

  const threads = useQuery({
    queryKey: ['researchThreads', deckId ?? '', companyId ?? ''],
    queryFn: () => repo.listResearchThreads!({ deckId, companyId }),
    enabled: typeof repo.listResearchThreads === 'function',
  });

  if (typeof repo.listResearchThreads !== 'function') return null;
  const list: ResearchThread[] = threads.data ?? [];

  return (
    <div className={cn('relative', className)} ref={ref}>
      <button
        type="button"
        className="btn-ghost"
        onClick={() => setOpen((v) => !v)}
        title="Your research conversations here"
        aria-expanded={open}
      >
        <History className="h-4 w-4" />
        Past research
        {list.length > 0 && (
          <span className="ml-1 rounded-full bg-surface-2 px-1.5 text-xs tabular-nums text-muted">
            {list.length}
          </span>
        )}
      </button>
      {open && (
        <div className="absolute right-0 z-40 mt-2 w-80 rounded-xl border border-border bg-surface p-2 shadow-card">
          <p className="px-2 pb-1.5 pt-1 text-[10px] font-semibold uppercase tracking-widest text-faint">
            Research history
          </p>
          {list.length === 0 ? (
            <p className="px-2 pb-2 text-sm text-muted">
              No conversations yet. Dig into any card, figure, or section — every thread is saved
              here.
            </p>
          ) : (
            <ul className="max-h-80 overflow-y-auto">
              {list.slice(0, 20).map((t) => (
                <li key={t.id}>
                  <button
                    type="button"
                    className="w-full rounded-lg px-2 py-2 text-left hover:bg-surface-2"
                    onClick={() => {
                      setOpen(false);
                      openThread(t.id);
                    }}
                  >
                    <span className="block truncate text-sm text-content">{t.title}</span>
                    <span className="mt-0.5 flex items-center gap-2 text-[11px] text-faint">
                      <MessagesSquare className="h-3 w-3" />
                      {Math.ceil(t.messages.length / 2)} exchange
                      {Math.ceil(t.messages.length / 2) === 1 ? '' : 's'}
                      <span>·</span>
                      {formatRelative(t.updatedAt)}
                      {t.reportId && (
                        <>
                          <span>·</span>
                          <span className="text-emerald-600">report saved</span>
                        </>
                      )}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * Generate a report with an optional focus prompt — "what should this report
 * concentrate on" — instead of a fixed one-size composition.
 */
export function ReportButton({
  kind,
  subjectId,
  className,
}: {
  kind: 'deck' | 'company';
  subjectId: string | undefined;
  className?: string;
}) {
  const generateReport = useGenerateReport();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [focus, setFocus] = useState('');
  const ref = useDismiss(() => setOpen(false));

  const run = () => {
    if (!subjectId) return;
    generateReport.mutate(
      { kind, subjectId, focus: focus.trim() || null },
      {
        onSuccess: (r) => {
          setOpen(false);
          setFocus('');
          navigate(`/reports/${r.id}`);
        },
      },
    );
  };

  return (
    <div className={cn('relative', className)} ref={ref}>
      <button
        type="button"
        className="btn-ghost"
        disabled={generateReport.isPending || !subjectId}
        title="Compose an executive report from the researched evidence"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
      >
        <FileText className={`h-4 w-4 ${generateReport.isPending ? 'animate-pulse' : ''}`} />
        {generateReport.isPending ? 'Composing…' : 'Report'}
      </button>
      {open && !generateReport.isPending && (
        <div className="absolute right-0 z-40 mt-2 w-80 rounded-xl border border-border bg-surface p-3 shadow-card">
          <label
            className="text-[11px] font-semibold uppercase tracking-wide text-muted"
            htmlFor={`report-focus-${kind}`}
          >
            Focus (optional)
          </label>
          <input
            id={`report-focus-${kind}`}
            className="input mt-1.5 py-2 text-sm"
            placeholder="e.g. who is winning enterprise, pricing pressure…"
            value={focus}
            onChange={(e) => setFocus(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') run();
            }}
          />
          <div className="mt-2 flex items-center justify-between gap-2">
            <p className="text-[11px] text-muted">
              Sourcing rules don’t change — focus steers emphasis.
            </p>
            <button
              type="button"
              className="btn-primary shrink-0 px-3 py-1.5 text-xs"
              onClick={run}
            >
              Compose
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
