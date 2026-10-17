import { beforeEach, describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { observe, spendBetween, totals, useFillRecord } from './fillLedger';
import type { DeskProgress } from './DeckStatusBar';

const desk = (id: string, filled: number, total = 4): DeskProgress => ({ id, name: id, filled, total });

describe('fill ledger', () => {
  beforeEach(() => localStorage.clear());

  it('sums the card figures across companies', () => {
    expect(totals([desk('a', 3), desk('b', 1)])).toEqual({ filled: 4, total: 8 });
  });

  it('keeps the first observation and replaces the latest', () => {
    const first = { filled: 4, total: 8, estUsd: 1, at: 1 };
    const rec = observe(observe(undefined, first), { filled: 6, total: 8, estUsd: 1.5, at: 2 });
    expect(rec.first).toEqual(first);
    expect(rec.latest.filled).toBe(6);
    expect(spendBetween(rec)).toBeCloseTo(0.5);
  });

  it('never reports negative spend after a month rollover resets the meter', () => {
    const rec = observe(observe(undefined, { filled: 1, total: 4, estUsd: 9, at: 1 }), { filled: 2, total: 4, estUsd: 0.2, at: 2 });
    expect(spendBetween(rec)).toBe(0);
  });
});

function Probe({ desks, settled }: { desks: DeskProgress[]; settled: boolean }) {
  const rec = useFillRecord('deck1', desks, settled);
  return <p data-testid="out">{rec ? `${rec.first.filled}->${rec.latest.filled} of ${rec.latest.total}` : 'none'}</p>;
}

describe('useFillRecord', () => {
  beforeEach(() => localStorage.clear());

  it('records nothing while the deck is still being created, then keeps the first settled count', () => {
    const { rerender } = render(<Probe desks={[desk('a', 1)]} settled={false} />);
    expect(screen.getByTestId('out')).toHaveTextContent('none');
    rerender(<Probe desks={[desk('a', 2)]} settled />);
    expect(screen.getByTestId('out')).toHaveTextContent('2->2 of 4');
    rerender(<Probe desks={[desk('a', 4)]} settled />);
    expect(screen.getByTestId('out')).toHaveTextContent('2->4 of 4');
    expect(JSON.parse(localStorage.getItem('mi.fillLedger.v1')!).deck1.first.filled).toBe(2);
  });
});
