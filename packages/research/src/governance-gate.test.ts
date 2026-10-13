import { describe, expect, it } from 'vitest';
import type { MissionGovernanceContent } from '@mi/contracts';
import { groundGovernanceInNotes } from './governance-gate';

const NOTES = [
  'Acme raised a $20 million Series A in March 2022 led by Sequoia Capital.',
  'In 2025 Acme closed a $6.6 billion Series C round led by Thrive Capital, with participation from Microsoft.',
  'The board is chaired by Bret Taylor; Dana Lee also sits on the board.',
].join('\n');

const base = (patch: Partial<MissionGovernanceContent>): MissionGovernanceContent => ({
  mission: '', ethos: '', governanceStructure: '', board: [], positives: [], negatives: [], fundingRounds: [], investors: [], ...patch,
});
const round = (name: string, date: string | null, amountUsd: number | null, leadInvestors: string[] = []) => ({ round: name, date, amountUsd, leadInvestors });

describe('governance and funding stay inside what the research stated', () => {
  it('keeps a round the notes state, with its amount, date and lead', () => {
    const out = groundGovernanceInNotes(base({ fundingRounds: [round('Series C', '2025', 6.6e9, ['Thrive Capital'])] }), NOTES);
    expect(out.fundingRounds).toEqual([round('Series C', '2025', 6.6e9, ['Thrive Capital'])]);
  });

  it('withholds an amount, a date and a lead the notes never mention, but keeps the round', () => {
    const out = groundGovernanceInNotes(base({ fundingRounds: [round('Series A', '2019 Jun', 5e9, ['Sequoia Capital', 'Founders Fund'])] }), NOTES);
    expect(out.fundingRounds).toEqual([round('Series A', null, null, ['Sequoia Capital'])]);
  });

  it('drops a round the notes neither name nor give the amount of', () => {
    const out = groundGovernanceInNotes(base({ fundingRounds: [round('Series D', '2026', 12e9, ['Thrive Capital'])] }), NOTES);
    expect(out.fundingRounds).toEqual([]);
  });

  it('keeps an undated, undisclosed round the notes do name, and never reads an empty name as a match', () => {
    expect(groundGovernanceInNotes(base({ fundingRounds: [round('Series A', null, null)] }), NOTES).fundingRounds).toEqual([round('Series A', null, null)]);
    expect(groundGovernanceInNotes(base({ fundingRounds: [round('', null, null)] }), NOTES).fundingRounds).toEqual([]);
  });

  it('collapses a round listed twice', () => {
    const rows = [round('Series A', '2022', 20e6), round('series a', '2022', 20e6)];
    expect(groundGovernanceInNotes(base({ fundingRounds: rows }), NOTES).fundingRounds).toHaveLength(1);
  });

  it('keeps investors the notes name and drops the ones recalled from memory', () => {
    const out = groundGovernanceInNotes(base({ investors: [
      { name: 'Microsoft Corporation', kind: 'corporate', note: '' },
      { name: 'SoftBank Group', kind: 'corporate', note: '' },
      { name: 'Thrive Capital', kind: 'vc', note: '' },
    ] }), NOTES);
    expect(out.investors.map((i) => i.name)).toEqual(['Microsoft Corporation', 'Thrive Capital']);
  });

  it('needs a person\'s whole name in the notes, so a shared surname does not vouch for them', () => {
    const out = groundGovernanceInNotes(base({ board: [
      { name: 'Bret Taylor', affiliation: 'Chair' },
      { name: 'Dana Lee', affiliation: '' },
      { name: 'Bob Taylor', affiliation: 'Director' },
    ] }), NOTES);
    expect(out.board.map((b) => b.name)).toEqual(['Bret Taylor', 'Dana Lee']);
  });
});
