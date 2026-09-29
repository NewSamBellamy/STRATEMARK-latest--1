import { useMemo } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ArrowUpRight, Cloud, Cpu, MapPin, PlusCircle, Trash2 } from 'lucide-react';
import type { Market } from '@mi/contracts';
import { useDeleteDeck, useMarkets } from '@/hooks/data';
import { QueryBoundary } from '@/components/states/QueryBoundary';
import { CardGridSkeleton } from '@/components/states/Skeleton';
import { EmptyState } from '@/components/states/EmptyState';
import { useResearchSession } from '@/features/deck/research-session';
import logoMark from '@/assets/wordmark.svg';

type MarketWithEngine = Market & { engine?: string };

const PALETTES = [
  ['#12352f', '#2b5a50', '#9ce4d2'],
  ['#172f4f', '#31547b', '#a7c6ec'],
  ['#3d304f', '#67527a', '#d8bfea'],
  ['#4c3528', '#79543c', '#e4c09d'],
  ['#263945', '#496272', '#b4d3df'],
] as const;

function hashOf(value: string): number {
  let hash = 0;
  for (let i = 0; i < value.length; i++) hash = (Math.imul(31, hash) + value.charCodeAt(i)) | 0;
  return Math.abs(hash);
}

function DeckTile({
  market,
  onOpen,
  onDelete,
}: {
  market: MarketWithEngine;
  onOpen: () => void;
  onDelete: () => void;
}) {
  const hash = hashOf(market.id);
  const [start, end, accent] = PALETTES[hash % PALETTES.length]!;
  const code = hash.toString(36).slice(0, 3).toUpperCase().padStart(3, '0');
  const date = new Date(market.createdAt).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });

  return (
    <article className="group">
      <div className="relative mx-2">
        <span
          aria-hidden
          className="absolute inset-x-2 -bottom-2 h-full rounded-[20px] border border-border bg-surface-2"
          style={{ transform: 'rotate(1.4deg)' }}
        />
        <span
          aria-hidden
          className="absolute inset-x-1 -bottom-1 h-full rounded-[20px] border border-border bg-surface"
          style={{ transform: 'rotate(-0.8deg)' }}
        />
        <button
          type="button"
          onClick={onOpen}
          aria-label={'Open ' + market.name}
          className="relative block aspect-[3/4] w-full overflow-hidden rounded-[20px] border border-white/15 text-left shadow-card transition-all duration-200 hover:-translate-y-1 hover:shadow-card-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
          style={{
            background:
              'radial-gradient(circle at 78% 18%, ' +
              accent +
              '35 0, transparent 27%), linear-gradient(145deg, ' +
              start +
              ', ' +
              end +
              ')',
          }}
        >
          <span className="absolute inset-3 rounded-[14px] border border-white/15" />
          <span className="absolute left-5 right-5 top-5 flex items-center justify-between text-[9px] font-semibold uppercase tracking-[0.2em] text-white/55">
            <span>Stratemark / Market</span>
            <span>D{code}</span>
          </span>
          <span
            aria-hidden
            className="absolute right-5 top-14 font-display text-[96px] font-bold leading-none text-white/[0.06]"
          >
            {market.name.trim().charAt(0).toUpperCase()}
          </span>
          <span className="absolute inset-x-5 bottom-6">
            <span className="mb-3 block h-px w-10" style={{ backgroundColor: accent }} />
            <span className="block font-display text-[22px] font-semibold leading-[1.08] tracking-[-0.03em] text-white [text-wrap:balance]">
              {market.name}
            </span>
            <span className="mt-2 block line-clamp-2 text-[11px] leading-relaxed text-white/60">
              {market.scopeDefinition.vertical}
            </span>
            <span className="mt-4 inline-flex items-center gap-1 text-[10px] font-medium text-white/65">
              Open deck <ArrowUpRight className="h-3 w-3" />
            </span>
          </span>
        </button>
        <button
          type="button"
          title={'Delete "' + market.name + '"'}
          aria-label={'Delete ' + market.name}
          onClick={onDelete}
          className="absolute right-3 top-3 z-10 grid h-8 w-8 place-items-center rounded-full border border-white/15 bg-black/20 text-white/55 opacity-0 backdrop-blur-sm transition-all hover:bg-red-500/80 hover:text-white focus:opacity-100 group-hover:opacity-100"
        >
          <Trash2 className="h-3.5 w-3.5" />
        </button>
      </div>
      <div className="mt-4 px-2">
        <div className="flex items-center justify-between gap-2 text-[11px] text-muted">
          <span className="inline-flex min-w-0 items-center gap-1.5 truncate">
            {market.scopeDefinition.geography && (
              <>
                <MapPin className="h-3 w-3 shrink-0" />
                <span className="truncate">{market.scopeDefinition.geography}</span>
              </>
            )}
          </span>
          <span className="shrink-0 text-faint">{date}</span>
        </div>
        <span className="mt-1.5 inline-flex items-center gap-1 text-[10px] text-faint">
          {market.engine === 'cloud' ? (
            <>
              <Cloud className="h-3 w-3" /> Cloud research
            </>
          ) : (
            <>
              <Cpu className="h-3 w-3" /> Local research
            </>
          )}
        </span>
      </div>
    </article>
  );
}

function ResearchingTile({ query }: { query: string }) {
  return (
    <Link to="/" className="group block">
      <div className="relative mx-2 aspect-[3/4] overflow-hidden rounded-[20px] border border-dashed border-primary/40 bg-[#edf6f1] p-5 shadow-card transition-transform hover:-translate-y-1">
        <span className="absolute inset-3 rounded-[14px] border border-primary/10" />
        <span className="relative text-[9px] font-semibold uppercase tracking-[0.2em] text-primary">
          Researching now
        </span>
        <span className="absolute left-1/2 top-1/2 grid h-16 w-16 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full border border-primary/20">
          <span className="h-3 w-3 animate-ping rounded-full bg-primary" />
        </span>
        <span className="absolute inset-x-5 bottom-6">
          <span className="block font-display text-[21px] font-semibold leading-tight text-content [text-wrap:balance]">
            {query}
          </span>
          <span className="mt-2 block text-[11px] text-muted">Open the live research room</span>
        </span>
      </div>
    </Link>
  );
}

export default function MarketsListPage() {
  const markets = useMarkets();
  const deleteDeck = useDeleteDeck();
  const navigate = useNavigate();
  const session = useResearchSession((state) => state.session);
  const researching = session?.running ? session.query : null;
  const sorted = useMemo(
    () =>
      [...((markets.data ?? []) as MarketWithEngine[])].sort(
        (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
      ),
    [markets.data],
  );

  return (
    <div className="mx-auto max-w-6xl">
      <header className="mb-8 flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-primary">
            Research library
          </p>
          <h1 className="mt-1 font-display text-[32px] font-semibold tracking-[-0.03em] text-content">
            All decks
          </h1>
          <p className="mt-1 text-sm text-muted">Every market you have researched, newest first.</p>
        </div>
        <div className="flex items-center gap-3">
          {sorted.length > 0 && (
            <span className="text-[12px] tabular-nums text-muted">
              {sorted.length} {sorted.length === 1 ? 'deck' : 'decks'}
            </span>
          )}
          <Link to="/" className="btn-primary">
            <PlusCircle className="h-4 w-4" />
            New deck
          </Link>
        </div>
      </header>

      <QueryBoundary
        query={markets}
        loading={<CardGridSkeleton count={3} />}
        isEmpty={(list) => list.length === 0 && !researching}
        empty={
          <EmptyState
            title="No decks yet"
            description="Describe a market in plain language and Stratemark will research it into a deck."
            icon={<img src={logoMark} alt="" className="h-6 w-6 opacity-40 grayscale" />}
            action={
              <Link to="/" className="btn-primary mt-2">
                <PlusCircle className="h-4 w-4" />
                Create your first deck
              </Link>
            }
          />
        }
      >
        {() => (
          <section
            className="grid gap-x-7 gap-y-10 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4"
            aria-label="Research decks"
          >
            {researching && <ResearchingTile query={researching} />}
            {sorted.map((market) => (
              <DeckTile
                key={market.id}
                market={market}
                onOpen={() => navigate('/markets/' + market.id + '/deck')}
                onDelete={() => {
                  if (confirm('Are you sure you want to delete "' + market.name + '"?')) {
                    deleteDeck.mutate(market.id);
                  }
                }}
              />
            ))}
          </section>
        )}
      </QueryBoundary>
    </div>
  );
}
