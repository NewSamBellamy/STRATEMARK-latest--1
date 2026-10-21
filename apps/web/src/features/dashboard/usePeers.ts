import { useSearchParams } from 'react-router-dom';
import { isSignalCardType } from '@mi/contracts';
import { useCards, useDeckByMarket } from '@/hooks/data';
import type { PeerEntry } from './dashboardModel';

export type PeerState =
  | { status: 'no_deck'; peers: PeerEntry[] }
  | { status: 'loading'; peers: PeerEntry[] }
  | { status: 'ready'; peers: PeerEntry[] };

/**
 * Peers = the other entity cards in the deck the dashboard was opened from
 * (`?deck=<marketId>`). Reads the already-cached deck cards: no new research.
 */
export function usePeers(): PeerState {
  const [params] = useSearchParams();
  const marketId = params.get('deck') ?? undefined;
  const deck = useDeckByMarket(marketId);
  const deckId = deck.data?.id;
  const cards = useCards(deckId);
  if (!marketId) return { status: 'no_deck', peers: [] };
  if (!deckId || cards.isPending) return { status: 'loading', peers: [] };
  const seen = new Set<string>();
  const peers: PeerEntry[] = [];
  for (const c of cards.data ?? []) {
    if (!c.company || isSignalCardType(c.card.cardType) || seen.has(c.company.id)) continue;
    seen.add(c.company.id);
    peers.push({
      companyId: c.company.id, name: c.company.name, logoUrl: c.company.logoUrl,
      websiteUrl: c.company.websiteUrl, metrics: c.metrics,
    });
  }
  return { status: 'ready', peers };
}
