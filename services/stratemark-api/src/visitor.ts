/**
 * Who a visitor is, for the daily limits: an IPv4 address, or the /64 an IPv6 address belongs to. A visitor on IPv6
 * holds a whole /64 (18 quintillion addresses) and can rotate within it at will, so counting single addresses would let
 * one machine spend as many visitors' limits as it likes. Red-team finding: 60 addresses in one /64 made 60 shares.
 */
export function visitorAddress(raw: string | null | undefined): string {
  const ip = (raw ?? '').trim().toLowerCase().split('%')[0] ?? '';
  if (!ip) return 'unknown';
  if (!ip.includes(':')) return ip;
  const mapped = /^(?:::ffff:|0:0:0:0:0:ffff:)(\d{1,3}(?:\.\d{1,3}){3})$/.exec(ip);
  if (mapped) return mapped[1]!;
  const halves = ip.split('::');
  if (halves.length > 2) return 'unknown';
  const head = halves[0] ? halves[0].split(':') : [];
  const tail = halves.length === 2 && halves[1] ? halves[1].split(':') : [];
  const gap = 8 - head.length - tail.length;
  if (halves.length === 2 ? gap < 1 : gap !== 0) return 'unknown';
  const groups = [...head, ...(halves.length === 2 ? Array<string>(gap).fill('0') : []), ...tail];
  if (groups.length !== 8 || groups.some((group) => !/^[0-9a-f]{1,4}$/.test(group))) return 'unknown';
  return `${groups.slice(0, 4).map((group) => group.replace(/^0+(?=.)/, '')).join(':')}::/64`;
}
