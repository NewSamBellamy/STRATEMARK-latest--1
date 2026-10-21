import { CheckCircle, Circle, Sun, X } from '@phosphor-icons/react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import type { CompanyMove, MoveKind } from '@mi/contracts';
import { EmptyState } from '@/components/states/EmptyState';
import { cn } from '@/lib/cn';
import { formatDate, formatRelative } from '@/lib/format';
import { safeHttpUrl } from '@/lib/sourceHref';
import { isAnotherWindowError, MOVE_STALE_DAYS, moveAgeDays, moveDayBucket, type MoveDayBucket } from '@mi/research';
import { useAnotherWindow, useFollows, useMarkMoveRead, useMarkMovesRead, useMoves, useRefreshMoves, useUnfollowCompany } from '@/hooks/today';
import { TodayCompanyView } from './TodayCompanyView';

const KIND_LABEL: Record<MoveKind, string> = {
  funding: 'Funding', launch: 'Launch', hire: 'People', deal: 'Deal', filing: 'Filing',
};
const FILTERS: Array<{ id: 'all' | 'unread' | MoveKind; label: string }> = [
  { id: 'all', label: 'All' }, { id: 'unread', label: 'Unread' }, { id: 'funding', label: 'Funding' },
  { id: 'launch', label: 'Launches' }, { id: 'hire', label: 'People' }, { id: 'deal', label: 'Deals' }, { id: 'filing', label: 'Filings' },
];
const LAST_VISIT_KEY = 'mi.today.lastVisit';
/** While Today stays open it looks again this often (the engine's 20 h rule still bounds what each look reads). */
export const TODAY_RECHECK_MS = 60 * 60_000;

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
  return formatDate(move.publishedAt);
}

function sourceName(move: CompanyMove): string {
  if (move.publisher) return move.publisher;
  try { return new URL(move.url).hostname.replace(/^www\./, ''); } catch { return 'Source'; }
}

const BUCKET_LABEL: Record<MoveDayBucket, string> = { today: 'Today', yesterday: 'Yesterday', week: 'This week', older: 'Older' };
const BUCKETS: MoveDayBucket[] = ['today', 'yesterday', 'week', 'older'];

/** The list (already in the engine's order) split by day of publication; stories over 30 days old are folded under Older. */
function groupMoves(moves: readonly CompanyMove[], now: Date) {
  return BUCKETS.map((bucket) => {
    const inBucket = moves.filter((move) => moveDayBucket(move, now) === bucket);
    return {
      bucket,
      recent: inBucket.filter((move) => moveAgeDays(move, now) <= MOVE_STALE_DAYS),
      stale: inBucket.filter((move) => moveAgeDays(move, now) > MOVE_STALE_DAYS),
    };
  }).filter((group) => group.recent.length + group.stale.length > 0);
}

export default function TodayPage() {
  const since = useLastVisit();
  const follows = useFollows();
  const moves = useMoves();
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const refresh = useRefreshMoves((done, total) => setProgress({ done, total }));
  useEffect(() => { if (!refresh.isPending) setProgress(null); }, [refresh.isPending]);
  const noted = useAnotherWindow();
  const anotherWindow = noted || (refresh.isError && isAnotherWindowError(refresh.error));
  const markRead = useMarkMoveRead();
  const markAll = useMarkMovesRead();
  const unfollow = useUnfollowCompany();
  const [filter, setFilter] = useState<(typeof FILTERS)[number]['id']>('all');
  const [params, setParams] = useSearchParams();
  const selected = params.get('company');
  const select = (id: string | null) => setParams(id ? { company: id } : {}, { replace: false });
  const followCount = follows.data?.length ?? 0;

  // The look runs when Today opens, when the person comes back to the tab, and hourly while it stays open. The engine
  // skips companies it looked at in the last 20 hours, so each trigger is cheap. No ref guard: a remount (StrictMode)
  // simply asks again, and the engine hands the second ask the check already running.
  const hasFollows = followCount > 0;
  const { mutate: check } = refresh;
  const checking = useRef(false);
  checking.current = refresh.isPending;
  useEffect(() => {
    if (!hasFollows) return undefined;
    check(false);
    const again = () => { if (!checking.current) check(false); };
    const onVisible = () => { if (document.visibilityState === 'visible') again(); };
    document.addEventListener('visibilitychange', onVisible);
    const timer = window.setInterval(again, TODAY_RECHECK_MS);
    return () => {
      document.removeEventListener('visibilitychange', onVisible);
      window.clearInterval(timer);
    };
  }, [hasFollows, check]);

  const all = moves.data ?? [];
  const isNew = (move: CompanyMove) => !move.readAt && (!since || move.foundAt > since);
  const newCount = all.filter(isNew).length;
  const unreadCount = all.filter((move) => !move.readAt).length;
  const shown = useMemo(() => (moves.data ?? []).filter((move) =>
    filter === 'all' ? true : filter === 'unread' ? !move.readAt : move.kind === filter), [moves.data, filter]);
  const shownUnread = shown.filter((move) => !move.readAt);
  const groups = useMemo(() => groupMoves(shown, new Date()), [shown]);
  const renderMove = (move: CompanyMove) => (
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
  );
  // "Checked" comes from the times the engine stored, so it survives a reload; a failed look is never counted as one.
  const checkedAt = (follows.data ?? []).reduce<string | null>((latest, follow) =>
    follow.lastCheckedAt && (!latest || follow.lastCheckedAt > latest) ? follow.lastCheckedAt : latest, null) ?? refresh.data?.refreshedAt ?? null;
  const failedCount = (follows.data ?? []).filter((follow) => follow.checkFailedAt).length;
  const firstCheckRunning = refresh.isPending && !checkedAt && all.length === 0;
  const checkedLabel = refresh.isPending ? 'checking now…'
    : checkedAt ? `checked ${formatRelative(checkedAt)}`
      : all.length > 0 ? null : 'not checked yet';

  return (
    <div className={cn('mx-auto', selected ? 'max-w-6xl' : 'max-w-3xl')}>
      <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl font-bold tracking-tight text-content">Today</h1>
          {/* One company's page has its own counts and its own check; the all-companies summary would be about other companies. */}
          {!selected && <p className="mt-1 text-sm text-muted">
            {followCount
              ? firstCheckRunning
                ? 'Checking the companies you follow…'
                : <>
                    {newCount ? `${newCount} new since your last visit` : 'Nothing new since your last visit'}
                    {' · '}{unreadCount} unread
                    {checkedLabel ? ` · ${checkedLabel}` : ''}
                  </>
              : 'Funding, launches, hires, deals and filings of the companies you follow.'}
          </p>}
        </div>
        {followCount > 0 && !selected && (
          <button type="button" className="btn-ghost text-sm" disabled={refresh.isPending}
            title="Look again now, even for companies checked today."
            onClick={() => refresh.mutate(true)}>
            {refresh.isPending
              ? (progress && progress.total > 1 ? `Checking ${progress.done} of ${progress.total}…` : 'Checking…')
              : 'Check now'}
          </button>
        )}
      </div>

      {followCount > 0 && (
        <nav className="mb-4 flex flex-wrap gap-1.5" aria-label="Companies on Today">
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

      {anotherWindow && (
        <div role="alert" className="mb-4 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border bg-surface-2 px-3 py-2 text-sm text-muted">
          <span>Another window changed your research. Reload to see it.</span>
          <button type="button" className="btn-ghost text-sm" onClick={() => window.location.reload()}>Reload</button>
        </div>
      )}
      {refresh.isError && !selected && !anotherWindow && (
        <p role="alert" className="mb-4 rounded-lg border border-border bg-surface-2 px-3 py-2 text-sm text-muted">
          The check didn’t finish: {(refresh.error instanceof Error ? refresh.error.message : 'unknown error').replace(/[.\s]+$/, '')}. Stored moves are still shown.
        </p>
      )}
      {failedCount > 0 && !refresh.isPending && !selected && (
        <p role="status" className="mb-4 rounded-lg border border-border bg-surface-2 px-3 py-2 text-sm text-muted">
          Couldn’t reach the news or filings for {failedCount} {failedCount === 1 ? 'company' : 'companies'}, trying again later.
        </p>
      )}

      {follows.isSuccess && followCount === 0 ? (
        <EmptyState
          title="Follow companies to see their moves here"
          description="Press the sun icon on a company’s card (or choose More → Follow on Today in a deck). Today checks those companies when you open it, and about once a day while it stays open, and lists what they did: funding, launches, hires, deals and filings, each dated and linked to its source."
          icon={<Sun weight="duotone" size={24} />}
          action={<Link to="/history" className="btn-primary">Open a deck</Link>}
          compact
        />
      ) : selected ? (
        <TodayCompanyView key={selected} companyId={selected} since={since} />
      ) : (
        <>
          {all.length > 0 && (
            <div className="mb-4 flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
              <div className="flex flex-wrap gap-1.5" role="tablist" aria-label="Filter moves">
                {FILTERS.map((option) => (
                  <button key={option.id} type="button" role="tab" aria-selected={filter === option.id}
                    className={cn('rounded-full border px-3 py-1 text-xs font-medium transition-colors',
                      filter === option.id ? 'border-primary bg-primary/8 text-primary' : 'border-border text-muted hover:bg-surface-2 hover:text-content')}
                    onClick={() => setFilter(option.id)}>
                    {option.label}
                  </button>
                ))}
              </div>
              {shownUnread.length > 0 && (
                <button type="button" className="btn-ghost text-sm" disabled={markAll.isPending}
                  onClick={() => markAll.mutate(shownUnread.map((move) => move.id))}>
                  Mark all read
                </button>
              )}
            </div>
          )}
          {moves.isSuccess && all.length === 0 && !refresh.isPending && (
            <EmptyState
              title="No moves found yet"
              description={failedCount > 0
                ? 'Some of the news and filings could not be reached, so this is not a full answer yet. Today tries those companies again later.'
                : 'Nothing dated in the last week from the news feed or SEC filings for the companies you follow. Today looks again when you next open it, and about once a day while it stays open.'}
              icon={<Sun weight="duotone" size={24} />}
              compact
            />
          )}
          {all.length > 0 && shown.length === 0 && <p className="py-8 text-center text-sm text-muted">No moves of this kind.</p>}
          {groups.map((group) => (
            <section key={group.bucket} className="mb-6" aria-label={BUCKET_LABEL[group.bucket]}>
              <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-faint">{BUCKET_LABEL[group.bucket]}</h2>
              {/* Right padding on a phone keeps the Ask orb (bottom right) clear of the mark-read buttons. */}
              <ul className="space-y-2 max-sm:pr-14">{group.recent.map(renderMove)}</ul>
              {group.stale.length > 0 && (
                <details className="mt-2 max-sm:pr-14">
                  <summary className="cursor-pointer text-sm text-muted hover:text-content">
                    {group.recent.length > 0 ? 'Show' : 'Show the'} {group.stale.length} from over {MOVE_STALE_DAYS} days ago
                  </summary>
                  <ul className="mt-2 space-y-2">{group.stale.map(renderMove)}</ul>
                </details>
              )}
            </section>
          ))}
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
