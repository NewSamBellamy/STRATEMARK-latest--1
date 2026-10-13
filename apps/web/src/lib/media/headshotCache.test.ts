import { afterEach, describe, expect, it, vi } from 'vitest';
import { loadPersisted, savePersisted } from './headshotCache';

const stored = () => JSON.parse(localStorage.getItem('sm.headshots.v1') ?? '{}') as Record<string, unknown>;

describe('persisted headshot cache', () => {
  afterEach(() => {
    vi.useRealTimers();
    localStorage.clear();
  });

  it('round-trips hits and remembered misses', () => {
    savePersisted('Ada::Acme', { thumb: 't', sourceUrl: 's' });
    savePersisted('Bob::Acme', null);
    expect(loadPersisted('Ada::Acme')).toEqual({ hit: true, value: { thumb: 't', sourceUrl: 's' } });
    expect(loadPersisted('Bob::Acme')).toEqual({ hit: true, value: null });
  });

  it('drops expired entries on write instead of keeping them forever', () => {
    vi.useFakeTimers();
    savePersisted('old::Acme', null);
    vi.advanceTimersByTime(15 * 86_400_000);
    savePersisted('new::Acme', null);
    expect(Object.keys(stored())).toEqual(['new::Acme']);
  });

  it('caps the number of stored entries, newest first', () => {
    vi.useFakeTimers();
    for (let i = 0; i < 505; i++) {
      savePersisted(`p${i}::Acme`, null);
      vi.advanceTimersByTime(1);
    }
    const keys = Object.keys(stored());
    expect(keys).toHaveLength(500);
    expect(keys).toContain('p504::Acme');
    expect(keys).not.toContain('p0::Acme');
  });
});
