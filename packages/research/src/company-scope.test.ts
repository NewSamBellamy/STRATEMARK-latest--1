import { describe, expect, it } from 'vitest';
import { namesFromRequest } from './company-scope';

describe('namesFromRequest', () => {
  it('drops every name the model lifted from its notes when the user named no company', () => {
    const names = ['Starbucks Corp.', 'McDonald Corp.', 'Nestle SA', 'Pilot Coffee Roasters'];
    expect(namesFromRequest(names, 'Specialty coffee roasters')).toEqual([]);
  });

  it('keeps the companies the user named, whatever legal form the model wrote', () => {
    expect(namesFromRequest(['Stripe, Inc.', 'Adyen N.V.', 'Square Inc.', 'Checkout.com'], 'Compare Stripe, Adyen and Checkout.com'))
      .toEqual(['Stripe, Inc.', 'Adyen N.V.', 'Checkout.com']);
  });

  it('matches whole words in order: "Apple" is not "Pineapple", and a part of a name is not the name', () => {
    expect(namesFromRequest(['Apple Inc.'], 'pineapple growers')).toEqual([]);
    expect(namesFromRequest(['Bank of America Corp.'], 'banks in america')).toEqual([]);
    expect(namesFromRequest(['Bank of America Corp.'], 'research Bank of America and its rivals')).toEqual(['Bank of America Corp.']);
  });

  it('ignores case, accents, punctuation and ampersands', () => {
    expect(namesFromRequest(['Nestlé S.A.', 'Procter & Gamble Co.'], 'nestle vs procter and gamble')).toEqual(['Nestlé S.A.', 'Procter & Gamble Co.']);
  });

  it('accepts the short form the user typed for a longer company name, and drops a bare apostrophe difference', () => {
    expect(namesFromRequest(['Pilot Coffee Roasters'], 'roasters like pilot coffee and others')).toEqual(['Pilot Coffee Roasters']);
    expect(namesFromRequest(['Peets Coffee Inc.'], "compare Peet's Coffee with rivals")).toEqual(['Peets Coffee Inc.']);
    // One shared word is not a mention of the company.
    expect(namesFromRequest(['Coffee Beanery'], 'specialty coffee roasters')).toEqual([]);
  });

  it('works on names written in any script', () => {
    expect(namesFromRequest(['腾讯控股有限公司', '阿里巴巴集团'], '比较 腾讯控股有限公司 与竞争对手')).toEqual(['腾讯控股有限公司']);
    expect(namesFromRequest(['Яндекс', 'Сбербанк'], 'сравнить яндекс и других')).toEqual(['Яндекс']);
  });

  it('removes duplicates and blanks, and keeps a name that is all legal words rather than lose it', () => {
    expect(namesFromRequest(['Stripe', 'stripe', ' ', ''], 'stripe')).toEqual(['Stripe']);
    expect(namesFromRequest(['The Company'], 'the company')).toEqual(['The Company']);
  });
});
