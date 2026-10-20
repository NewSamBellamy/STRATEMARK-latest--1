import { describe, expect, it } from 'vitest';
import { hasProseFigure, withoutProseFigures } from './proseFigures';

describe('prose figures', () => {
  it.each([
    // Money.
    'It raised $500M at a $5B valuation.', 'It raised €2.1bn from investors.', 'A USD 500 million round.',
    'Acme is a $5B robotics company.', 'It sold for five billion dollars.', 'It was valued at half a billion.',
    // People: counts of employees and of customers, however they are written.
    'The company has about 1,200 employees.', 'It employs about 300 people.', 'Headcount reached 1,200.',
    'It has 400 FTEs.', 'It is a 400-person company.', 'It is a 50-person team.', 'It has twelve thousand people.',
    'It has 2,500 professionals.', 'It serves 1,200 enterprise customers.', 'It has 3,000 clients.', 'It has 40,000 merchants.',
    'It has 1,200,000 monthly active accounts.', 'It serves 3 million monthly active users.', 'It has 12,000 customers.',
    // Shares and fractions.
    'It holds a 40% market share.', 'It has 30 percent of the market.', 'It has 30 per cent of the market.',
    'It holds a third of the market.', 'It holds two thirds of the market.', 'It holds half of the market.',
    'Its market share rose to 12.5% last year.', 'It earns a quarter of its revenue in Asia.',
    // Any big number that is not a plain year: fail closed.
    'A 500M Series C.', 'A team of 50 engineers built it.', 'It runs 320 stores.', 'It was founded in 1,950.', 'It dates from 2101.',
    'Hundreds of firms use it.',
  ])('treats "%s" as stating a figure', (text) => {
    expect(hasProseFigure(text), text).toBe(true);
  });

  it.each([
    'Founded in 2015 in Austin, Texas.', 'It closed its Series C in Q1 2021.', 'It launched a GPT-4 based assistant.',
    'It opened offices in 12 countries.', 'It was founded by three engineers.', 'ISO-certified plants in three states.',
    'It was acquired by a third party.', 'It has been active since 1999 and 2024 was its busiest year.', 'It dates from 1900.',
    'It makes industrial widgets for the logistics sector.', '',
  ])('does not treat "%s" as a figure', (text) => {
    expect(hasProseFigure(text), text).toBe(false);
  });

  it('copes with nothing to read', () => {
    expect(hasProseFigure(null)).toBe(false);
    expect(hasProseFigure(undefined)).toBe(false);
  });

  it('keeps the sentences around a figure, as stored and in order, and nothing when nothing is left', () => {
    expect(withoutProseFigures('Acme makes widgets. It raised $500M in 2024. Its customers are retailers.')).toBe('Acme makes widgets. Its customers are retailers.');
    expect(withoutProseFigures('Acme is a $5B robotics company with 12,000 employees and 3 million users.')).toBeNull();
    expect(withoutProseFigures('It raised $500M in 2024. It employs 1,200 people.')).toBeNull();
    expect(withoutProseFigures('A robotics maker in Austin.')).toBe('A robotics maker in Austin.');
    expect(withoutProseFigures(null)).toBeNull();
  });
});
