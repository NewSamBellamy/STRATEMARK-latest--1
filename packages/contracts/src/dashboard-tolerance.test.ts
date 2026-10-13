import { describe, expect, it } from 'vitest';
import {
  historyContentSchema,
  missionGovernanceContentSchema,
  productsRoadmapContentSchema,
  teamOrgContentSchema,
} from './schemas';

/**
 * A research pass returns what the sources support and nothing more. These
 * schemas therefore have to degrade, not collapse: on a live bake, 21% of
 * dashboard tabs were lost outright because a single string was absent.
 *
 * The rule under test: keep every field that was grounded, drop only what was
 * malformed, and never substitute a value that implies a finding.
 */
describe('dashboard content schemas degrade instead of collapsing', () => {
  it('keeps the governance fields that exist when others are missing', () => {
    const out = missionGovernanceContentSchema.parse({
      mission: 'Ensure AGI benefits humanity.',
      board: [{ name: 'A. Director', affiliation: 'Acme Capital' }, { name: 'B. Trustee' }],
      // ethos, governanceStructure, positives, negatives all absent
    });
    expect(out.mission).toBe('Ensure AGI benefits humanity.');
    expect(out.ethos).toBe(''); // an admitted gap, not an invention
    expect(out.board).toHaveLength(2);
    expect(out.board[1]!.affiliation).toBe('');
    expect(out.positives).toEqual([]);
  });

  it('keeps the timeline rows that parsed and discards only the broken one', () => {
    const out = historyContentSchema.parse({
      timeline: [
        { date: '2021', title: 'Founded', detail: 'Spun out of a research lab.' },
        { date: '2023', title: 'Series C' }, // no detail
        { nonsense: true }, // no title — unusable, must be dropped
        'not even an object',
      ],
      quotes: [{ text: 'We move deliberately.' }],
    });
    expect(out.timeline.map((t) => t.title)).toEqual(['Founded', 'Series C']);
    expect(out.timeline[1]!.detail).toBe('');
    expect(out.quotes[0]!.attribution).toBe('');
    expect(out.founderStory).toBe('');
  });

  it('files an unrecognised org grouping under other rather than losing the chart', () => {
    const out = teamOrgContentSchema.parse({
      nodes: [
        { id: '1', name: 'Chief Executive', role: 'CEO', group: 'exec', parentId: null },
        { id: '2', name: 'Head of Policy', group: 'policy' }, // not a known group
      ],
    });
    expect(out.nodes).toHaveLength(2);
    expect(out.nodes[1]!.group).toBe('other');
    expect(out.nodes[1]!.parentId).toBeNull();
  });

  it('drops a product whose lifecycle stage is unreadable instead of guessing one', () => {
    // There is no neutral value for status, and claiming "live" for something we
    // could not read would be a fabricated finding. Dropping the row is honest.
    const out = productsRoadmapContentSchema.parse({
      products: [
        { name: 'Model A', description: 'Flagship model.', status: 'live' },
        { name: 'Model B', description: 'Unclear.', status: 'rumoured' },
      ],
      roadmap: 'not an array',
    });
    expect(out.products.map((p) => p.name)).toEqual(['Model A']);
    expect(out.roadmap).toEqual([]);
  });

  it('accepts a bare node array for team_org — the "Expected object, received array" crash', () => {
    // Production failure 2026-08-25: a merge-style prompt led the model to
    // emit the node list directly instead of { nodes: [...] }, and the Team &
    // Org tab hard-crashed with a raw zod error on screen. Shape
    // normalization is the parser's job.
    const bare = [
      { id: 'ceo', name: 'Jane Doe', role: 'CEO', group: 'exec', parentId: null, bio: '' },
      { id: 'cto', name: 'Ann Roe', role: 'CTO', group: 'exec', parentId: 'ceo', bio: '' },
    ];
    const parsed = teamOrgContentSchema.parse(bare);
    expect(parsed.nodes).toHaveLength(2);
    expect(parsed.nodes[0]?.name).toBe('Jane Doe');
    // The wrapped shape still parses identically.
    expect(teamOrgContentSchema.parse({ nodes: bare }).nodes).toHaveLength(2);
  });

  it('never turns a wholly absent tab payload into fabricated content', () => {
    const out = missionGovernanceContentSchema.parse({});
    expect(out).toEqual({
      mission: '',
      ethos: '',
      governanceStructure: '',
      board: [],
      positives: [],
      negatives: [],
      fundingRounds: [],
      investors: [],
    });
  });

  it('keeps a quotation whose source link is blank or malformed, without provenance', () => {
    const out = historyContentSchema.parse({
      quotes: [
        { text: 'Google is broken.', attribution: 'A. Founder', date: 'June 2025', sourceTitle: 'A podcast', sourceUrl: '' },
        { text: 'We build answers.', attribution: 'A. Founder', sourceUrl: 'not a url' },
        { text: 'Cited.', attribution: 'A. Founder', sourceUrl: 'https://example.com/interview' },
      ],
    });
    expect(out.quotes.map((q) => [q.text, q.sourceUrl])).toEqual([
      ['Google is broken.', undefined], ['We build answers.', undefined], ['Cited.', 'https://example.com/interview'],
    ]);
  });
});
