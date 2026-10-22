import { describe, expect, it } from 'vitest';
import type { OrgNode } from '@mi/contracts';
import { cardBio, glanceFacts } from './personFacts';

const person = (over: Partial<OrgNode> = {}): OrgNode => ({
  id: 'p', name: 'Ada Lovelace', role: 'CEO', group: 'exec', parentId: null, bio: '', ...over,
});

describe('cardBio', () => {
  it('drops the search provenance prefix and wrapping quotes', () => {
    expect(cardBio('Google Search reports (original page not retrieved): "Ran the lab."')).toBe('Ran the lab.');
    expect(cardBio('Plain sourced line.')).toBe('Plain sourced line.');
  });

  it('is null for an empty or written-out gap', () => {
    expect(cardBio('')).toBeNull();
    expect(cardBio(null)).toBeNull();
    expect(cardBio('Not reported')).toBeNull();
  });
});

describe('glanceFacts', () => {
  it('is empty for a person known only by name and role', () => {
    expect(glanceFacts(person())).toEqual([]);
  });

  it('lists only filled fields, in reading order, footnoted to the person source', () => {
    const facts = glanceFacts(person({ tenure: '2019 to now', priorCompany: 'Not reported', notableProject: 'Engine' }), 'Grace Hopper');
    expect(facts.map((f) => [f.key, f.label, f.value, f.footnote])).toEqual([
      ['reportsTo', 'Reports to', 'Grace Hopper', null],
      ['tenure', 'Tenure', '2019 to now', 1],
      ['project', 'Known for', 'Engine', 1],
    ]);
  });

  it('adds a sourced move, footnoted to its own source when that differs', () => {
    const move = { kind: 'joined' as const, date: '2026-03', sourceUrl: 'https://news.example/move' };
    expect(glanceFacts(person({ sourceUrl: 'https://a.example', move })).at(-1)).toMatchObject({ key: 'move', footnote: 2 });
    expect(glanceFacts(person({ sourceUrl: 'https://news.example/move', move })).at(-1)).toMatchObject({ key: 'move', footnote: 1 });
    expect(glanceFacts(person({ move: { ...move, sourceUrl: '' } }))).toEqual([]);
  });
});
