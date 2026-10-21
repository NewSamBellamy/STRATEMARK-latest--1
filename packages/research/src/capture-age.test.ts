import { expect, it } from 'vitest';
import { isFreshCapture } from './capture-age';
import { isFreshPassage, MEMORY_MAX_AGE_DAYS } from './chat-route';

const NOW = new Date('2026-10-21T00:00:00Z');

it('treats missing, unreadable and far-future captures as not fresh', () => {
  for (const at of [null, undefined, '', 'not a date', '2027-01-01T00:00:00Z']) expect(isFreshCapture(at, NOW, 365)).toBe(false);
});

it('chat memory uses the same rule with its 14-day window', () => {
  expect(isFreshPassage({ capturedAt: '2026-10-10T00:00:00Z' }, NOW)).toBe(true);
  expect(isFreshPassage({ capturedAt: '2026-10-01T00:00:00Z' }, NOW)).toBe(false);
  expect(isFreshCapture('2026-10-10T00:00:00Z', NOW, MEMORY_MAX_AGE_DAYS)).toBe(true);
});
