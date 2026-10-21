import { isEntityCardType, type CardWithCompany } from '@mi/contracts';
import { buildCardView } from '@/features/card/card-view';
import { missingFaceSlots } from '@/lib/living/faceSweep';

/**
 * Sourced figures showing on a card face: the same measure the deck status
 * strip counts. Null for signal cards, which have no figure slots — they are
 * never given a count they did not earn.
 */
export function sourcedFigureCount(card: CardWithCompany): number | null {
  if (!isEntityCardType(card.card.cardType)) return null;
  return buildCardView(card).faceMetrics.length - missingFaceSlots(card).length;
}

const nameOf = (c: CardWithCompany) => c.company?.name ?? c.card.title ?? '';

/**
 * Deck-sort rule for one lane: most sourced figures first, ties by name. A lane
 * whose cards do not all have a count (signal lanes) keeps its existing order.
 */
export function orderLane(
  cards: CardWithCompany[],
  count: (card: CardWithCompany) => number | null = sourcedFigureCount,
): CardWithCompany[] {
  const counts = new Map<string, number>();
  for (const c of cards) {
    const n = count(c);
    if (n == null) return cards;
    counts.set(c.card.id, n);
  }
  return [...cards].sort((a, b) =>
    (counts.get(b.card.id)! - counts.get(a.card.id)!) || nameOf(a).localeCompare(nameOf(b)));
}
