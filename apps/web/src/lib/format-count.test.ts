import { expect, it } from 'vitest';
import { formatCount } from './format';
it('does not round 4,500 employees to a misleading 5K snapshot', () => {
  expect(formatCount(4500)).toBe('4.5K');
  expect(formatCount(9000)).toBe('9K');
  expect(formatCount(620)).toBe('620');
  expect(formatCount(null)).toBe('Unknown');
});
