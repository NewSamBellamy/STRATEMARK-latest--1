/**
 * All decks. Each deck reads as a physical stack of cards: two card backs
 * fanned behind a face card carrying the lead company's logo and brand
 * colour. Every figure shown (company count, coverage, status, updated) is
 * derived from stored data in ./deck-library; nothing is estimated.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { rateDeck, type OvrBreakdown } from '@/features/card/rating';
import { OvrPlaque } from '@/features/card/OvrPlaque';
import { Link, useNavigate } from 'react-router-dom';
import { useQueries } from '@tanstack/react-query';
import { MoreHorizontal, PlusCircle, Search } from 'lucide-react';
import type { CardWithCompany, Deck, Market } from '@mi/contracts';
import { useDeleteDeck, useMarkets, projectCard } from '@/hooks/data';
import { useRepository } from '@/lib/repository/RepositoryProvider';
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
  ovr: OvrBreakdown | null;
}

/** Quiet fallback hues, used only when a lead company has no stored brand colour. */
const FALLBACKS = ['#1f2937', '#1e3a5f', '#3b3054', '#1f3d33', '#4a3728', '#2d3a4a'] as const;
function fallbackColor(id: string): string {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (Math.imul(31, h) + id.charCodeAt(i)) | 0;
  return FALLBACKS[Math.abs(h) % FALLBACKS.length]!;
}

const HEX = /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i;
/** Only trust a well-formed, scraped/manual stored hex; the default theme falls back. */
function brandColor(row: DeckRow): string {
  const theme = row.lead?.company?.brandTheme;
  const primary = theme && theme.source !== 'default' ? theme.primary : undefined;
  return primary && HEX.test(primary) ? primary : fallbackColor(row.market.id);
}

/** Loads every deck's status and cards once, so sorting by size/recency is real. */
function useDeckRows(markets: Market[]): DeckRow[] {
  const repo = useRepository();
  const results = useQueries({
    queries: markets.map((m) => ({
      queryKey: ['library', m.id],
      staleTime: 30_000,
      queryFn: async () => {
        const deck = (await repo.getDeckByMarket(m.id)) as (Deck & { status?: string }) | null;
        const cards = deck ? await repo.listCards(deck.id) : [];
        return { deck, cards: cards.map(projectCard) };
      },
    })),
  });
  return markets.map((market, i) => {
    const data = results[i]?.data;
    const cards = data?.cards ?? null;
    return {
      market,
      size: cards ? companyCount(cards) : null,
      updatedAt: data?.deck?.lastRefreshedAt ?? data?.deck?.createdAt ?? market.createdAt,
      state: researchState(data?.deck?.status),
      coverage: cards && cards.length > 0 ? computeCoverage(cards) : null,
      lead: cards ? pickLeadCard(cards) : null,
      ovr: (() => {
        const lead = cards ? pickLeadCard(cards) : null;
        return cards && lead ? rateDeck(cards).get(lead.card.id) ?? null : null;
      })(),
    };
  });
}

/** Fanned stack: two backs behind the face card. Motion is disabled under reduced-motion. */
function DeckStack({ row }: { row: DeckRow }) {
  const color = brandColor(row);
  const logo = row.lead?.company?.logoUrl ?? null;
  const [logoFailed, setLogoFailed] = useState(false);
  const back =
    'absolute inset-0 rounded-2xl border border-border shadow-sm transition-transform duration-300 ease-out motion-reduce:transition-none';
  return (
    <div className="relative aspect-[3/4] w-full">
      <span
        aria-hidden
        className={cn(
          back,
          'bg-surface-2 [transform:rotate(3deg)] group-hover:[transform:translate(10px,-2px)_rotate(5.5deg)] group-focus-visible:[transform:translate(10px,-2px)_rotate(5.5deg)] motion-reduce:group-hover:[transform:rotate(3deg)] motion-reduce:group-focus-visible:[transform:rotate(3deg)]',
        )}
      />
      <span
        aria-hidden
        className={cn(
          back,
          'bg-surface [transform:rotate(-2deg)] group-hover:[transform:translate(-8px,-2px)_rotate(-4deg)] group-focus-visible:[transform:translate(-8px,-2px)_rotate(-4deg)] motion-reduce:group-hover:[transform:rotate(-2deg)] motion-reduce:group-focus-visible:[transform:rotate(-2deg)]',
        )}
      />
      <span
        className="absolute inset-0 overflow-hidden rounded-2xl border border-black/10 shadow-card transition-all duration-300 ease-out group-hover:-translate-y-1.5 group-hover:shadow-card-hover motion-reduce:transition-none motion-reduce:group-hover:translate-y-0"
        style={{
          background: `linear-gradient(155deg, ${color} 0%, ${color} 55%, rgb(0 0 0 / 0.35) 140%)`,
        }}
      >
        {row.ovr && (
          <span className="absolute right-3 top-3">
            <OvrPlaque rating={row.ovr} inline />
          </span>
        )}
        <span className="absolute left-1/2 top-[34%] grid h-16 w-16 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-2xl bg-white shadow-sm">
          {logo && !logoFailed ? (
            <img
              src={logo}
              alt=""
              loading="lazy"
              draggable={false}
              onError={() => setLogoFailed(true)}
              className="h-10 w-10 object-contain"
            />
          ) : (
            <img src={logoMark} alt="" className="h-7 w-7 opacity-40 grayscale" />
          )}
        </span>
        <span
          aria-hidden
          className="absolute inset-x-0 bottom-0 h-1/2 bg-gradient-to-t from-black/70 via-black/35 to-transparent"
        />
        <span className="absolute inset-x-0 bottom-0 p-4 text-left">
          <span className="block text-[10px] font-medium text-white/65">Stratemark deck</span>
          <span className="mt-1 line-clamp-3 block font-display text-[17px] font-semibold leading-snug text-white [text-wrap:balance]">
            {row.market.name}
          </span>
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
  onDelete,
}: {
  market: Market;
  onOpen: () => void;
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
  onDelete,
}: {
  row: DeckRow;
  onOpen: () => void;
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
          <p className="truncate font-display text-[15px] font-semibold text-content">
            {market.name}
          </p>
          <p className="mt-0.5 truncate text-[12px] text-muted">{market.scopeDefinition.vertical}</p>
        </div>
        <OverflowMenu market={market} onOpen={onOpen} onDelete={onDelete} />
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
}: {
  query: string;
  setQuery: (v: string) => void;
  sort: DeckSort;
  setSort: (v: DeckSort) => void;
}) {
  return (
    <div className="mb-6 flex flex-col gap-2 sm:flex-row sm:items-center">
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
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState<DeckSort>('recent');
  const rows = useDeckRows(markets);
  const shown = useMemo(() => sortDecks(filterDecks(rows, query), sort), [rows, query, sort]);

  return (
    <>
      <Controls query={query} setQuery={setQuery} sort={sort} setSort={setSort} />
      {shown.length === 0 && !researching ? (
        <p className="py-16 text-center text-sm text-muted">No decks match &ldquo;{query}&rdquo;.</p>
      ) : (
        <ul className="grid grid-cols-[repeat(auto-fill,minmax(200px,1fr))] gap-x-6 gap-y-10">
          {researching && !query && <ResearchingTile query={researching} />}
          {shown.map((row) => (
            <DeckTile
              key={row.market.id}
              row={row}
              onOpen={() => navigate(`/markets/${row.market.id}/deck`)}
              onDelete={() => {
                if (confirm(`Delete "${row.market.name}"? This removes the deck and its cards.`)) {
                  deleteDeck.mutate(row.market.id);
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
