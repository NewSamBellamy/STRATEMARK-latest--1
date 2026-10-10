/**
 * Market-cap quote lane — an honest ESTIMATED figure for public companies,
 * computed from two dated, attributable sources instead of a provider hunt:
 * the Yahoo v8 chart endpoint supplies the last traded price (with its own
 * market timestamp), and the SEC XBRL dei EntityCommonStockSharesOutstanding
 * concept supplies the share count as stated on the latest filing's cover.
 * The product of the two is a computation, so it lands at estimated tier with
 * both sources named — never verified, never presented as reported.
 *
 * Zero provider calls. Ticker/CIK resolution runs inside the node reader as a
 * bounded slice of the official SEC company_tickers.json (the full 800 KB map
 * never enters the vault).
 */
import { z } from 'zod';
import type { OriginalSourceReceipt } from './original-source';

export function yahooSearchUrl(companyName: string): string {
  return `https://query1.finance.yahoo.com/v1/finance/search?q=${encodeURIComponent(companyName)}&quotesCount=6&newsCount=0`;
}

export function yahooChartUrl(symbol: string): string {
  return `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=1d&range=1d`;
}

export function secTickerMapUrl(): string {
  return 'https://www.sec.gov/files/company_tickers.json';
}

export function secSharesConceptUrl(cik: string): string {
  const padded = cik.replace(/\D/g, '').padStart(10, '0');
  return `https://data.sec.gov/api/xbrl/companyconcept/CIK${padded}/dei/EntityCommonStockSharesOutstanding.json`;
}

const quoteMetaSchema = z.object({
  chart: z.object({
    result: z.array(z.object({
      meta: z.object({
        symbol: z.string().min(1),
        currency: z.string().min(1),
        regularMarketPrice: z.number().positive(),
        regularMarketTime: z.number().positive(),
        longName: z.string().nullish(),
        shortName: z.string().nullish(),
        instrumentType: z.string().nullish(),
      }).passthrough(),
    })).min(1),
    error: z.null().optional(),
  }).passthrough(),
}).passthrough();

export interface QuoteMeta {
  symbol: string;
  currency: string;
  price: number;
  asOf: string;
  name: string | null;
}

/** Parse the retained chart JSON into the price facts. Identity is checked by
 * the caller against the company (the chart alone does not prove who). */
export function parseQuoteMeta(chartJson: string): QuoteMeta | null {
  let doc: z.infer<typeof quoteMetaSchema>;
  try {
    doc = quoteMetaSchema.parse(JSON.parse(chartJson));
  } catch {
    return null;
  }
  const meta = doc.chart.result[0]!.meta;
  const asOfDate = new Date(meta.regularMarketTime * 1000);
  if (!Number.isFinite(asOfDate.getTime())) return null;
  return {
    symbol: meta.symbol,
    currency: meta.currency,
    price: meta.regularMarketPrice,
    asOf: asOfDate.toISOString().slice(0, 10),
    name: meta.longName ?? meta.shortName ?? null,
  };
}

const tickerMapSchema = z.record(z.object({
  cik_str: z.number().int().positive(),
  ticker: z.string().min(1),
  title: z.string().min(1),
}));

/** Company-name key for ticker matching: legal suffixes stripped, same idea
 * as the ADV matcher — compare only what both sides state. */
export function companyNameKey(raw: string): string {
  return raw
    .toUpperCase()
    .normalize('NFKC')
    .replace(/[^A-Z0-9]+/g, ' ')
    .replace(/\b(?:LLC|LLP|LP|INC|CORP(?:O?RATION)?|LTD|PLC|COMPANY|LIMITED|HOLDINGS|GROUP)\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export interface TickerMatch {
  cik: string;
  ticker: string;
  title: string;
}

export function parseTickerMatches(tickerMapJson: string, companyName: string): TickerMatch[] {
  const wanted = companyNameKey(companyName);
  if (wanted.length < 3) return [];
  let map: z.infer<typeof tickerMapSchema>;
  try {
    map = tickerMapSchema.parse(JSON.parse(tickerMapJson));
  } catch {
    return [];
  }
  const matches: TickerMatch[] = [];
  for (const row of Object.values(map)) {
    if (companyNameKey(row.title) === wanted) {
      matches.push({ cik: String(row.cik_str), ticker: row.ticker, title: row.title });
    }
  }
  return matches;
}

/** Reader-side: deterministic bounded slice of the official ticker map holding
 * only the entries whose title matches the requested company. The request URL
 * carries the lookup name as a query param; the full map never gets retained. */
export function selectTickerMapSlice(fullJson: string, lookupName: string): string {
  const matches = parseTickerMatches(fullJson, lookupName).slice(0, 6);
  return JSON.stringify({ lookupName, matches });
}

const sharesConceptSchema = z.object({
  cik: z.number().int().positive(),
  entityName: z.string().min(1),
  taxonomy: z.literal('dei'),
  tag: z.literal('EntityCommonStockSharesOutstanding'),
  units: z.record(z.array(z.object({
    end: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    val: z.number().int().nonnegative(),
    accn: z.string().min(1),
    fy: z.number().optional(),
    fp: z.string().optional(),
    form: z.string().min(1),
    filed: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    frame: z.string().optional(),
  }).passthrough()).min(1)),
}).passthrough();

export interface SharesObservation {
  cik: string;
  entityName: string;
  value: number;
  asOf: string;
  form: string;
  filed: string;
}

/** Latest reported shares outstanding from the retained dei concept receipt.
 * Ties on the period end refuse to pick a winner. */
export function parseSharesOutstanding(conceptJson: string, cikFromUrl: string): SharesObservation | null {
  let doc: z.infer<typeof sharesConceptSchema>;
  try {
    doc = sharesConceptSchema.parse(JSON.parse(conceptJson));
  } catch {
    return null;
  }
  if (String(doc.cik) !== cikFromUrl.replace(/\D/g, '').replace(/^0+/, '')) return null;
  const rows = [...Object.values(doc.units)].flat()
    .map((row) => ({ ...row, asOf: row.end }))
    .sort((a, b) => b.end.localeCompare(a.end) || b.filed.localeCompare(a.filed));
  const latest = rows[0];
  if (!latest) return null;
  if (rows.some((row) => row.end === latest.end && row.val !== latest.val)) return null;
  return { cik: String(doc.cik), entityName: doc.entityName, value: latest.val, asOf: latest.end, form: latest.form, filed: latest.filed };
}

/** Identity check between the quote and the company: the chart's own long or
 * short name must equal the company on the suffix-insensitive key, or the
 * ticker-map title must (the map slice travels in the same attempt). */
function quoteIdentity(meta: QuoteMeta, companyName: string, tickerTitle: string | null): boolean {
  const wanted = companyNameKey(companyName);
  if (wanted.length < 3) return false;
  const candidates = [meta.name, tickerTitle].filter((n): n is string => Boolean(n));
  return candidates.some((n) => companyNameKey(n) === wanted);
}

export interface MarketCapEstimate {
  value: number;
  currency: string;
  asOf: string;
  price: number;
  priceAsOf: string;
  shares: number;
  sharesAsOf: string;
  symbol: string;
  citations: Array<{ title: string; url: string }>;
  methodNote: string;
}

/** Combine the retained chart + shares receipts into the estimate. Any missing
 * piece, non-USD price, or identity mismatch yields nothing — the hunt ladder
 * stays free to do better, and nothing fabricated lands. */
export function marketCapEstimate(
  companyName: string,
  originals: readonly OriginalSourceReceipt[],
  tickerTitle: string | null,
  nowMs = Date.now(),
): MarketCapEstimate | null {
  const chart = originals.find((source) => source.status === 'retrieved' && source.httpStatus === 200 && !source.truncated &&
    /^https:\/\/query1\.finance\.yahoo\.com\/v8\/finance\/chart\//.test(source.finalUrl ?? '') &&
    source.text && source.text.length <= 4000 && Number.isFinite(Date.parse(source.retrievedAt)) && Date.parse(source.retrievedAt) <= nowMs);
  if (!chart?.text) return null;
  const meta = parseQuoteMeta(chart.text);
  if (!meta || meta.currency !== 'USD' || !quoteIdentity(meta, companyName, tickerTitle)) return null;

  const sharesUrl = originals.find((source) => source.status === 'retrieved' && source.httpStatus === 200 && !source.truncated &&
    /\/dei\/EntityCommonStockSharesOutstanding\.json$/.test(source.finalUrl ?? '') && source.text &&
    source.text.length <= 32000 && Number.isFinite(Date.parse(source.retrievedAt)) && Date.parse(source.retrievedAt) <= nowMs);
  if (!sharesUrl?.text) return null;
  const cik = /CIK(\d{10})/.exec(sharesUrl.finalUrl!)?.[1] ?? null;
  if (!cik) return null;
  const shares = parseSharesOutstanding(sharesUrl.text, cik);
  if (!shares || shares.value <= 0) return null;

  // The estimate takes the quote's market date as its as-of (the price drives
  // the figure's freshness) and names both sources with their own dates.
  return {
    value: Math.round(meta.price * shares.value),
    currency: 'USD',
    asOf: meta.asOf,
    price: meta.price,
    priceAsOf: meta.asOf,
    shares: shares.value,
    sharesAsOf: shares.asOf,
    symbol: meta.symbol,
    citations: [
      { title: `Yahoo Finance quote for ${meta.symbol} (${meta.asOf})`, url: chart.finalUrl! },
      { title: `SEC XBRL shares outstanding (${shares.asOf}, ${shares.form})`, url: sharesUrl.finalUrl! },
    ],
    methodNote: `Estimated market cap = share price US$${meta.price} (Yahoo Finance, ${meta.asOf}) × ${shares.value.toLocaleString('en-US')} shares outstanding (SEC ${shares.form} cover, ${shares.asOf}). A computation from two reported figures, not a reported market cap.`,
  };
}
