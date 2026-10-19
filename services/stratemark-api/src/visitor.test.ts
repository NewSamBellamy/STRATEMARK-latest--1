import { describe, expect, it } from 'vitest';
import { visitorAddress } from './visitor';

describe('who counts as one visitor', () => {
  it('keeps an IPv4 address as it is', () => {
    expect(visitorAddress('203.0.113.7')).toBe('203.0.113.7');
    expect(visitorAddress('  203.0.113.7 ')).toBe('203.0.113.7');
  });

  it('counts every address in one IPv6 /64 as the same visitor, however it is written', () => {
    const same = [
      '2001:db8:abcd:12:1:2:3:4', '2001:db8:abcd:12:ffff:ffff:ffff:ffff', '2001:DB8:ABCD:12::1', '2001:0db8:abcd:0012:0000:0000:0000:0001',
      '2001:db8:abcd:12::', '2001:db8:abcd:12:a:b:c:d%eth0',
    ].map(visitorAddress);
    expect(new Set(same).size).toBe(1);
    expect(same[0]).toBe('2001:db8:abcd:12::/64');
  });

  it('keeps different /64s apart, and different networks apart', () => {
    expect(visitorAddress('2001:db8:abcd:12::1')).not.toBe(visitorAddress('2001:db8:abcd:13::1'));
    expect(visitorAddress('2001:db8:abcd:12::1')).not.toBe(visitorAddress('2001:db8:abce:12::1'));
  });

  it('expands :: wherever it sits', () => {
    expect(visitorAddress('::1')).toBe('0:0:0:0::/64');
    expect(visitorAddress('fe80::1')).toBe('fe80:0:0:0::/64');
    expect(visitorAddress('2001:db8::')).toBe('2001:db8:0:0::/64');
    expect(visitorAddress('1:2:3:4:5:6:7::')).toBe('1:2:3:4::/64');
  });

  it('reads an IPv4-mapped IPv6 address as the IPv4 one', () => {
    expect(visitorAddress('::ffff:203.0.113.7')).toBe('203.0.113.7');
  });

  it('puts anything unreadable in one shared bucket instead of throwing', () => {
    for (const bad of [null, undefined, '', '   ', '1::2::3', 'zzzz::1', '1:2:3:4:5:6:7:8:9', '1:2:3', '12345::1']) expect(visitorAddress(bad)).toBe('unknown');
  });
});
