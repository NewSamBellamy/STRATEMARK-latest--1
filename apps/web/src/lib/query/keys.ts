import type { CardFilter, DashboardTab } from '@mi/contracts';

/** Centralized query keys so invalidation stays consistent. */
export const qk = {
  markets: ['markets'] as const,
  market: (id: string) => ['market', id] as const,
  deck: (marketId: string) => ['deck', marketId] as const,
  cards: (deckId: string, filter?: CardFilter) => ['cards', deckId, filter ?? {}] as const,
  card: (cardId: string) => ['card', cardId] as const,
  company: (id: string) => ['company', id] as const,
  companyMetrics: (id: string) => ['companyMetrics', id] as const,
  dashboard: (companyId: string, tab: DashboardTab) => ['dashboard', companyId, tab] as const,
  savedCards: ['savedCards'] as const,
  moves: ['moves'] as const,
  follows: ['follows'] as const,
  todayIntel: (companyId: string) => ['today', 'intel', companyId] as const,
  companyCard: (companyId: string) => ['today', 'card', companyId] as const,
};
