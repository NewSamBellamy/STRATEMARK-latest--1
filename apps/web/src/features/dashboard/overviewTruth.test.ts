import { describe, expect, it } from 'vitest';
import { storiesCaption } from './overviewTruth';

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
