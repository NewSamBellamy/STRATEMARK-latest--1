import { expect, it } from 'vitest';
import { formatCount, formatUsd } from './format';
it('does not round 4,500 employees to a misleading 5K snapshot', () => {
  expect(formatCount(4500)).toBe('4.5K');
  expect(formatCount(9000)).toBe('9K');
  expect(formatCount(620)).toBe('620');
  expect(formatCount(null)).toBe('Unknown');
});
it('steps up to B and T tiers instead of 1000.0M or $4690.0B', () => {
  expect(formatCount(1e9)).toBe('1.0B');
  expect(formatCount(2.5e9)).toBe('2.5B');
  expect(formatCount(450_000)).toBe('450K');
  expect(formatUsd(4.69e12)).toBe('$4.69T');
  expect(formatUsd(1e12)).toBe('$1.0T');
  expect(formatUsd(4.6e12)).toBe('$4.6T');
  expect(formatUsd(852e9)).toBe('$852.0B');
  expect(formatUsd(1e9)).toBe('$1.0B');
});
