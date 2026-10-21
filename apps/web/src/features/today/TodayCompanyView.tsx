/**
 * One company on Today: its card on the left (the same layout as opening a card
 * from a deck) and, on the right, the day's five to ten updates across its own
 * releases and filings, the news, and the social conversation. Every update is
 * dated and linked to its source and can be marked read. "View full report"
 * makes a PDF of the same updates with the pictures their sources published.
 */
import { useMemo, useState } from 'react';
import { formatDate } from '@/lib/format';
import { Link } from 'react-router-dom';
import { CheckCircle, Circle } from '@phosphor-icons/react';
import { ArrowUpRight, FileText, Loader2, RefreshCw } from 'lucide-react';
import { CardStage } from '@/features/card/CardStage';
import { Logo } from '@/features/card/Logo';
import { buildCardView } from '@/features/card/card-view';
import { buildDailyReportModel } from '@/features/export/dailyReportModel';
import { resolveUpdateImages } from '@/features/export/reportImages';
import { usePrintJob } from '@/features/export/usePrintJob';
import { useCompany } from '@/hooks/data';
import {
  useCompanyCard,
  useMarkMoveRead,
  useMoves,
  useRefreshMoves,
  useRefreshSentiment,
  useSocialRead,
  useStoredLiveIntel,
  useUnfollowCompany,
} from '@/hooks/today';
import { cn } from '@/lib/cn';
import { safeHttpUrl } from '@/lib/sourceHref';
import { localDate } from '@/features/export/exportModel';
import {
  KIND_LABEL,
  MIN_WANTED,
  MOVE_KIND_LABEL,
  pickTodayUpdates,
  unreadCount,
  updatesFromMoves,
  updatesFromSocial,
  type TodayUpdate,
} from './todayUpdates';

const SENTIMENT_STYLE = {
  positive: 'border-positive/40 text-positive',
  neutral: 'border-border text-muted',
  negative: 'border-negative/40 text-negative',
} as const;

function dateText(update: TodayUpdate): string {
  const when = formatDate(update.at);
  return update.dateKind === 'found' ? `found ${when}` : when;
}

/** `since`: when Today was last opened before this visit; moves found after it (and unread) are "New". */
export function TodayCompanyView({ companyId, since = null }: { companyId: string; since?: string | null }) {
  const company = useCompany(companyId).data ?? null;
  const card = useCompanyCard(companyId).data ?? null;
  const moves = useMoves();
  const intel = useStoredLiveIntel(companyId);
  const markMoveRead = useMarkMoveRead();
  const social = useSocialRead();
  const refreshMoves = useRefreshMoves();
  const refreshSentiment = useRefreshSentiment(companyId);
  const unfollow = useUnfollowCompany();
  const printer = usePrintJob();
  const [preparing, setPreparing] = useState(false);

  const updates = useMemo(
    () => pickTodayUpdates([...updatesFromMoves(moves.data ?? [], companyId), ...updatesFromSocial(intel.data, social.read)]),
    [moves.data, intel.data, companyId, social.read],
  );
  const name = company?.name ?? card?.company?.name ?? 'This company';
  const unread = unreadCount(updates);

  const setRead = (update: TodayUpdate, read: boolean) => {
    if (update.kind === 'social') social.set(update.id, read);
    else markMoveRead.mutate({ id: update.id, read });
  };

  const makeReport = async () => {
    if (updates.length === 0 || preparing) return;
    setPreparing(true);
    try {
      const images = await resolveUpdateImages(updates);
      const info = { name, logoUrl: company?.logoUrl ?? null, website: company?.websiteUrl ?? null, hq: company?.hqLocation ?? null };
      printer.print({ kind: 'dailyReport', model: buildDailyReportModel(info, updates, images) }, `${name} - Stratemark Today ${localDate()}`);
    } finally {
      setPreparing(false);
    }
  };

  return (
    <div className="grid items-start gap-8 lg:grid-cols-[minmax(0,360px)_minmax(0,1fr)]">
      <aside aria-label={`${name} card`} className="lg:sticky lg:top-4">
        {card ? (
          <CardStage data={card} view={buildCardView(card)} />
        ) : (
          <div className="panel flex items-center gap-3 p-5">
            <Logo name={name} website={company?.websiteUrl ?? null} logoUrl={company?.logoUrl ?? null} className="h-12 w-12 border border-border" />
            <div className="min-w-0">
              <p className="font-display text-lg font-semibold text-content">{name}</p>
              {company?.oneLiner && <p className="line-clamp-3 text-[13px] text-muted">{company.oneLiner}</p>}
            </div>
          </div>
        )}
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <button type="button" className="btn-primary" disabled={updates.length === 0 || preparing} onClick={() => void makeReport()}>
            {preparing ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileText className="h-4 w-4" />}
            {preparing ? 'Preparing the report…' : 'View full report'}
          </button>
          <Link to={`/company/${companyId}/dashboard/overview`} className="btn-ghost">
            Open dashboard <ArrowUpRight className="h-4 w-4" />
          </Link>
        </div>
        <button type="button" className="mt-3 text-[12px] text-muted underline-offset-2 hover:text-content hover:underline" disabled={unfollow.isPending}
          onClick={() => unfollow.mutate(companyId)}>
          Stop following {name}
        </button>
      </aside>

      <section aria-label={`${name} updates`}>
        <div className="mb-3 flex flex-wrap items-end justify-between gap-2">
          <div>
            <h2 className="font-display text-xl font-semibold text-content">{name} today</h2>
            <p className="mt-0.5 text-[13px] text-muted">
              {updates.length === 0
                ? 'Nothing dated in the last two months yet.'
                : `${updates.length} ${updates.length === 1 ? 'update' : 'updates'} · ${unread} unread`}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button type="button" className="btn-ghost text-[13px]" disabled={refreshMoves.isPending}
              title="Look for new releases, news and filings now, even if they were checked today."
              onClick={() => refreshMoves.mutate({ force: true, companyIds: [companyId] })}>
              {refreshMoves.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
              Check news now
            </button>
            <button type="button" className="btn-ghost text-[13px]" disabled={refreshSentiment.isPending}
              title="Runs a research pass on social conversation. It uses research credits, so it only runs when you ask."
              onClick={() => refreshSentiment.mutate()}>
              {refreshSentiment.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
              Refresh social sentiment
            </button>
          </div>
        </div>

        {refreshMoves.isError && (
          <p role="alert" className="mb-3 rounded-lg border border-border bg-surface-2 px-3 py-2 text-[13px] text-muted">
            The check didn’t finish: {(refreshMoves.error instanceof Error ? refreshMoves.error.message : 'unknown error').replace(/[.\s]+$/, '')}. Stored updates are still shown.
          </p>
        )}
        {refreshSentiment.isError && (
          <p role="alert" className="mb-3 rounded-lg border border-border bg-surface-2 px-3 py-2 text-[13px] text-muted">
            The sentiment check didn’t finish: {refreshSentiment.error instanceof Error ? refreshSentiment.error.message : 'unknown error'}.
          </p>
        )}

        {updates.length > 0 && updates.length < MIN_WANTED && (
          <p className="mb-3 text-[12.5px] text-muted">Only {updates.length} dated {updates.length === 1 ? 'item was' : 'items were'} found. Nothing is added to fill the list.</p>
        )}

        <ul className="space-y-2">
          {updates.map((update) => (
            <li key={update.id} className={cn('panel flex items-start gap-3 p-4', update.readAt && 'opacity-70')}>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted">
                  <span className="rounded-full bg-surface-2 px-2 py-0.5 font-medium">{update.moveKind ? MOVE_KIND_LABEL[update.moveKind] : KIND_LABEL[update.kind]}</span>
                  {update.sentiment && (
                    <span className={cn('rounded-full border px-2 py-0.5 font-medium', SENTIMENT_STYLE[update.sentiment])} title="The sentiment research tagged this item with">
                      {update.sentiment}
                    </span>
                  )}
                  {update.importance === 3 && <span className="rounded-full bg-primary/8 px-2 py-0.5 font-medium text-primary">Major</span>}
                  {update.foundAt && !update.readAt && (!since || update.foundAt > since) && <span className="font-semibold text-primary">New</span>}
                </div>
                <a href={safeHttpUrl(update.url)} target="_blank" rel="noopener noreferrer"
                  className={cn('mt-1 block text-[15px] leading-snug text-content hover:text-primary hover:underline', !update.readAt && 'font-semibold')}
                  onClick={() => { if (!update.readAt) setRead(update, true); }}>
                  {update.title}
                </a>
                {update.summary && <p className="mt-1 text-[13px] leading-snug text-muted">{update.summary}</p>}
                <div className="mt-1 text-xs text-faint">{update.publisher ?? 'Source'} · {dateText(update)}</div>
              </div>
              <button type="button" className="btn-ghost px-2" aria-label={update.readAt ? 'Mark unread' : 'Mark read'}
                title={update.readAt ? 'Mark unread' : 'Mark read'} onClick={() => setRead(update, !update.readAt)}>
                {update.readAt ? <CheckCircle size={18} weight="fill" className="text-muted" /> : <Circle size={18} className="text-primary" />}
              </button>
            </li>
          ))}
        </ul>
      </section>
      {printer.host}
    </div>
  );
}
