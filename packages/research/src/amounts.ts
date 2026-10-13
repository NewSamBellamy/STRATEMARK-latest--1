/** Amounts as pages write them ("$852 billion", "4,500", "13.07bn") with where they sit. */

const SCALE: Record<string, number> = { trillion: 1e12, billion: 1e9, million: 1e6, thousand: 1e3, tn: 1e12, bn: 1e9, b: 1e9, mn: 1e6, m: 1e6, k: 1e3 };

export interface AmountMatch { value: number; index: number }

export function amountMatches(text: string): AmountMatch[] {
  return [...text.matchAll(/(\d[\d,]*(?:\.\d+)?)\s*(trillion|billion|million|thousand|tn|bn|mn|[bmk])?\b/gi)]
    // A bare year ("in 2025") is a date, not a headcount of 2,025.
    .filter((m) => m[2] || !/^(?:19|20)\d{2}$/.test(m[1]!))
    .map((m) => ({ value: Number(m[1]!.replaceAll(',', '')) * (SCALE[m[2]?.toLowerCase() ?? ''] ?? 1), index: m.index! }));
}

/** The same figure allowing for display rounding ("$4.6 billion" for 4,620,000,000). */
export function sameAmount(found: number, wanted: number): boolean {
  return Math.abs(found - wanted) <= Math.max(1, Math.abs(wanted)) * 0.01;
}
