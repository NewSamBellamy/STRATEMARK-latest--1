import type { CardType } from '@mi/contracts';
import vice from '@/assets/card-art/vice.svg';
import barrier from '@/assets/card-art/barrier.svg';
import culture from '@/assets/card-art/culture.svg';
import insight from '@/assets/card-art/insight.svg';

/** A single illustrated default per type, shared by every card in every market. */
export const DEFAULT_CARD_ART: Partial<Record<CardType, {
  src: string; accent: string; highlight: string;
}>> = {
  vice: { src: vice, accent: '#71594b', highlight: '#c8b68b' },
  barrier: { src: barrier, accent: '#5f6958', highlight: '#bac1a1' },
  culture: { src: culture, accent: '#4e715b', highlight: '#b8c49c' },
  insight: { src: insight, accent: '#526e68', highlight: '#b8c9b4' },
};

export function MarketCardArt({ type }: { type: CardType }) {
  return <img src={(DEFAULT_CARD_ART[type] ?? DEFAULT_CARD_ART.insight!).src}
    className="h-full w-full object-cover" alt="" draggable={false} />;
}
