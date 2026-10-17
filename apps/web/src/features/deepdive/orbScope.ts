/**
 * Where the Ask orb should aim when you press it from wherever you are: the
 * deck you are looking at, the company whose dashboard is open, or (anywhere
 * else) your most recent deck. Nothing is guessed beyond that: with no deck at
 * all there is nothing to ask about, and the orb says so by staying away.
 */
import type { MarketIntelRepository, ResearchScope } from '@mi/contracts';

type Reader = Pick<MarketIntelRepository, 'listMarkets' | 'getDeckByMarket'>;

function queryOf(hash: string): URLSearchParams {
  const i = hash.indexOf('?');
  return new URLSearchParams(i >= 0 ? hash.slice(i + 1) : '');
}

export async function resolveOrbScope(hash: string, repo: Reader): Promise<ResearchScope | null> {
  const deckMatch = /^#?\/markets\/([^/?#]+)\/deck/.exec(hash);
  if (deckMatch) {
    const deck = await repo.getDeckByMarket(decodeURIComponent(deckMatch[1]!));
    if (deck) return { kind: 'deck', deckId: deck.id };
  }
  const companyMatch = /^#?\/company\/([^/?#]+)\/dashboard/.exec(hash);
  if (companyMatch) {
    const marketId = queryOf(hash).get('deck');
    const deck = marketId ? await repo.getDeckByMarket(marketId) : null;
    return { kind: 'company', deckId: deck?.id ?? null, companyId: decodeURIComponent(companyMatch[1]!) };
  }
  const markets = (await repo.listMarkets()).filter((m) => !m.archivedAt);
  for (const market of markets) {
    const deck = await repo.getDeckByMarket(market.id);
    if (deck) return { kind: 'deck', deckId: deck.id };
  }
  return null;
}
