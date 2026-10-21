import { describe, expect, it } from 'vitest';
import type { CardWithCompany } from '@mi/contracts';
import { buildDataset } from '@mi/mocks';
import { orderLane, sourcedFigureCount } from './lane-order';

const dataset = buildDataset();
const mk = (id: string, name: string): CardWithCompany => ({
  card: { ...dataset.cards[0]!, id, title: name },
  company: null,
  metrics: [],
  viceClaims: [],
});

describe('orderLane', () => {
  const a = mk('a', 'Acme');
  const b = mk('b', 'Beta');
  const c = mk('c', 'Cora');
  const d = mk('d', 'Delta');
  const counts: Record<string, number | null> = { a: 2, b: 5, c: 2, d: 0 };
  const count = (x: CardWithCompany) => counts[x.card.id] ?? null;

  it('puts the most sourced figures first and breaks ties by name', () => {
    expect(orderLane([d, c, a, b], count).map((x) => x.card.id)).toEqual(['b', 'a', 'c', 'd']);
  });

  it('does not mutate its input', () => {
    const input = [d, c, a, b];
    orderLane(input, count);
    expect(input.map((x) => x.card.id)).toEqual(['d', 'c', 'a', 'b']);
  });

  it('keeps the existing order when any card has no comparable count', () => {
    const partial = (x: CardWithCompany) => (x.card.id === 'c' ? null : count(x));
    expect(orderLane([d, c, a, b], partial).map((x) => x.card.id)).toEqual(['d', 'c', 'a', 'b']);
  });

  it('gives signal cards no count', () => {
    const signal = dataset.cards.find((x) => x.cardType === 'vice');
    expect(signal).toBeDefined();
    expect(sourcedFigureCount({ card: signal!, company: null, metrics: [], viceClaims: [] })).toBeNull();
  });
});
