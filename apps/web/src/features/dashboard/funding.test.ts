import { describe, expect, it } from 'vitest';
import { unifyFunding, isFundingRoundEvent } from './funding';

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

  it('non-funding events are not rounds', () => {
    expect(isFundingRoundEvent(timeline[2]!)).toBe(false);
  });
});
