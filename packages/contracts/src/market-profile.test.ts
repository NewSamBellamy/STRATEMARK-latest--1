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

  it('classifies credit managers that call themselves lenders or credit investors', () => {
    // Descriptor shapes from a live "US private credit asset managers" deck,
    // where most managers fell to the operating-company card (no AUM slot).
    expect(classifyMarketProfile({ name: 'Golub Capital', oneLiner: 'Direct lender providing financing for private equity-backed middle-market companies.' })).toBe('financial_firm');
    expect(classifyMarketProfile({ name: 'Ares Management', oneLiner: 'Global alternative investment manager with a leading direct lending platform.' })).toBe('financial_firm');
    expect(classifyMarketProfile({ name: 'HPS Investment Partners', oneLiner: 'Global credit investment firm.' })).toBe('financial_firm');
    expect(classifyMarketProfile({ name: 'Audax Private Debt', oneLiner: 'Senior secured loans to middle-market companies.' })).toBe('financial_firm');
    expect(classifyMarketProfile({ name: 'Blue Owl Capital', oneLiner: 'Alternative asset manager focused on direct lending and GP stakes.' })).toBe('financial_firm');
    expect(classifyMarketProfile({ name: 'Antares Capital', oneLiner: 'Middle-market lender serving private equity sponsors.' })).toBe('financial_firm');
    expect(classifyMarketProfile({ name: 'Owl Rock', oneLiner: 'A business development company focused on direct lending.' })).toBe('financial_firm');
  });

  it('keeps lending software and consumer lending marketplaces out of the fund profile', () => {
    expect(classifyMarketProfile({ name: 'Funding Circle', oneLiner: 'Online lending platform for small businesses.' })).toBe('operating_company');
    expect(classifyMarketProfile({ name: 'LoanPro', oneLiner: 'Loan management software for direct lenders and credit funds.' })).toBe('operating_company');
    expect(classifyMarketProfile({ name: 'Cardo', oneLiner: 'Private credit data platform for investors.' })).toBe('operating_company');
  });

  it('keeps companies that SERVE funds and managers out of the fund profile', () => {
    // Fund-manager words in the object of a service phrase name the customers.
    expect(classifyMarketProfile({ name: 'Alter Domus', oneLiner: 'Discover Alter Domus, offering expert services for alternative investments…' })).toBe('operating_company');
    expect(classifyMarketProfile({ name: 'Alter Domus', oneLiner: 'Fund administration services for alternative asset managers.' })).toBe('operating_company');
    expect(classifyMarketProfile({ name: 'SS&C Technologies', oneLiner: 'provider of software and services to the financial services industry including asset managers' })).toBe('operating_company');
    expect(classifyMarketProfile({ name: 'iCapital', oneLiner: 'technology platform for wealth managers to access alternative investments' })).toBe('operating_company');
    expect(classifyMarketProfile({ name: 'CAIS', oneLiner: 'Alternative investment platform for financial advisors and wealth management firms.' })).toBe('operating_company');
    expect(classifyMarketProfile({ name: 'Fund Admin Co', oneLiner: 'Fund administrator to private equity and hedge funds.' })).toBe('operating_company');
    expect(classifyMarketProfile({ name: 'Custody Co', oneLiner: 'Custodian for asset managers.' })).toBe('operating_company');
    expect(classifyMarketProfile({ name: 'Back Office Co', oneLiner: 'Outsourced CFO services for venture capital firms.' })).toBe('operating_company');
    expect(classifyMarketProfile({ name: 'Kirkland & Ellis', oneLiner: 'Law firm advising private equity funds.' })).toBe('operating_company');
    expect(classifyMarketProfile({ name: 'Preqin', oneLiner: 'Data provider to private credit managers.' })).toBe('operating_company');
    expect(classifyMarketProfile({ name: 'Advisory Co', oneLiner: 'Consulting services to U.S. asset managers.' })).toBe('operating_company');
    expect(classifyMarketProfile({ name: 'Juniper Square', oneLiner: 'Investment management software used by private equity firms.' })).toBe('operating_company');
  });

  it('does not read "human capital management" (HR and payroll software) as a capital manager', () => {
    // ADP's real descriptor: it was filed as a financial firm, got an AUM slot and no market-cap hunt.
    expect(classifyMarketProfile({ name: 'Automatic Data Processing, Inc. / ADP (RUN Powered by ADP)',
      oneLiner: 'Automatic Data Processing, Inc. / ADP (RUN Powered by ADP) is a dominant global human capital management (HCM) and payroll incumbent offering dedicated small business solutions (RUN).' }))
      .toBe('operating_company');
    expect(classifyMarketProfile({ name: 'Workday', oneLiner: 'Cloud applications for Human Capital Management and finance.' })).toBe('operating_company');
    expect(classifyMarketProfile({ name: 'Treasury Co', oneLiner: 'Working capital management for mid-size firms.' })).toBe('operating_company');
    // An actual capital manager still is one.
    expect(classifyMarketProfile({ name: 'Acme Capital Management', oneLiner: 'Registered investment adviser based in Boston.' })).toBe('financial_firm');
    expect(classifyMarketProfile({ name: 'Elm Park', oneLiner: 'An independent capital management firm for families and foundations.' })).toBe('financial_firm');
  });

  it('keeps a manager a manager when it also serves clients', () => {
    // Cliffwater consults AND manages assets: it really is a financial firm.
    expect(classifyMarketProfile({ name: 'Cliffwater', oneLiner: 'alternative investment adviser and asset manager' })).toBe('financial_firm');
    // The subject before "serving" still decides.
    expect(classifyMarketProfile({ name: 'Hamilton Lane', oneLiner: 'Private markets investment management firm serving institutional investors.' })).toBe('financial_firm');
    expect(classifyMarketProfile({ name: 'Blackstone', oneLiner: 'Asset manager serving institutional investors in the U.S. and Europe.' })).toBe('financial_firm');
  });

  it('classifies operating companies as operating companies', () => {
    expect(classifyMarketProfile({ name: 'Tesla', oneLiner: 'Designs and manufactures electric vehicles and energy storage.' })).toBe('operating_company');
    expect(classifyMarketProfile({ name: 'Acme Storage', oneLiner: 'Grid-scale battery storage systems.' })).toBe('operating_company');
  });

  it('does not mistake a vendor that SERVES financial firms for a fund', () => {
    expect(classifyMarketProfile({ name: 'Carta', oneLiner: 'Cap table software for private equity and venture capital.' })).toBe('operating_company');
    expect(classifyMarketProfile({ name: 'Affinity', oneLiner: 'Relationship intelligence platform serving venture capital firms.' })).toBe('operating_company');
    // The industry words describe its customers, not its business.
    expect(classifyMarketProfile({ name: 'Edda', oneLiner: 'Venture capital portfolio management software.' })).toBe('operating_company');
    expect(classifyMarketProfile({ name: 'Allvue Systems', oneLiner: 'Private equity fund administration SaaS.' })).toBe('operating_company');
    expect(classifyMarketProfile({ name: 'Accel', oneLiner: 'Early and growth-stage venture capital firm.' })).toBe('financial_firm');
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

  it('gives operating companies ordered alternatives that reach small private brands', () => {
    expect(PROFILE_CORE_SLOTS.operating_company).toEqual([
      ['employees'],
      ['arr', 'revenue', 'funding_total'],
      ['users', 'distribution'],
      ['valuation', 'market_cap', 'last_round', 'funding_total'],
    ]);
    expect(PROFILE_CORE_SLOTS.financial_firm).toEqual([['aum'], ['employees'], ['valuation', 'market_cap'], ['arr']]);
  });
});
