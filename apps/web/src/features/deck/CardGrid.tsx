import { memo, useCallback, useLayoutEffect, useRef, useState } from 'react';
import { Check } from 'lucide-react';
import { useSearchParams } from 'react-router-dom';
import type { CardWithCompany } from '@mi/contracts';
import { cn } from '@/lib/cn';
import { useMarket } from '@/hooks/data';
import { useRepository } from '@/lib/repository/RepositoryProvider';
import { buildCardShare } from '@/lib/share/codec';
import { verifyCardForShare } from '@/lib/share/preflight';
import { ShareDialog } from '@/features/share/ShareDialog';
import { useReadOnly } from '@/lib/readOnly';
import { GameCard } from '@/features/card/GameCard';
import { CardReader } from '@/features/card/CardReader';

/**
 * A responsive grid of game cards.
 *
 * Two modes:
 *  · browse (default) — clicking a card opens the CardReader.
 *  · select — clicking toggles selection (ring + check badge). Used by the
 *    deck-level "compare" flow: pick companies, then ask a grounded question
 *    about exactly those cards.
 */
export function CardGrid({
  cards,
  deckUserValues,
  marketId,
  deckStatus,
  selectable = false,
  selected,
  onToggle,
}: {
  cards: CardWithCompany[];
  /** The whole deck, when `cards` is a filtered slice. */
  deckCards?: CardWithCompany[];
  deckUserValues: number[];
  /** Lets the reader hand the dashboard a real way back to this deck. */
  marketId?: string;
  deckStatus?: 'running' | 'refreshing' | 'partial' | 'failed' | 'ready' | 'ready_stale';
  selectable?: boolean;
  selected?: Set<string>;
  onToggle?: (cardId: string) => void;
}) {
  // Store the ID, derive the data: when a desk corrects a metric and the cards
  // refetch, the OPEN reader updates in place instead of showing a frozen
  // snapshot — change it in one place, it changes everywhere.
  const [searchParams, setSearchParams] = useSearchParams();
  const activeId = searchParams.get('card');
  const activeIndex = cards.findIndex((c) => c.card.id === activeId);
  const active = activeIndex >= 0 ? cards[activeIndex]! : null;
  const setActiveId = (id: string | null) => {
    const next = new URLSearchParams(searchParams);
    if (id) next.set('card', id);
    else next.delete('card');
    setSearchParams(next, { replace: true });
  };
  const deckView = new URLSearchParams();
  for (const key of ['split', 'type']) {
    const value = searchParams.get(key);
    if (value) deckView.set(key, value);
  }
  const marketName = useMarket(marketId).data?.name ?? null;
  const repo = useRepository();
  const [shareTarget, setShareTarget] = useState<CardWithCompany | null>(null);
  // The click handler reads the URL and mode, which change often; route it
  // through a ref so every card keeps the same callback and memoized cards
  // skip re-rendering when only another card (or the open reader) changed.
  const openHandler = useRef<(cardId: string) => void>(() => {});
  useLayoutEffect(() => {
    openHandler.current = (cardId) => (selectable ? onToggle?.(cardId) : setActiveId(cardId));
  });
  const openCard = useCallback((cardId: string) => openHandler.current(cardId), []);
  // Closing the reader hands focus back to the card it ended on (which may
  // differ from the one that opened it after Prev/Next browsing).
  const gridRef = useRef<HTMLDivElement>(null);
  const cardControl = useCallback((cardId: string) => [...(gridRef.current
    ?.querySelectorAll<HTMLElement>('[data-card-id]') ?? [])]
    .find((slot) => slot.dataset.cardId === cardId)
    ?.querySelector<HTMLElement>('.card-sleeve__open') ?? null, []);
  return (
    <>
      <div
        ref={gridRef}
        className="card-grid"
        data-testid="card-grid"
      >
        {cards.map((c) => (
          <CardGridItem
            key={c.card.id}
            data={c}
            deckUserValues={deckUserValues}
            deckStatus={deckStatus}
            selectable={selectable}
            isSelected={selectable && (selected?.has(c.card.id) ?? false)}
            onOpenCard={openCard}
            onShareCard={setShareTarget}
          />
        ))}
      </div>
      {/* One share dialog for the whole grid — fact-checks the card first. */}
      <ShareDialog
        open={shareTarget !== null}
        onOpenChange={(o) => {
          if (!o) setShareTarget(null);
        }}
        page={shareTarget ? { deckId: shareTarget.card.deckId, cardId: shareTarget.card.id } : undefined}
        title={shareTarget?.company?.name ?? shareTarget?.card.title ?? 'Card'}
        subtitle={marketName ? `${marketName} — market research snapshot` : 'Market research snapshot'}
        build={async (onStage) => {
          if (!shareTarget) throw new Error('Nothing selected to share.');
          const fresh = await verifyCardForShare(repo, shareTarget, onStage);
          return buildCardShare(fresh, marketName);
        }}
      />
      <CardReader
        data={active}
        open={active !== null}
        onOpenChange={(o) => {
          if (!o) setActiveId(null);
        }}
        marketId={marketId}
        returnFocusTo={cardControl}
        deckView={deckView.toString()}
        position={activeIndex >= 0 ? activeIndex + 1 : undefined}
        total={cards.length}
        onPrevious={activeIndex > 0 ? () => setActiveId(cards[activeIndex - 1]!.card.id) : undefined}
        onNext={activeIndex >= 0 && activeIndex < cards.length - 1 ? () => setActiveId(cards[activeIndex + 1]!.card.id) : undefined}
      />
    </>
  );
}

/** One grid slot. Memoized: re-renders only when its own card or selection changes. */
const CardGridItem = memo(function CardGridItem({
  data,
  deckUserValues,
  deckStatus,
  selectable,
  isSelected,
  onOpenCard,
  onShareCard,
}: {
  data: CardWithCompany;
  deckUserValues: number[];
  deckStatus?: 'running' | 'refreshing' | 'partial' | 'failed' | 'ready' | 'ready_stale';
  selectable: boolean;
  isSelected: boolean;
  onOpenCard: (cardId: string) => void;
  onShareCard: (card: CardWithCompany) => void;
}) {
  const cardId = data.card.id;
  const onOpen = useCallback(() => onOpenCard(cardId), [onOpenCard, cardId]);
  const readOnly = useReadOnly();
  const onShare = useCallback(() => onShareCard(data), [onShareCard, data]);
  return (
    <div className={cn('relative', selectable && 'cursor-pointer')} data-card-id={cardId}>
      <GameCard
        data={data}
        deckUserValues={deckUserValues}
        deckStatus={deckStatus}
        onOpen={onOpen}
        onShare={readOnly ? undefined : onShare}
        className={cn(
          selectable && 'transition-opacity',
          selectable && !isSelected && 'opacity-80 hover:opacity-100',
          isSelected && 'ring-2 ring-primary ring-offset-2 ring-offset-app',
        )}
      />
      {isSelected && (
        <span className="pointer-events-none absolute -right-2 -top-2 z-10 grid h-6 w-6 place-items-center rounded-full bg-primary text-white shadow">
          <Check className="h-3.5 w-3.5" />
        </span>
      )}
    </div>
  );
});
