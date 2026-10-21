import { describe, expect, it } from 'vitest';
import { eventDateIndex, newestFirst, sourceCoverage, storiesCaption } from './overviewTruth';

describe('sourceCoverage', () => {
  const fig = (url: string | null) => ({ citations: url ? [{ url, title: 't' }] : [] });
  it('counts distinct sites, not citations', () => {
    expect(sourceCoverage([fig('https://www.forbes.com/a'), fig('https://forbes.com/b')])).toBe('Backed by 1 source');
    expect(sourceCoverage([fig('https://forbes.com/a'), fig('https://reuters.com/b'), fig('https://sec.gov/c'), fig(null)])).toBe('Backed by 3 sources');
  });
  it('says nothing when no figure has a linked source', () => {
    expect(sourceCoverage([fig(null)])).toBeNull();
  });
});

describe('newestFirst', () => {
  it('orders mixed quarter, month and year dates newest first and keeps titles untouched', () => {
    const rows = [
      { date: 'Q1 2025', title: 'a' }, { date: 'Q2 2026', title: 'Sovereignty Warnings & Talks' },
      { date: 'Q4 2024', title: 'c' }, { date: 'March 2026', title: 'd' }, { date: 'Q2 2025', title: 'e' },
    ];
    expect(newestFirst(rows).map((r) => r.title)).toEqual(['Sovereignty Warnings & Talks', 'd', 'e', 'a', 'c']);
  });
  it('puts unreadable dates last in research order', () => {
    const rows = [{ date: 'Soon', title: 'x' }, { date: '2020', title: 'y' }, { date: 'Later', title: 'z' }];
    expect(newestFirst(rows).map((r) => r.title)).toEqual(['y', 'x', 'z']);
  });
  it('does not read a range as a date', () => {
    expect(eventDateIndex('2019-2021')).toBeNull();
  });
});

const story = (publishedDate: string | null, stale = false) => ({ publishedDate, stale });

describe('storiesCaption', () => {
  it('says dates are not reported when no story carries one', () => {
    expect(storiesCaption(Array.from({ length: 15 }, () => story(null)))).toBe('15 stories (dates not reported)');
  });
  it('says recent only when every story has a reported date', () => {
    expect(storiesCaption([story('2026-05-01'), story('2026-05-02')])).toBe('2 recent stories');
  });
  it('counts a mix honestly and ignores stale items', () => {
    expect(storiesCaption([story('2026-05-01'), story(null), story(null, true)])).toBe('2 stories (1 with a reported date)');
  });
  it('is null with nothing to count', () => {
    expect(storiesCaption([story(null, true)])).toBeNull();
  });
});
