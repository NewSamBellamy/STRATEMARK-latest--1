import { useMemo, useEffect, useRef, useState } from 'react';
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
  Share2,
  SquareMousePointer,
  Target,
  X,
} from 'lucide-react';
import {
  CARD_TYPE_DESCRIPTIONS,
  CARD_TYPE_LABELS,
  CARD_TYPE_ORDER,
  MATURITY_TIERS,
  TIER_BLURBS,
  TIER_LABELS,
  isEntityCardType,
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
import { DeckCompletionBanner } from './DeckCompletionBanner';
import { DemoDeckBanner } from './DemoDeckBanner';
import { useAgentTrace } from '@/lib/agentic/agentTrace';
import { buildDeckShare } from '@/lib/share/codec';
import { ShareDialog } from '@/features/share/ShareDialog';
import { AgentActivityFeed } from './AgentActivityFeed';
import { useDeepDive } from '@/features/deepdive/DeepDive';
import { ThreadHistoryButton } from '@/features/research/ResearchControls';
import { cn } from '@/lib/cn';
import { useApiKey } from '@/lib/settings/apiKey';
import { SettingsLink } from '@/components/SettingsLink';
import { QueryBoundary } from '@/components/states/QueryBoundary';
import { CardGridSkeleton } from '@/components/states/Skeleton';
import { EmptyState } from '@/components/states/EmptyState';
import { CardGrid } from './CardGrid';
import { TierBadge } from '@/features/card/TierBadge';
import { deckActionPolicy } from './deck-actions';

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
      { placeholder: 'Compare these…' },
    );
    exitCompare();
  };

  const [params, setParams] = useSearchParams();
  const split = params.get('split'); // 'types' | 'company' | null
  const typeParam = params.get('type') as CardType | null;
  const actionPolicy = deckActionPolicy(typeParam);

  const all = useMemo(() => cards.data ?? [], [cards.data]);
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
  const [shareOpen, setShareOpen] = useState(false);

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

  return (
    <div className="w-full max-w-[1600px] px-2 sm:px-4">
      {/* ── Header — tight, structured, clear hierarchy ── */}
      <div className="mb-6">
        {/* Back link */}
        <Link to="/history" className="inline-flex items-center gap-1 text-[12px] font-medium text-muted hover:text-primary-ink transition-colors">
          <ArrowLeft className="h-3 w-3" />
          Back
        </Link>

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
                  ☁️ Sentinel Cloud Agent
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

          {/* Compact action bar */}
          <div className="flex flex-wrap items-center gap-1.5">
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
            {actionPolicy.briefing && <Link
              to={`/markets/${marketId}/briefing`}
              className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-surface px-3 py-1.5 text-[12px] font-medium text-content transition-colors hover:bg-surface-2"
              title="The Daily Briefing — the desk hunts the last 24h across every tracked company and unboxes it as an editorial report"
            >
              <Newspaper className="h-3.5 w-3.5" />
              Briefing
            </Link>}
            <button
              type="button"
              className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-surface px-3 py-1.5 text-[12px] font-medium text-content transition-colors hover:bg-surface-2"
              disabled={all.length === 0}
              title="Share this whole deck as a clean interactive snapshot — all the research travels inside the link, AI layer removed."
              onClick={() => setShareOpen(true)}
            >
              <Share2 className="h-3.5 w-3.5" />
              Share
            </button>
            <ShareDialog
              open={shareOpen}
              onOpenChange={setShareOpen}
              title={market.data?.name ?? 'Market deck'}
              subtitle="Full deck — research snapshot"
              build={async () => buildDeckShare(all, market.data?.name ?? null)}
            />
            <ThreadHistoryButton deckId={deckId} />
            <MoreMenu marketId={marketId} refreshDeck={refreshDeck} />
          </div>
        </div>

        {/* The finish line (red team P0-2): baseline research outcome stated
            in plain terms, so completion is a visible fact. The ambient feed
            below is ongoing HEALTH, not incompleteness. */}
        <DeckCompletionBanner deckId={deckId} />
        <DemoDeckBanner />
        {/* The visible heartbeat: desks verifying, correcting, and warming tabs live. */}
        <AgentActivityFeed living={living} />
      </div>

      {deckMissing && (
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
      )}

      {!deckMissing && all.length > 0 && (isRunning || isPartial) && (
        <div role="status" className="mb-5 flex flex-wrap items-center gap-3 rounded-xl border border-border bg-surface px-4 py-3 text-sm text-muted">
          {isRunning ? <Loader2 className="h-4 w-4 animate-spin" /> : <AlertCircle className="h-4 w-4" />}
          <span>{isRunning
            ? 'Completed research is ready to explore. More cards will appear as their research finishes.'
            : 'Completed research is available below. Some companies still need another pass.'}</span>
        </div>
      )}

      {!deckMissing && (
        (isRunning || isPartial) && all.length === 0 ? (
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
          // Level 2 — Company sub-deck split into 8 tier-decks.
          if (split === 'company') {
            return (
              <section>
                <TypeNav
                  cards={list}
                  active="company"
                  onSelect={(t) => setSplit(t === 'company' ? {} : (t ? { type: t } : {}))}
                  split={split}
                  onToggleSplit={() => setSplit({})}
                />
                <p className="mb-4 text-[12px] text-muted">
                  Companies grouped by maturity tier — T8 giants down to T1 seeds.
                  <span className="text-faint"> {CARD_TYPE_DESCRIPTIONS.company}</span>
                </p>
                <TierSplit cards={list} deckUserValues={userValues} marketId={marketId} deckStatus={deckStatus} />
                {/* The deck never hard-stops in this view either. */}
                <div className="mt-8">
                  <ExpandPrompt
                    marketId={marketId}
                    focus={{}}
                    label="Hunt for more companies in this market"
                    compact
                  />
                </div>
              </section>
            );
          }
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
                  onToggleSplit={() => setSplit({ split: 'company' })}
                />
                <h2 className="mb-1 font-display text-lg text-content">
                  {CARD_TYPE_LABELS[typeParam]} — {filtered.length} card
                  {filtered.length === 1 ? '' : 's'}
                </h2>
                <p className="mb-3 text-[12px] text-faint">{CARD_TYPE_DESCRIPTIONS[typeParam]}</p>
                {filtered.length > 0 ? (
                  <CardGrid cards={filtered} deckUserValues={userValues} marketId={marketId} deckStatus={deckStatus} />
                ) : (
                  <ExpandPrompt marketId={marketId} focus={{ cardType: typeParam }} label={`Hunt for ${cardCountNoun(typeParam, 2)} in this market`} />
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
                      t === 'company' ? setSplit({ split: 'company' }) : setSplit({ split: 'types', type: t })
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
                onToggleSplit={() => setSplit(split === 'company' ? {} : { split: 'company' })}
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
        )
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
}: {
  marketId: string | undefined;
  refreshDeck: { isPending: boolean; mutate: (id: string) => void };
}) {
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
        <div className="absolute right-0 top-full z-30 mt-1 w-48 rounded-xl border border-border bg-surface p-1 shadow-card">
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
          <Link
            to={`/markets/${marketId}/opportunity`}
            className="flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm text-content hover:bg-surface-2"
            onClick={() => setOpen(false)}
          >
            <Target className="h-4 w-4 text-muted" />
            Opportunity
          </Link>
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
        {type === 'company' ? 'Split into 8 tiers' : 'View cards'}
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
  onToggleSplit,
}: {
  cards: CardWithCompany[];
  active: CardType | null;
  onSelect: (t: CardType | null) => void;
  split?: string | null;
  onToggleSplit?: () => void;
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
      {onToggleSplit && (
        <div className="mb-1 flex shrink-0 items-center gap-1.5">
          <details className="group relative">
            <summary className="cursor-pointer list-none rounded-lg px-2 py-1.5 text-[11px] font-medium text-muted hover:bg-surface-2 hover:text-content">
              Tier guide
            </summary>
            <div className="absolute right-0 top-full z-30 mt-1 w-72 rounded-xl border border-border bg-surface p-3 shadow-card">
              <p className="mb-2 text-[10px] leading-relaxed text-muted">
                Tiers combine source-backed scale signals. Missing figures are excluded, never scored as zero.
              </p>
              <div className="grid grid-cols-2 gap-x-3 gap-y-1.5">
                {[...MATURITY_TIERS].reverse().map((tier) => <div key={tier} className="flex items-baseline gap-1.5 text-[10px]">
                  <strong className="w-5 text-content">T{tier}</strong>
                  <span className="truncate text-muted">{TIER_LABELS[tier]}</span>
                </div>)}
              </div>
            </div>
          </details>
          <button
            type="button"
            onClick={onToggleSplit}
            className={cn(
              'inline-flex items-center gap-1.5 rounded-lg border border-border bg-surface px-3 py-1.5 text-[12px] font-medium text-content transition-colors hover:bg-surface-2',
              split === 'company' && 'border-primary bg-primary/10 text-primary-ink',
            )}
          >
            <Layers className="h-3.5 w-3.5" />
            {split === 'company' ? 'Ungroup' : 'Group by Tier'}
          </button>
        </div>
      )}
    </div>
  );
}

/**
 * Targeted micro-research affordance. As an empty state it turns a dead end
 * into a hunt; in `compact` mode it sits under a full grid so the deck never
 * hard-stops at its initial company count — expanding is always one click.
 */
function ExpandPrompt({
  marketId,
  focus,
  label,
  compact = false,
}: {
  marketId: string | undefined;
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

function TierSplit({
  cards,
  deckUserValues,
  marketId,
  deckStatus,
}: {
  cards: CardWithCompany[];
  deckUserValues: number[];
  marketId: string | undefined;
  deckStatus?: 'running' | 'refreshing' | 'partial' | 'failed' | 'ready' | 'ready_stale';
}) {
  const companyCards = cards.filter((c) => c.card.cardType === 'company');
  const byTier = new Map<MaturityTier, CardWithCompany[]>();
  for (const t of MATURITY_TIERS) byTier.set(t, []);
  for (const c of companyCards) {
    if (c.card.tier != null) byTier.get(c.card.tier)!.push(c);
  }

  return (
    <div className="space-y-8">
      {MATURITY_TIERS.map((tier) => {
        const group = byTier.get(tier)!;
        return (
          <section key={tier}>
            <div className="mb-3 flex items-center gap-3 border-b border-border pb-2">
              <TierBadge tier={tier} size="md" />
              <span className="text-sm text-muted">{TIER_BLURBS[tier]}</span>
              <span className="ml-auto chip border-border text-muted">{group.length}</span>
            </div>
            {group.length > 0 ? (
              <CardGrid cards={group} deckUserValues={deckUserValues} marketId={marketId} deckStatus={deckStatus} />
            ) : (
              <ExpandPrompt
                marketId={marketId}
                focus={{ tier }}
                label={`Hunt for ${TIER_LABELS[tier]} companies`}
              />
            )}
          </section>
        );
      })}
    </div>
  );
}
