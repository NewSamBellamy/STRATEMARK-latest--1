/**
 * A deck's fill record: how many card-face figures were showing the first time
 * the deck settled, how many show now, and the estimated spend in between. It
 * exists so "did that change make decks fuller, and what did it cost?" is
 * answered from the app itself instead of by memory. Everything is counted,
 * nothing is estimated except spend, which is the same list-price estimate the
 * usage meter shows. Stored on this device only.
 */
import { useEffect, useState } from 'react';
import { getSpend } from '@/lib/usage';
import type { DeskProgress } from './DeckStatusBar';

const KEY = 'mi.fillLedger.v1';
const MAX_DECKS = 60;

export interface FillPoint { filled: number; total: number; estUsd: number; at: number }
export interface FillRecord { first: FillPoint; latest: FillPoint }
type Ledger = Record<string, FillRecord>;

function read(): Ledger {
  try {
    const raw = localStorage.getItem(KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : {};
    return parsed && typeof parsed === 'object' ? (parsed as Ledger) : {};
  } catch {
    return {};
  }
}

function write(ledger: Ledger): void {
  try {
    const entries = Object.entries(ledger).sort((a, b) => b[1].latest.at - a[1].latest.at).slice(0, MAX_DECKS);
    localStorage.setItem(KEY, JSON.stringify(Object.fromEntries(entries)));
  } catch { /* storage unavailable: the record is a convenience */ }
}

export function totals(desks: readonly DeskProgress[]): { filled: number; total: number } {
  return desks.reduce((acc, d) => ({ filled: acc.filled + d.filled, total: acc.total + d.total }), { filled: 0, total: 0 });
}

/** Apply one observation to a record. The first observation is kept; the latest is replaced. */
export function observe(prev: FillRecord | undefined, point: FillPoint): FillRecord {
  return prev ? { first: prev.first, latest: point } : { first: point, latest: point };
}

/** Spend between the two points; a month rollover resets the meter, so it never reports a negative. */
export function spendBetween(record: FillRecord): number {
  return Math.max(0, record.latest.estUsd - record.first.estUsd);
}

/**
 * Records the deck's fill while it is settled (not mid-creation). Returns the
 * record, or null until the deck has been seen settled with at least one figure place.
 */
export function useFillRecord(deckId: string | undefined, desks: readonly DeskProgress[], settled: boolean): FillRecord | null {
  const [record, setRecord] = useState<FillRecord | null>(() => (deckId ? read()[deckId] ?? null : null));
  const { filled, total } = totals(desks);
  useEffect(() => {
    if (!deckId) { setRecord(null); return; }
    if (!settled || total === 0) { setRecord(read()[deckId] ?? null); return; }
    const ledger = read();
    const estUsd = getSpend().estUsd;
    const next = observe(ledger[deckId], { filled, total, estUsd, at: Date.now() });
    // Only write when something changed, so an idle open deck does not churn storage.
    const prev = ledger[deckId];
    if (!prev || prev.latest.filled !== filled || prev.latest.total !== total || Math.abs(prev.latest.estUsd - estUsd) >= 0.005) {
      ledger[deckId] = next;
      write(ledger);
    }
    setRecord(next);
  }, [deckId, settled, filled, total]);
  return record;
}
