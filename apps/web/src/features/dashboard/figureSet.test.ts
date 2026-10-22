import { describe, expect, it } from 'vitest';
import type { CompanyMetric } from '@mi/contracts';
import { currencyCaptionFor, figureDates, figureDisplay, figureTrust } from './figureSet';
import { figureCurrency } from './figureCurrency';
import { shortCompanyName } from './companyNames';
import { comparableKnown } from './dashboardModel';

const metric = (patch: Partial<CompanyMetric> = {}): CompanyMetric => ({
  id: 'm', companyId: 'c', metricType: 'valuation', value: 11.7e9, confidence: 'verified', source: null, citations: [],
  methodNote: null, capturedAt: '2026-07-30T15:11:40.256Z', ...patch,
}) as CompanyMetric;

describe('figure currency', () => {
  it('is plain US dollars unless the figure itself says otherwise', () => {
    expect(figureCurrency(metric())).toBeNull();
    expect(figureCurrency(metric({ methodNote: 'Series C valuation in USD' }))).toBeNull();
    expect(figureDisplay(metric())).toBe('$11.7B');
  });
  it('shows a figure reported in euros as euros, not as dollars', () => {
    const m = metric({ methodNote: 'Series C round valuation reported in euros (~$13.8B - $14B USD)' });
    expect(figureDisplay(m)).toBe('€11.7B');
    expect(currencyCaptionFor(m)).toBe('Reported in euros (EUR); not converted to US dollars');
  });
  it('labels a stated conversion as converted and admits the rate date is unknown', () => {
    const m = metric({ methodNote: 'EUR 10B converted to USD at the 2026 exchange rate' });
    expect(figureDisplay(m)).toBe('$11.7B');
    expect(currencyCaptionFor(m)).toBe('Converted from euros (EUR); rate date not recorded');
  });
  it('says nothing when two foreign currencies are named, rather than guessing', () => {
    expect(figureCurrency(metric({ methodNote: 'EUR and GBP figures differ' }))).toBeNull();
  });
  it('ignores a euro amount mentioned far from the stored number (a dollar figure stays dollars)', () => {
    const far = 'Valued at $11.7B in the round announcement published by the company this quarter. Separately it bought a small studio for €40M.';
    expect(figureCurrency(metric({ methodNote: far }))).toBeNull();
    expect(figureDisplay(metric({ methodNote: far }))).toBe('$11.7B');
  });
  it('still reads a currency that sits next to the stored number', () => {
    expect(figureCurrency(metric({ methodNote: 'Round valued at €11.7B, reported in euros' }))?.code).toBe('EUR');
    expect(figureCurrency(metric({ methodNote: 'Valuation 11.7 billion euros per the filing' }))?.code).toBe('EUR');
  });
  it('only applies to money figures', () => {
    expect(figureCurrency(metric({ metricType: 'employees', methodNote: 'reported in euros' }))).toBeNull();
  });
  it('keeps a euro figure out of a dollar ranking', () => {
    const entry = { companyId: 'c', name: 'C', metrics: [metric({ methodNote: 'reported in euros' })] };
    expect(comparableKnown(entry, 'valuation')).toBeUndefined();
  });
});

describe('figure dates and trust', () => {
  it('keeps the reported period and the capture date as two different things', () => {
    expect(figureDates(metric())).toEqual({ period: null, record: expect.stringMatching(/^captured \d{1,2} Jul 2026$/) });
    const dated = figureDates(metric({ reportedSupport: { asOf: '2026-03-31' } as CompanyMetric['reportedSupport'] }));
    expect(dated.period).toBe('31 Mar 2026');
    expect(dated.record).toMatch(/^captured /);
  });
  it('words trust once', () => {
    expect(figureTrust(metric({ confidence: 'estimated' }))).toBe('Estimated');
    expect(figureTrust(metric({ confidence: 'estimated', citations: [{ title: 'x', url: 'https://x.com/a' }] }))).toBe('Reported');
    expect(figureTrust(metric({ confidence: 'user_verified' }))).toBe('Human checked');
  });
});

describe('short company names', () => {
  it.each([
    ['Crusoe (Crusoe Energy Systems)', 'Crusoe'],
    ['NVIDIA Corporation', 'NVIDIA'],
    ['Microsoft Corporation', 'Microsoft'],
    ['Mistral AI', 'Mistral AI'],
    ['Together AI', 'Together AI'],
    ['Co', 'Co'],
  ])('%s -> %s', (raw, short) => expect(shortCompanyName(raw)).toBe(short));
});
