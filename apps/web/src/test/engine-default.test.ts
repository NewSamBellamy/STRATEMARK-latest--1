import { describe, expect, it } from 'vitest';
import { resolveEngine } from '@/lib/settings/engine';

describe('resolveEngine', () => {
  it('defaults to local with nothing stored', () => {
    expect(resolveEngine(null, true)).toBe('local');
    expect(resolveEngine(null, false)).toBe('local');
  });
  it('falls back to local when cloud is stored but Sentinel is not configured', () => {
    expect(resolveEngine('cloud', false)).toBe('local');
  });
  it('keeps cloud when configured', () => {
    expect(resolveEngine('cloud', true)).toBe('cloud');
  });
  it('ignores garbage', () => {
    expect(resolveEngine('bogus', true)).toBe('local');
  });
});
