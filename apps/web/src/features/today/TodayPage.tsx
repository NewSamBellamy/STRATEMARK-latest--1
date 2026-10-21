import { CheckCircle, Circle, Sun, X } from '@phosphor-icons/react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import type { CompanyMove, MoveKind } from '@mi/contracts';
import { EmptyState } from '@/components/states/EmptyState';
import { cn } from '@/lib/cn';
import { formatRelative } from '@/lib/format';
import { safeHttpUrl } from '@/lib/sourceHref';
import { useFollows, useMarkMoveRead, useMoves, useRefreshMoves, useUnfollowCompany } from '@/hooks/today';
import { TodayCompanyView } from './TodayCompanyView';

const KIND_LABEL: Record<MoveKind, string> = {
  funding: 'Funding', launch: 'Launch', hire: 'People', deal: 'Deal', filing: 'Filing',
};
const FILTERS: Array<{ id: 'all' | 'unread' | MoveKind; label: string }> = [
  { id: 'all', label: 'All' }, { id: 'unread', label: 'Unread' }, { id: 'funding', label: 'Funding' },
  { id: 'launch', label: 'Launches' }, { id: 'hire', label: 'People' }, { id: 'deal', label: 'Deals' }, { id: 'filing', label: 'Filings' },
];
const LAST_VISIT_KEY = 'mi.today.lastVisit';

/** When the user last opened Today (this device); the visit before this one decides what is "new". */
function useLastVisit(): string | null {
  const [since] = useState<string | null>(() => {
    try { return localStorage.getItem(LAST_VISIT_KEY); } catch { return null; }
  });
  useEffect(() => {
    try { localStorage.setItem(LAST_VISIT_KEY, new Date().toISOString()); } catch { /* no storage: everything unread stays visible */ }
  }, []);
  return since;
}

/** A filing's date is EDGAR's filing day (no time); a story's is its feed timestamp. */
function moveDate(move: CompanyMove): string {
  return new Date(move.publishedAt).toLocaleDateString(undefined, {
    month: 'short', day: 'numeric', year: 'numeric', ...(move.source === 'sec_filing' ? { timeZone: 'UTC' } : {}),
  });
}

function sourceName(move: CompanyMove): string {
  if (move.publisher) return move.publisher;
  try { return new URL(move.url).hostname.replace(/^www\./, ''); } catch { return 'Source'; }
}

export default function TodayPage() {
  const since = useLastVisit();
  const follows = useFollows();
  const moves = useMoves();
  const refresh = useRefreshMoves();
  const markRead = useMarkMoveRead();
  const unfollow = useUnfollowCompany();
  const [filter, setFilter] = useState<(typeof FILTERS)[number]['id']>('all');
  const [params, setParams] = useSearchParams();
  const selected = params.get('company');
  const select = (id: string | null) => setParams(id ? { company: id } : {}, { replace: false });
  const followCount = follows.data?.length ?? 0;

  // The daily look runs when Today opens; the engine skips companies it looked at in the last day.
  const asked = useRef(false);
  useEffect(() => {
    if (asked.current || !followCount) return;
    asked.current = true;
    refresh.mutate(false);
  }, [followCount, refresh]);

  const all = moves.data ?? [];
  const isNew = (move: CompanyMove) => !move.readAt && (!since || move.foundAt > since);
  const newCount = all.filter(isNew).length;
  const unreadCount = all.filter((move) => !move.readAt).length;
  const shown = useMemo(() => (moves.data ?? []).filter((move) =>
    filter === 'all' ? true : filter === 'unread' ? !move.readAt : move.kind === filter), [moves.data, filter]);
  const checkedAt = refresh.data?.refreshedAt ?? null;

  return (
    <div className={cn('mx-auto', selected ? 'max-w-6xl' : 'max-w-3xl')}>
      <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-display text-[28px] font-bold tracking-tight text-content">Today</h1>
          <p className="mt-1 text-sm text-muted">
            {followCount
              ? <>
                  {newCount ? `${newCount} new since your last visit` : 'Nothing new since your last visit'}
                  {' · '}{unreadCount} unread{' · '}
                  {refresh.isPending ? 'checking now…' : `checked ${formatRelative(checkedAt)}`}
                </>
              : 'Funding, launches, hires, deals and filings of the companies you follow.'}
          </p>
        </div>
        {followCount > 0 && (
          <button type="button" className="btn-ghost text-sm" disabled={refresh.isPending}
            title="Look again now, even for companies checked today."
            onClick={() => refresh.mutate(true)}>
            {refresh.isPending ? 'Checking…' : 'Check now'}
          </button>
        )}
      </div>

      {followCount > 0 && (
        <nav className="mb-5 flex flex-wrap gap-1.5" aria-label="Companies on Today">
          <button type="button" aria-current={!selected ? 'page' : undefined}
            className={cn('rounded-full border px-3 py-1 text-xs font-medium transition-colors',
              !selected ? 'border-primary bg-primary/8 text-primary' : 'border-border text-muted hover:bg-surface-2 hover:text-content')}
            onClick={() => select(null)}>
            All companies
          </button>
          {(follows.data ?? []).map((follow) => {
            const unreadHere = all.filter((m) => m.companyId === follow.companyId && !m.readAt).length;
            return (
              <button key={follow.companyId} type="button" aria-current={selected === follow.companyId ? 'page' : undefined}
                className={cn('inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium transition-colors',
                  selected === follow.companyId ? 'border-primary bg-primary/8 text-primary' : 'border-border text-muted hover:bg-surface-2 hover:text-content')}
                onClick={() => select(follow.companyId)}>
                {follow.companyName ?? follow.companyId}
                {unreadHere > 0 && <span className="rounded-full bg-primary px-1.5 text-[10px] font-semibold text-white" aria-label={`${unreadHere} unread`}>{unreadHere}</span>}
              </button>
            );
          })}
        </nav>
      )}

      {refresh.isError && (
        <p role="alert" className="mb-4 rounded-lg border border-border bg-surface-2 px-3 py-2 text-sm text-muted">
          The check didn’t finish: {refresh.error instanceof Error ? refresh.error.message : 'unknown error'}. Stored moves are still shown.
        </p>
      )}

      {follows.isSuccess && followCount === 0 ? (
        <EmptyState
          title="Follow companies to see their moves here"
          description="Open a deck and choose More → Follow on Today. Each morning this page lists what those companies did — funding, launches, hires, deals and filings — every item dated and linked to its source."
          icon={<Sun weight="duotone" size={24} />}
        />
      ) : selected ? (
        <TodayCompanyView key={selected} companyId={selected} />
      ) : (
        <>
          {all.length > 0 && (
            <div className="mb-4 flex flex-wrap gap-1.5" role="tablist" aria-label="Filter moves">
              {FILTERS.map((option) => (
                <button key={option.id} type="button" role="tab" aria-selected={filter === option.id}
                  className={cn('rounded-full border px-3 py-1 text-xs font-medium transition-colors',
                    filter === option.id ? 'border-primary bg-primary/8 text-primary' : 'border-border text-muted hover:bg-surface-2 hover:text-content')}
                  onClick={() => setFilter(option.id)}>
                  {option.label}
                </button>
              ))}
            </div>
          )}
          {moves.isSuccess && all.length === 0 && !refresh.isPending && (
            <EmptyState
              title="No moves found yet"
              description="Nothing dated in the last week from the news feed or SEC filings for the companies you follow. The next daily check looks again."
              icon={<Sun weight="duotone" size={24} />}
            />
          )}
          {all.length > 0 && shown.length === 0 && <p className="py-8 text-center text-sm text-muted">No moves of this kind.</p>}
          <ul className="space-y-2">
            {shown.map((move) => (
              <li key={move.id} className={cn('panel flex items-start gap-3 p-4', move.readAt && 'opacity-70')}>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted">
                    <Link to={`/today?company=${encodeURIComponent(move.companyId)}`} className="font-semibold text-content hover:text-primary hover:underline" title="Open this company on Today">
                      {move.companyName}
                    </Link>
                    <span className="rounded-full bg-surface-2 px-2 py-0.5 font-medium">{KIND_LABEL[move.kind]}</span>
                    {move.importance === 3 && <span className="rounded-full bg-primary/8 px-2 py-0.5 font-medium text-primary">Major</span>}
                    {isNew(move) && <span className="font-semibold text-primary">New</span>}
                  </div>
                  <a href={safeHttpUrl(move.url)} target="_blank" rel="noopener noreferrer"
                    className={cn('mt-1 block text-[15px] leading-snug text-content hover:text-primary hover:underline', !move.readAt && 'font-semibold')}
                    onClick={() => { if (!move.readAt) markRead.mutate({ id: move.id, read: true }); }}>
                    {move.title}
                  </a>
                  <div className="mt-1 text-xs text-faint">
                    {sourceName(move)} · {moveDate(move)}
                  </div>
                </div>
                <button type="button" className="btn-ghost px-2" aria-label={move.readAt ? 'Mark unread' : 'Mark read'}
                  title={move.readAt ? 'Mark unread' : 'Mark read'}
                  onClick={() => markRead.mutate({ id: move.id, read: !move.readAt })}>
                  {move.readAt ? <CheckCircle size={18} weight="fill" className="text-muted" /> : <Circle size={18} className="text-primary" />}
                </button>
              </li>
            ))}
          </ul>
          {followCount > 0 && (
            <section className="mt-8" aria-label="Following">
              <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-faint">Following {followCount}</h2>
              <div className="flex flex-wrap gap-1.5">
                {(follows.data ?? []).map((follow) => (
                  <span key={follow.companyId} className="inline-flex items-center gap-1 rounded-full border border-border px-2.5 py-1 text-xs text-content">
                    {follow.companyName ?? follow.companyId}
                    <button type="button" className="text-faint hover:text-content" aria-label={`Unfollow ${follow.companyName ?? follow.companyId}`}
                      disabled={unfollow.isPending} onClick={() => unfollow.mutate(follow.companyId)}>
                      <X size={12} />
                    </button>
                  </span>
                ))}
              </div>
            </section>
          )}
        </>
      )}
    </div>
  );
}
