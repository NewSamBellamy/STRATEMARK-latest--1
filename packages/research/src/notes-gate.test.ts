import { describe, expect, it } from 'vitest';
import type { HistoryContent, MissionGovernanceContent } from '@mi/contracts';
import { attachQuoteSources, groundGovernanceInNotes, groundHistoryInNotes, keepCitedSourceUrls } from './notes-gate';

const NOTES = [
  'Acme raised a $20 million Series A in March 2022 led by Sequoia Capital.',
  'In 2025 Acme closed a $6.6 billion Series C round led by Thrive Capital, with participation from Microsoft.',
  'The board is chaired by Bret Taylor; Dana Lee also sits on the board.',
].join('\n');

const base = (patch: Partial<MissionGovernanceContent>): MissionGovernanceContent => ({
  mission: '', ethos: '', governanceStructure: '', board: [], positives: [], negatives: [], fundingRounds: [], investors: [], ...patch,
});
const round = (name: string, date: string | null, amountUsd: number | null, leadInvestors: string[] = []) => ({ round: name, date, amountUsd, leadInvestors });

describe('concerns about a named company must trace to the research text (Rule 9)', () => {
  const NOTES_C = `${NOTES}\nRegulators opened an antitrust inquiry into Acme's pricing in 2025. Acme lobbied against the EU AI Act.`;

  it('keeps a concern the notes state and drops one they never mention', () => {
    const out = groundGovernanceInNotes(base({ negatives: [
      'Antitrust inquiry into pricing',
      'Lobbying against the EU AI Act',
      'Accused of poisoning a rival water supply',
    ], positives: ['Founders keep voting control'] }), NOTES_C, 'Acme');
    expect(out.negatives).toEqual(['Antitrust inquiry into pricing', 'Lobbying against the EU AI Act']);
    // A positive is not an allegation: it is left as the model wrote it.
    expect(out.positives).toEqual(['Founders keep voting control']);
  });

  it('drops a concern made only of words the notes do not contain, and an empty one', () => {
    const out = groundGovernanceInNotes(base({ negatives: ['', '   ', 'Layoffs followed a failed merger'] }), NOTES_C, 'Acme');
    expect(out.negatives).toEqual([]);
  });
});

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

  it('derives investors from round leads and sourced board affiliations, as kind other', () => {
    const notes = `${NOTES}\nDana Lee is a partner at Thrive Capital.`;
    const out = groundGovernanceInNotes(base({
      fundingRounds: [round('Series C', '2025', 6.6e9, ['Thrive Capital'])],
      board: [{ name: 'Dana Lee', affiliation: 'Thrive Capital' }, { name: 'Bret Taylor', affiliation: 'Acme (Chair)' }],
    }), notes, 'Acme');
    expect(out.investors).toEqual([{ name: 'Thrive Capital', kind: 'other', note: 'Led Series C (2025).' }]);
  });

  it('does not derive an investor from an affiliation the notes do not state beside the member', () => {
    const out = groundGovernanceInNotes(base({ board: [{ name: 'Dana Lee', affiliation: 'Zorblax Ventures' }] }), NOTES, 'Acme');
    expect(out.board[0]!.affiliation).toBe('');
    expect(out.investors).toEqual([]);
  });

  it('needs a person\'s whole name in the notes, so a shared surname does not vouch for them', () => {
    const out = groundGovernanceInNotes(base({ board: [
      { name: 'Bret Taylor', affiliation: 'Chair' },
      { name: 'Dana Lee', affiliation: '' },
      { name: 'Bob Taylor', affiliation: 'Director' },
    ] }), NOTES);
    expect(out.board.map((b) => b.name)).toEqual(['Bret Taylor', 'Dana Lee']);
  });

  it('keeps a board affiliation only when the notes state it beside the member, else blank', () => {
    const notes = `${NOTES}\nDana Lee is also the Chief Executive Officer of Globex Robotics.`;
    const out = groundGovernanceInNotes(base({ board: [
      { name: 'Dana Lee', affiliation: 'Chief Executive Officer of Globex Robotics' },
      { name: 'Bret Taylor', affiliation: 'CEO of Sierra' },
    ] }), notes);
    expect(out.board).toEqual([
      { name: 'Dana Lee', affiliation: 'Chief Executive Officer of Globex Robotics' },
      { name: 'Bret Taylor', affiliation: '' },
    ]);
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

describe('funding facts on history events', () => {
  const hist = (timeline: HistoryContent['timeline']): HistoryContent => ({ founderStory: '', timeline, quotes: [] });
  it('drops an amount and investor the notes do not state; keeps the stated ones', () => {
    const out = groundHistoryInNotes(hist([
      { date: '2022 Mar', title: 'Acme raises Series A', detail: '', amountUsd: 20e6, investors: ['Sequoia Capital', 'Zorblax Fund'] },
      { date: '2025', title: 'Acme closes Series C round', detail: '', amountUsd: 9.9e9 },
    ]), NOTES);
    expect(out.timeline[0]).toMatchObject({ amountUsd: 20e6, investors: ['Sequoia Capital'] });
    expect(out.timeline[1]!.amountUsd).toBeUndefined();
  });
  it('fills the amount and lead from the event own description when the notes carry them too', () => {
    const out = groundHistoryInNotes(hist([
      { date: '2025', title: 'Series C Financing', detail: 'Raises $6.6 billion in Series C funding at a $90 billion valuation led by Thrive Capital.' },
    ]), NOTES);
    expect(out.timeline[0]).toMatchObject({ amountUsd: 6.6e9, investors: ['Thrive Capital'] });
  });
  it('does not take a described amount the notes never state, nor an ambiguous or non-USD one', () => {
    const out = groundHistoryInNotes(hist([
      { date: '2025', title: 'Series C Financing', detail: 'Raises $9.9 billion in Series C funding led by Thrive Capital.' },
      { date: '2022 Mar', title: 'Series A Financing', detail: 'Raises $20 million, then a further $6.6 billion.' },
      { date: '2025', title: 'Series C Financing', detail: 'Raises €6.6 billion in a round.' },
    ]), NOTES);
    expect(out.timeline[0]!.amountUsd).toBeUndefined();
    expect(out.timeline[0]!.investors).toEqual(['Thrive Capital']);
    expect(out.timeline[1]!.amountUsd).toBeUndefined();
    expect(out.timeline[2]!.amountUsd).toBeUndefined();
  });
  it('a non-funding event never gains an amount from its description', () => {
    const out = groundHistoryInNotes(hist([
      { date: '2025', title: 'Acme opens a data center', detail: 'Invests $6.6 billion in racks.' },
    ]), `${NOTES}\nIn 2025 Acme opens a data center.`);
    expect(out.timeline[0]!.amountUsd).toBeUndefined();
  });
  it('removes a sourceUrl that no citation carries', () => {
    const rows = [{ sourceUrl: 'https://made.up/x' }, { sourceUrl: 'https://real.test/a/' }];
    const out = keepCitedSourceUrls(rows, [{ url: 'https://real.test/a' }]);
    expect(out[0]!.sourceUrl).toBeUndefined();
    expect(out[1]!.sourceUrl).toBe('https://real.test/a/');
  });
});
