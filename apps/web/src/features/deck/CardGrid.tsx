import { useState } from 'react';
import { Check } from 'lucide-react';
import { useSearchParams } from 'react-router-dom';
import type { CardWithCompany } from '@mi/contracts';
import { cn } from '@/lib/cn';
import { useMarket } from '@/hooks/data';
import { useRepository } from '@/lib/repository/RepositoryProvider';
import { buildCardShare } from '@/lib/share/codec';
import { verifyCardForShare } from '@/lib/share/preflight';
import { ShareDialog } from '@/features/share/ShareDialog';
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
  return (
    <>
      <div
        className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3"
        data-testid="card-grid"
      >
        {cards.map((c) => {
          const isSelected = selectable && (selected?.has(c.card.id) ?? false);
          return (
            <div key={c.card.id} className={cn('relative', selectable && 'cursor-pointer')}>
              <GameCard
                data={c}
                deckUserValues={deckUserValues}
                deckStatus={deckStatus}
                onOpen={() => (selectable ? onToggle?.(c.card.id) : setActiveId(c.card.id))}
                onShare={() => setShareTarget(c)}
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
        })}
      </div>
      {/* One share dialog for the whole grid — fact-checks the card first. */}
      <ShareDialog
        open={shareTarget !== null}
        onOpenChange={(o) => {
          if (!o) setShareTarget(null);
        }}
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
        deckView={deckView.toString()}
        position={activeIndex >= 0 ? activeIndex + 1 : undefined}
        total={cards.length}
        onPrevious={activeIndex > 0 ? () => setActiveId(cards[activeIndex - 1]!.card.id) : undefined}
        onNext={activeIndex >= 0 && activeIndex < cards.length - 1 ? () => setActiveId(cards[activeIndex + 1]!.card.id) : undefined}
      />
    </>
  );
}
