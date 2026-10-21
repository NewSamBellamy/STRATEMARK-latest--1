/**
 * Reference currency conversion for retained non-USD figures.
 *
 * The honesty rule this module serves: the QUOTE is always the primary
 * evidence, in the currency and words the source used. The conversion is a
 * labeled convenience on the metric row, never a silent rewrite of evidence.
 *
 * Rates are a frozen snapshot — deliberately NOT a live API, so a figure
 * stored today converts identically tomorrow and the rate can be audited in
 * source control. Snapshot: exchangerate-api.com mid-market reference rates,
 * 2026-10-09. Yearly-average precision is not claimed: a converted figure is
 * approximate by construction, and the metric's methodNote says so.
 */

export const FX_SNAPSHOT_SOURCE = 'exchangerate-api.com mid-market reference rates, 2026-10-09';

/** USD value of ONE unit of the currency (mid-market snapshot, see above). */
const USD_PER_UNIT: Readonly<Record<string, number>> = {
  EUR: 1.120761, GBP: 1.321849, JPY: 0.00632777, CNY: 0.148915, KRW: 0.00074497,
  TWD: 0.0312865, INR: 0.0103217, CAD: 0.702701, AUD: 0.695472, CHF: 1.2012,
  HKD: 0.127418, SGD: 0.780627, SEK: 0.100118, NOK: 0.104521, DKK: 0.149697,
  BRL: 0.199272, MXN: 0.0552456,
};

/** True when the unit is a convertible currency (not USD/count/percent). */
export function isConvertibleCurrency(unit: string | null | undefined): boolean {
  return unit != null && unit in USD_PER_UNIT;
}

/** USD per unit, or null for USD/count/percent, unsupported and missing codes. */
export function usdPerUnit(unit: string | null | undefined): number | null {
  return (unit != null && USD_PER_UNIT[unit]) || null;
}

/** How the source text must name the currency for the quote to support it.
 * The unit code disambiguates shared symbols (¥ serves both JPY and CNY). */
export function currencyMentionPattern(unit: string): RegExp | null {
  switch (unit) {
    case 'USD': return /\bUSD\b|US\$|U\.S\. dollars/i;
    case 'EUR': return /€|\bEUR\b|\beuros?\b/i;
    case 'GBP': return /£|\bGBP\b|\bpounds?\b|\bsterling\b/i;
    case 'JPY': return /¥|\bJPY\b|\byen\b/i;
    case 'CNY': return /¥|\bCNY\b|\byuan\b|\brenminbi\b|\bRMB\b/i;
    case 'INR': return /₹|\bINR\b|\brupees?\b/i;
    case 'KRW': return /₩|\bKRW\b|\bwon\b/i;
    default: return new RegExp(`\\b${unit}\\b`);
  }
}

const compactUsd = (value: number): string => {
  const abs = Math.abs(value);
  if (abs >= 1e12) return `${(value / 1e12).toFixed(2)}T`;
  if (abs >= 1e9) return `${(value / 1e9).toFixed(2)}B`;
  if (abs >= 1e6) return `${(value / 1e6).toFixed(2)}M`;
  return value.toPrecision(6);
};

/** The methodNote sentence that keeps a converted figure honest on the card. */
export function describeCurrencyConversion(nativeValue: number, unit: string, usdValue: number): string {
  const rate = USD_PER_UNIT[unit];
  if (rate == null) return '';
  return `Reported ${compactUsd(nativeValue)} ${unit}, ≈US$${compactUsd(usdValue)} at reference rate ${rate} USD/${unit} (${FX_SNAPSHOT_SOURCE}); conversion is approximate.`;
}
