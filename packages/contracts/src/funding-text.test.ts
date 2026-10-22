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

describe('statedRoundAmount: amounts that are not a single USD round size (red-team B2 to B4)', () => {
  it('does not read a prefixed dollar (A$, C$, HK$) as US dollars', () => {
    expect(statedRoundAmount('Raised A$50 million in a Series B')).toBeNull();
    expect(statedRoundAmount('Closed a C$30 million Series A')).toBeNull();
    expect(statedRoundAmount('Raises HK$100 million in a Series A')).toBeNull();
    expect(statedRoundAmount('Raises US$40 million in a Series A')).toEqual({ currency: 'USD', value: 40e6, display: '$40M' });
  });

  it('says nothing for a range instead of reading its first number', () => {
    expect(statedRoundAmount('Raised $20-25 million in Series A')).toBeNull();
    expect(statedRoundAmounts('Raised $20–25 million in Series A')).toHaveLength(0);
    expect(statedRoundAmounts('Raised $20 to $25 million in Series A')).toHaveLength(0);
    expect(statedRoundAmounts('Raised $2 or $3 billion in Series A')).toHaveLength(0);
  });

  it('does not take a cumulative total as the round size', () => {
    expect(statedRoundAmount('Series D brings total funding to $1.2 billion')).toBeNull();
    expect(statedRoundAmount('Series C; the company has raised $300 million to date')).toBeNull();
    expect(statedRoundAmount('Seed round. $75 million raised in total so far')).toBeNull();
  });
});

describe('statedLeadInvestors: a name with an initial is not cut at the initial (red-team M1)', () => {
  it('keeps T. Rowe Price and J.P. Morgan whole', () => {
    expect(statedLeadInvestors('Series E led by T. Rowe Price and Fidelity')).toEqual(['T. Rowe Price', 'Fidelity']);
    expect(statedLeadInvestors('Series B led by J.P. Morgan and Accel')).toEqual(['J.P. Morgan', 'Accel']);
  });

  it('never returns a lone letter as an investor', () => {
    expect(statedLeadInvestors('Round led by T')).toEqual([]);
  });

  it('still stops at the end of the sentence', () => {
    expect(statedLeadInvestors('Raises $5M led by Orion Capital. Zeta Ventures later joined.')).toEqual(['Orion Capital']);
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

describe('statedLeadInvestors: a person is not an investor name (red-team minor)', () => {
  it('drops an entry that is a job title before a personal name', () => {
    expect(statedLeadInvestors('Round led by FTX CEO Sam Bankman-Fried and Orion Capital.')).toEqual(['Orion Capital']);
    expect(statedLeadInvestors('Round led by Fakeco founder Jane Doe.')).toEqual([]);
  });

  it('keeps only the organisation of a possessive "Name’s Org"', () => {
    expect(statedLeadInvestors('Round led by Chamath Palihapitiya’s Social Capital and Zeta Ventures.')).toEqual(['Social Capital', 'Zeta Ventures']);
    expect(statedLeadInvestors("Round led by Jane Doe's Fakeco Partners.")).toEqual(['Fakeco Partners']);
  });

  it('does not touch real names that merely contain such letters', () => {
    expect(statedLeadInvestors('Round led by Founders Fund and Lead Edge Capital.')).toEqual(['Founders Fund', 'Lead Edge Capital']);
  });
});

describe('isFundingWording', () => {
  it('recognises a round title and nothing else', () => {
    expect(isFundingWording('Series C Financing')).toBe(true);
    expect(isFundingWording('Launches Model X')).toBe(false);
  });
});

describe('investors derived only from sourced data', () => {
  it('a board seat is NOT evidence of an investment: affiliations are ignored unless asked for (red-team B1)', () => {
    const board = [
      { name: 'Hugh Johnston', affiliation: 'The Walt Disney Company' },
      { name: 'Jane Doe', affiliation: 'Board Member' },
      { name: 'Reid Hoffman', affiliation: 'Partner, Greylock Partners' },
      { name: 'Ann Lee', affiliation: 'Zeta Ventures' },
    ];
    expect(deriveInvestors({ companyName: 'Microsoft Corporation', board })).toEqual([]);
  });

  it('when explicitly asked, only an investment firm named by an affiliation becomes an investor entry of unknown kind', () => {
    const board = [
      { name: 'Hugh Johnston', affiliation: 'The Walt Disney Company' },
      { name: 'Jane Doe', affiliation: 'Board Member' },
      { name: 'Bo Observer', affiliation: 'Board Observer' },
      { name: 'Ann Lee', affiliation: 'Zeta Ventures' },
    ];
    expect(deriveInvestors({ companyName: 'Fakeco', board, includeBoardAffiliations: true }))
      .toEqual([{ name: 'Zeta Ventures', kind: 'other', note: 'Affiliation of board member Ann Lee.' }]);
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
    expect(organisationOfAffiliation('Board Member')).toBeNull();
    expect(organisationOfAffiliation('Investor')).toBeNull();
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
      includeBoardAffiliations: true,
    });
    expect(got).toEqual([{ name: 'Zeta Ventures', kind: 'vc', note: 'Seed lead.' }]);
  });

  it('invents nothing from an empty company', () => {
    expect(deriveInvestors({})).toEqual([]);
    expect(deriveInvestors({ board: [{ name: 'Ann Lee', affiliation: '' }], includeBoardAffiliations: true })).toEqual([]);
  });

  it('sameOrganisation ignores generic suffixes only', () => {
    expect(sameOrganisation('Lightspeed', 'Lightspeed Venture Partners')).toBe(true);
    expect(sameOrganisation('Orion Capital', 'Zeta Capital')).toBe(false);
  });
});
