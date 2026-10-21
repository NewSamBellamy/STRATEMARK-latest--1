import { describe, expect, it } from 'vitest';
import { STALE_HOLD_MS, allowanceIdentity, reserveAllowance, settleAllowance } from './allowance';

const ALLOWANCE = 15_000_000;
const NOW = 1_800_000_000_000;
const idOf = (ip: string) => allowanceIdentity(new Request('https://w.example/', { headers: { 'cf-connecting-ip': ip } }));

describe('the lifetime allowance steps', () => {
  it('admits a call that lands exactly on the allowance and refuses one that passes it, counting what is held', () => {
    const first = reserveAllowance(undefined, 10_000_000, ALLOWANCE, NOW);
    expect(first).toEqual({ ok: true, record: { spent: 0, held: 10_000_000, at: NOW } });
    const settled = settleAllowance(first.ok ? first.record : undefined, 10_000_000, 9_000_000, NOW);
    expect(settled).toEqual({ spent: 9_000_000, held: 0, at: NOW });
    expect(reserveAllowance(settled, 6_000_000, ALLOWANCE, NOW).ok).toBe(true);
    const refused = reserveAllowance(settled, 6_000_001, ALLOWANCE, NOW);
    expect(refused).toEqual({ ok: false, record: settled, usedMicros: 9_000_000 });
  });

  it('counts a hold still in flight, so two concurrent calls cannot both pass', () => {
    const one = reserveAllowance(undefined, 8_000_000, ALLOWANCE, NOW);
    expect(one.ok).toBe(true);
    const two = reserveAllowance(one.ok ? one.record : undefined, 8_000_000, ALLOWANCE, NOW);
    expect(two).toMatchObject({ ok: false, usedMicros: 8_000_000 });
  });

  it('leaves no record when nothing was spent and nothing is held (a failed call takes no slot)', () => {
    const held = reserveAllowance(undefined, 5_000_000, ALLOWANCE, NOW);
    expect(settleAllowance(held.ok ? held.record : undefined, 5_000_000, 0, NOW)).toBeUndefined();
  });

  it('drops a hold that was never settled once it is stale, and not before', () => {
    const leaked = { spent: 2_000_000, held: 14_000_000, at: NOW };
    expect(reserveAllowance(leaked, 1_000_000, ALLOWANCE, NOW + STALE_HOLD_MS).ok).toBe(false);
    expect(reserveAllowance(leaked, 1_000_000, ALLOWANCE, NOW + STALE_HOLD_MS + 1)).toEqual({
      ok: true, record: { spent: 2_000_000, held: 1_000_000, at: NOW + STALE_HOLD_MS + 1 },
    });
  });
});

describe('who an allowance belongs to', () => {
  it('is one visitor for every address in an IPv6 /64, and another for a different /64 or an IPv4 address', async () => {
    const a = await idOf('2001:db8:abcd:12::1');
    expect(await idOf('2001:db8:abcd:12:ffff:1:2:3')).toBe(a);
    expect(await idOf('2001:db8:abcd:13::1')).not.toBe(a);
    expect(await idOf('203.0.113.9')).not.toBe(a);
  });

  it('is a hash, never the address', async () => {
    const id = await idOf('203.0.113.9');
    expect(id).toMatch(/^[0-9a-f]{32}$/);
    expect(id).not.toContain('203');
  });
});
