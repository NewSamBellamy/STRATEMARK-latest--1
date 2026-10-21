import { describe, expect, it } from 'vitest';
import { deriveInvestors, isFundingWording, organisationOfAffiliation, sameOrganisation, statedLeadInvestors, statedRoundAmount, statedRoundAmounts } from './funding-text';

// Clearly fake companies and funds throughout: Fakeco, Zeta Ventures, Orion Capital.
describe('statedRoundAmount: only the amount the text gives as the round size', () => {
  it('reads a USD round size and ignores the valuation beside it', () => {
    expect(statedRoundAmount('Series C Financing. Raises $800 million in Series C funding at an $8.3 billion valuation led by Zeta Ventures.'))
      .toEqual({ currency: 'USD', value: 800e6, display: '$800M' });
    expect(statedRoundAmount('Raises $305 million at a $3.3 billion valuation and surpasses $100 million in annualized revenue.')?.value).toBe(305e6);
  });

  it('reads a billion written out', () => {
    expect(statedRoundAmount('Closes an oversubscribed $1.375 billion Series E round.')).toEqual({ currency: 'USD', value: 1.375e9, display: '$1.375B' });
  });

  it('keeps a euro amount in euros and drops the writer own approximate dollar gloss', () => {
    const got = statedRoundAmount('Raises a €105M (~$113M) Seed round led by Zeta Ventures at a €240M valuation.');
    expect(got).toEqual({ currency: 'EUR', value: 105e6, display: '€105M' });
  });

  it('says nothing when two different round sizes compete', () => {
    expect(statedRoundAmount('Raises $50 million, then a further $20 million extension.')).toBeNull();
    expect(statedRoundAmounts('Raises $50 million, then a further $20 million extension.')).toHaveLength(2);
  });

  it('counts a repeated mention once', () => {
    expect(statedRoundAmounts('Raises $40M. The $40M round closed in May.')).toHaveLength(1);
  });

  it('says nothing when the only amount is a valuation, revenue or a headcount-style figure', () => {
    expect(statedRoundAmount('Hits $1.0 billion in annualized revenue with over 400,000 users.')).toBeNull();
    expect(statedRoundAmount('Valued at $2 billion after a funding round.')).toBeNull();
    expect(statedRoundAmount('Announces a Series B round.')).toBeNull();
  });

  it('does not take a number glued to letters or without a currency sign', () => {
    expect(statedRoundAmount('Raises 40 million in a Series A round.')).toBeNull();
    expect(statedRoundAmount('Opens a $100 more-than-expected office.')?.value).toBe(100);
  });
});

describe('statedLeadInvestors', () => {
  it('reads one lead and stops at the next clause', () => {
    expect(statedLeadInvestors('Raises $800 million in Series C funding at an $8.3 billion valuation led by Zeta Ventures.')).toEqual(['Zeta Ventures']);
    expect(statedLeadInvestors('Seed round led by Orion Capital at a €240M valuation before releasing a product.')).toEqual(['Orion Capital']);
  });

  it('reads a co-led list', () => {
    expect(statedLeadInvestors('A $13 billion round co-led by Alpha, Beta Partners, and Gamma at a high valuation.')).toEqual(['Alpha', 'Beta Partners', 'Gamma']);
  });

  it('drops anything that is not a plain proper name', () => {
    expect(statedLeadInvestors('Round led by Orion Capital and participation from existing backers.')).toEqual(['Orion Capital']);
    expect(statedLeadInvestors('Round led by several existing investors.')).toEqual([]);
    expect(statedLeadInvestors('Round announced with no lead.')).toEqual([]);
  });
});

describe('isFundingWording', () => {
  it('recognises a round title and nothing else', () => {
    expect(isFundingWording('Series C Financing')).toBe(true);
    expect(isFundingWording('Launches Model X')).toBe(false);
  });
});

describe('investors derived only from sourced data', () => {
  it('a board affiliation naming an organisation becomes an investor entry of unknown kind', () => {
    const got = deriveInvestors({ companyName: 'Fakeco', board: [{ name: 'Ann Lee', affiliation: 'Zeta Ventures' }] });
    expect(got).toEqual([{ name: 'Zeta Ventures', kind: 'other', note: 'Affiliation of board member Ann Lee.' }]);
  });

  it('a partner title is stripped to the firm', () => {
    expect(organisationOfAffiliation('Partner, Zeta Ventures')).toBe('Zeta Ventures');
    expect(organisationOfAffiliation('General Partner at Orion Capital')).toBe('Orion Capital');
  });

  it('a job, a school or the company itself is not an investor', () => {
    expect(organisationOfAffiliation('Fakeco (CEO)', 'Fakeco')).toBeNull();
    expect(organisationOfAffiliation('Fakeco', 'Fakeco')).toBeNull();
    expect(organisationOfAffiliation('Professor, Fake University')).toBeNull();
    expect(organisationOfAffiliation('Chief Scientist')).toBeNull();
    expect(organisationOfAffiliation('')).toBeNull();
    expect(organisationOfAffiliation(null)).toBeNull();
  });

  it('round leads are included once, with the round they led', () => {
    const got = deriveInvestors({
      fundingRounds: [
        { round: 'Seed', amountUsd: null, date: '2023 Feb', leadInvestors: ['Orion Capital'] },
        { round: 'Series A', amountUsd: null, date: '2024', leadInvestors: ['Orion'] },
      ],
    });
    expect(got).toEqual([{ name: 'Orion Capital', kind: 'other', note: 'Led Seed (2023 Feb).' }]);
  });

  it('listed investors keep their own kind and note and are not duplicated by a short form', () => {
    const got = deriveInvestors({
      board: [{ name: 'Ann Lee', affiliation: 'Zeta' }],
      investors: [{ name: 'Zeta Ventures', kind: 'vc', note: 'Seed lead.' }],
    });
    expect(got).toEqual([{ name: 'Zeta Ventures', kind: 'vc', note: 'Seed lead.' }]);
  });

  it('invents nothing from an empty company', () => {
    expect(deriveInvestors({})).toEqual([]);
    expect(deriveInvestors({ board: [{ name: 'Ann Lee', affiliation: '' }] })).toEqual([]);
  });

  it('sameOrganisation ignores generic suffixes only', () => {
    expect(sameOrganisation('Lightspeed', 'Lightspeed Venture Partners')).toBe(true);
    expect(sameOrganisation('Orion Capital', 'Zeta Capital')).toBe(false);
  });
});
