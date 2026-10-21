/**
 * Currency, shown as reported and never silently converted. Pure and free of
 * dashboard dependencies so ranking can use it too.
 */
import type { CompanyMetric, MetricType } from '@mi/contracts';

// ---- Currency: shown as reported, never silently converted ------------------

const CURRENCIES: ReadonlyArray<{ code: string; symbol: string; name: string; test: RegExp }> = [
  { code: 'EUR', symbol: '€', name: 'euros', test: /€|\beuros?\b|\bEUR\b/i },
  { code: 'GBP', symbol: '£', name: 'pounds sterling', test: /£|\bGBP\b|\bpounds? sterling\b|\bsterling\b/i },
  { code: 'CHF', symbol: 'CHF ', name: 'Swiss francs', test: /\bCHF\b|\bSwiss francs?\b/i },
  { code: 'JPY', symbol: '¥', name: 'yen', test: /¥|\bJPY\b|\byen\b/i },
  { code: 'CNY', symbol: 'CN¥', name: 'yuan', test: /\bCNY\b|\bRMB\b|\byuan\b|\brenminbi\b/i },
  { code: 'INR', symbol: '₹', name: 'rupees', test: /₹|\bINR\b|\brupees?\b/i },
];
const MONEY: ReadonlySet<MetricType> = new Set(['market_cap', 'valuation', 'arr', 'aum', 'revenue', 'funding_total', 'last_round']);

export interface FigureCurrency {
  code: string;
  symbol: string;
  name: string;
  /** The stored number is a USD conversion the research states it made; no rate date is recorded. */
  converted: boolean;
}

/**
 * The currency a money figure was reported in, when the research says it was
 * not US dollars. The metric row carries no currency field, so this reads only
 * what the figure's own provenance text states. A figure with no such statement
 * is US dollars, as it always was. A figure whose note says "reported in euros"
 * keeps the euro number it stored and says so; one whose note says it was
 * converted is shown as converted, with the honest gap that no rate date exists.
 */
export function figureCurrency(metric: CompanyMetric): FigureCurrency | null {
  if (!MONEY.has(metric.metricType)) return null;
  const text = [metric.methodNote, metric.passageSupport?.quote, metric.quotedSupport?.quote, metric.quotedSupport?.unit]
    .filter((t): t is string => typeof t === 'string' && t.length > 0).join(' \n ');
  if (!text) return null;
  const hits = CURRENCIES.filter((c) => c.test.test(text));
  if (hits.length !== 1) return null; // none, or ambiguous: say nothing rather than guess
  const hit = hits[0]!;
  return { code: hit.code, symbol: hit.symbol, name: hit.name, converted: /\bconverted\b|\bexchange rate\b/i.test(text) };
}

/** The caption that goes under a figure whose currency is not plain US dollars. */
export function currencyCaption(c: FigureCurrency | null): string | null {
  if (!c) return null;
  return c.converted
    ? `Converted from ${c.name} (${c.code}); rate date not recorded`
    : `Reported in ${c.name} (${c.code}); not converted to US dollars`;
}

/** Re-prefix a compact USD string with the reported currency's symbol: "$11.7B" becomes "€11.7B". */
export function withReportedCurrency(display: string, c: FigureCurrency | null): string {
  return c && !c.converted && display.startsWith('$') ? `${c.symbol}${display.slice(1)}` : display;
}
