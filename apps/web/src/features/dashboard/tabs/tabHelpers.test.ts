import { describe, expect, it } from 'vitest';
import type { OrgNode } from '@mi/contracts';
import {
  buildOrgTree, classifyEvent, countByGroup, filterOrgTree, groupByHost, groupByYear,
  hostOf, matchesQuery, orgInitials, parseEventYear, recencyBucket, sourceStrength, strengthMix,
  type OrgTreeNode,
} from './tabHelpers';

const person = (id: string, parentId: string | null, group: OrgNode['group'] = 'exec'): OrgNode => ({
  id, name: `P ${id}`, role: 'Role', group, parentId, bio: '',
});

describe('buildOrgTree', () => {
  it('nests children and counts descendants', () => {
    const f = buildOrgTree([person('a', null), person('b', 'a'), person('c', 'b'), person('d', 'a')]);
    expect(f).toHaveLength(1);
    expect(f[0]!.descendants).toBe(3);
    expect(f[0]!.children.map((c) => c.person.id)).toEqual(['b', 'd']);
    expect(f[0]!.children[0]!.children[0]!.depth).toBe(2);
  });
  it('promotes people with a missing parent to roots instead of dropping them', () => {
    expect(buildOrgTree([person('a', 'ghost'), person('b', null)]).map((r) => r.person.id)).toEqual(['a', 'b']);
  });
  it('breaks cycles and self-parenting without losing anyone', () => {
    const f = buildOrgTree([person('a', 'b'), person('b', 'a'), person('c', 'c')]);
    const ids: string[] = [];
    const walk = (n: OrgTreeNode) => { ids.push(n.person.id); n.children.forEach(walk); };
    f.forEach(walk);
    expect(ids.sort()).toEqual(['a', 'b', 'c']);
  });
});

describe('filterOrgTree / counts / initials', () => {
  it('keeps ancestors of matches', () => {
    const f = buildOrgTree([person('a', null), person('b', 'a', 'ai'), person('c', 'a', 'design')]);
    const out = filterOrgTree(f, (p) => p.group === 'ai');
    expect(out[0]!.person.id).toBe('a');
    expect(out[0]!.children.map((c) => c.person.id)).toEqual(['b']);
    expect(filterOrgTree(f, () => false)).toEqual([]);
  });
  it('counts by group and builds initials', () => {
    expect(countByGroup([person('a', null), person('b', null, 'ai')]).ai).toBe(1);
    expect(orgInitials('Sam Altman')).toBe('SA');
    expect(orgInitials('Madonna')).toBe('M');
    expect(orgInitials('  ')).toBe('?');
  });
});

describe('timeline helpers', () => {
  it('parses years from free-form dates', () => {
    expect(parseEventYear('2024 Mar')).toBe(2024);
    expect(parseEventYear('Q3 2021')).toBe(2021);
    expect(parseEventYear('soon')).toBeNull();
  });
  it('groups newest year first with undated last', () => {
    const g = groupByYear([{ date: '2020' }, { date: 'n/a' }, { date: '2024 Jan' }, { date: '2020 May' }]);
    expect(g.map((x) => x.label)).toEqual(['2024', '2020', 'Undated']);
    expect(g[1]!.items).toHaveLength(2);
  });
  it('classifies conservatively', () => {
    expect(classifyEvent('Series C', 'raised $50M')).toBe('funding');
    expect(classifyEvent('Launches Atlas')).toBe('product');
    expect(classifyEvent('Appoints new CFO')).toBe('leadership');
    expect(classifyEvent('Company founded')).toBe('corporate');
    expect(classifyEvent('Something happened')).toBe('other');
  });
});

describe('source and recency helpers', () => {
  it('groups by host and drops bad URLs', () => {
    const g = groupByHost([{ url: 'https://www.a.com/1' }, { url: 'https://a.com/2' }, { url: 'nope' }, { url: 'https://b.com' }]);
    expect(g.map((x) => x.host)).toEqual(['a.com', 'b.com']);
    expect(g[0]!.items).toHaveLength(2);
    expect(hostOf('x')).toBeNull();
  });
  it('buckets by reported date only', () => {
    const now = Date.parse('2026-10-10');
    expect(recencyBucket('2026-10-06', now)).toBe('week');
    expect(recencyBucket('2026-09-20', now)).toBe('month');
    expect(recencyBucket('2026-08-01', now)).toBe('quarter');
    expect(recencyBucket('2025-01-01', now)).toBe('older');
    expect(recencyBucket(null, now)).toBe('undated');
    expect(recencyBucket('garbage', now)).toBe('undated');
  });
  it('matches all terms case-insensitively', () => {
    expect(matchesQuery('Series C led by Acme', 'series acme')).toBe(true);
    expect(matchesQuery('Series C', 'acme')).toBe(false);
    expect(matchesQuery('anything', '')).toBe(true);
  });
});

describe('source strength', () => {
  it('reads strength from the class a citation carries and never guesses', () => {
    expect(sourceStrength('primary')).toBe('primary');
    expect(sourceStrength('reputable_secondary')).toBe('press');
    expect(sourceStrength('industry')).toBe('industry');
    expect(sourceStrength('user_generated')).toBe('community');
    expect(sourceStrength('unknown')).toBe('unrated');
    expect(sourceStrength(undefined)).toBe('unrated');
  });

  it('counts only the classes present, strongest first', () => {
    const items = ['press', 'primary', 'press', 'unrated'] as const;
    expect(strengthMix(items.map((strength) => ({ strength })))).toEqual([
      { strength: 'primary', count: 1 }, { strength: 'press', count: 2 }, { strength: 'unrated', count: 1 },
    ]);
  });
});
