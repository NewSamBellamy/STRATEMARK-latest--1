/**
 * Shared research-conversation control: the thread-history dropdown (a deck's
 * or company's accumulated questions). It feature-detects the conversational
 * repository and hides itself on transports that haven't wired it. Reports
 * are created from the one Share & export menu, not from here.
 */
import { useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { History, MessagesSquare } from 'lucide-react';
import type { ResearchThread } from '@mi/contracts';
import { useRepository } from '@/lib/repository/RepositoryProvider';
import { useDeepDive } from '@/features/deepdive/DeepDive';
import { formatRelative } from '@/lib/format';
import { cn } from '@/lib/cn';
import { usePopoverSide } from '@/lib/usePopoverSide';

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
  compact = false,
  inMenu = false,
  onPick,
}: {
  deckId?: string;
  companyId?: string;
  className?: string;
  /** Match the deck's small bordered action buttons. */
  compact?: boolean;
  /** A row inside an actions menu: the list opens inline under the row. */
  inMenu?: boolean;
  /** Called after a thread is opened (so a parent menu can close). */
  onPick?: () => void;
}) {
  const repo = useRepository();
  const { openThread } = useDeepDive();
  const [open, setOpen] = useState(false);
  const ref = useDismiss(() => setOpen(false));
  const side = usePopoverSide(ref, open, 320);

  const threads = useQuery({
    queryKey: ['researchThreads', deckId ?? '', companyId ?? ''],
    queryFn: () => repo.listResearchThreads!({ deckId, companyId }),
    enabled: typeof repo.listResearchThreads === 'function',
  });

  if (typeof repo.listResearchThreads !== 'function') return null;
  const list: ResearchThread[] = threads.data ?? [];

  if (inMenu) {
    return (
      <div ref={ref} className={className}>
        <button
          type="button"
          className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left text-sm text-content hover:bg-surface-2"
          aria-expanded={open}
          onClick={() => setOpen((v) => !v)}
        >
          <History className="h-4 w-4 text-muted" />
          Past chats
          {list.length > 0 && (
            <span className="ml-auto rounded-full bg-surface-2 px-1.5 text-xs tabular-nums text-muted">{list.length}</span>
          )}
        </button>
        {open && (
          <div className="mx-1 mb-1 rounded-lg border border-border bg-surface-2/40 p-1">
            {list.length === 0 ? (
              <p className="px-2 py-1.5 text-[12px] text-muted">No conversations yet. Every thread you start is saved here.</p>
            ) : (
              <ul className="max-h-60 overflow-y-auto">
                {list.slice(0, 20).map((t) => (
                  <li key={t.id}>
                    <button
                      type="button"
                      className="w-full rounded-md px-2 py-1.5 text-left hover:bg-surface-2"
                      onClick={() => { setOpen(false); onPick?.(); openThread(t.id); }}
                    >
                      <span className="block truncate text-[13px] text-content">{t.title}</span>
                      <span className="text-[11px] text-faint">{formatRelative(t.updatedAt)}</span>
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

  return (
    <div className={cn('relative', className)} ref={ref}>
      <button
        type="button"
        className={compact
          ? 'inline-flex items-center gap-1.5 rounded-lg border border-border bg-surface px-3 py-1.5 text-[12px] font-medium text-content transition-colors hover:bg-surface-2'
          : 'btn-ghost'}
        onClick={() => setOpen((v) => !v)}
        title="Your past chats about this"
        aria-expanded={open}
      >
        <History className={compact ? "h-3.5 w-3.5" : "h-4 w-4"} />
        Chats
        {list.length > 0 && (
          <span className="ml-1 rounded-full bg-surface-2 px-1.5 text-xs tabular-nums text-muted">
            {list.length}
          </span>
        )}
      </button>
      {open && (
        <div className={cn('absolute z-40 mt-2 w-80 rounded-xl border border-border bg-surface p-2 shadow-card', side === 'left' ? 'left-0' : 'right-0')}>
          <p className="px-2 pb-1.5 pt-1 text-[10px] font-semibold uppercase tracking-widest text-faint">
            Chats
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
