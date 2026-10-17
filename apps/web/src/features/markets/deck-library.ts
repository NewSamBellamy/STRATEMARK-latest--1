/**
 * Pure helpers for the deck library: coverage, status, sorting, filtering.
 * Everything here is derived from stored data. Nothing is estimated or
 * imputed; a slot with no usable value counts as unfilled, never as zero.
 */
import type { CardWithCompany, Market } from '@mi/contracts';
import { buildCardView } from '@/features/card/card-view';

/** Slots on every card face (PROFILE_CORE_SLOTS has four per profile). */
export const FACE_SLOT_COUNT = 4;

const ENTITY_TYPES = new Set(['company', 'infrastructure', 'distribution']);

export interface Coverage {
  filled: number;
  total: number;
  /** Whole-number percent, or null when there is nothing to measure. */
  percent: number | null;
}

function isEntity(c: CardWithCompany): boolean {
  return c.card.companyId != null && ENTITY_TYPES.has(c.card.cardType);
}

/**
 * Face slots showing a real value on one card. Delegates to buildCardView, the
 * same projection the card face uses, so honesty gates (verified needs a
 * citation, estimated needs passing reportedSupport) apply identically.
 */
export function filledSlots(c: CardWithCompany): number {
  const view = buildCardView(c);
  if (view.signal) return 0;
  return view.profileMetrics.filter((slot) => slot.metric?.value != null).length;
}

/** Share of entity-card face slots (4 per card) that show a real figure. */
export function computeCoverage(cards: readonly CardWithCompany[]): Coverage {
  const entities = cards.filter(isEntity);
  const total = entities.length * FACE_SLOT_COUNT;
  if (total === 0) return { filled: 0, total: 0, percent: null };
  const filled = entities.reduce((n, c) => n + filledSlots(c), 0);
  return { filled, total, percent: Math.round((filled / total) * 100) };
}

/** The deck's lead company: the best-filled entity card, ties broken by deck order. */
export function pickLeadCard(cards: readonly CardWithCompany[]): CardWithCompany | null {
  // The deck lists its market leaders first, so the cover is the first
  // company card that has a real logo — OpenAI for frontier AI, not whichever
  // smaller lab happened to have the most filled slots.
  const companies = cards.filter((c) => c.card.cardType === 'company' && c.company);
  const lead = companies.find((c) => c.company!.logoUrl) ?? companies[0];
  if (lead) return lead;
  let best: CardWithCompany | null = null;
  let bestScore = -1;
  for (const c of cards) {
    if (!isEntity(c) || !c.company) continue;
    const score = filledSlots(c) + (c.company.logoUrl ? 0.5 : 0);
    if (score > bestScore) {
      best = c;
      bestScore = score;
    }
  }
  return best;
}

export function companyCount(cards: readonly CardWithCompany[]): number {
  return cards.filter(isEntity).length;
}

export type ResearchState = 'live' | 'complete' | 'stale' | 'incomplete' | 'unknown';

export function researchState(status: string | null | undefined): ResearchState {
  switch (status) {
    case 'running':
    case 'partial':
    case 'refreshing':
      return 'live';
    case 'ready':
      return 'complete';
    case 'ready_stale':
      return 'stale';
    case 'failed':
      return 'incomplete';
    default:
      return 'unknown';
  }
}

export const RESEARCH_STATE_LABEL: Record<ResearchState, string | null> = {
  live: 'Researching',
  complete: 'Ready',
  stale: 'Needs refresh',
  incomplete: 'Incomplete',
  unknown: null,
};

export type DeckSort = 'recent' | 'name' | 'size';

export interface DeckSortRow {
  market: Market;
  /** Entity-card count when known; unknown sizes sort last. */
  size: number | null;
  /** ISO timestamp of last update (refresh, else creation). */
  updatedAt: string;
}

const time = (iso: string): number => {
  const t = new Date(iso).getTime();
  return Number.isNaN(t) ? 0 : t;
};

export function sortDecks<T extends DeckSortRow>(rows: readonly T[], by: DeckSort): T[] {
  const out = [...rows];
  out.sort((a, b) => {
    if (by === 'name') {
      return a.market.name.localeCompare(b.market.name, undefined, { sensitivity: 'base' });
    }
    if (by === 'size') {
      const d = (b.size ?? -1) - (a.size ?? -1);
      if (d !== 0) return d;
    }
    return time(b.updatedAt) - time(a.updatedAt);
  });
  return out;
}

export function filterDecks<T extends { market: Market }>(rows: readonly T[], query: string): T[] {
  const q = query.trim().toLowerCase();
  if (!q) return [...rows];
  return rows.filter(({ market }) =>
    [market.name, market.scopeDefinition.vertical, market.scopeDefinition.geography ?? ''].some(
      (s) => s.toLowerCase().includes(q),
    ),
  );
}

export function formatUpdated(iso: string, now: number = Date.now()): string {
  const t = time(iso);
  if (!t) return 'Unknown';
  const days = Math.floor((now - t) / 86_400_000);
  if (days <= 0) return 'Today';
  if (days === 1) return 'Yesterday';
  if (days < 7) return `${days} days ago`;
  return new Date(t).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: days > 300 ? 'numeric' : undefined,
  });
}

const MARKET_STOPWORDS = new Set([
  'the', 'a', 'an', 'and', 'of', 'for', 'in', 'on', '&', 'global', 'market', 'markets', 'sector', 'industry',
  'companies', 'company', 'brands', 'players', 'landscape', 'space', 'segment', 'worldwide',
]);

function marketTokens(name: string): Set<string> {
  return new Set(name.toLowerCase().replace(/[()/,.:;'"]+/g, ' ').split(/\s+/)
    .map((t) => t.replace(/s$/, ''))
    .filter((t) => t.length > 1 && !MARKET_STOPWORDS.has(t) && !MARKET_STOPWORDS.has(`${t}s`)));
}

/**
 * An existing deck that already covers what the user just typed, so creating
 * a near-copy ("Commercial UAS" after "Civil & Commercial UAS") is a choice,
 * not an accident. Word overlap on the meaningful terms of the name.
 */
export function findSimilarMarket<T extends { name: string }>(query: string, markets: readonly T[]): T | null {
  const q = marketTokens(query);
  if (q.size === 0) return null;
  let best: T | null = null;
  let bestScore = 0;
  for (const m of markets) {
    const t = marketTokens(m.name);
    if (t.size === 0) continue;
    const shared = [...q].filter((x) => t.has(x)).length;
    const jaccard = shared / new Set([...q, ...t]).size;
    const covered = shared / Math.min(q.size, t.size);
    const score = Math.max(jaccard, shared >= 2 ? covered * 0.9 : 0);
    if (score > bestScore) { best = m; bestScore = score; }
  }
  return bestScore >= 0.6 ? best : null;
}
