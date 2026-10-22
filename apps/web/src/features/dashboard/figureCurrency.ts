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

/** How close, in characters, a currency word or symbol must sit to the figure's own digits in the note. */
const NEAR_CHARS = 25;

function mentions(text: string, pattern: RegExp): Array<[number, number]> {
  const global = new RegExp(pattern.source, pattern.flags.includes('g') ? pattern.flags : `${pattern.flags}g`);
  return [...text.matchAll(global)].map((m) => [m.index ?? 0, (m.index ?? 0) + m[0].length]);
}

/** Where the stored number is written in the note ("11.7" for 11.7e9, "11,700,000,000"), as [start, end) pairs. */
function numberSpans(text: string, value: number | null): Array<[number, number]> {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return [];
  const forms = new Set<string>();
  for (const divisor of [1e9, 1e6, 1e3, 1]) {
    const n = value / divisor;
    if (n >= 1 && n < 1000) forms.add(String(Number(n.toFixed(3))));
  }
  forms.add(Math.round(value).toLocaleString('en-US'));
  const spans: Array<[number, number]> = [];
  for (const form of forms) {
    const escaped = form.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    for (const m of text.matchAll(new RegExp(`(?<![\\d.,])${escaped}(?!\\d|[.,]\\d)`, 'g'))) spans.push([m.index ?? 0, (m.index ?? 0) + m[0].length]);
  }
  return spans;
}

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
  const spans = numberSpans(text, metric.value);
  // When the note quotes the stored number, a currency counts only beside it; a far-off amount in another
  // currency is about something else. A note that never quotes the number keeps the plain reading.
  const hits = CURRENCIES.filter((c) => spans.length === 0
    ? c.test.test(text)
    : mentions(text, c.test).some(([from, to]) => spans.some(([a, b]) => from - b <= NEAR_CHARS && a - to <= NEAR_CHARS)));
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
