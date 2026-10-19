import { useMemo, useEffect, useRef, useState, type ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import {
  AlertCircle,
  ArrowLeft,
  ChevronRight,
  FileText,
  Layers,
  Loader2,
  MessagesSquare,
  MoreHorizontal,
  Newspaper,
  Radar,
  RefreshCw,
  Search,
  Settings,
  SquareMousePointer,
  Target,
  X,
  Sun,
} from 'lucide-react';
import {
  CARD_TYPE_DESCRIPTIONS,
  CARD_TYPE_LABELS,
  CARD_TYPE_ORDER,
  isEntityCardType,
  isSignalCardType,
  type CardType,
  type CardWithCompany,
  type MaturityTier,
} from '@mi/contracts';
import {
  useCards,
  useDeckByMarket,
  useMarket,
  useRefreshDeck,
  useResumableJob,
  useResumeResearchJob,
} from '@/hooks/data';
import { useLivingDeck } from '@/lib/living/useLivingDeck';
import { DeckStatusBar } from './DeckStatusBar';
import { DemoDeckBanner } from './DemoDeckBanner';
import { useAgentTrace } from '@/lib/agentic/agentTrace';
import { buildDeckShare } from '@/lib/share/codec';
import { ExportMenu } from '@/features/export/ExportMenu';
import { useReadOnly } from '@/lib/readOnly';
import { GroundingQuotaNotice } from '@/lib/living/GroundingQuotaNotice';
import { useDeepDive } from '@/features/deepdive/DeepDive';
import { ThreadHistoryButton } from '@/features/research/ResearchControls';
import { cn } from '@/lib/cn';
import { useApiKey } from '@/lib/settings/apiKey';
import { SettingsLink } from '@/components/SettingsLink';
import { QueryBoundary } from '@/components/states/QueryBoundary';
import { CardGridSkeleton } from '@/components/states/Skeleton';
import { EmptyState } from '@/components/states/EmptyState';
import { CardGrid } from './CardGrid';
import { deckActionPolicy } from './deck-actions';
import { useRepository, useSupports } from '@/lib/repository/RepositoryProvider';
import { useFollowCompanies, useFollows } from '@/hooks/today';

/** Human count noun per card type — fixes the old "20 company companies" bug. */
function cardCountNoun(type: CardType, count: number): string {
  const one: Record<CardType, string> = {
    company: 'company',
    infrastructure: 'infrastructure provider',
    distribution: 'distribution channel',
    culture: 'culture signal',
    vice: 'risk signal',
    insight: 'market insight',
    barrier: 'barrier to entry',
  };
  const many: Record<CardType, string> = {
    company: 'companies',
    infrastructure: 'infrastructure providers',
    distribution: 'distribution channels',
    culture: 'culture signals',
    vice: 'risk signals',
    insight: 'market insights',
    barrier: 'barriers to entry',
  };
  return count === 1 ? one[type] : many[type];
}

function deckUserValuesFrom(cards: CardWithCompany[]): number[] {
  return cards
    .filter((c) => c.card.cardType === 'company')
    .flatMap((c) => c.metrics)
    .filter((m) => m.metricType === 'users' && m.confidence !== 'unknown' && m.value !== null)
    .map((m) => m.value as number);
}

export default function DeckPage() {
  const { marketId } = useParams();
  const market = useMarket(marketId);
  const deck = useDeckByMarket(marketId);
  const deckId = deck.data?.id;
  const cards = useCards(deckId);
  const refreshDeck = useRefreshDeck();
  const resumableJob = useResumableJob(marketId);
  const resumeJob = useResumeResearchJob();
  const { chat } = useDeepDive();
  const readOnly = useReadOnly();

  const deckStatus = (deck.data as { status?: 'running' | 'refreshing' | 'partial' | 'failed' | 'ready' | 'ready_stale' } | null)?.status;
  const isRunning = deckStatus === 'running';
  const isPartial = deckStatus === 'partial';
  const isRefreshing = deckStatus === 'refreshing';
  const isFailed = deckStatus === 'failed';
  const isStale = deckStatus === 'ready_stale';
  const deckError = (deck.data as { error?: string } | null)?.error;
  const lastSyncedAt = (deck.data as { lastSyncedAt?: string } | null)?.lastSyncedAt;
  const deckRevision = (deck.data as { revision?: number } | null)?.revision;

  // Compare mode: select cards, then ask a grounded question about exactly
  // that set. Selection is deck-page state — leaving the page clears it.
  const [compare, setCompare] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const toggleSelected = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const exitCompare = () => {
    setCompare(false);
    setSelected(new Set());
  };
  const askSelected = () => {
    if (!deckId || selected.size === 0) return;
    chat(
      { kind: 'cards', deckId, cardIds: [...selected] },
      {
        placeholder: 'Ask a follow-up about these…',
        seed: selected.size === 1
          ? 'What stands out about this one, and what would you check next?'
          : `Compare these ${selected.size} head-to-head: where each is stronger, where the research has gaps, and who you would back.`,
      },
    );
    exitCompare();
  };

  const [params, setParams] = useSearchParams();
  const split = params.get('split'); // 'types' | 'company' | null
  const typeParam = params.get('type') as CardType | null;
  const actionPolicy = deckActionPolicy(typeParam);

  const all = useMemo(() => cards.data ?? [], [cards.data]);
  const canFollow = useSupports('followCompanies');
  const follows = useFollows();
  const followCompanies = useFollowCompanies();
  const deckCompanyIds = useMemo(() => [...new Set(all.flatMap((entry) => (entry.company ? [entry.company.id] : [])))], [all]);
  const followed = useMemo(() => new Set((follows.data ?? []).map((follow) => follow.companyId)), [follows.data]);
  const allFollowed = deckCompanyIds.length > 0 && deckCompanyIds.every((id) => followed.has(id));
  const companyCount = useMemo(
    () => new Set(all.filter((entry) => isEntityCardType(entry.card.cardType))
      .map((entry) => entry.company?.id)
      .filter((id): id is string => Boolean(id))).size,
    [all],
  );
  // A market whose deck record is gone (or a stale link) must NEVER render a
  // blank screen (audit 7:44): show a recovery path instead.
  const deckMissing = market.isSuccess && deck.isSuccess && (!market.data || !deck.data);
  const living = useLivingDeck(deckId, all);

  // Anchor the floating presence's "Chat" to THIS deck's synthesized research.
  const setChatContext = useAgentTrace((s) => s.setChatContext);
  const marketName = market.data?.name;
  useEffect(() => {
    if (deckId) setChatContext({ kind: 'deck', deckId, subject: marketName ?? 'this deck' });
    return () => setChatContext(null);
  }, [deckId, marketName, setChatContext]);
  const userValues = useMemo(() => deckUserValuesFrom(all), [all]);
  const countByType = useMemo(() => {
    const m = new Map<CardType, number>();
    for (const c of all) m.set(c.card.cardType, (m.get(c.card.cardType) ?? 0) + 1);
    return m;
  }, [all]);

  const setSplit = (next: { split?: string; type?: string }) => {
    const p = new URLSearchParams();
    if (next.split) p.set('split', next.split);
    if (next.type) p.set('type', next.type);
    setParams(p);
  };

  // A missing deck is a dead end, not a deck: none of the deck chrome (title,
  // live actions, demo/progress banners) may imply there is research here.
  if (deckMissing) {
    return (
      <div className="w-full max-w-[1600px] px-2 sm:px-4">
        <div className="panel mx-auto max-w-xl p-8 text-center">
          <Layers className="mx-auto h-8 w-8 text-muted" />
          <h2 className="mt-3 font-display text-xl font-semibold text-content">
            This deck's research isn't here
          </h2>
          <p className="mt-2 text-sm leading-relaxed text-muted">
            {market.data
              ? 'The market exists but its researched deck is missing — it may predate a storage recovery. Re-run the research, or check Settings → Data safety for a restorable backup.'
              : 'This link points at a deck that no longer exists in your library.'}
          </p>
          <div className="mt-5 flex flex-wrap justify-center gap-2">
            {market.data && marketId && (
              <button
                type="button"
                className="btn-primary"
                disabled={refreshDeck.isPending}
                onClick={() => refreshDeck.mutate(marketId)}
              >
                <RefreshCw className={`h-4 w-4 ${refreshDeck.isPending ? 'animate-spin' : ''}`} />
                {refreshDeck.isPending ? 'Researching…' : 'Re-run research'}
              </button>
            )}
            <SettingsLink className="btn-ghost">Data safety</SettingsLink>
            <Link to="/history" className="btn-ghost">All decks</Link>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="w-full max-w-[1600px] px-2 sm:px-4">
      {/* ── Header — tight, structured, clear hierarchy ── */}
      <div className="mb-6">
        {/* Back link */}
        {!readOnly && (
          <Link to="/history" className="inline-flex items-center gap-1 text-[12px] font-medium text-muted hover:text-primary-ink transition-colors">
            <ArrowLeft className="h-3 w-3" />
            Back
          </Link>
        )}

        {/* Title row */}
        <div className="mt-2 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
          <div>
            <div className="flex items-center gap-2">
              <h1 className="font-display text-[22px] font-bold tracking-tight text-content sm:text-[28px]">
                {market.data?.name ?? 'Deck'}
              </h1>
              {((market.data as { engine?: string } | undefined)?.engine === 'cloud' ||
                (all[0]?.card as { engine?: string } | undefined)?.engine === 'cloud') && (
                <span className="inline-flex items-center gap-1 rounded border border-teal-200 bg-teal-50 px-2 py-0.5 text-[11px] font-medium text-teal-700 dark:border-teal-800 dark:bg-teal-950/50 dark:text-teal-300">
                  ☁️ Stratemark Cloud
                </span>
              )}
            </div>
            {market.data?.scopeDefinition && (
              <p className="mt-0.5 text-[12px] text-faint">
                {[
                  `${companyCount} ${companyCount === 1 ? 'company' : 'companies'}`,
                  market.data.scopeDefinition.geography,
                ].filter(Boolean).join(' · ')}
              </p>
            )}
          </div>

          {/* Compact action bar (a shared copy has nothing to ask, research or change) */}
          {!readOnly && <div className="flex flex-wrap items-center gap-1.5">
            <button
              type="button"
              className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-surface px-3 py-1.5 text-[12px] font-medium text-content transition-colors hover:bg-surface-2"
              disabled={!deckId}
              onClick={() =>
                deckId && (actionPolicy.compare
                  ? chat(
                    { kind: 'deck', deckId },
                    { placeholder: 'Ask about this market…' },
                  )
                  : chat(
                    {
                      kind: 'cards',
                      deckId,
                      cardIds: all.filter((item) => item.card.cardType === typeParam).map((item) => item.card.id),
                      subject: typeParam ? `${CARD_TYPE_LABELS[typeParam]} findings` : 'market findings',
                    },
                    { placeholder: 'Ask about these findings…' },
                  ))
              }
            >
              <MessagesSquare className="h-3.5 w-3.5" />
              {actionPolicy.askLabel}
            </button>
            {actionPolicy.compare && <button
              type="button"
              className={cn(
                'inline-flex items-center gap-1.5 rounded-lg border border-border bg-surface px-3 py-1.5 text-[12px] font-medium text-content transition-colors hover:bg-surface-2',
                compare && 'border-primary bg-primary/10 text-primary-ink',
              )}
              disabled={!deckId}
              aria-pressed={compare}
              onClick={() => (compare ? exitCompare() : setCompare(true))}
            >
              <SquareMousePointer className="h-3.5 w-3.5" />
              {compare ? 'Cancel' : 'Compare'}
            </button>}
            <ExportMenu
              deck={{ ...(deckId ? { id: deckId } : {}), title: market.data?.name ?? 'Market deck', cards: all }}
              share={all.length === 0 ? undefined : {
                title: market.data?.name ?? 'Market deck',
                subtitle: 'Full deck — research snapshot',
                build: async () => buildDeckShare(all, market.data?.name ?? null),
                page: deckId ? { deckId } : undefined,
              }}
              report={actionPolicy.compare ? { kind: 'deck', subjectId: marketId } : undefined}
            />
            <MoreMenu
              marketId={marketId}
              refreshDeck={refreshDeck}
              extra={(close) => (
                <>
                  {actionPolicy.briefing && (
                    <Link
                      to={`/markets/${marketId}/briefing`}
                      className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left text-sm text-content hover:bg-surface-2"
                      title="The desk hunts the last 24h across every tracked company and unboxes it as an editorial report"
                      onClick={close}
                    >
                      <Newspaper className="h-4 w-4 text-muted" />
                      Daily briefing
                    </Link>
                  )}
                  <ThreadHistoryButton deckId={deckId} inMenu onPick={close} />
                  {canFollow && (
                    <button
                      type="button"
                      className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left text-sm text-content hover:bg-surface-2 disabled:opacity-60"
                      disabled={deckCompanyIds.length === 0 || allFollowed || followCompanies.isPending}
                      title="List this deck's companies' funding, launches, hires, deals and filings on Today, checked daily."
                      onClick={() => { close(); followCompanies.mutate(deckCompanyIds); }}
                    >
                      <Sun className="h-4 w-4 text-muted" />
                      {allFollowed ? 'Following on Today' : `Follow ${deckCompanyIds.length} companies on Today`}
                    </button>
                  )}
                </>
              )}
            />
          </div>}
        </div>

        {!readOnly && <DemoDeckBanner />}
        {/* One status line for the deck: creation progress, card completeness
            and live research, counted the same way as the header above. */}
        {!readOnly && <DeckStatusBar
          deckId={deckId}
          marketName={market.data?.name ?? 'this deck'}
          cards={all}
          living={living}
          deckStatus={deckStatus}
          resume={resumableJob.data
            ? { run: () => resumableJob.data && resumeJob.mutate(resumableJob.data.id), pending: resumeJob.isPending }
            : null}
        />}
        {!readOnly && <GroundingQuotaNotice />}
      </div>

      {(isRunning || isPartial) && all.length === 0 ? (
          <div className={cn(
            'panel mx-auto my-6 max-w-xl p-8 text-center',
            isPartial ? 'border-amber-200 bg-amber-50 dark:border-amber-800 dark:bg-amber-950/50' : 'glow-border',
          )}>
            <div className={cn(
              'mx-auto flex h-12 w-12 items-center justify-center rounded-full',
              isPartial ? 'bg-amber-100 text-amber-700 dark:bg-amber-900/50 dark:text-amber-300' : 'bg-primary/10 text-primary',
            )}>
              {isPartial ? <AlertCircle className="h-6 w-6" /> : <Radar className="h-6 w-6 animate-pulse" />}
            </div>
            <h2 className="mt-4 font-display text-xl font-semibold text-content">
              {isPartial ? 'This deck needs another research pass' : 'Preparing the cards before reveal'}
            </h2>
            <p className="mt-2 text-sm leading-relaxed text-muted">
              {isPartial
                ? 'Some card faces or first-look summaries did not finish. Stratemark is keeping unfinished cards out of view instead of presenting partial research as complete.'
                : 'Researching each company’s identity, core business figures, sources, and first-look summary. The deck opens when those card-ready essentials are complete.'}
            </p>
            {isPartial ? (
              <div className="mt-5 flex flex-wrap items-center justify-center gap-3">
                {resumableJob.data && (
                  <button type="button" className="btn-primary" disabled={resumeJob.isPending}
                    onClick={() => resumableJob.data && resumeJob.mutate(resumableJob.data.id)}>
                    <RefreshCw className={`h-4 w-4 ${resumeJob.isPending ? 'animate-spin' : ''}`} />
                    {resumeJob.isPending ? 'Resuming…' : 'Resume where it stopped'}
                  </button>
                )}
                <button type="button" className="btn-ghost" disabled={refreshDeck.isPending || !marketId}
                  onClick={() => marketId && refreshDeck.mutate(marketId)}>
                  {refreshDeck.isPending ? 'Checking figures…' : 'Re-verify current cards'}
                </button>
              </div>
            ) : (
              <div className="mt-6 flex items-center justify-center gap-2 text-xs font-medium text-primary">
                <Loader2 className="h-4 w-4 animate-spin" />
                <span>Building evidence-ready card faces…</span>
              </div>
            )}
          </div>
        ) : (
          <QueryBoundary
        query={cards}
        loading={<CardGridSkeleton />}
        isEmpty={(list) => list.length === 0}
        empty={
          isRefreshing ? (
            <div className="panel mx-auto max-w-xl p-8 text-center border-teal-200 bg-teal-50 my-6 dark:border-teal-800 dark:bg-teal-950/50">
              <RefreshCw className="mx-auto h-8 w-8 text-teal-600 animate-spin" />
              <h2 className="mt-3 font-display text-xl font-semibold text-teal-800 dark:text-teal-200">
                Refreshing deck…
              </h2>
              <p className="mt-2 text-sm leading-relaxed text-muted">
                Delta research is running. Your existing cards remain visible while new discoveries are added.
              </p>
            </div>
          ) : isStale ? (
            <div className="panel mx-auto max-w-xl p-8 text-center border-amber-200 bg-amber-50 my-6 dark:border-amber-800 dark:bg-amber-950/50">
              <AlertCircle className="mx-auto h-8 w-8 text-amber-600" />
              <h2 className="mt-3 font-display text-xl font-semibold text-amber-800 dark:text-amber-200">
                Last refresh failed — showing previous results
              </h2>
              <p className="mt-2 text-sm leading-relaxed text-muted">
                {deckError || 'The refresh did not complete. The deck below is the last successful snapshot.'}
                {lastSyncedAt && (
                  <span className="block mt-1 text-xs text-faint">
                    Last synced: {new Date(lastSyncedAt).toLocaleString()}{deckRevision ? ` · Revision ${deckRevision}` : ''}
                  </span>
                )}
              </p>
              <div className="mt-5 flex justify-center gap-2">
                {marketId && (
                  <button
                    type="button"
                    className="btn-primary"
                    disabled={refreshDeck.isPending}
                    onClick={() => refreshDeck.mutate(marketId)}
                  >
                    <RefreshCw className={`h-4 w-4 ${refreshDeck.isPending ? 'animate-spin' : ''}`} />
                    Retry refresh
                  </button>
                )}
              </div>
            </div>
          ) : isFailed ? (
            <div className="panel mx-auto max-w-xl p-8 text-center border-negative/30 bg-negative/5 my-6">
              <AlertCircle className="mx-auto h-8 w-8 text-negative" />
              <h2 className="mt-3 font-display text-xl font-semibold text-negative">
                Research failed
              </h2>
              <p className="mt-2 text-sm leading-relaxed text-muted">
                {deckError || 'The research run failed or timed out.'}
              </p>
              <div className="mt-5 flex justify-center gap-2">
                {marketId && (
                  <button
                    type="button"
                    className="btn-primary"
                    disabled={refreshDeck.isPending}
                    onClick={() => refreshDeck.mutate(marketId)}
                  >
                    <RefreshCw className={`h-4 w-4 ${refreshDeck.isPending ? 'animate-spin' : ''}`} />
                    Retry research
                  </button>
                )}
              </div>
            </div>
          ) : (
            <EmptyState
              title="No cards yet"
              description="Run the research pass to populate this deck with competitive-intelligence cards."
              icon={<Layers className="h-6 w-6" />}
              action={
                <button
                  type="button"
                  className="btn-primary mt-2"
                  disabled={refreshDeck.isPending || !marketId}
                  onClick={() => marketId && refreshDeck.mutate(marketId)}
                >
                  <RefreshCw className={`h-4 w-4 ${refreshDeck.isPending ? 'animate-spin' : ''}`} />
                  {refreshDeck.isPending ? 'Researching…' : 'Run research'}
                </button>
              }
            />
          )
        }
      >
        {(list) => {
          // Level 1 leaf — a specific non-company sub-deck's cards.
          if (split === 'types' && typeParam) {
            const filtered = list.filter((c) => c.card.cardType === typeParam);
            return (
              <section>
                <TypeNav
                  cards={list}
                  active={typeParam}
                  onSelect={(t) => setSplit(t ? { type: t } : {})}
                  split={split}
                />
                <h2 className="mb-1 font-display text-lg text-content">
                  {CARD_TYPE_LABELS[typeParam]} — {filtered.length} card
                  {filtered.length === 1 ? '' : 's'}
                </h2>
                <p className="mb-3 text-[12px] text-faint">{CARD_TYPE_DESCRIPTIONS[typeParam]}</p>
                {filtered.length > 0 ? (
                  <CardGrid cards={filtered} deckCards={all} deckUserValues={userValues} marketId={marketId} deckStatus={deckStatus} />
                ) : (
                  <ExpandPrompt marketId={marketId} deckId={deckId} focus={{ cardType: typeParam }} label={`Hunt for ${cardCountNoun(typeParam, 2)} in this market`} />
                )}
              </section>
            );
          }
          // Level 1 — seven card-type sub-decks.
          if (split === 'types') {
            return (
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {CARD_TYPE_ORDER.map((t) => (
                  <SubDeckTile
                    key={t}
                    type={t}
                    count={countByType.get(t) ?? 0}
                    onClick={() =>
                      t === 'company' ? setSplit({ type: 'company' }) : setSplit({ split: 'types', type: t })
                    }
                  />
                ))}
              </div>
            );
          }
          // Level 0 — prefer company cards, but never land on an empty category
          // when an exact-scope deck's only valid lead card is infrastructure or
          // distribution. Signal-only decks also fall back to their first
          // populated category; a genuinely empty/running deck remains Company.
          const firstPopulatedType = CARD_TYPE_ORDER.find((type) =>
            list.some((card) => card.card.cardType === type),
          );
          const defaultType: CardType = typeParam ?? firstPopulatedType ?? 'company';
          const filtered = list.filter((c) => c.card.cardType === defaultType);
          return (
            <section>
              <TypeNav
                cards={list}
                active={defaultType}
                onSelect={(t) => setSplit(t ? { type: t } : {})}
                split={split}
              />
              <div className="mb-4">
                <p className="text-[12px] text-muted">
                  {filtered.length} {cardCountNoun(defaultType, filtered.length)}
                  <span className="text-faint"> — {CARD_TYPE_DESCRIPTIONS[defaultType]}</span>
                </p>
              </div>
              {filtered.length > 0 ? (
                <>
                  <CardGrid
                    cards={filtered}
                    deckCards={all}
                    deckUserValues={userValues}
                    marketId={marketId}
                    deckStatus={deckStatus}
                    selectable={compare}
                    selected={selected}
                    onToggle={toggleSelected}
                  />
                  {/* The deck never "just stops": hunting more of this type is always one click. */}
                  <div className="mt-6">
                    <ExpandPrompt
                      marketId={marketId}
                      deckId={deckId}
                      focus={typeParam ? { cardType: typeParam } : {}}
                      label={
                        typeParam
                          ? `Hunt for more ${cardCountNoun(typeParam, 2)} in this market`
                          : 'Hunt for more companies in this market'
                      }
                      compact
                    />
                  </div>
                </>
              ) : (
                <ExpandPrompt
                  marketId={marketId}
                  deckId={deckId}
                  focus={typeParam ? { cardType: typeParam } : {}}
                  label={
                    typeParam
                      ? `Hunt for ${CARD_TYPE_LABELS[typeParam].toLowerCase()} cards in this market`
                      : 'Hunt for more companies in this market'
                  }
                />
              )}
            </section>
          );
        }}
          </QueryBoundary>
        )}

      {/* Compare mode action bar */}
      {compare && actionPolicy.compare && (
        <div className="fixed bottom-6 left-1/2 z-40 flex -translate-x-1/2 items-center gap-3 rounded-full border border-border bg-surface px-4 py-2.5 shadow-card">
          <span className="text-sm tabular-nums text-muted">
            {selected.size} card{selected.size === 1 ? '' : 's'} selected
          </span>
          <button
            type="button"
            className="btn-primary px-3.5 py-1.5 text-sm"
            disabled={selected.size === 0}
            onClick={askSelected}
          >
            <MessagesSquare className="h-4 w-4" />
            Ask about these
          </button>
          <button
            type="button"
            className="rounded-full p-1 text-muted hover:text-content"
            onClick={exitCompare}
            aria-label="Exit compare mode"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      )}
    </div>
  );
}

/** Secondary deck actions behind a "More" toggle. */
function MoreMenu({
  marketId,
  refreshDeck,
  extra,
}: {
  marketId: string | undefined;
  refreshDeck: { isPending: boolean; mutate: (id: string) => void };
  /** Deck actions that live here to keep the header to its primary few. */
  extra?: (close: () => void) => ReactNode;
}) {
  const canOpportunity = useSupports('getMarketOpportunity');
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [open]);

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        className="btn-ghost px-2.5"
        onClick={() => setOpen(!open)}
        aria-label="More actions"
        aria-expanded={open}
      >
        <MoreHorizontal className="h-4 w-4" />
      </button>
      {open && (
        <div className="absolute right-0 top-full z-30 mt-1 w-56 rounded-xl border border-border bg-surface p-1 shadow-card">
          {extra?.(() => setOpen(false))}
          <Link
            to="/reports"
            className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left text-sm text-content hover:bg-surface-2"
            onClick={() => setOpen(false)}
          >
            <FileText className="h-4 w-4 text-muted" />
            Reports
          </Link>
          <button
            type="button"
            className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left text-sm text-content hover:bg-surface-2"
            disabled={refreshDeck.isPending || !marketId}
            onClick={() => {
              if (marketId) refreshDeck.mutate(marketId);
              setOpen(false);
            }}
          >
            <RefreshCw className={`h-4 w-4 text-muted ${refreshDeck.isPending ? 'animate-spin' : ''}`} />
            {refreshDeck.isPending ? 'Refreshing…' : 'Refresh deck'}
          </button>
          {canOpportunity && <Link
            to={`/markets/${marketId}/opportunity`}
            className="flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm text-content hover:bg-surface-2"
            onClick={() => setOpen(false)}
          >
            <Target className="h-4 w-4 text-muted" />
            Opportunity
          </Link>}
          <Link
            to={`/markets/${marketId}/settings`}
            className="flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm text-content hover:bg-surface-2"
            onClick={() => setOpen(false)}
          >
            <Settings className="h-4 w-4 text-muted" />
            Settings
          </Link>
        </div>
      )}
    </div>
  );
}


function SubDeckTile({
  type,
  count,
  onClick,
}: {
  type: CardType;
  count: number;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="panel group flex flex-col p-5 text-left transition-colors hover:border-primary/50 hover:bg-surface-2"
    >
      <div className="flex items-center justify-between">
        <h3 className="font-display text-lg font-semibold text-content">{CARD_TYPE_LABELS[type]}</h3>
        <span className="chip border-border text-muted">{count}</span>
      </div>
      <p className="mt-2 text-sm text-muted">{CARD_TYPE_DESCRIPTIONS[type]}</p>
      <span className="mt-4 inline-flex items-center gap-1 text-xs font-medium text-primary-ink opacity-0 transition-opacity group-hover:opacity-100">
        View cards
        <ChevronRight className="h-3.5 w-3.5" />
      </span>
    </button>
  );
}

/**
 * Persistent card-type navigation.
 *
 * Replaces the old drill-down (split → pick a type → new screen) with a bar that
 * stays put: click a type and the grid below re-filters in place, the way you'd
 * flip between sections of a binder. Counts come from the real deck so an empty
 * type is visible rather than hidden behind a click.
 */
function TypeNav({
  cards,
  active,
  onSelect,
  split,
}: {
  cards: CardWithCompany[];
  active: CardType | null;
  onSelect: (t: CardType | null) => void;
  split?: string | null;
}) {
  const counts = new Map<CardType, number>();
  for (const c of cards) counts.set(c.card.cardType, (counts.get(c.card.cardType) ?? 0) + 1);
  // EVERY card class keeps its tab, even at zero (audit: "the tab should
  // still be there") — an empty class opens its hunt prompt, never vanishes.
  const present = CARD_TYPE_ORDER;

  const Tab = ({
    label,
    count,
    selected,
    onClick,
  }: {
    label: string;
    count: number;
    selected: boolean;
    onClick: () => void;
  }) => (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={selected}
      className={cn(
        'whitespace-nowrap border-b-2 px-4 py-2 text-[13px] font-medium transition-colors',
        selected
          ? 'border-primary text-primary'
          : 'border-transparent text-muted hover:text-content',
      )}
    >
      {label}
      <span
        className={cn(
          'ml-1.5 tabular-nums text-[11px]',
          selected ? 'text-primary/60' : 'text-faint',
        )}
      >
        {count}
      </span>
    </button>
  );

  return (
    <div className="mb-5 flex flex-wrap items-center justify-between gap-2 border-b border-border">
      <nav
        data-testid="type-nav"
        className="flex items-center gap-1 overflow-x-auto"
        aria-label="Filter deck by card type"
      >
        {present.map((t) => (
          <Tab
            key={t}
            label={CARD_TYPE_LABELS[t]}
            count={counts.get(t) ?? 0}
            selected={split !== 'company' && active === t}
            onClick={() => onSelect(t)}
          />
        ))}
      </nav>
    </div>
  );
}

/**
 * Targeted micro-research affordance. As an empty state it turns a dead end
 * into a hunt; in `compact` mode it sits under a full grid so the deck never
 * hard-stops at its initial company count — expanding is always one click.
 */
function ExpandPrompt(props: {
  marketId: string | undefined;
  deckId?: string | undefined;
  focus: { tier?: MaturityTier; cardType?: CardType };
  label: string;
  compact?: boolean;
}) {
  const repo = useRepository();
  // Barrier, insight, vice and culture cards are searched for by the deck itself (ensureSignalCards), not hunted as new
  // companies: a hunt for a "barrier" would go looking for companies.
  if (props.focus.cardType && isSignalCardType(props.focus.cardType) && props.deckId && typeof repo.ensureSignalCards === 'function') {
    return <SignalPrompt deckId={props.deckId} label={props.label} compact={props.compact} />;
  }
  return <HuntPrompt {...props} />;
}

/** The one search for a deck's missing market-signal cards, from the empty tab or under a full grid. */
function SignalPrompt({ deckId, label, compact = false }: { deckId: string; label: string; compact?: boolean }) {
  const hasKey = useApiKey((s) => s.hasKey);
  const repo = useRepository();
  const qc = useQueryClient();
  const [state, setState] = useState<{ status: 'idle' | 'running' | 'done' | 'failed'; added: number }>({ status: 'idle', added: 0 });
  if (!hasKey) {
    if (compact) return null;
    return <p className="py-3 text-sm text-muted">Nothing found here in the sample data. With a key connected, Stratemark can search for these.</p>;
  }
  const search = async () => {
    setState({ status: 'running', added: 0 });
    try {
      const result = await repo.ensureSignalCards!(deckId, { force: true });
      const added = Object.values(result.added).reduce((a, b) => a + b, 0);
      setState({ status: result.failed && added === 0 ? 'failed' : 'done', added });
      void qc.invalidateQueries({ queryKey: ['cards'] });
    } catch {
      setState({ status: 'failed', added: 0 });
    }
  };
  return (
    <div className={cn('flex flex-wrap items-center gap-3', compact ? 'justify-center py-1' : 'py-3')}>
      {!compact && state.status === 'idle' && <p className="text-sm text-muted">Nothing found here yet.</p>}
      <button
        type="button"
        className={cn('btn-ghost text-sm', state.status === 'running' && 'animate-pulse border-primary/60 bg-primary/5 text-primary-ink')}
        disabled={state.status === 'running'}
        onClick={() => void search()}
      >
        <Search className={`h-4 w-4 ${state.status === 'running' ? 'animate-pulse' : ''}`} />
        {state.status === 'running' ? 'Searching this market…' : label}
      </button>
      {state.status === 'done' && state.added > 0 && <span className="text-xs text-muted">Found {state.added} new {state.added === 1 ? 'card' : 'cards'}.</span>}
      {state.status === 'done' && state.added === 0 && <span className="text-xs text-muted">Search ran, and nothing credible turned up. Stratemark does not fill a gap with a guess.</span>}
      {state.status === 'failed' && <span className="text-xs text-negative">The search failed. Try again.</span>}
    </div>
  );
}

function HuntPrompt({
  marketId,
  focus,
  label,
  compact = false,
}: {
  marketId: string | undefined;
  deckId?: string | undefined;
  focus: { tier?: MaturityTier; cardType?: CardType };
  label: string;
  compact?: boolean;
}) {
  const hasKey = useApiKey((s) => s.hasKey);
  // QUEUED, never blocked: clicking while another hunt runs enqueues this one
  // in click order — the rate limiter still only ever sees one hunt at a time.
  const jobs = useAgentTrace((s) => s.jobs);
  const enqueueHunt = useAgentTrace((s) => s.enqueueHunt);
  const mine = jobs.find(
    (j) =>
      j.marketId === marketId && j.focus.tier === focus.tier && j.focus.cardType === focus.cardType,
  );
  const queuePosition =
    mine?.status === 'queued'
      ? jobs.filter((j) => j.status === 'queued').findIndex((j) => j.id === mine.id) + 1
      : 0;
  if (!hasKey) {
    if (compact) return null;
    return (
      <p className="py-3 text-sm text-muted">
        Nothing found here in the sample data. With a key connected, the agent can hunt for these
        specifically.
      </p>
    );
  }
  return (
    <div className={cn('flex flex-wrap items-center gap-3', compact ? 'justify-center py-1' : 'py-3')}>
      {!compact && <p className="text-sm text-muted">Nothing surfaced in the first pass.</p>}
      <button
        type="button"
        className={cn(
          'btn-ghost text-sm',
          mine?.status === 'running' && 'animate-pulse border-primary/60 bg-primary/5 text-primary-ink',
          mine?.status === 'queued' && 'border-primary/30 text-primary-ink',
        )}
        disabled={mine?.status === 'queued' || mine?.status === 'running' || !marketId}
        title="Hunts run one at a time (rate-limit friendly) — extra clicks queue in order."
        onClick={() => marketId && enqueueHunt({ marketId, focus, label })}
      >
        <Search className={`h-4 w-4 ${mine?.status === 'running' ? 'animate-pulse' : ''}`} />
        {mine?.status === 'running'
          ? 'Actively hunting this market…'
          : mine?.status === 'queued'
            ? `Queued${queuePosition > 0 ? ` (#${queuePosition})` : ''} — starts after the current hunt`
            : label}
      </button>
      {mine?.status === 'done' && mine.added === 0 && (
        <span className="text-xs text-muted">Search ran — nothing credible found (that’s honest).</span>
      )}
      {mine?.status === 'failed' && (
        <span className="text-xs text-negative">Hunt failed — try again.</span>
      )}
    </div>
  );
}

