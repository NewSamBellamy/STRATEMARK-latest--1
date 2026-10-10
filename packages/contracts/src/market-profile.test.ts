import { describe, expect, it } from 'vitest';
import { classifyMarketProfile, PROFILE_CORE_SLOTS, profileMetricTypes } from './market-profile';
import { METRIC_TYPES } from './enums';

describe('market profile classification', () => {
  it('classifies firms whose scale metric is assets under management', () => {
    expect(classifyMarketProfile({ name: 'a16z', oneLiner: 'Andreessen Horowitz is a venture capital firm based in Menlo Park.' })).toBe('financial_firm');
    expect(classifyMarketProfile({ name: 'Sequoia Capital', oneLiner: 'Early-stage venture capital.' })).toBe('financial_firm');
    expect(classifyMarketProfile({ name: 'Blackstone', oneLiner: 'Global asset management firm.' })).toBe('financial_firm');
    expect(classifyMarketProfile({ name: 'Citadel', oneLiner: 'A multistrategy hedge fund.' })).toBe('financial_firm');
    expect(classifyMarketProfile({ name: 'Goldman Sachs', oneLiner: 'Investment banking and financial services.' })).toBe('financial_firm');
  });

  it('classifies operating companies as operating companies', () => {
    expect(classifyMarketProfile({ name: 'Tesla', oneLiner: 'Designs and manufactures electric vehicles and energy storage.' })).toBe('operating_company');
    expect(classifyMarketProfile({ name: 'Acme Storage', oneLiner: 'Grid-scale battery storage systems.' })).toBe('operating_company');
  });

  it('does not mistake a vendor that SERVES financial firms for a fund', () => {
    expect(classifyMarketProfile({ name: 'Carta', oneLiner: 'Cap table software for private equity and venture capital.' })).toBe('operating_company');
    expect(classifyMarketProfile({ name: 'Affinity', oneLiner: 'Relationship intelligence platform serving venture capital firms.' })).toBe('operating_company');
  });

  it('treats a missing company as an operating company, never a crash', () => {
    expect(classifyMarketProfile(null)).toBe('operating_company');
    expect(classifyMarketProfile(undefined)).toBe('operating_company');
    expect(classifyMarketProfile({ name: 'X', oneLiner: null })).toBe('operating_company');
  });
});

describe('profile metric tables', () => {
  it('hunts AUM only for financial firms and never hunts fund-inapplicable metrics there', () => {
    const financial = profileMetricTypes('financial_firm');
    expect(financial).toContain('aum');
    expect(financial).not.toContain('arr');
    expect(financial).not.toContain('users');
    const operating = profileMetricTypes('operating_company');
    expect(operating).toContain('arr');
    expect(operating).toContain('users');
    expect(operating).not.toContain('aum');
  });

  it('leads the financial hunt with AUM; the operating order is unchanged', () => {
    expect(profileMetricTypes('financial_firm')[0]).toBe('aum');
    expect(profileMetricTypes('operating_company')).toEqual([
      'market_cap', 'valuation', 'market_share', 'arr', 'users', 'employees',
    ]);
  });

  it('keeps every table row inside the fixed metric enum and four slots per profile', () => {
    for (const profile of ['operating_company', 'financial_firm'] as const) {
      const slots = PROFILE_CORE_SLOTS[profile];
      expect(slots).toHaveLength(4);
      for (const types of slots) {
        for (const type of types) expect(METRIC_TYPES).toContain(type);
      }
    }
  });

  it('gives financial firms an AUM slot where operating companies have users', () => {
    expect(PROFILE_CORE_SLOTS.financial_firm[0]).toEqual(['aum']);
    expect(PROFILE_CORE_SLOTS.operating_company).not.toContainEqual(['aum']);
    expect(PROFILE_CORE_SLOTS.operating_company.some(types => types.includes('users'))).toBe(true);
  });
});
