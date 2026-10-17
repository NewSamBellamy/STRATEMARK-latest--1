/**
 * The cards a conversation is about, shown the way an attached picture would be:
 * small thumbnails of the real cards above the conversation. Each is the same
 * card face the deck shows, scaled down, and pressing it opens the card.
 */
import { useState } from 'react';
import type { CardWithCompany } from '@mi/contracts';
import { CollectibleCard } from '@/features/card/CollectibleCard';
import { CardReader } from '@/features/card/CardReader';
import { buildCardView } from '@/features/card/card-view';
import { useCards } from '@/hooks/data';

const THUMB_WIDTH = 66;
/** The card is laid out at a width where its text is drawn as designed, then scaled down. */
const LAYOUT_WIDTH = 300;
const SCALE = THUMB_WIDTH / LAYOUT_WIDTH;

export function CardThumb({ data, onOpen }: { data: CardWithCompany; onOpen: () => void }) {
  const name = data.company?.name ?? data.card.title ?? 'Card';
  return (
    <button
      type="button"
      onClick={onOpen}
      aria-label={`Open the ${name} card`}
      title={name}
      className="group relative shrink-0 overflow-hidden rounded-lg shadow-sm ring-1 ring-border transition-transform hover:-translate-y-0.5 hover:ring-primary/50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary"
      style={{ width: THUMB_WIDTH, height: Math.round(THUMB_WIDTH * 1.4) }}
    >
      <span aria-hidden className="pointer-events-none absolute left-0 top-0 block origin-top-left" style={{ width: LAYOUT_WIDTH, transform: `scale(${SCALE})` }}>
        <CollectibleCard data={data} view={buildCardView(data)} />
      </span>
    </button>
  );
}

const MAX_SHOWN = 6;

export function CardThumbStrip({ deckId, cardIds, marketId }: { deckId: string; cardIds: string[]; marketId?: string }) {
  const cards = useCards(deckId).data ?? [];
  const [openId, setOpenId] = useState<string | null>(null);
  const wanted = new Set(cardIds);
  const matched = cards.filter((c) => wanted.has(c.card.id));
  if (matched.length === 0) return null;
  const shown = matched.slice(0, MAX_SHOWN);
  const active = matched.find((c) => c.card.id === openId) ?? null;
  const at = active ? matched.indexOf(active) : -1;
  return (
    <div className="border-b border-border bg-surface px-4 py-2.5" aria-label="Cards in this conversation">
      <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-faint">
        {matched.length === 1 ? 'Card in this chat' : `${matched.length} cards in this chat`}
      </p>
      <div className="flex items-start gap-2 overflow-x-auto pb-0.5">
        {shown.map((c) => <CardThumb key={c.card.id} data={c} onOpen={() => setOpenId(c.card.id)} />)}
        {matched.length > shown.length && (
          <span className="self-center pl-1 text-[11px] text-faint">+{matched.length - shown.length} more</span>
        )}
      </div>
      <CardReader
        data={active}
        open={active !== null}
        onOpenChange={(o) => { if (!o) setOpenId(null); }}
        marketId={marketId}
        position={at >= 0 ? at + 1 : undefined}
        total={matched.length}
        onPrevious={at > 0 ? () => setOpenId(matched[at - 1]!.card.id) : undefined}
        onNext={at >= 0 && at < matched.length - 1 ? () => setOpenId(matched[at + 1]!.card.id) : undefined}
      />
    </div>
  );
}
