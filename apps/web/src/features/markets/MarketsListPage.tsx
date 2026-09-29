/**
 * All decks — ONE shelf, and every deck finally looks like a deck of cards.
 *
 * Founder's spec, third pass (verbatim): "Make it like a deck of cards front
 * and center and then the next deck of cards, and just one carousel you can
 * scroll through… use the image generation to make a really nice face card
 * for each deck… It should just be all decks." So:
 *
 *  · ONE section. No "Your decks" + "All decks" duplication.
 *  · Each deck renders as a physical portrait card stack (two offset card
 *    edges behind the face), with a GENERATED face-card image (nano-banana,
 *    vault-cached — one image per deck, ever) and the deck's name set over a
 *    quiet scrim. No rainbow accent bands — the art carries the color.
 *  · Hand-pull carousel: grab and drag anywhere; scroll-snap centers the
 *    nearest stack; the centered deck is the hero with its info strip and
 *    actions below. Oldest left, newest right.
 *  · A deck being researched RIGHT NOW appears at the right end as a live,
 *    pulsing card back — starting a hunt is never invisible.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ArrowRight, Cloud, Cpu, MapPin, PlusCircle, Trash2 } from 'lucide-react';
import { useDeleteDeck, useMarkets } from '@/hooks/data';
import { useAiCover } from '@/lib/ai/aiCover';
import { QueryBoundary } from '@/components/states/QueryBoundary';
import { CardGridSkeleton } from '@/components/states/Skeleton';
import { EmptyState } from '@/components/states/EmptyState';
import { useResearchSession } from '@/features/deck/research-session';
import { cn } from '@/lib/cn';
import type { Market } from '@mi/contracts';
import logoMark from '@/assets/wordmark.svg';

/** Market objects returned by SentinelRepository carry an optional runtime `engine` tag. */
type MarketWithEngine = Market & { engine?: string };

/**
 * Quiet, deterministic card-back palette per deck — used only until (or
 * unless) the generated face art exists. Muted duotones, not Christmas.
 */
const BACKS = [
  ['#1f2937', '#374151'], // graphite
  ['#1e3a5f', '#2d4a73'], // deep navy
  ['#3b3054', '#4a3d68'], // aubergine
  ['#1f3d33', '#2d5445'], // forest
  ['#4a3728', '#5e4536'], // umber
  ['#2d3a4a', '#3d4d61'], // slate blue
] as const;

function backOf(id: string): readonly [string, string] {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (Math.imul(31, h) + id.charCodeAt(i)) | 0;
  return BACKS[Math.abs(h) % BACKS.length]!;
}

/** The face card: generated art (vault-cached) or the designed card back. */
function DeckFace({ market }: { market: MarketWithEngine }) {
  const scope = market.scopeDefinition;
  const { url: art } = useAiCover(
    `deckface:${market.id}`,
    market.name,
    `The face card of a premium trading-card deck about the "${market.name}" competitive market (${scope.vertical}${scope.geography ? `, ${scope.geography}` : ''}). One striking editorial illustration that captures this industry — concrete subject matter, no text, no logos.`,
    '3:4',
  );
  const [c1, c2] = backOf(market.id);
  return (
    <>
      {art ? (
        <img src={art} alt="" className="absolute inset-0 h-full w-full object-cover" />
      ) : (
        /* The card back: quiet duotone with an embossed monogram ring. */
        <div
          aria-hidden
          className="absolute inset-0"
          style={{ background: `linear-gradient(150deg, ${c1} 0%, ${c2} 100%)` }}
        >
          <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2">
            <img src={logoMark} alt="" className="h-10 w-10 opacity-[0.15] drop-shadow-sm grayscale invert" />
          </div>
        </div>
      )}
      {/* The nameplate: the deck's identity over a quiet scrim. */}
      <span
        aria-hidden
        className="absolute inset-x-0 bottom-0 h-2/5 bg-gradient-to-t from-black/80 via-black/40 to-transparent"
      />
      <span className="absolute inset-x-0 bottom-0 p-4 text-left">
        <span className="block text-[10px] font-medium tracking-normal text-white/60">
          Stratemark Deck
        </span>
        <span className="mt-1 block font-display text-[17px] font-bold leading-snug text-white [text-wrap:balance]">
          {market.name}
        </span>
        <span className="mt-0.5 block truncate text-[11px] text-white/70">
          {scope.vertical}
        </span>
      </span>
      {art && (
        <span className="absolute right-2.5 top-2 font-display text-[8px] italic tracking-wide text-white/60">
          AI-generated
        </span>
      )}
    </>
  );
}

/** A deck as a physical stack of cards — two edges peeking behind the face. */
function DeckStack({
  market,
  onOpen,
}: {
  market: MarketWithEngine;
  onOpen: () => void;
}) {
  return (
    <div className="group relative select-none">
      <span
        aria-hidden
        className="absolute inset-x-2 -bottom-2 h-full rounded-2xl border border-border bg-surface-2 shadow-sm"
        style={{ transform: 'rotate(1.4deg)' }}
      />
      <span
        aria-hidden
        className="absolute inset-x-1 -bottom-1 h-full rounded-2xl border border-border bg-surface shadow-sm"
        style={{ transform: 'rotate(-1deg)' }}
      />
      <button
        type="button"
        onClick={onOpen}
        className="relative block aspect-[3/4] w-full cursor-pointer overflow-hidden rounded-2xl border border-border bg-surface text-left shadow-card transition-all hover:-translate-y-1 hover:shadow-card-hover"
        title={`Open ${market.name}`}
      >
        <DeckFace market={market} />
      </button>
    </div>
  );
}

/** The deck that's still in the oven — a pulsing card back at the shelf's end. */
function ResearchingStack({ query, onOpen }: { query: string; onOpen: () => void }) {
  return (
    <div className="relative select-none">
      <span
        aria-hidden
        className="absolute inset-x-2 -bottom-2 h-full rounded-2xl border border-border bg-surface-2 shadow-sm"
        style={{ transform: 'rotate(1.4deg)' }}
      />
      <button
        type="button"
        onClick={onOpen}
        className="relative block aspect-[3/4] w-full cursor-pointer overflow-hidden rounded-2xl border border-dashed border-primary/40 bg-surface text-left shadow-card"
        title="Research is running — open the live progress"
      >
        <div className="absolute inset-0 grid place-items-center">
          <span className="grid h-16 w-16 place-items-center rounded-full border border-primary/30">
            <span className="h-3 w-3 animate-ping rounded-full bg-primary" />
          </span>
        </div>
        <span className="absolute inset-x-0 bottom-0 p-4">
          <span className="block text-[9px] font-semibold uppercase tracking-[0.28em] text-primary-ink">
            Researching now
          </span>
          <span className="mt-1 block font-display text-[17px] font-bold leading-snug text-content [text-wrap:balance]">
            {query}
          </span>
          <span className="mt-1.5 block h-2 w-2/3 animate-pulse rounded bg-surface-2" />
        </span>
      </button>
    </div>
  );
}

/**
 * THE shelf — every deck on one hand-pull carousel. Native scroll-snap does
 * the physics; pointer-drag makes the whole rail grabbable.
 */
function DeckShelf({
  decks,
  researching,
  onOpen,
  onDelete,
}: {
  decks: MarketWithEngine[];
  researching: string | null;
  onOpen: (id: string) => void;
  onDelete: (m: MarketWithEngine) => void;
}) {
  const railRef = useRef<HTMLDivElement>(null);
  const count = decks.length + (researching ? 1 : 0);
  const [activeIdx, setActiveIdx] = useState(count - 1);
  const drag = useRef<{ startX: number; startScroll: number; moved: boolean } | null>(null);
  const navigate = useNavigate();

  // Open on the newest item (right end of the shelf).
  useEffect(() => {
    const el = railRef.current;
    if (el) el.scrollLeft = el.scrollWidth;
  }, []);

  // Track which stack sits at center — its info strip renders below.
  const onScroll = useCallback(() => {
    const el = railRef.current;
    if (!el) return;
    const center = el.scrollLeft + el.clientWidth / 2;
    const kids = Array.from(el.children) as HTMLElement[];
    let best = 0;
    let bestDist = Infinity;
    kids.forEach((kid, i) => {
      const mid = kid.offsetLeft + kid.offsetWidth / 2;
      const dist = Math.abs(mid - center);
      if (dist < bestDist) {
        bestDist = dist;
        best = i;
      }
    });
    setActiveIdx(best);
  }, []);

  const active: MarketWithEngine | null = decks[activeIdx] ?? null;
  const activeIsResearch = researching != null && activeIdx === decks.length;

  return (
    <section>
      <div
        ref={railRef}
        onScroll={onScroll}
        onPointerDown={(e) => {
          const el = railRef.current;
          if (!el) return;
          drag.current = { startX: e.clientX, startScroll: el.scrollLeft, moved: false };
        }}
        onPointerMove={(e) => {
          const el = railRef.current;
          if (!el || !drag.current) return;
          const dx = e.clientX - drag.current.startX;
          if (Math.abs(dx) > 4) {
            drag.current.moved = true;
            el.scrollLeft = drag.current.startScroll - dx;
          }
        }}
        onPointerUp={() => {
          drag.current = null;
        }}
        onPointerLeave={() => {
          drag.current = null;
        }}
        className="flex cursor-grab snap-x snap-mandatory gap-8 overflow-x-auto px-[30%] pb-8 pt-4 [scrollbar-width:none] active:cursor-grabbing [&::-webkit-scrollbar]:hidden"
        aria-label="All decks — drag to browse, oldest left to newest right"
      >
        {decks.map((m, i) => (
          <div
            key={m.id}
            className={cn(
              'w-[220px] shrink-0 snap-center transition-all duration-200 sm:w-[250px]',
              i === activeIdx ? 'scale-100 opacity-100' : 'scale-[0.88] opacity-55',
            )}
          >
            <DeckStack
              market={m}
              onOpen={() => {
                // A drag that ended on the card is a pull, not a click.
                if (!drag.current?.moved) onOpen(m.id);
              }}
            />
          </div>
        ))}
        {researching && (
          <div
            className={cn(
              'w-[220px] shrink-0 snap-center transition-all duration-200 sm:w-[250px]',
              activeIsResearch ? 'scale-100 opacity-100' : 'scale-[0.88] opacity-55',
            )}
          >
            <ResearchingStack
              query={researching}
              onOpen={() => {
                if (!drag.current?.moved) navigate('/');
              }}
            />
          </div>
        )}
      </div>

      {/* The info strip: what's centered, with its actions. */}
      <div className="mx-auto max-w-md text-center">
        {activeIsResearch ? (
          <div>
            <p className="font-display text-[15px] font-semibold text-content">{researching}</p>
            <p className="mt-0.5 text-[12px] text-muted">
              The desk is researching this market right now — cards appear as they're found.
            </p>
            <Link to="/" className="btn-primary mt-3 inline-flex">
              Watch the research
            </Link>
          </div>
        ) : active ? (
          <div>
            <p className="font-display text-[15px] font-semibold text-content">{active.name}</p>
            <p className="mt-0.5 flex flex-wrap items-center justify-center gap-x-3 gap-y-1 text-[12px] text-muted">
              <span>{active.scopeDefinition.vertical}</span>
              {active.scopeDefinition.geography && (
                <span className="inline-flex items-center gap-1">
                  <MapPin className="h-3 w-3" />
                  {active.scopeDefinition.geography}
                </span>
              )}
              <span className="inline-flex items-center gap-1">
                {active.engine === 'cloud' ? (
                  <>
                    <Cloud className="h-3 w-3 text-teal-500" /> Sentinel cloud
                  </>
                ) : (
                  <>
                    <Cpu className="h-3 w-3" /> Local engine
                  </>
                )}
              </span>
              <span className="text-faint">
                {new Date(active.createdAt).toLocaleDateString(undefined, {
                  month: 'short',
                  day: 'numeric',
                })}
              </span>
              <span className="tabular-nums text-faint">
                {activeIdx + 1} / {count}
              </span>
            </p>
            <div className="mt-3 flex items-center justify-center gap-2">
              <button type="button" className="btn-primary" onClick={() => onOpen(active.id)}>
                Open deck
                <ArrowRight className="h-4 w-4" />
              </button>
              <button
                type="button"
                title={`Delete "${active.name}"`}
                onClick={() => onDelete(active)}
                className="grid h-9 w-9 place-items-center rounded-lg border border-border text-faint transition-colors hover:border-red-300 hover:bg-red-500/10 hover:text-red-500"
              >
                <Trash2 className="h-4 w-4" />
              </button>
            </div>
          </div>
        ) : null}
      </div>
    </section>
  );
}

export default function MarketsListPage() {
  const markets = useMarkets();
  const deleteDeck = useDeleteDeck();
  const navigate = useNavigate();
  const open = (id: string) => navigate(`/markets/${id}/deck`);
  // A deck being researched right now belongs on the shelf already.
  const session = useResearchSession((s) => s.session);
  const researching = session?.running ? session.query : null;

  const sorted = useMemo(
    () =>
      [...((markets.data ?? []) as MarketWithEngine[])].sort(
        (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
      ),
    [markets.data],
  );

  return (
    <div className="mx-auto max-w-5xl">
      <div className="mb-2 flex items-end justify-between">
        <div>
          <h1 className="font-display text-2xl font-semibold text-content">All decks</h1>
          <p className="mt-1 text-sm text-muted">
            Every market you've researched, as a deck of cards. Drag the shelf — oldest left,
            newest right.
          </p>
        </div>
        <Link to="/" className="btn-primary">
          <PlusCircle className="h-4 w-4" />
          New deck
        </Link>
      </div>

      <QueryBoundary
        query={markets}
        loading={<CardGridSkeleton count={3} />}
        isEmpty={(list) => list.length === 0 && !researching}
        empty={
          <EmptyState
            title="No decks yet"
            description="Describe a market in plain language and we'll research it into a deck of cards."
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
          <DeckShelf
            decks={sorted}
            researching={researching}
            onOpen={open}
            onDelete={(m) => {
              if (confirm(`Are you sure you want to delete "${m.name}"?`)) {
                deleteDeck.mutate(m.id);
              }
            }}
          />
        )}
      </QueryBoundary>
    </div>
  );
}
