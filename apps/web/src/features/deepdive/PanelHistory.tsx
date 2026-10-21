/**
 * The Ask panel's history: a plain list, newest first, one tap to open (like the conversation lists in ChatGPT and
 * Claude). Two groups: what this card has (its conversations and reports) and every recent conversation. It reads
 * what is stored; it never calls a model.
 */
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { FileText, MessagesSquare } from 'lucide-react';
import type { Report, ResearchThread } from '@mi/contracts';
import { useRepository } from '@/lib/repository/RepositoryProvider';
import { useReports } from '@/hooks/data';
import { formatRelative } from '@/lib/format';

/** How a card's conversations are looked up: one card id, or a company (a company card with no single card id). */
export interface MemoryKey {
  cardId?: string;
  companyId?: string;
}

const newestFirst = (a: ResearchThread, b: ResearchThread) => (a.updatedAt < b.updatedAt ? 1 : a.updatedAt > b.updatedAt ? -1 : 0);

export function sortThreadsNewest(list: ResearchThread[]): ResearchThread[] {
  return [...list].sort(newestFirst);
}

function Row({ title, meta, onClick, to, icon }: { title: string; meta: string; onClick?: () => void; to?: string; icon: 'chat' | 'report' }) {
  const body = (
    <>
      {icon === 'chat' ? <MessagesSquare className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted" /> : <FileText className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted" />}
      <span className="min-w-0">
        <span className="block truncate text-[13px] text-content">{title}</span>
        <span className="block truncate text-[11px] text-faint">{meta}</span>
      </span>
    </>
  );
  const cls = 'flex w-full items-start gap-2.5 rounded-lg px-2 py-2 text-left hover:bg-surface-2';
  return (
    <li>
      {to ? <Link to={to} className={cls} onClick={onClick}>{body}</Link> : <button type="button" className={cls} onClick={onClick}>{body}</button>}
    </li>
  );
}

export function PanelHistory({
  memoryKey,
  cardLabel,
  currentThreadId,
  onOpenThread,
  onOpenReport,
}: {
  memoryKey: MemoryKey | null;
  cardLabel: string | null;
  currentThreadId?: string | null;
  onOpenThread: (id: string) => void;
  onOpenReport: () => void;
}) {
  const repo = useRepository();
  const allReports = useReports();
  const canList = typeof repo.listResearchThreads === 'function';

  const here = useQuery({
    queryKey: ['researchThreads', 'panelCard', memoryKey?.cardId ?? '', memoryKey?.companyId ?? ''],
    enabled: canList && memoryKey !== null,
    queryFn: async (): Promise<{ threads: ResearchThread[]; reports: Report[] }> => {
      if (memoryKey?.cardId && typeof repo.getCardMemory === 'function') {
        const m = await repo.getCardMemory(memoryKey.cardId);
        return { threads: m.threads, reports: m.reports };
      }
      const threads = await repo.listResearchThreads!(memoryKey!.cardId ? { cardId: memoryKey!.cardId } : { companyId: memoryKey!.companyId });
      return { threads, reports: [] };
    },
  });
  const recent = useQuery({
    queryKey: ['researchThreads', 'panelRecent'],
    enabled: canList,
    queryFn: () => repo.listResearchThreads!(),
  });

  const reportByThread = new Map<string, string>();
  for (const r of allReports.data ?? []) for (const id of r.threadIds ?? []) reportByThread.set(id, r.id);
  const reportMade = (t: ResearchThread) => Boolean(t.reportId) || reportByThread.has(t.id);
  const meta = (t: ResearchThread, extra?: string | null) =>
    [extra, formatRelative(t.updatedAt), reportMade(t) ? 'report made' : null].filter(Boolean).join(' · ');

  const thisCardThreads = sortThreadsNewest(here.data?.threads ?? []);
  const thisCardReports = [...(here.data?.reports ?? [])].sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
  // "This card" is one list, newest first: conversations and reports interleaved by when they were last used.
  const thisCard = [
    ...thisCardThreads.map((t) => ({ kind: 'thread' as const, at: t.updatedAt, thread: t })),
    ...thisCardReports.map((r) => ({ kind: 'report' as const, at: r.createdAt, report: r })),
  ].sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0));
  const recentThreads = sortThreadsNewest(recent.data ?? []).slice(0, 30);

  return (
    <div className="min-h-0 flex-1 overflow-y-auto px-3 py-3" aria-label="Conversation history">
      {memoryKey && (
        <section aria-label="This card">
          <h3 className="px-2 pb-1 text-[10px] font-semibold uppercase tracking-widest text-faint">This card</h3>
          {thisCard.length === 0 ? (
            <p className="px-2 pb-2 text-[12px] text-muted">{cardLabel ? `Nothing yet for ${cardLabel}.` : 'Nothing yet for this card.'} Ask a question and it is kept here.</p>
          ) : (
            <ul>
              {thisCard.map((item) =>
                item.kind === 'thread' ? (
                  <Row key={`t_${item.thread.id}`} icon="chat" title={item.thread.title} meta={meta(item.thread, item.thread.id === currentThreadId ? 'Open now' : null)}
                    onClick={() => onOpenThread(item.thread.id)} />
                ) : (
                  <Row key={`r_${item.report.id}`} icon="report" title={item.report.title} meta={`Report · ${formatRelative(item.report.createdAt)}`}
                    to={`/reports/${item.report.id}`} onClick={onOpenReport} />
                ),
              )}
            </ul>
          )}
        </section>
      )}
      <section aria-label="Recent" className={memoryKey ? 'mt-4' : undefined}>
        <h3 className="px-2 pb-1 text-[10px] font-semibold uppercase tracking-widest text-faint">Recent</h3>
        {recentThreads.length === 0 ? (
          <p className="px-2 text-[12px] text-muted">No conversations yet. Every chat you start is saved here.</p>
        ) : (
          <ul>
            {recentThreads.map((t) => (
              <Row key={t.id} icon="chat" title={t.title} meta={meta(t, t.scope.subject ?? null)} onClick={() => onOpenThread(t.id)} />
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
