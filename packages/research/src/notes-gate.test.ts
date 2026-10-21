import { describe, expect, it } from 'vitest';
import type { HistoryContent, MissionGovernanceContent } from '@mi/contracts';
import { attachQuoteSources, groundGovernanceInNotes, groundHistoryInNotes } from './notes-gate';

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

const STORY = [
  'Acme was founded in 2019 by Dana Lee in a Berlin apartment.',
  'In March 2023 Acme launched its first public model, Atlas.',
  'CEO Dana Lee told Reuters: "We built Atlas because nothing else was fast enough for the people who use it every day."',
].join('\n');
const history = (patch: Partial<HistoryContent>): HistoryContent => ({ founderStory: 'story', timeline: [], quotes: [], ...patch });

describe('history stays inside what the research stated', () => {
  it('keeps a milestone whose year and substance the notes carry, and drops an invented one', () => {
    const out = groundHistoryInNotes(history({ timeline: [
      { date: '2019', title: 'Founded in Berlin', detail: '' },
      { date: '2023 Mar', title: 'Launches Atlas model', detail: '' },
      { date: '2021', title: 'Acquires a robotics startup', detail: '' },
      { date: '2023 Jun', title: 'Opens Singapore office', detail: '' },
      { date: 'Early days', title: 'Founded in Berlin', detail: '' },
    ] }), STORY);
    expect(out.timeline.map((e) => e.title)).toEqual(['Founded in Berlin', 'Launches Atlas model']);
  });

  it('shows a quotation only when it is verbatim from the notes, across ellipses and punctuation', () => {
    const out = groundHistoryInNotes(history({ quotes: [
      { text: 'We built Atlas because nothing else was fast enough', attribution: 'Dana Lee' },
      { text: '“We built Atlas … for the people who use it every day.”', attribution: 'Dana Lee' },
      { text: 'We will never stop shipping', attribution: 'Dana Lee' },
      { text: 'We built Atlas because speed matters most', attribution: 'Dana Lee' },
    ] }), STORY);
    expect(out.quotes.map((q) => q.text)).toEqual([
      'We built Atlas because nothing else was fast enough',
      '“We built Atlas … for the people who use it every day.”',
    ]);
  });
});

describe('quote links', () => {
  const catalog = [{ url: 'https://www.cnbc.com/2026/interview', title: 'cnbc.com' }, { url: 'https://www.forbes.com/a', title: 'forbes.com' }, { url: 'https://www.forbes.com/b', title: 'forbes.com' }];
  const quote = (sourceTitle?: string, sourceUrl?: string) => ({ text: 't', attribution: 'a', sourceTitle, sourceUrl });
  it('links a quote to the one search citation from the publication it names', () => {
    expect(attachQuoteSources([quote('CNBC Interview')], catalog)[0]!.sourceUrl).toBe('https://www.cnbc.com/2026/interview');
  });
  it('never guesses: several candidates, none, or a link already given leave it as it is', () => {
    expect(attachQuoteSources([quote('Forbes')], catalog)[0]!.sourceUrl).toBeUndefined();
    expect(attachQuoteSources([quote('A podcast')], catalog)[0]!.sourceUrl).toBeUndefined();
    expect(attachQuoteSources([quote(undefined)], catalog)[0]!.sourceUrl).toBeUndefined();
    expect(attachQuoteSources([quote('CNBC', 'https://x.test/q')], catalog)[0]!.sourceUrl).toBe('https://x.test/q');
  });
});
