import { afterEach, describe, expect, it, vi } from 'vitest';
import { AMBIENT_REST_MS, batchRestKey, huntRestKey, isResting, startRest } from './ambientRest';

afterEach(() => { localStorage.clear(); vi.restoreAllMocks(); });

const T0 = Date.UTC(2026, 9, 18, 12, 0, 0);

describe('rest for automatic paid searches', () => {
  it('a company that was just searched rests, and a company never searched does not', () => {
    startRest(huntRestKey('acme'), T0);
    expect(isResting(huntRestKey('acme'), T0 + 60_000)).toBe(true);
    expect(isResting(huntRestKey('gamma'), T0 + 60_000)).toBe(false);
    expect(isResting(batchRestKey('acme'), T0 + 60_000)).toBe(false);
  });

  it('survives a reload: a new read of the same browser storage still finds it', () => {
    startRest(huntRestKey('acme'), T0);
    vi.resetModules();
    return import('./ambientRest').then((fresh) => expect(fresh.isResting(huntRestKey('acme'), T0 + 3_600_000)).toBe(true));
  });

  it('ends after the rest period, and no sooner', () => {
    startRest(batchRestKey('deck'), T0);
    expect(isResting(batchRestKey('deck'), T0 + AMBIENT_REST_MS - 1)).toBe(true);
    expect(isResting(batchRestKey('deck'), T0 + AMBIENT_REST_MS)).toBe(false);
  });

  it('starting a rest again moves it forward, and runs-out entries are forgotten', () => {
    startRest(huntRestKey('old'), T0);
    const later = T0 + AMBIENT_REST_MS + 1;
    startRest(huntRestKey('new'), later);
    expect(JSON.parse(localStorage.getItem('mi.ambientRest')!)).toEqual({ [huntRestKey('new')]: later });
    startRest(huntRestKey('new'), later + 1_000);
    expect(isResting(huntRestKey('new'), later + 2_000)).toBe(true);
  });

  it('a start time far in the future (a wrong clock) is not a rest', () => {
    startRest(huntRestKey('acme'), T0 + 30 * 86_400_000);
    expect(isResting(huntRestKey('acme'), T0)).toBe(false);
  });

  it('ignores a damaged ledger and never throws without storage', () => {
    localStorage.setItem('mi.ambientRest', '{not json');
    expect(isResting(huntRestKey('acme'), T0)).toBe(false);
    localStorage.setItem('mi.ambientRest', JSON.stringify({ [huntRestKey('acme')]: 'yesterday', [huntRestKey('b')]: T0 }));
    expect(isResting(huntRestKey('acme'), T0)).toBe(false);
    expect(isResting(huntRestKey('b'), T0)).toBe(true);
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('blocked'); });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('blocked'); });
    expect(() => startRest(huntRestKey('acme'), T0)).not.toThrow();
    expect(isResting(huntRestKey('acme'), T0)).toBe(false);
  });

  it('keeps the newest entries when the ledger is full', () => {
    for (let i = 0; i < 650; i += 1) startRest(huntRestKey(`c${i}`), T0 + i);
    const stored = JSON.parse(localStorage.getItem('mi.ambientRest')!) as Record<string, number>;
    expect(Object.keys(stored)).toHaveLength(600);
    expect(stored[huntRestKey('c649')]).toBeDefined();
    expect(stored[huntRestKey('c0')]).toBeUndefined();
  });
});
