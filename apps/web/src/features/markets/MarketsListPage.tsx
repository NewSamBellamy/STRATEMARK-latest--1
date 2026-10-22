/**
 * All decks. Each deck reads as a physical stack of cards: two card backs
 * fanned behind a face card carrying the lead company's logo and brand
 * colour. Every figure shown (company count, coverage, status, updated) is
 * derived from stored data in ./deck-library; nothing is estimated.
 */
import { DeckCover } from './DeckCover';
import { deckDisplayTitle, deckTitleSize } from './coverArt';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useQueries } from '@tanstack/react-query';
import { MoreHorizontal, PlusCircle, Search } from 'lucide-react';
import type { CardWithCompany, Deck, Market } from '@mi/contracts';
import { useArchiveDeck, useDeleteDeck, useMarkets, projectCard } from '@/hooks/data';
import { useRepository, useSupports } from '@/lib/repository/RepositoryProvider';
import { QueryBoundary } from '@/components/states/QueryBoundary';
import { CardGridSkeleton } from '@/components/states/Skeleton';
import { EmptyState } from '@/components/states/EmptyState';
import { useResearchSession } from '@/features/deck/research-session';
import { cn } from '@/lib/cn';
import logoMark from '@/assets/wordmark.svg';
import {
  RESEARCH_STATE_LABEL,
  companyCount,
  computeCoverage,
  filterDecks,
  formatUpdated,
  pickLeadCard,
  researchState,
  sortDecks,
  type Coverage,
  type DeckSort,
  type ResearchState,
} from './deck-library';

interface DeckRow {
  market: Market;
  size: number | null;
  updatedAt: string;
  state: ResearchState;
  coverage: Coverage | null;
  lead: CardWithCompany | null;
}

interface LibraryEntry {
  deck: (Deck & { status?: string }) | null;
  cards: CardWithCompany[];
}

/**
 * Just the data of each library query. A stable `combine` lets TanStack
 * structurally share the result, so the array keeps its identity until some
 * deck's data actually changes (not on every fetch-status flip).
 */
const libraryData = (results: Array<{ data?: LibraryEntry }>) => results.map((r) => r.data);

/** Loads every deck's status and cards once, so sorting by size/recency is real. */
export function useDeckRows(markets: Market[]): DeckRow[] {
  const repo = useRepository();
  const entries = useQueries({
    queries: markets.map((m) => ({
      queryKey: ['library', m.id],
      staleTime: 30_000,
      queryFn: async (): Promise<LibraryEntry> => {
        const deck = (await repo.getDeckByMarket(m.id)) as (Deck & { status?: string }) | null;
        const cards = deck ? await repo.listCards(deck.id) : [];
        return { deck, cards: cards.map(projectCard) };
      },
    })),
    combine: libraryData,
  });
  // Coverage and lead-card picks walk every card: rebuild only when a market
  // or its deck data changed, and hand sorting/filtering a stable array.
  return useMemo(() => markets.map((market, i) => {
    const data = entries[i];
    const cards = data?.cards ?? null;
    return {
      market,
      size: cards ? companyCount(cards) : null,
      updatedAt: data?.deck?.lastRefreshedAt ?? data?.deck?.createdAt ?? market.createdAt,
      state: researchState(data?.deck?.status),
      coverage: cards && cards.length > 0 ? computeCoverage(cards) : null,
      lead: cards ? pickLeadCard(cards) : null,
    };
  }), [markets, entries]);
}

/**
 * A deck on the shelf: a card-shaped cover (engraved like the card backs, unique
 * to the deck), with the edges of the cards behind it showing like a real deck.
 * On hover the cover lifts and the stack fans a little. Motion is off under
 * reduced-motion.
 */
function DeckStack({ row }: { row: DeckRow }) {
  const { market } = row;
  const count = row.size;
  // The cover carries a short title; the full market name is in the text under the deck.
  const title = deckDisplayTitle(market.name);
  const edge =
    'absolute inset-0 rounded-2xl border border-black/25 bg-[#1b2a25] shadow-sm transition-transform duration-300 ease-out motion-reduce:transition-none';
  return (
    <div className="relative aspect-[5/7] w-full">
      <span
        aria-hidden
        className={cn(edge, '[transform:translate(8px,8px)] group-hover:[transform:translate(14px,8px)_rotate(2.5deg)] group-focus-visible:[transform:translate(14px,8px)_rotate(2.5deg)] motion-reduce:group-hover:[transform:translate(8px,8px)] motion-reduce:group-focus-visible:[transform:translate(8px,8px)]')}
      />
      <span
        aria-hidden
        className={cn(edge, 'bg-[#24362f] [transform:translate(4px,4px)] group-hover:[transform:translate(5px,4px)_rotate(1deg)] group-focus-visible:[transform:translate(5px,4px)_rotate(1deg)] motion-reduce:group-hover:[transform:translate(4px,4px)] motion-reduce:group-focus-visible:[transform:translate(4px,4px)]')}
      />
      <span className="absolute inset-0 overflow-hidden rounded-2xl shadow-card transition-all duration-300 ease-out group-hover:-translate-y-1.5 group-hover:shadow-card-hover motion-reduce:transition-none motion-reduce:group-hover:translate-y-0">
        <DeckCover name={market.name} seed={market.id} className="absolute inset-0 h-full w-full" />
        <span className="absolute inset-x-0 bottom-0 px-5 pb-8 pt-4 text-center">
          <span className="line-clamp-3 block break-words font-display font-semibold leading-tight text-[#f1ead2] [text-wrap:balance]"
            style={{ fontSize: deckTitleSize(title) }}>
            {title}
          </span>
          {count != null && (
            <span className="mt-1.5 block text-[10.5px] uppercase tracking-[0.18em] text-[#f1ead2]/70">
              {count} {count === 1 ? 'company' : 'companies'}
            </span>
          )}
        </span>
      </span>
    </div>
  );
}

function StatusChip({ state }: { state: ResearchState }) {
  const label = RESEARCH_STATE_LABEL[state];
  if (!label) return null;
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[11px] font-medium',
        state === 'live' ? 'border-primary/30 text-primary-ink' : 'border-border text-muted',
      )}
    >
      <span
        aria-hidden
        className={cn(
          'h-1.5 w-1.5 rounded-full',
          state === 'live' && 'animate-pulse bg-primary motion-reduce:animate-none',
          state === 'complete' && 'bg-positive',
          state === 'stale' && 'bg-neutral',
          state === 'incomplete' && 'bg-negative',
        )}
      />
      {label}
    </span>
  );
}

function OverflowMenu({
  market,
  onOpen,
  onArchive,
  onDelete,
}: {
  market: Market;
  onOpen: () => void;
  onArchive: (() => void) | null;
  onDelete: () => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const navigate = useNavigate();
  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', away);
    document.addEventListener('keydown', esc);
    return () => {
      document.removeEventListener('mousedown', away);
      document.removeEventListener('keydown', esc);
    };
  }, [open]);
  const item = 'block w-full px-3 py-1.5 text-left text-[13px] text-content hover:bg-surface-2';
  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        aria-label={`More actions for ${market.name}`}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className="grid h-8 w-8 place-items-center rounded-lg text-muted transition-colors hover:bg-surface-2 hover:text-content"
      >
        <MoreHorizontal className="h-4 w-4" />
      </button>
      {open && (
        <div
          role="menu"
          className="absolute bottom-full right-0 z-10 mb-1 w-40 overflow-hidden rounded-xl border border-border bg-surface py-1 shadow-card-hover"
        >
          <button role="menuitem" type="button" className={item} onClick={onOpen}>
            Open deck
          </button>
          <button
            role="menuitem"
            type="button"
            className={item}
            onClick={() => navigate(`/markets/${market.id}/settings`)}
          >
            Deck settings
          </button>
          {onArchive && (
            <button
              role="menuitem"
              type="button"
              className={item}
              onClick={() => {
                setOpen(false);
                onArchive();
              }}
            >
              {market.archivedAt ? 'Restore deck' : 'Archive deck'}
            </button>
          )}
          <button
            role="menuitem"
            type="button"
            className={cn(item, 'text-negative hover:bg-negative/10')}
            onClick={() => {
              setOpen(false);
              onDelete();
            }}
          >
            Delete deck
          </button>
        </div>
      )}
    </div>
  );
}

function DeckTile({
  row,
  onOpen,
  onArchive,
  onDelete,
}: {
  row: DeckRow;
  onOpen: () => void;
  onArchive: (() => void) | null;
  onDelete: () => void;
}) {
  const { market } = row;
  const pct = row.coverage?.percent ?? null;
  return (
    <li className="flex flex-col">
      <button
        type="button"
        onClick={onOpen}
        aria-label={`Open ${market.name}`}
        className="group mx-3 mt-2 block cursor-pointer rounded-2xl text-left outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-4 focus-visible:ring-offset-bg"
      >
        <DeckStack row={row} />
      </button>
      <div className="mt-5 flex items-start justify-between gap-2 px-1">
        <div className="min-w-0">
          <p className="line-clamp-2 font-display text-[15px] font-semibold text-content">
            {market.name}
          </p>
          <p className="mt-0.5 line-clamp-2 text-[12px] text-muted">{market.scopeDefinition.vertical}</p>
        </div>
        <OverflowMenu market={market} onOpen={onOpen} onArchive={onArchive} onDelete={onDelete} />
      </div>
      <dl className="mt-2 grid grid-cols-3 gap-2 px-1 text-[12px]">
        <div>
          <dt className="text-faint">Companies</dt>
          <dd className="tabular-nums text-content">{row.size ?? '—'}</dd>
        </div>
        <div>
          <dt className="text-faint">Coverage</dt>
          <dd className="tabular-nums text-content">{pct != null ? `${pct}%` : '—'}</dd>
        </div>
        <div>
          <dt className="text-faint">Updated</dt>
          <dd className="truncate text-content">{formatUpdated(row.updatedAt)}</dd>
        </div>
      </dl>
      <div className="mt-2 px-1">
        <StatusChip state={row.state} />
      </div>
    </li>
  );
}

function Controls({
  query,
  setQuery,
  sort,
  setSort,
  archivedCount,
  showArchived,
  setShowArchived,
}: {
  query: string;
  setQuery: (v: string) => void;
  sort: DeckSort;
  setSort: (v: DeckSort) => void;
  archivedCount: number;
  showArchived: boolean;
  setShowArchived: (v: boolean) => void;
}) {
  return (
    <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-center">
      <label className="relative flex-1">
        <span className="sr-only">Search decks</span>
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-faint" />
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search decks"
          className="input w-full pl-9"
        />
      </label>
      <label className="flex items-center gap-2 text-[13px] text-muted">
        Sort by
        <select
          value={sort}
          onChange={(e) => setSort(e.target.value as DeckSort)}
          className="input w-auto"
        >
          <option value="recent">Recent</option>
          <option value="name">Name</option>
          <option value="size">Size</option>
        </select>
      </label>
      {(archivedCount > 0 || showArchived) && (
        <button
          type="button"
          aria-pressed={showArchived}
          onClick={() => setShowArchived(!showArchived)}
          className={cn('btn-ghost shrink-0 text-[13px]', showArchived && 'bg-surface-2 text-content')}
        >
          {showArchived ? 'Back to decks' : `Archived (${archivedCount})`}
        </button>
      )}
    </div>
  );
}

function ResearchingTile({ query }: { query: string }) {
  return (
    <li className="flex flex-col">
      <Link
        to="/"
        aria-label={`Watch research for ${query}`}
        className="group mx-3 mt-2 block rounded-2xl outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-4 focus-visible:ring-offset-bg"
      >
        <div className="relative aspect-[3/4] w-full">
          <span
            aria-hidden
            className="absolute inset-0 rounded-2xl border border-border bg-surface-2 [transform:rotate(3deg)]"
          />
          <span className="absolute inset-0 grid place-items-center rounded-2xl border border-dashed border-primary/40 bg-surface shadow-card">
            <span className="h-2.5 w-2.5 animate-pulse rounded-full bg-primary motion-reduce:animate-none" />
          </span>
        </div>
      </Link>
      <div className="mt-5 px-1">
        <p className="truncate font-display text-[15px] font-semibold text-content">{query}</p>
        <p className="mt-0.5 text-[12px] text-muted">Cards appear as they are found.</p>
        <div className="mt-2">
          <StatusChip state="live" />
        </div>
      </div>
    </li>
  );
}

function Library({ markets, researching }: { markets: Market[]; researching: string | null }) {
  const navigate = useNavigate();
  const deleteDeck = useDeleteDeck();
  const archiveDeck = useArchiveDeck();
  const canArchive = useSupports('setMarketArchived');
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState<DeckSort>('recent');
  const [showArchived, setShowArchived] = useState(false);
  const rows = useDeckRows(markets);
  // A delete can wait on research still running for the deck: take the tile away
  // at once and bring it back only if the delete fails.
  const [removing, setRemoving] = useState<ReadonlySet<string>>(new Set());
  const archivedCount = useMemo(() => rows.filter((row) => row.market.archivedAt).length, [rows]);
  const shown = useMemo(() => sortDecks(filterDecks(rows, query), sort)
    .filter((row) => !removing.has(row.market.id) && Boolean(row.market.archivedAt) === showArchived),
  [rows, query, sort, removing, showArchived]);
  // Restoring the last archived deck returns to the library.
  useEffect(() => {
    if (showArchived && archivedCount === 0) setShowArchived(false);
  }, [showArchived, archivedCount]);

  return (
    <>
      <Controls
        query={query}
        setQuery={setQuery}
        sort={sort}
        setSort={setSort}
        archivedCount={archivedCount}
        showArchived={showArchived}
        setShowArchived={setShowArchived}
      />
      {archiveDeck.isError && (
        <p role="alert" className="mb-4 text-[13px] text-negative">
          {archiveDeck.error instanceof Error ? archiveDeck.error.message : 'The deck could not be archived.'}
        </p>
      )}
      {shown.length === 0 && !(researching && !showArchived) ? (
        <p className="py-16 text-center text-sm text-muted">
          {query ? <>No decks match &ldquo;{query}&rdquo;.</> : showArchived ? 'No archived decks.' : 'Every deck is archived.'}
        </p>
      ) : (
        <ul className="grid grid-cols-[repeat(auto-fill,minmax(200px,1fr))] gap-x-6 gap-y-10">
          {researching && !query && !showArchived && <ResearchingTile query={researching} />}
          {shown.map((row) => (
            <DeckTile
              key={row.market.id}
              row={row}
              onOpen={() => navigate(`/markets/${row.market.id}/deck`)}
              onArchive={canArchive ? () => archiveDeck.mutate({ id: row.market.id, archived: !row.market.archivedAt }) : null}
              onDelete={() => {
                if (confirm(`Delete "${row.market.name}"? This removes the deck and its cards.`)) {
                  const id = row.market.id;
                  setRemoving((current) => new Set(current).add(id));
                  deleteDeck.mutate(id, {
                    onSettled: () => setRemoving((current) => { const next = new Set(current); next.delete(id); return next; }),
                  });
                }
              }}
            />
          ))}
        </ul>
      )}
    </>
  );
}

export default function MarketsListPage() {
  const markets = useMarkets();
  const session = useResearchSession((s) => s.session);
  const researching = session?.running ? session.query : null;

  return (
    <div className="mx-auto max-w-6xl">
      <div className="mb-6 flex items-end justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl font-semibold text-content">All decks</h1>
          <p className="mt-1 text-sm text-muted">
            Every market you have researched, as a deck of cards.
          </p>
        </div>
        <Link to="/" className="btn-primary shrink-0">
          <PlusCircle className="h-4 w-4" />
          New deck
        </Link>
      </div>

      <QueryBoundary
        query={markets}
        loading={<CardGridSkeleton count={4} />}
        isEmpty={(list) => list.length === 0 && !researching}
        empty={
          <EmptyState
            title="No decks yet"
            description="Describe a market in plain language and it is researched into a deck of cards, with every figure sourced."
            icon={<img src={logoMark} alt="" className="h-6 w-6 opacity-40 grayscale" />}
            action={
              <Link to="/" className="btn-primary mt-2">
                <PlusCircle className="h-4 w-4" />
                Build your first deck
              </Link>
            }
          />
        }
      >
        {(list) => <Library markets={list} researching={researching} />}
      </QueryBoundary>
    </div>
  );
}
