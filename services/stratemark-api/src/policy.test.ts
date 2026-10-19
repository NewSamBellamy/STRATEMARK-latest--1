import { describe, expect, it } from 'vitest';
import {
  MAX_LEDGER_VISITORS, allowedModel, allowedOrigin, callCostMicros, isPrivateIpv4, parseBudgetUsd, priceFamily, reserveMicros, rollHistory, safePublicUrl, settle, tryReserve,
  type LedgerDay,
} from './policy';

const LIST = 'https://getstratemark.com,https://*.getstratemark.com,https://stratemark.pages.dev';

describe('origin allowlist', () => {
  it('accepts listed origins and subdomains of a wildcard entry', () => {
    expect(allowedOrigin('https://getstratemark.com', LIST, false)).toBe(true);
    expect(allowedOrigin('https://app.getstratemark.com', LIST, false)).toBe(true);
    expect(allowedOrigin('https://stratemark.pages.dev', LIST, false)).toBe(true);
  });
  it('refuses lookalikes, other pages.dev sites, http and missing origins', () => {
    expect(allowedOrigin('https://getstratemark.com.evil.io', LIST, false)).toBe(false);
    expect(allowedOrigin('https://evilgetstratemark.com', LIST, false)).toBe(false);
    expect(allowedOrigin('https://someone-else.pages.dev', LIST, false)).toBe(false);
    expect(allowedOrigin('http://getstratemark.com', LIST, false)).toBe(false);
    expect(allowedOrigin(null, LIST, false)).toBe(false);
  });
  it('allows localhost only when switched on', () => {
    expect(allowedOrigin('http://localhost:5173', LIST, false)).toBe(false);
    expect(allowedOrigin('http://localhost:5173', LIST, true)).toBe(true);
  });
});

describe('model allowlist', () => {
  it('allows Gemini model ids only', () => {
    expect(allowedModel('gemini-flash-lite-latest')).toBe(true);
    expect(allowedModel('gemini-2.5-pro')).toBe(true);
    expect(allowedModel('imagen-4')).toBe(false);
    expect(allowedModel('gemini-x/../../keys')).toBe(false);
    expect(allowedModel('gemini-3.1-flash-lite-image')).toBe(false);
    expect(allowedModel('gemini-2.5-flash-preview-tts')).toBe(false);
  });
});

describe('page URL guard', () => {
  it('allows public https pages', () => {
    expect(safePublicUrl('https://www.example.com/about#team')?.href).toBe('https://www.example.com/about');
  });
  it('blocks credentials, ports, IP literals, internal names and non-https', () => {
    for (const bad of [
      'http://example.com', 'https://user:pw@example.com', 'https://example.com:8443/',
      'https://127.0.0.1/', 'https://10.0.0.5/', 'https://[::1]/', 'https://localhost/',
      'https://printer.local/', 'https://intranet/', 'ftp://example.com', 42,
    ]) expect(safePublicUrl(bad)).toBeNull();
  });
  it('flags private and reserved IPv4 ranges', () => {
    for (const ip of ['10.1.2.3', '127.0.0.1', '169.254.169.254', '172.20.0.1', '192.168.1.1', '100.64.0.1', '0.0.0.0', '224.0.0.1', 'nonsense']) {
      expect(isPrivateIpv4(ip)).toBe(true);
    }
    expect(isPrivateIpv4('104.16.132.229')).toBe(false);
  });
  it('flags the documentation ranges too, which are not on the public internet', () => {
    for (const ip of ['192.0.2.1', '192.0.0.8', '198.51.100.7', '203.0.113.200']) expect(isPrivateIpv4(ip), ip).toBe(true);
    for (const ip of ['192.0.3.1', '198.51.101.7', '203.0.114.1', '8.8.8.8']) expect(isPrivateIpv4(ip), ip).toBe(false);
  });
});

describe('dollar budget', () => {
  it('prices calls by family at the most expensive current rate, unknown models as Pro', () => {
    expect(priceFamily('gemini-flash-lite-latest')).toBe('lite');
    expect(priceFamily('gemini-3.8-flash')).toBe('flash');
    expect(priceFamily('gemini-3.1-pro-preview')).toBe('pro');
    expect(priceFamily('gemini-experimental-x')).toBe('pro');
    // 1M input + 1M output on Flash-Lite = $0.30 + $2.50, in micro-dollars.
    expect(callCostMicros('gemini-flash-lite-latest', { promptTokenCount: 1_000_000, candidatesTokenCount: 1_000_000 }, false, 0)).toBe(2_800_000);
  });
  it('counts thinking as output and charges search grounding at the higher of the two schemes', () => {
    const thinking = callCostMicros('gemini-flash-lite-latest', { candidatesTokenCount: 0, thoughtsTokenCount: 1_000_000 }, false, 0);
    expect(thinking).toBe(2_500_000);
    expect(callCostMicros('gemini-flash-lite-latest', {}, true, 0)).toBe(35_000); // $0.035 per grounded prompt
    expect(callCostMicros('gemini-flash-lite-latest', {}, true, 5)).toBe(70_000); // 5 queries x $0.014
  });
  it('reserves more than any single realistic call costs', () => {
    const held = reserveMicros('gemini-flash-lite-latest', true, 20_000);
    expect(held).toBeGreaterThan(callCostMicros('gemini-flash-lite-latest', { promptTokenCount: 26_000, candidatesTokenCount: 16_000 }, true, 6));
  });
  it('stops at the global budget, including money already held by in-flight calls', () => {
    const day = '2026-10-10';
    let l = { day, spentMicros: 0, heldMicros: 0, visitors: {} } as LedgerDay;
    const a = tryReserve(l, day, 'a', 60, 100, 1000); expect(a.ok).toBe(true); l = a.ledger;
    const b = tryReserve(l, day, 'b', 50, 100, 1000); expect(b).toMatchObject({ ok: false, reason: 'global' });
    l = settle(l, day, 'a', 60, 10); // the call cost less than held
    expect(l).toMatchObject({ spentMicros: 10, heldMicros: 0 });
    expect(tryReserve(l, day, 'b', 50, 100, 1000).ok).toBe(true);
  });
  it('limits each visitor to their share and resets at UTC midnight', () => {
    const day = '2026-10-10';
    let l = { day, spentMicros: 0, heldMicros: 0, visitors: {} } as LedgerDay;
    l = settle(tryReserve(l, day, 'x', 40, 1000, 50).ledger, day, 'x', 40, 40);
    expect(tryReserve(l, day, 'x', 20, 1000, 50)).toMatchObject({ ok: false, reason: 'visitor' });
    expect(tryReserve(l, day, 'y', 20, 1000, 50).ok).toBe(true);
    expect(tryReserve(l, '2026-10-11', 'x', 20, 1000, 50).ok).toBe(true);
  });
});

describe('the hold covers what a call can cost', () => {
  it('grows with the prompt and with the answer a request may ask for, and covers a worst-case call', () => {
    const small = reserveMicros('gemini-flash-lite-latest', false, 1_000, 1_000);
    expect(reserveMicros('gemini-flash-lite-latest', false, 100_000, 1_000)).toBeGreaterThan(small);
    expect(reserveMicros('gemini-flash-lite-latest', false, 1_000, 49_152)).toBeGreaterThan(small);
    // A grounded flash call with a long prompt, the longest answer and full thinking, searching ten times.
    const worst = callCostMicros('gemini-flash-latest', { promptTokenCount: 130_000, candidatesTokenCount: 32_768, thoughtsTokenCount: 16_384 }, true, 12);
    expect(reserveMicros('gemini-flash-latest', true, 140_000, 32_768 + 16_384)).toBeGreaterThan(worst);
  });
});

describe('a budget from configuration', () => {
  it('reads zero as zero (the kill switch), and anything unreadable as the default', () => {
    expect(parseBudgetUsd('0', 100)).toBe(0);
    expect(parseBudgetUsd('0.0', 100)).toBe(0);
    expect(parseBudgetUsd('25', 100)).toBe(25);
    expect(parseBudgetUsd(' 7.5 ', 100)).toBe(7.5);
    for (const bad of [undefined, '', '   ', 'abc', '-5', 'NaN', 'Infinity']) expect(parseBudgetUsd(bad, 100), String(bad)).toBe(100);
  });
});

describe('the ledger across UTC midnight and under a flood of visitors', () => {
  it('a call that straddles midnight adds its cost to the new day and wipes nothing', () => {
    const yesterday = '2026-10-18';
    const today = '2026-10-19';
    let l = { day: today, spentMicros: 90_000_000, heldMicros: 5_000_000, visitors: { a: 60_000_000, b: 30_000_000, c: 5_000_000 } } as LedgerDay;
    // The call was held on the day that ended, so there is no hold to release on today's ledger.
    l = settle(l, yesterday, 'z', 7_000_000, 2_000_000);
    expect(l).toMatchObject({ day: today, spentMicros: 92_000_000, heldMicros: 5_000_000 });
    expect(l.visitors).toEqual({ a: 60_000_000, b: 30_000_000, c: 5_000_000, z: 2_000_000 });
    // The day's budget is still spent: another $100 cannot be reserved.
    expect(tryReserve(l, today, 'new', 10_000_000, 100_000_000, 20_000_000)).toMatchObject({ ok: false, reason: 'global' });
  });

  it('stops tracking new visitors past a ceiling instead of growing without bound, and keeps serving the ones it knows', () => {
    const day = '2026-10-10';
    const visitors = Object.fromEntries(Array.from({ length: MAX_LEDGER_VISITORS }, (_unused, i) => [`v${i}`, 1]));
    const l = { day, spentMicros: 0, heldMicros: 0, visitors } as LedgerDay;
    expect(tryReserve(l, day, 'a-new-one', 10, 1_000_000, 1_000_000)).toMatchObject({ ok: false, reason: 'global' });
    expect(tryReserve(l, day, 'v7', 10, 1_000_000, 1_000_000).ok).toBe(true);
  });
});

describe('spend history', () => {
  it('keeps one line per finished day, newest first, without visitor addresses', () => {
    const day1 = { day: '2026-10-09', spentMicros: 12_340_000, heldMicros: 0, visitors: { '1.1.1.1': 5, '2.2.2.2': 7 } } as LedgerDay;
    const day2 = { day: '2026-10-10', spentMicros: 99_990_000, heldMicros: 0, visitors: { '3.3.3.3': 1 } } as LedgerDay;
    const h = rollHistory(rollHistory([], day1), day2);
    expect(h).toEqual([
      { day: '2026-10-10', spentUsd: 99.99, visitors: 1 },
      { day: '2026-10-09', spentUsd: 12.34, visitors: 2 },
    ]);
    expect(JSON.stringify(h)).not.toContain('1.1.1.1');
  });
});
