import { describe, expect, it } from 'vitest';
import { normalizeEventDate } from './event-date';
import { historyContentSchema } from './schemas';

describe('normalizeEventDate', () => {
  it.each([
    // The forms Tennant, Instacart and the rest actually came back with:
    ['2019 (September)', 'September 2019'],
    ['2026 Mar', 'March 2026'],
    ['2026 Sept', 'September 2026'],
    ['2024 (September 25)', 'September 25, 2024'],
    ['2026 (April 29)', 'April 29, 2026'],
    ['April 2017', 'April 2017'],
    ['2019 (Q3)', 'Q3 2019'],
    ['2023 Q4', 'Q4 2023'],
    ['Q1 2025', 'Q1 2025'],
    ['2026 (Early)', 'Early 2026'],
    ['2024 Early', 'Early 2024'],
    ['Early 2003', 'Early 2003'],
    ['Mid-2024', 'Mid 2024'],
    ['Mid–2018', 'Mid 2018'],
    ['2024 (Mid-Year)', 'Mid 2024'],
    ['2022 Late', 'Late 2022'],
    ['2021 (Fall)', 'Fall 2021'],
    ['2020 (spring)', 'Spring 2020'],
    ['2025 (Full-Year)', '2025'],
    ['2026 (Current Year)', '2026'],
    ['2018', '2018'],
    ['  1909 ', '1909'],
    ['2026 (May – September)', 'May – September 2026'],
  ])('%s -> %s', (raw, expected) => expect(normalizeEventDate(raw)).toBe(expected));

  it.each([
    'Late 2022 / Early 2023', // two years: a span, not one date
    '2019-2021',
    '2026-04-29',
    'c. 1932',
    '2020 (Spring/Summer)',
    'Founding',
    'FY 2024', // a fiscal year is not a calendar year: never reduce it to "2024"
    '2024 (FY)',
    '',
    '2019-21',
  ])('leaves "%s" exactly as written: it never guesses', (raw) => expect(normalizeEventDate(raw)).toBe(raw.trim()));

  it('is idempotent', () => {
    for (const raw of ['2019 (September)', '2024 (Mid-Year)', '2026 (April 29)', '2025 (Full-Year)', 'Q3 2019']) {
      const once = normalizeEventDate(raw);
      expect(normalizeEventDate(once)).toBe(once);
    }
  });
});

describe('history content', () => {
  it('stores timeline dates in the one written form', () => {
    const parsed = historyContentSchema.parse({ founderStory: 's', timeline: [
      { date: '2024 (Mid-Year)', title: 'X4 ROVR Launch', detail: '' }, { date: '2026 (Current Year)', title: 'Rollout', detail: '' }], quotes: [] });
    expect(parsed.timeline.map((event) => event.date)).toEqual(['Mid 2024', '2026']);
  });
});
