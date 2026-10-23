import { beforeEach, describe, expect, it } from 'vitest';
import {
  SHOT_MEMORY_TTL_MS, forgetShotProvider, recalledShotProvider, rememberShotProvider,
} from './siteShotMemory';

describe('siteShotMemory', () => {
  beforeEach(() => localStorage.clear());

  it('remembers the provider per site, ignoring www', () => {
    expect(recalledShotProvider('https://acme.com/a')).toBeNull();
    rememberShotProvider('https://www.acme.com/', 'alt');
    expect(recalledShotProvider('https://acme.com/pricing')).toBe('alt');
    expect(recalledShotProvider('https://other.com')).toBeNull();
  });

  it('expires after a week', () => {
    rememberShotProvider('https://acme.com', 'primary', 1_000);
    expect(recalledShotProvider('https://acme.com', 1_000 + SHOT_MEMORY_TTL_MS - 1)).toBe('primary');
    expect(recalledShotProvider('https://acme.com', 1_000 + SHOT_MEMORY_TTL_MS + 1)).toBeNull();
  });

  it('forgets, and survives corrupt storage', () => {
    rememberShotProvider('https://acme.com', 'alt');
    forgetShotProvider('https://acme.com');
    expect(recalledShotProvider('https://acme.com')).toBeNull();
    localStorage.setItem('mi.siteShot.v1', '{not json');
    expect(recalledShotProvider('https://acme.com')).toBeNull();
  });

  it('caps the number of remembered sites, dropping the oldest', () => {
    for (let i = 0; i < 90; i++) rememberShotProvider(`https://s${i}.com`, 'alt', i);
    expect(recalledShotProvider('https://s0.com', 100)).toBeNull();
    expect(recalledShotProvider('https://s89.com', 100)).toBe('alt');
  });
});
