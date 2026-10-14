import { describe, expect, it } from 'vitest';
import { STORED_DECK_WARMUP_KEY, storedDeckWarmupEnabled } from './RepositoryProvider';

const storage = (value: string | null) => ({ getItem: (key: string) => (key === STORED_DECK_WARMUP_KEY ? value : null) });

describe('storedDeckWarmupEnabled', () => {
  it('is off by default: stored decks are not backfilled without explicit approval', () => {
    expect(storedDeckWarmupEnabled(storage(null))).toBe(false);
    expect(storedDeckWarmupEnabled(storage('true'))).toBe(false);
    expect(storedDeckWarmupEnabled(null)).toBe(false);
    expect(storedDeckWarmupEnabled({ getItem: () => { throw new Error('blocked'); } })).toBe(false);
  });

  it('is on only when the flag is set to "on"', () => {
    expect(storedDeckWarmupEnabled(storage('on'))).toBe(true);
  });
});
