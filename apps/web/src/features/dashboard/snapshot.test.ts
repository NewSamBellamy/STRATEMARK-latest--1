import { describe, expect, it } from 'vitest';
import type { OrgNode } from '@mi/contracts';
import { fundingSnapshot, leadershipSnapshot, newsMood, reportedDateMs, roundsNewestFirst } from './snapshot';

const round = (name: string, date: string | null, leads: string[] = [], amountUsd: number | null = null) =>
  ({ round: name, date, leadInvestors: leads, amountUsd });
const person = (name: string, role: string, group: OrgNode['group'] = 'exec', parentId: string | null = null): OrgNode =>
  ({ id: name, name, role, group, parentId, bio: '' });

describe('reported dates', () => {
  it.each([
    ['2026 Mar', Date.UTC(2026, 2, 1)],
    ['March 2026', Date.UTC(2026, 2, 1)],
    ['Mar 14, 2026', Date.UTC(2026, 2, 14)],
    ['2026-03', Date.UTC(2026, 2, 1)],
    ['2026-03-09', Date.UTC(2026, 2, 9)],
    ['Q3 2025', Date.UTC(2025, 6, 1)],
    ['2024 H2', Date.UTC(2024, 6, 1)],
    ['2023', Date.UTC(2023, 0, 1)],
    ['early 2022', Date.UTC(2022, 0, 1)],
  ])('reads %s', (text, expected) => expect(reportedDateMs(text)).toBe(expected));

  it.each([null, undefined, '', 'recently', 'Not reported'])('names no year for %s', (text) => expect(reportedDateMs(text)).toBeNull());
});

describe('funding snapshot', () => {
  it('orders rounds newest first and leaves undated rounds last, in their own order', () => {
    const ordered = roundsNewestFirst([round('Seed', '2021'), round('Mystery', null), round('Series B', '2024 Jun'), round('Series A', 'Mar 2022'), round('Other', 'sometime')]);
    expect(ordered.map((r) => r.round)).toEqual(['Series B', 'Series A', 'Seed', 'Mystery', 'Other']);
  });

  it('names the latest round and the investors that actually led', () => {
    const snap = fundingSnapshot(
      [round('Series A', '2022', ['Sequoia']), round('Series B', '2024', ['Sequoia', 'a16z']), round('Series C', '2025 Oct', ['Thrive'])],
      [{ name: 'Someone Else', kind: 'vc', note: '' }],
    )!;
    expect(snap.latest.round).toBe('Series C');
    expect(snap.roundCount).toBe(3);
    expect(snap.leads).toEqual(['Sequoia', 'a16z', 'Thrive']);
  });

  it('falls back to the listed investors when no round names a lead, and never invents either', () => {
    expect(fundingSnapshot([round('Seed', '2021')], [{ name: 'Y Combinator', kind: 'vc', note: '' }])!.leads).toEqual(['Y Combinator']);
    expect(fundingSnapshot([], [{ name: 'Y Combinator', kind: 'vc', note: '' }])).toBeNull();
  });
});

describe('leadership snapshot', () => {
  it('puts the CEO, then founders, then the other chiefs first', () => {
    const names = leadershipSnapshot([
      person('Pat', 'Chief Financial Officer'), person('Lee', 'Co-founder & CTO'), person('Sam', 'Chief Executive Officer'),
      person('Kim', 'Head of Design', 'design'), person('Ana', 'President'), person('Zed', 'VP Sales'),
    ]).map((p) => p.name);
    expect(names).toEqual(['Sam', 'Lee', 'Ana', 'Pat']);
  });

  it('uses the top of the reported org when nobody is grouped as an executive', () => {
    const names = leadershipSnapshot([person('Dee', 'Researcher', 'ai', 'boss'), person('Boss', 'Director', 'other', null)]).map((p) => p.name);
    expect(names).toEqual(['Boss']);
  });
});

describe('news mood', () => {
  it('counts current stories only', () => {
    expect(newsMood([
      { sentiment: 'positive', stale: false }, { sentiment: 'negative', stale: false },
      { sentiment: 'positive', stale: false }, { sentiment: 'neutral', stale: true },
    ])).toEqual({ positive: 2, neutral: 0, negative: 1, total: 3 });
  });
});
