import { describe, expect, it } from 'vitest';
import type { CardWithCompany, Market } from '@mi/contracts';
import {
  computeCoverage,
  filterDecks,
  formatUpdated,
  pickLeadCard,
  findSimilarMarket,
  researchState,
  sortDecks,
} from './deck-library';

const metric = (metricType: string, value: number | null, confidence = 'verified') =>
  ({
    id: metricType,
    companyId: 'a',
    metricType,
    value,
    confidence,
    source: value == null ? null : 'https://www.reuters.com/x',
    citations: value == null ? [] : [{ title: 'reuters.com', url: 'https://www.reuters.com/x' }],
    methodNote: null,
    capturedAt: '2026-01-01T00:00:00Z',
  }) as never;
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
  it('matches the card face: 4 adaptive slots, honesty gates applied', () => {
    const c = card('a', [
      metric('employees', 100), // slot 1, verified + cited
      metric('valuation', 20), // slot 4
      metric('market_cap', 10), // same slot as valuation, not counted twice
      metric('users', null, 'unknown'), // unknown: unfilled
      metric('arr', 5, 'estimated'), // estimated without reportedSupport: not shown
    ]);
    expect(computeCoverage([c])).toEqual({ filled: 2, total: 4, percent: 50 });
  });
  it('does not count a verified figure that has no citation', () => {
    const bare = { ...(metric('employees', 100) as object), citations: [], source: null } as never;
    expect(computeCoverage([card('a', [bare])]).filled).toBe(0);
  });
});

describe('pickLeadCard', () => {
  it('leads with the first company that has a logo (decks list leaders first)', () => {
    const a = card('a', [metric('users', 1)]);
    const b = card('b', [metric('users', 1), metric('employees', 2)], 'company', 'https://b.com/logo.png');
    const c = card('c', [metric('users', 1)], 'company', 'https://c.com/logo.png');
    expect(pickLeadCard([a, b, c])?.card.id).toBe('b');
    expect(pickLeadCard([a, card('d', [])])?.card.id).toBe('a');
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

describe('findSimilarMarket', () => {
  const decks = [
    { name: 'Civil & Commercial Unmanned Aircraft Systems (UAS)' },
    { name: 'Global Non-Alcoholic Spirits Market' },
    { name: 'Frontier AI Labs Market' },
  ];
  it('flags a near-copy of an existing deck', () => {
    expect(findSimilarMarket('Commercial Unmanned Aircraft Systems', decks)?.name).toMatch(/Civil/);
    expect(findSimilarMarket('non-alcoholic spirits brands', decks)?.name).toMatch(/Spirits/);
    expect(findSimilarMarket('frontier AI labs', decks)?.name).toBe('Frontier AI Labs Market');
  });
  it('leaves genuinely different markets alone', () => {
    expect(findSimilarMarket('non-alcoholic beer', decks)).toBeNull();
    expect(findSimilarMarket('AI code-review startups', decks)).toBeNull();
    expect(findSimilarMarket('market', decks)).toBeNull();
  });
});
