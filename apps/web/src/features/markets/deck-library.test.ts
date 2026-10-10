import { describe, expect, it } from 'vitest';
import type { CardWithCompany, Market } from '@mi/contracts';
import {
  computeCoverage,
  filterDecks,
  formatUpdated,
  pickLeadCard,
  researchState,
  sortDecks,
} from './deck-library';

const metric = (metricType: string, value: number | null, confidence = 'estimated') =>
  ({ metricType, value, confidence }) as never;
const card = (id: string, metrics: unknown[], cardType = 'company', logoUrl: string | null = null) =>
  ({
    card: { id, companyId: cardType === 'company' ? id : null, cardType },
    company: cardType === 'company' ? { id, name: id, logoUrl } : null,
    metrics,
    viceClaims: [],
  }) as unknown as CardWithCompany;
const market = (name: string, vertical = 'v'): Market =>
  ({
    id: name,
    name,
    scopeDefinition: { vertical, geography: null, notes: null },
    refreshCadence: 'manual',
    createdAt: '2026-01-01T00:00:00Z',
  }) as unknown as Market;

describe('computeCoverage', () => {
  it('is null for empty decks and never counts signal cards', () => {
    expect(computeCoverage([]).percent).toBeNull();
    expect(computeCoverage([card('s', [metric('users', 5)], 'insight')]).percent).toBeNull();
  });
  it('counts slots once, ignoring unknown and null values', () => {
    const c = card('a', [
      metric('market_cap', 10),
      metric('valuation', 20), // same slot as market_cap
      metric('employees', 100),
      metric('users', null, 'unknown'),
      metric('arr', 0, 'unknown'),
    ]);
    expect(computeCoverage([c])).toEqual({ filled: 2, total: 5, percent: 40 });
  });
});

describe('pickLeadCard', () => {
  it('prefers the best-filled card, then deck order', () => {
    const a = card('a', [metric('users', 1)]);
    const b = card('b', [metric('users', 1), metric('employees', 2)]);
    expect(pickLeadCard([a, b])?.card.id).toBe('b');
    expect(pickLeadCard([a, card('c', [metric('users', 1)])])?.card.id).toBe('a');
    expect(pickLeadCard([])).toBeNull();
  });
});

describe('sort and filter', () => {
  const rows = [
    { market: market('Beta'), size: 3, updatedAt: '2026-02-01T00:00:00Z' },
    { market: market('alpha'), size: null, updatedAt: '2026-03-01T00:00:00Z' },
    { market: market('Gamma'), size: 9, updatedAt: '2026-01-01T00:00:00Z' },
  ];
  it('sorts by recent, name, size (unknown last)', () => {
    expect(sortDecks(rows, 'recent').map((r) => r.market.name)).toEqual(['alpha', 'Beta', 'Gamma']);
    expect(sortDecks(rows, 'name').map((r) => r.market.name)).toEqual(['alpha', 'Beta', 'Gamma']);
    expect(sortDecks(rows, 'size').map((r) => r.market.name)).toEqual(['Gamma', 'Beta', 'alpha']);
  });
  it('filters by name or vertical, case-insensitively', () => {
    expect(filterDecks(rows, ' GAM ').length).toBe(1);
    expect(filterDecks(rows, '').length).toBe(3);
    expect(filterDecks([{ market: market('X', 'Aerospace') }], 'aero').length).toBe(1);
  });
});

describe('misc', () => {
  it('maps deck status to research state', () => {
    expect(researchState('running')).toBe('live');
    expect(researchState('ready')).toBe('complete');
    expect(researchState(undefined)).toBe('unknown');
  });
  it('formats relative dates', () => {
    const now = new Date('2026-05-10T12:00:00Z').getTime();
    expect(formatUpdated('2026-05-10T01:00:00Z', now)).toBe('Today');
    expect(formatUpdated('2026-05-08T12:00:00Z', now)).toBe('2 days ago');
    expect(formatUpdated('', now)).toBe('Unknown');
  });
});
