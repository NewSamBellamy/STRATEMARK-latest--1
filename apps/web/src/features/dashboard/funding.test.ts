import { describe, expect, it } from 'vitest';
import { unifyFunding, isFundingRoundEvent, statedByEvent } from './funding';

// Clearly fake company: Fakeco / Zeta Ventures.
const timeline = [
  { date: '2021 Jun', title: 'Fakeco raises Seed round', detail: '', amountUsd: 5e6, investors: ['Zeta Ventures'], sourceUrl: 'https://news.test/seed' },
  { date: '2023 Feb', title: 'Fakeco announces Series B', detail: '' },
  { date: '2024 Sep', title: 'Fakeco launches Model X', detail: '' },
];

describe('one funding structure', () => {
  it('history funding events become the governance rounds when governance is empty', () => {
    const rounds = unifyFunding([], timeline);
    expect(rounds.map((r) => r.round)).toEqual(['Seed', 'Series B']);
    expect(rounds[0]).toMatchObject({ amountUsd: 5e6, leadInvestors: ['Zeta Ventures'], sourceUrl: 'https://news.test/seed' });
  });

  it('a round with no stated amount stays null (never guessed)', () => {
    expect(unifyFunding(undefined, timeline)[1]).toMatchObject({ round: 'Series B', amountUsd: null, leadInvestors: [] });
  });

  it('a governance round gains only what the matching event states', () => {
    const gov = [{ round: 'Series B', amountUsd: null, date: '2023 Feb', leadInvestors: [] }];
    const rounds = unifyFunding(gov, timeline);
    expect(rounds).toHaveLength(2);
    expect(rounds.find((r) => r.round === 'Series B')!.amountUsd).toBeNull();
    const richer = unifyFunding(gov, [{ ...timeline[1]!, amountUsd: 40e6 }]);
    expect(richer).toHaveLength(1);
    expect(richer[0]!.amountUsd).toBe(40e6);
  });

  it('a Pre-seed event does not take the facts of a Seed round', () => {
    const gov = [{ round: 'Seed', amountUsd: 5e6, date: '2021', leadInvestors: ['Zeta Ventures'] }];
    const rounds = unifyFunding(gov, [{ date: '2021 Jan', title: 'Fakeco raises Pre-seed', detail: '' }]);
    expect(rounds).toHaveLength(2);
    expect(rounds[1]).toMatchObject({ round: 'Pre-seed', amountUsd: null, leadInvestors: [] });
  });

  it('an amount and lead the event description states fill the round (old cached events carry no fields)', () => {
    const rounds = unifyFunding([], [
      { date: '2026 Q3 (July)', title: 'Series C Financing', detail: 'Raises $800 million in Series C funding at an $8.3 billion valuation led by Zeta Ventures.' },
    ]);
    expect(rounds).toEqual([{ round: 'Series C', amountUsd: 800e6, date: '2026 Q3 (July)', leadInvestors: ['Zeta Ventures'] }]);
  });

  it('a stated amount in another currency is kept as written, never converted or put in the USD field', () => {
    const [round] = unifyFunding([], [
      { date: '2023 Jun', title: 'Seed Funding', detail: 'Raises a €105M (~$113M) Seed round led by Zeta Ventures at a €240M valuation.' },
    ]);
    expect(round).toMatchObject({ round: 'Seed', amountUsd: null, amountNote: '€105M', leadInvestors: ['Zeta Ventures'] });
  });

  it('two competing amounts fill nothing', () => {
    const [round] = unifyFunding([], [{ date: '2024', title: 'Series B Funding', detail: 'Raises $50 million plus a $20 million extension.' }]);
    expect(round).toMatchObject({ amountUsd: null, leadInvestors: [] });
    expect(round!.amountNote).toBeUndefined();
    expect(statedByEvent({ title: 'Series B Funding', detail: 'Raises $50 million plus a $20 million extension.' }).statesAmount).toBe(true);
  });

  it('an event stating its own amount beats the description', () => {
    const [round] = unifyFunding([], [{ date: '2024', title: 'Series B Funding', detail: 'Raises $50 million.', amountUsd: 45e6 }]);
    expect(round!.amountUsd).toBe(45e6);
  });

  it('a round listed twice for the same date is one row, and an extension is not the plain round', () => {
    const rounds = unifyFunding(
      [
        { round: 'Series A', amountUsd: null, date: '2023 Nov', leadInvestors: [] },
        { round: 'series a', amountUsd: 20e6, date: '2023 Nov', leadInvestors: ['Zeta Ventures'], sourceUrl: 'https://news.test/a' },
      ],
      [
        { date: '2024 Mar', title: 'Series A Extension / Series B Funding', detail: 'Raises $106 million, valuing the company at $1.25 billion.' },
        { date: '2025 Feb', title: 'Series B Funding and Revenue Milestone', detail: 'Raises $305 million at a $3.3 billion valuation.' },
      ],
    );
    expect(rounds.map((r) => r.round)).toEqual(['Series A', 'Series A Extension / Series B Funding', 'Series B']);
    expect(rounds[0]).toMatchObject({ amountUsd: 20e6, leadInvestors: ['Zeta Ventures'], sourceUrl: 'https://news.test/a' });
    expect(rounds[1]!.amountUsd).toBe(106e6);
    expect(rounds[2]!.amountUsd).toBe(305e6);
  });

  it('non-funding events are not rounds', () => {
    expect(isFundingRoundEvent(timeline[2]!)).toBe(false);
  });
});
