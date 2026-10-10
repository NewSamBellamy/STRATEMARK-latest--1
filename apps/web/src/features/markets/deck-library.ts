/**
 * Pure helpers for the deck library: coverage, status, sorting, filtering.
 * Everything here is derived from stored data. Nothing is estimated or
 * imputed; a slot with no usable value counts as unfilled, never as zero.
 */
import type { CardWithCompany, Market, MetricType } from '@mi/contracts';

/** Face-of-card figure slots; a slot is filled by any one of its metric types. */
export const FACE_SLOTS: readonly (readonly MetricType[])[] = [
  ['market_cap', 'valuation', 'aum'],
  ['arr', 'revenue'],
  ['employees'],
  ['users'],
  ['market_share'],
];

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

/** Number of face slots with a real (non-null, non-unknown) value on one card. */
export function filledSlots(c: CardWithCompany): number {
  return FACE_SLOTS.filter((types) =>
    c.metrics.some(
      (m) => types.includes(m.metricType) && m.value != null && m.confidence !== 'unknown',
    ),
  ).length;
}

/** Share of entity-card face slots that hold a real figure. Signal cards are excluded. */
export function computeCoverage(cards: readonly CardWithCompany[]): Coverage {
  const entities = cards.filter(isEntity);
  const total = entities.length * FACE_SLOTS.length;
  if (total === 0) return { filled: 0, total: 0, percent: null };
  const filled = entities.reduce((n, c) => n + filledSlots(c), 0);
  return { filled, total, percent: Math.round((filled / total) * 100) };
}

/** The deck's lead company: the best-filled entity card, ties broken by deck order. */
export function pickLeadCard(cards: readonly CardWithCompany[]): CardWithCompany | null {
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
  complete: 'Complete',
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
