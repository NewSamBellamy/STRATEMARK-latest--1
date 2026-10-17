/** quotedOriginalEstimate — press-release figures as honest estimates, never verified. */
import { describe, expect, it } from 'vitest';
import { quotedEstimateNote, quotedOriginalEstimate, type QuotedEstimateInput } from './quoted-estimate';
import type { OriginalSourceReceipt } from './original-source';

const url = 'https://www.prnewswire.com/news-releases/ramp-raises-series-f-302791103.html';
const sentence = 'Today, Ramp announced a $750 million primary financing round led by ICONIQ, GIC, and Ontario Teachers\' Pension Plan, valuing the company at $44 billion.';
const page = (text: string): OriginalSourceReceipt => ({ requestedUrl: url, finalUrl: url, status: 'retrieved', httpStatus: 200,
  text, contentHash: 'a'.repeat(64), retrievedAt: '2026-10-10T00:00:00.000Z' });
const dateline = `Ramp Raises Series F at $44 Billion Valuation NEW YORK, June 4, 2026 /PRNewswire/ -- ${sentence} The round brings new investors.`;
const base: QuotedEstimateInput = {
  companyName: 'Ramp', metricType: 'valuation', value: 44_000_000_000, nowMs: Date.parse('2026-10-10T00:00:00Z'),
  support: { sourceUrl: url, quote: sentence, asOf: '2026-06-04', basis: 'valuation', unit: 'USD' },
  originals: [page(dateline)],
};
const withQuote = (quote: string, patch: Partial<QuotedEstimateInput> = {}, text = `NEW YORK, June 4, 2026 -- ${quote}`): QuotedEstimateInput =>
  ({ ...base, ...patch, support: { ...base.support!, quote, ...(patch.support ?? {}) }, originals: [page(text)] });

describe('quotedOriginalEstimate', () => {
  it('accepts a press-release valuation dated by its dateline', () => {
    expect(quotedOriginalEstimate(base)).toEqual([{ url, title: 'prnewswire.com (original page, quoted)' }]);
  });

  it('binds each metric to the amount next to its wording', () => {
    expect(quotedOriginalEstimate({ ...base, metricType: 'last_round', value: 750_000_000,
      support: { ...base.support!, basis: 'last_round' } })).toHaveLength(1);
    // The round size is in the sentence but is not the valuation.
    expect(quotedOriginalEstimate({ ...base, value: 750_000_000 })).toEqual([]);
  });

  it('needs a date in the quote or the dateline just before it', () => {
    expect(quotedOriginalEstimate({ ...base, originals: [page(`Ramp news. ${sentence}`)] })).toEqual([]);
    const far = `NEW YORK, June 4, 2026 -- ${'x '.repeat(400)}${sentence}`;
    expect(quotedOriginalEstimate({ ...base, originals: [page(far)] })).toEqual([]);
  });

  it('rejects hedged, rumoured and lower-bound statements', () => {
    for (const quote of [
      'Ramp has raised about $1.85 billion at a valuation of roughly $60 billion, citing people familiar with the matter.',
      'Ramp is in talks to raise at a valuation of $60 billion.',
      'With this round, Ramp has raised over $3 billion in total equity financing.',
    ]) {
      const value = quote.includes('$3 billion') ? 3e9 : 60e9;
      const metricType = quote.includes('$3 billion') ? 'funding_total' as const : 'valuation' as const;
      expect(quotedOriginalEstimate(withQuote(quote, { metricType, value, support: { basis: metricType } as never }))).toEqual([]);
    }
  });

  it('does not let a later article re-date an older round it restates', () => {
    for (const quote of [
      'Ramp, which was valued at $44 billion in 2025, announced a new product today.',
      'Ramp was previously valued at $44 billion.',
    ]) expect(quotedOriginalEstimate(withQuote(quote))).toEqual([]);
  });

  it('requires the quote verbatim on the fetched page, the company as written, and the currency', () => {
    expect(quotedOriginalEstimate({ ...base, originals: [page('NEW YORK, June 4, 2026 -- something else entirely.')] })).toEqual([]);
    expect(quotedOriginalEstimate({ ...base, originals: [{ ...page(dateline), status: 'blocked' }] })).toEqual([]);
    const lower = 'Today, the ramp announced a $750 million round, valuing the company at $44 billion.';
    expect(quotedOriginalEstimate(withQuote(lower))).toEqual([]);
    const noCurrency = 'Today, Ramp announced a round valuing the company at 44 billion.';
    expect(quotedOriginalEstimate(withQuote(noCurrency))).toEqual([]);
  });

  it('rejects stale or future dates and excluded metrics', () => {
    expect(quotedOriginalEstimate({ ...base, nowMs: Date.parse('2027-07-01T00:00:00Z') })).toEqual([]);
    expect(quotedOriginalEstimate({ ...base, nowMs: Date.parse('2026-06-01T00:00:00Z') })).toEqual([]);
    expect(quotedOriginalEstimate({ ...base, metricType: 'market_cap', support: { ...base.support!, basis: 'market_cap' } })).toEqual([]);
    expect(quotedOriginalEstimate({ ...base, metricType: 'market_share', value: 40, support: { ...base.support!, basis: 'market_share' } })).toEqual([]);
  });

  it('accepts a dated headcount count and a customers figure', () => {
    const headcount = 'As of June 30, 2026, Acme employs 1,200 people across its offices and has 1,200 employees.';
    expect(quotedOriginalEstimate(withQuote(headcount, { companyName: 'Acme Inc.', metricType: 'employees', value: 1200,
      support: { basis: 'employees', unit: 'count', asOf: '2026-06-30' } as never }, headcount))).toHaveLength(1);
  });

  it('writes a note that quotes the source and says it is not verified', () => {
    const note = quotedEstimateNote(base.support!, quotedOriginalEstimate(base)[0]!);
    expect(note).toContain('Quoted from prnewswire.com as of 2026-06-04');
    expect(note).toContain('not independently verified');
  });
});

describe('funding_total wording', () => {
  const base = { companyName: 'Skydio', metricType: 'funding_total' as const, value: 110_000_000, asOf: '2026-04-23', unit: 'USD', nowMs: Date.parse('2026-10-13') };
  it('a single named round is never a total raised', async () => {
    const { quoteHolds } = await import('./quoted-estimate');
    expect(quoteHolds({ ...base, quote: 'Skydio has raised $110 million in Series F financing, led by existing investors.' })).toBe(false);
    expect(quoteHolds({ ...base, value: 1_500_000_000, quote: 'Skydio has raised $1.5 billion in a Series F round led by investors.' })).toBe(false);
  });
  it('cumulative wording still counts', async () => {
    const { quoteHolds } = await import('./quoted-estimate');
    expect(quoteHolds({ ...base, value: 740_000_000, quote: 'Skydio has raised $740 million to date from investors.' })).toBe(true);
  });
});
