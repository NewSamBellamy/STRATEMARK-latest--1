import { describe, expect, it } from 'vitest';
import type { OrgNode } from '@mi/contracts';
import { compareOrg, groupColumns, rankRole, recentMove, sortByRank, startingFive } from './orgRank';

const person = (name: string, role: string, over: Partial<OrgNode> = {}): OrgNode => ({
  id: name, name, role, group: 'exec', parentId: null, bio: '', ...over,
});

describe('rankRole', () => {
  it.each([
    ['Co-founder & Chief Executive Officer (CEO)', 0],
    ['Co-founder & Chief Scientist', 0],
    ['Founder', 0],
    ['Chief Executive Officer', 1],
    ['CEO', 1],
    ['Chief Technology Officer', 2],
    ['CFO', 2],
    ['Chief Business Officer (CBO)', 2],
    ['Chief of Staff to the CEO', 2],
    ['President', 2],
    ['Senior Vice President / VP of Global Public Affairs', 3],
    ['SVP, Sales', 3],
    ['EVP Engineering', 3],
    ['VP of Finance', 4],
    ['Vice President, Product', 4],
    ['Head of Model Behavior', 5],
    ['Director of Research', 5],
    ['Research Lead', 5],
    ['Member of Technical Staff', 6],
    ['', 6],
  ])('ranks "%s" as %i', (role, rank) => expect(rankRole({ role })).toBe(rank));

  it('treats isFounder as rank 0 whatever the title says', () => {
    expect(rankRole({ role: 'Head of Design', isFounder: true })).toBe(0);
  });

  it('does not read "President" inside "Vice President" as a president', () => {
    expect(rankRole({ role: 'Vice President of Sales' })).toBe(4);
  });
});

describe('ordering', () => {
  const team = [
    person('Pia', 'VP of Finance'),
    person('Hal', 'Head of People', { group: 'other' }),
    person('Cleo', 'Chief Technology Officer'),
    person('Lample', 'Co-founder & Chief Science Officer', { group: 'ai' }),
    person('Arthur', 'Co-founder & Chief Executive Officer'),
    person('Sven', 'SVP of Public Affairs'),
    person('Otto', 'Analyst', { group: 'other' }),
  ];

  it('sorts by role rank, then the CEO among founders, then function, then name', () => {
    expect(sortByRank(team).map((p) => p.name)).toEqual(['Arthur', 'Lample', 'Cleo', 'Sven', 'Pia', 'Hal', 'Otto']);
    expect(compareOrg(team[4]!, team[3]!)).toBeLessThan(0);
  });

  it('takes the starting five from the top of that order, co-founders included', () => {
    expect(startingFive(team).map((p) => p.name)).toEqual(['Arthur', 'Lample', 'Cleo', 'Sven', 'Pia']);
  });
});

describe('groupColumns', () => {
  it('puts founders and the CEO in their own column and keeps the fixed column order', () => {
    const cols = groupColumns([
      person('Des', 'Head of Design', { group: 'design' }),
      person('Pro', 'Head of Product', { group: 'product' }),
      person('Ann', 'Chief Executive Officer'),
      person('Ray', 'Researcher', { group: 'ai' }),
      person('Fin', 'VP of Finance'),
      person('Zoe', 'Co-founder & CTO', { group: 'ai' }),
    ]);
    expect(cols.map((c) => c.key)).toEqual(['founders', 'exec', 'ai', 'product_design']);
    expect(cols[0]!.people.map((p) => p.name)).toEqual(['Zoe', 'Ann']);
    expect(cols[3]!.people.map((p) => p.name)).toEqual(['Pro', 'Des']);
  });

  it('leaves out empty columns', () => {
    expect(groupColumns([person('Ann', 'CEO')]).map((c) => c.key)).toEqual(['founders']);
    expect(groupColumns([])).toEqual([]);
  });
});

describe('recentMove', () => {
  const now = Date.UTC(2026, 9, 20);
  const move = (over: Record<string, unknown> = {}) => ({
    move: { kind: 'joined', date: '2026-03', sourceUrl: 'https://news.example/a', ...over },
  }) as Pick<OrgNode, 'move'>;

  it('shows a sourced move from the last year as kind and month', () => {
    expect(recentMove(move(), now)).toMatchObject({ label: 'JOINED · MAR 2026', sourceUrl: 'https://news.example/a' });
    expect(recentMove(move({ kind: 'promoted', date: 'Mar 2026' }), now)?.label).toBe('PROMOTED · MAR 2026');
  });

  it('shows nothing without a move, for an old move, or for an unsourced one', () => {
    expect(recentMove({ move: null }, now)).toBeNull();
    expect(recentMove({}, now)).toBeNull();
    expect(recentMove(move({ date: '2024-05' }), now)).toBeNull();
    expect(recentMove(move({ sourceUrl: '' }), now)).toBeNull();
    expect(recentMove(move({ sourceUrl: 'javascript:alert(1)' }), now)).toBeNull();
  });

  it('shows nothing for a date it cannot read, and never invents a month for a bare year', () => {
    expect(recentMove(move({ date: 'sometime last spring' }), now)).toBeNull();
    expect(recentMove(move({ date: 'Q1 2026' }), now)).toBeNull();
    expect(recentMove(move({ date: '2026' }), now)?.label).toBe('JOINED · 2026');
  });
});
