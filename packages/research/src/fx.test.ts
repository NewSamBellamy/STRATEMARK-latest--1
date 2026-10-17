import { describe, expect, it } from 'vitest';
import { FX_SNAPSHOT_SOURCE, currencyMentionPattern, describeCurrencyConversion, isConvertibleCurrency, usdPerUnit } from './fx';

describe('reference currency conversion', () => {
  it('exposes a frozen documented snapshot rate for every convertible currency', () => {
    for (const unit of ['EUR', 'GBP', 'JPY', 'CNY', 'KRW', 'TWD', 'INR', 'CAD', 'AUD', 'CHF', 'HKD', 'SGD', 'SEK', 'NOK', 'DKK', 'BRL', 'MXN']) {
      expect(usdPerUnit(unit), unit).toBeGreaterThan(0);
      expect(isConvertibleCurrency(unit), unit).toBe(true);
    }
    expect(usdPerUnit('USD')).toBeNull();
    expect(usdPerUnit('count')).toBeNull();
    expect(usdPerUnit('percent')).toBeNull();
    expect(isConvertibleCurrency('RUB')).toBe(false);
    expect(isConvertibleCurrency(null)).toBe(false);
    expect(isConvertibleCurrency(undefined)).toBe(false);
    expect(FX_SNAPSHOT_SOURCE).toMatch(/exchangerate-api\.com/);
    expect(FX_SNAPSHOT_SOURCE).toMatch(/\d{4}-\d{2}-\d{2}/);
  });
  it.each([
    ['¥6 billion', 'JPY', true],
    ['¥6 billion', 'CNY', true],
    ['CNY 40 million', 'CNY', true],
    ['40 million yuan', 'CNY', true],
    ['RMB 40 million', 'CNY', true],
    ['€12.5 billion', 'EUR', true],
    ['EUR 12.5 billion', 'EUR', true],
    ['12.5 billion euros', 'EUR', true],
    ['£3.4 billion', 'GBP', true],
    ['₹500 billion', 'INR', true],
    ['₩900 billion', 'KRW', true],
    ['USD 40 million', 'USD', true],
    ['US$40 million', 'USD', true],
    ['40 million', 'CNY', false],
    ['40 million dollars', 'CNY', false],
    ['40 million euros', 'JPY', false],
  ])('names the currency in the quote the way a source would: %s as %s → %s', (text, unit, expected) => {
    expect(currencyMentionPattern(unit)!.test(text)).toBe(expected);
  });
  it('converts a native figure and labels the conversion honestly', () => {
    const usd = 40_000_000 * usdPerUnit('CNY')!;
    const note = describeCurrencyConversion(40_000_000, 'CNY', usd);
    expect(note).toContain('CNY');
    expect(note).toContain('≈US$5.96M');
    expect(note).toContain('reference rate');
    expect(note).toContain(FX_SNAPSHOT_SOURCE);
    expect(note).toContain('approximate');
  });
});
