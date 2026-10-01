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
  type CardType,
  type CardWithCompany,
  type MaturityTier,
} from '@mi/contracts';
import { useCards, useDeckByMarket, useMarket, useRefreshDeck } from '@/hooks/data';
import { useLivingDeck } from '@/lib/living/useLivingDeck';
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
import { buildCardView, sortCompanyCardsForBrowse } from '@/features/card/card-view';
import { isReadOnlyResearch, isNativeResearch } from '@/lib/settings/runtime';
import NativeDeckPage from './NativeDeckPage';

/**
 * V2 includes all seven card types. Historical Culture is labeled Community;
 * existing records retain their wire values and provenance.
 */
const HIDDEN_CARD_TYPES: ReadonlySet<CardType> = new Set();
const VISIBLE_CARD_TYPE_ORDER = CARD_TYPE_ORDER.filter((t) => !HIDDEN_CARD_TYPES.has(t));
const DISPLAY_STAGES = [...MATURITY_TIERS].reverse();
type MarketRole = 'company' | 'infrastructure' | 'distribution';

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

export default function DeckPage() {
  return isNativeResearch() ? <NativeDeckPage /> : <LegacyDeckPage />;
}

function LegacyDeckPage() {
  const { marketId } = useParams();
  const readOnly = isReadOnlyResearch();
  const market = useMarket(marketId);
  const deck = useDeckByMarket(marketId);
  const deckId = deck.data?.id;
  const cards = useCards(deckId);
  const refreshDeck = useRefreshDeck();
  const { chat } = useDeepDive();

  const deckStatus = (
    deck.data as {
      status?: 'running' | 'refreshing' | 'partial' | 'failed' | 'ready' | 'ready_stale';
    } | null
  )?.status;
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
    if (!deckId || selected.size < 2) return;
    chat({ kind: 'cards', deckId, cardIds: [...selected] }, { placeholder: 'Compare these…' });
    exitCompare();
  };

  const [params, setParams] = useSearchParams();
  const split = readOnly ? null : params.get('split'); // 'types' | 'company' | null
  const legacyType = params.get('type') as CardType | null;
  const typeParam = readOnly ? 'company' : legacyType;
  const roleParam = (params.get('role') ||
    (readOnly && (legacyType === 'infrastructure' || legacyType === 'distribution')
      ? legacyType
      : null)) as MarketRole | null;

  const all = useMemo(
    () => (cards.data ?? []).filter((c) => !HIDDEN_CARD_TYPES.has(c.card.cardType)),
    [cards.data],
  );
  const sortedCompanies = useMemo(() => {
    const companies = all.filter((c) => c.card.cardType === 'company');
    return readOnly
      ? [...companies].sort((a, b) =>
          (a.company?.name ?? a.card.title ?? '').localeCompare(
            b.company?.name ?? b.card.title ?? '',
          ),
        )
      : sortCompanyCardsForBrowse(companies);
  }, [all, readOnly]);
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
  const countByType = useMemo(() => {
    const m = new Map<CardType, number>();
    for (const c of all) m.set(c.card.cardType, (m.get(c.card.cardType) ?? 0) + 1);
    return m;
  }, [all]);

  const setSplit = (next: { split?: string; type?: string }) => {
    if ((next.type && next.type !== 'company') || (next.split === 'types' && !next.type)) {
      exitCompare();
    }
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
        <Link
          to="/history"
          className="inline-flex items-center gap-1 text-[12px] font-medium text-muted hover:text-primary-ink transition-colors"
        >
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
                  (() => {
                    const count = all.filter((c) => c.card.cardType === 'company').length;
                    return `${count} ${cardCountNoun('company', count)}`;
                  })(),
                  market.data.scopeDefinition.geography,
                ]
                  .filter(Boolean)
                  .join(' · ')}
              </p>
            )}
          </div>

          {/* Compact action bar */}
          {!readOnly && (
            <div className="flex flex-wrap items-center gap-1.5">
              <button
                type="button"
                className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-surface px-3 py-1.5 text-[12px] font-medium text-content transition-colors hover:bg-surface-2"
                disabled={!deckId}
                onClick={() =>
                  deckId &&
                  chat({ kind: 'deck', deckId }, { placeholder: 'Ask about this market…' })
                }
              >
                <MessagesSquare className="h-3.5 w-3.5" />
                Ask
              </button>
              {(!split || split === 'company') && (!typeParam || typeParam === 'company') && (
                <button
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
                </button>
              )}
              <Link
                to={`/markets/${marketId}/briefing`}
                className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-surface px-3 py-1.5 text-[12px] font-medium text-content transition-colors hover:bg-surface-2"
                title="Generate a cited update across every tracked company"
              >
                <Newspaper className="h-3.5 w-3.5" />
                Briefing
              </Link>
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
          )}
        </div>

        {/* The visible heartbeat: desks verifying, correcting, and warming tabs live. */}
        {!readOnly && <AgentActivityFeed living={living} />}
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
            {!readOnly && market.data && marketId && (
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
            {!readOnly && <SettingsLink className="btn-ghost">Data safety</SettingsLink>}
            <Link to="/history" className="btn-ghost">
              All decks
            </Link>
          </div>
        </div>
      )}

      {!deckMissing && (
        <QueryBoundary
          query={cards}
          loading={<CardGridSkeleton />}
          isEmpty={(list) => list.length === 0}
          empty={
            readOnly ? (
              <EmptyState
                title="No staged company records"
                description="This saved market has no readable company profiles in the migration preview. The original archive remains unchanged."
                icon={<Layers className="h-6 w-6" />}
              />
            ) : isRunning ? (
              <div className="panel mx-auto max-w-xl p-8 text-center glow-border my-6">
                <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-primary/10 text-primary">
                  <Radar className="h-6 w-6 animate-pulse text-primary" />
                </div>
                <h2 className="mt-4 font-display text-xl font-semibold text-content">
                  Sentinel Cloud Agent is researching this market
                </h2>
                <p className="mt-2 text-sm leading-relaxed text-muted">
                  Research is still running. Sourced company cards will appear as each pass
                  completes.
                </p>
                <div className="mt-6 flex items-center justify-center gap-2 text-xs text-primary font-medium">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  <span>Streaming live updates…</span>
                </div>
              </div>
            ) : isPartial ? (
              <div className="panel mx-auto max-w-xl p-8 text-center glow-border my-6">
                <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-primary/10 text-primary">
                  <Radar className="h-6 w-6 animate-pulse text-primary" />
                </div>
                <h2 className="mt-4 font-display text-xl font-semibold text-content">
                  Research in progress — partial results below
                </h2>
                <p className="mt-2 text-sm leading-relaxed text-muted">
                  More cards are being added as they are discovered. Partial cards are marked
                  incomplete.
                </p>
                <div className="mt-6 flex items-center justify-center gap-2 text-xs text-primary font-medium">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  <span>Streaming live updates…</span>
                </div>
              </div>
            ) : isRefreshing ? (
              <div className="panel mx-auto max-w-xl p-8 text-center border-teal-200 bg-teal-50 my-6 dark:border-teal-800 dark:bg-teal-950/50">
                <RefreshCw className="mx-auto h-8 w-8 text-teal-600 animate-spin" />
                <h2 className="mt-3 font-display text-xl font-semibold text-teal-800 dark:text-teal-200">
                  Refreshing deck…
                </h2>
                <p className="mt-2 text-sm leading-relaxed text-muted">
                  Delta research is running. Your existing cards remain visible while new
                  discoveries are added.
                </p>
              </div>
            ) : isStale ? (
              <div className="panel mx-auto max-w-xl p-8 text-center border-amber-200 bg-amber-50 my-6 dark:border-amber-800 dark:bg-amber-950/50">
                <AlertCircle className="mx-auto h-8 w-8 text-amber-600" />
                <h2 className="mt-3 font-display text-xl font-semibold text-amber-800 dark:text-amber-200">
                  Last refresh failed — showing previous results
                </h2>
                <p className="mt-2 text-sm leading-relaxed text-muted">
                  {deckError ||
                    'The refresh did not complete. The deck below is the last successful snapshot.'}
                  {lastSyncedAt && (
                    <span className="block mt-1 text-xs text-faint">
                      Last synced: {new Date(lastSyncedAt).toLocaleString()}
                      {deckRevision ? ` · Revision ${deckRevision}` : ''}
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
                      <RefreshCw
                        className={`h-4 w-4 ${refreshDeck.isPending ? 'animate-spin' : ''}`}
                      />
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
                      <RefreshCw
                        className={`h-4 w-4 ${refreshDeck.isPending ? 'animate-spin' : ''}`}
                      />
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
                    <RefreshCw
                      className={`h-4 w-4 ${refreshDeck.isPending ? 'animate-spin' : ''}`}
                    />
                    {refreshDeck.isPending ? 'Researching…' : 'Run research'}
                  </button>
                }
              />
            )
          }
        >
          {(list) => {
            // Level 2 — Company sub-deck grouped by the 8 size-signal bands.
            if (!readOnly && split === 'company') {
              return (
                <section>
                  <TypeNav
                    cards={list}
                    active="company"
                    onSelect={(t) => setSplit(t === 'company' ? {} : t ? { type: t } : {})}
                    split={split}
                    onToggleSplit={() => setSplit({})}
                  />
                  <p className="mb-4 text-[12px] text-muted">
                    Companies grouped by size-signal band — higher bands first. Bands reflect
                    available size inputs, not company performance or quality.
                    <span className="text-faint"> {CARD_TYPE_DESCRIPTIONS.company}</span>
                  </p>
                  <TierSplit
                    cards={list}
                    cohortCards={all}
                    marketId={marketId}
                    deckStatus={deckStatus}
                    selectable={compare}
                    selected={selected}
                    onToggle={toggleSelected}
                  />
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
            if (!readOnly && split === 'types' && typeParam) {
              const filtered =
                typeParam === 'company'
                  ? sortedCompanies
                  : list.filter((c) => c.card.cardType === typeParam);
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
                    <CardGrid
                      cards={filtered}
                      cohortCards={all}
                      marketId={marketId}
                      deckStatus={deckStatus}
                    />
                  ) : (
                    <ExpandPrompt
                      marketId={marketId}
                      focus={{ cardType: typeParam }}
                      label={`Hunt for ${CARD_TYPE_LABELS[typeParam].toLowerCase()} players in this market`}
                    />
                  )}
                </section>
              );
            }
            // Level 1 — six card-type sub-decks.
            if (!readOnly && split === 'types') {
              return (
                <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                  {VISIBLE_CARD_TYPE_ORDER.map((t) => (
                    <SubDeckTile
                      key={t}
                      type={t}
                      count={countByType.get(t) ?? 0}
                      onClick={() =>
                        t === 'company'
                          ? setSplit({ split: 'company' })
                          : setSplit({ split: 'types', type: t })
                      }
                    />
                  ))}
                </div>
              );
            }
            // Level 0 — show company cards by default (the primary view).
            // Other types are accessible via the category nav.
            const defaultType: CardType = typeParam ?? 'company';
            const filtered =
              defaultType === 'company'
                ? sortedCompanies.filter(
                    (c) => !readOnly || !roleParam || c.marketRoles?.includes(roleParam),
                  )
                : list.filter((c) => c.card.cardType === defaultType);
            return (
              <section>
                {readOnly && defaultType === 'company' ? (
                  <RoleNav
                    cards={sortedCompanies}
                    active={roleParam}
                    onSelect={(role) => {
                      const next = new URLSearchParams(params);
                      if (role) next.set('role', role);
                      else next.delete('role');
                      setParams(next, { replace: true });
                    }}
                  />
                ) : (
                  !readOnly && (
                    <TypeNav
                      cards={list}
                      active={defaultType}
                      onSelect={(t) => setSplit(t ? { type: t } : {})}
                      split={split}
                      onToggleSplit={() =>
                        setSplit(split === 'company' ? {} : { split: 'company' })
                      }
                    />
                  )
                )}
                <div className="mb-4">
                  <p className="text-[12px] text-muted">
                    {filtered.length}{' '}
                    {readOnly
                      ? filtered.length === 1
                        ? 'saved profile'
                        : 'saved profiles'
                      : cardCountNoun(defaultType, filtered.length)}
                    {!readOnly && (
                      <span className="text-faint"> — {CARD_TYPE_DESCRIPTIONS[defaultType]}</span>
                    )}
                    {defaultType === 'company' && !readOnly && (
                      <span className="text-faint">
                        {' '}
                        · Ordered by size-signal band, not company quality
                      </span>
                    )}
                  </p>
                </div>
                {filtered.length > 0 ? (
                  <>
                    <CardGrid
                      cards={filtered}
                      cohortCards={all}
                      marketId={marketId}
                      deckStatus={deckStatus}
                      selectable={compare}
                      selected={selected}
                      onToggle={toggleSelected}
                    />
                    {/* The deck never "just stops": hunting more of this type is always one click. */}
                    {!readOnly && (
                      <div className="mt-6">
                        <ExpandPrompt
                          marketId={marketId}
                          focus={typeParam ? { cardType: typeParam } : {}}
                          label={
                            typeParam
                              ? `Hunt for more ${CARD_TYPE_LABELS[typeParam].toLowerCase()} players`
                              : 'Hunt for more companies in this market'
                          }
                          compact
                        />
                      </div>
                    )}
                  </>
                ) : readOnly ? (
                  <p className="py-4 text-sm text-muted">
                    No saved profiles match this role filter.
                  </p>
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
      )}

      {/* Compare mode action bar */}
      {compare && (
        <div className="fixed bottom-6 left-1/2 z-40 flex -translate-x-1/2 items-center gap-3 rounded-full border border-border bg-surface px-4 py-2.5 shadow-card">
          <span className="text-sm tabular-nums text-muted">
            {selected.size} card{selected.size === 1 ? '' : 's'} selected
          </span>
          <button
            type="button"
            className="btn-primary px-3.5 py-1.5 text-sm"
            disabled={selected.size < 2}
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
            <RefreshCw
              className={`h-4 w-4 text-muted ${refreshDeck.isPending ? 'animate-spin' : ''}`}
            />
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
        <h3 className="font-display text-lg font-semibold text-content">
          {CARD_TYPE_LABELS[type]}
        </h3>
        <span className="chip border-border text-muted">{count}</span>
      </div>
      <p className="mt-2 text-sm text-muted">{CARD_TYPE_DESCRIPTIONS[type]}</p>
      <span className="mt-4 inline-flex items-center gap-1 text-xs font-medium text-primary-ink opacity-0 transition-opacity group-hover:opacity-100">
        {type === 'company' ? 'Group by scale band' : 'View cards'}
        <ChevronRight className="h-3.5 w-3.5" />
      </span>
    </button>
  );
}

function RoleNav({
  cards,
  active,
  onSelect,
}: {
  cards: CardWithCompany[];
  active: MarketRole | null;
  onSelect: (role: MarketRole | null) => void;
}) {
  const roles: Array<{ id: MarketRole | null; label: string }> = [
    { id: null, label: 'All profiles' },
    { id: 'company', label: 'Companies' },
    { id: 'infrastructure', label: 'Infrastructure' },
    { id: 'distribution', label: 'Distribution' },
  ];
  return (
    <nav
      className="mb-5 flex flex-wrap gap-1 border-b border-border"
      aria-label="Filter by market role"
      data-testid="role-nav"
    >
      {roles.map(({ id, label }) => {
        const count =
          id === null
            ? cards.length
            : cards.filter((card) => card.marketRoles?.includes(id)).length;
        return (
          <button
            key={id ?? 'all'}
            type="button"
            aria-pressed={active === id}
            onClick={() => onSelect(id)}
            className={cn(
              'whitespace-nowrap border-b-2 px-4 py-2 text-[13px] font-medium transition-colors',
              active === id
                ? 'border-primary text-primary'
                : 'border-transparent text-muted hover:text-content',
            )}
          >
            {label}
            <span className="ml-1.5 text-[11px] text-faint">{count}</span>
          </button>
        );
      })}
    </nav>
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
  const present = VISIBLE_CARD_TYPE_ORDER;

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
        <button
          type="button"
          onClick={onToggleSplit}
          className={cn(
            'inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-border bg-surface px-3 py-1.5 text-[12px] font-medium text-content transition-colors hover:bg-surface-2 mb-1',
            split === 'company' && 'border-primary bg-primary/10 text-primary-ink',
          )}
        >
          <Layers className="h-3.5 w-3.5" />
          {split === 'company' ? 'Ungroup' : 'Group by scale band'}
        </button>
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
    <div
      className={cn('flex flex-wrap items-center gap-3', compact ? 'justify-center py-1' : 'py-3')}
    >
      {!compact && <p className="text-sm text-muted">Nothing surfaced in the first pass.</p>}
      <button
        type="button"
        className={cn(
          'btn-ghost text-sm',
          mine?.status === 'running' &&
            'animate-pulse border-primary/60 bg-primary/5 text-primary-ink',
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
        <span className="text-xs text-muted">
          Search ran — nothing credible found (that’s honest).
        </span>
      )}
      {mine?.status === 'failed' && (
        <span className="text-xs text-negative">Hunt failed — try again.</span>
      )}
    </div>
  );
}

function TierSplit({
  cards,
  cohortCards,
  marketId,
  deckStatus,
  selectable,
  selected,
  onToggle,
}: {
  cards: CardWithCompany[];
  cohortCards: CardWithCompany[];
  marketId: string | undefined;
  deckStatus?: 'running' | 'refreshing' | 'partial' | 'failed' | 'ready' | 'ready_stale';
  selectable: boolean;
  selected: Set<string>;
  onToggle: (cardId: string) => void;
}) {
  const companyCards = cards.filter((c) => c.card.cardType === 'company');
  const byTier = new Map<MaturityTier, CardWithCompany[]>();
  const unverified: CardWithCompany[] = [];
  for (const t of MATURITY_TIERS) byTier.set(t, []);
  for (const c of companyCards) {
    const scaleBand = buildCardView(c).maturity?.tier;
    if (scaleBand != null) byTier.get(scaleBand)!.push(c);
    else unverified.push(c);
  }

  return (
    <div className="space-y-8">
      {DISPLAY_STAGES.map((tier) => {
        const group = byTier.get(tier)!;
        if (group.length === 0) return null;
        return (
          <section key={tier}>
            <div className="mb-3 flex items-center gap-3 border-b border-border pb-2">
              <TierBadge tier={tier} size="md" />
              <span className="text-sm text-muted">{TIER_BLURBS[tier]}</span>
              <span className="ml-auto chip border-border text-muted">{group.length}</span>
            </div>
            <CardGrid
              cards={group}
              cohortCards={cohortCards}
              marketId={marketId}
              deckStatus={deckStatus}
              selectable={selectable}
              selected={selected}
              onToggle={onToggle}
            />
          </section>
        );
      })}
      {unverified.length > 0 && (
        <section data-testid="unverified-stage">
          <div className="mb-3 flex items-center gap-3 border-b border-border pb-2">
            <span className="rounded-full border border-border bg-surface px-3 py-1 text-xs font-semibold text-content">
              Scale unverified
            </span>
            <span className="text-sm text-muted">
              Not enough source-backed size signals for a scale band
            </span>
            <span className="ml-auto chip border-border text-muted">{unverified.length}</span>
          </div>
          <CardGrid
            cards={unverified}
            cohortCards={cohortCards}
            marketId={marketId}
            deckStatus={deckStatus}
            selectable={selectable}
            selected={selected}
            onToggle={onToggle}
          />
        </section>
      )}
    </div>
  );
}
