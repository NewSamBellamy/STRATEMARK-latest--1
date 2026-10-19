import { describe, expect, it } from 'vitest';
import { logoDomainOf, safeLogoUrl } from './logoSources';

describe('logoDomainOf', () => {
  it('keeps the host of an ordinary company site', () => {
    expect(logoDomainOf('https://www.sunrun.com')).toBe('sunrun.com');
    expect(logoDomainOf('sunrun.com')).toBe('sunrun.com');
    expect(logoDomainOf('shop.spacex.com')).toBe('shop.spacex.com');
    expect(logoDomainOf('  HTTP://WWW.Example-Co.IO/about?x=1#top ')).toBe('example-co.io');
    expect(logoDomainOf('bücher.de')).toBe('xn--bcher-kva.de');
  });

  it('uses only the host, so a path, query or fragment never reaches a request', () => {
    expect(logoDomainOf('acme.io/cgi-bin/reboot?x=1#y')).toBe('acme.io');
    expect(logoDomainOf('https://acme.io/a/b?leak=1')).toBe('acme.io');
  });

  it('refuses addresses on a private network and anything that is not a plain public host', () => {
    for (const value of [
      '192.168.1.1/cgi-bin/reboot?', '10.0.0.1', 'http://169.254.169.254/latest/meta-data/', '[::1]', 'https://[::1]:8443/',
      '127.1', '0x7f.0.0.1', '2130706433',
      'localhost', 'localhost:8080/admin?x=', 'printer.local', 'nas.lan', 'db.internal',
      'acme.io:8443', 'user:pw@acme.io', 'trusted.com@acme.io',
      'x.com&size=1&url=https://y.com', 'acme.io&size=1', 'acme.io%2f@evil.io', 'a b.com',
      'javascript:alert(1)', 'ftp://acme.io', 'data:text/html,x.com', 'https:\\\\acme.io',
      'acme', '', '   ', null, undefined,
    ]) {
      expect(logoDomainOf(value as string | null | undefined), String(value)).toBeNull();
    }
  });

  it('still treats reserved placeholder domains as having no site', () => {
    for (const value of ['example.com', 'www.example.org', 'sub.example.net', 'acme.example', 'acme.test', 'acme.invalid']) {
      expect(logoDomainOf(value), value).toBeNull();
    }
  });
});

describe('safeLogoUrl', () => {
  it('accepts https on a public host and drops the fragment', () => {
    expect(safeLogoUrl('https://commons.wikimedia.org/wiki/Special:FilePath/Meta_Platforms_Inc._logo_(cropped).svg'))
      .toBe('https://commons.wikimedia.org/wiki/Special:FilePath/Meta_Platforms_Inc._logo_(cropped).svg');
    expect(safeLogoUrl('https://acme.io/logo.png?v=2#x')).toBe('https://acme.io/logo.png?v=2');
  });

  it('accepts an image embedded in the value, which makes no request', () => {
    expect(safeLogoUrl('data:image/svg+xml,%3Csvg%3E%3C/svg%3E')).toBe('data:image/svg+xml,%3Csvg%3E%3C/svg%3E');
    expect(safeLogoUrl('data:image/png;base64,iVBORw0KGgo=')).toContain('data:image/png;base64,');
  });

  it('refuses plain http, other schemes, private hosts, ports and credentials', () => {
    for (const value of [
      'http://acme.io/logo.png', 'http://169.254.169.254/latest/meta-data/', 'https://169.254.169.254/x', 'https://192.168.1.1/logo.png',
      'https://localhost/logo.png', 'https://acme.io:8443/logo.png', 'https://user:pw@acme.io/logo.png', 'https://acme.com@evil.io/logo.png',
      '//acme.io/logo.png', 'acme.io/logo.png', 'javascript:alert(1)', 'data:text/html,<script>alert(1)</script>', 'file:///etc/passwd',
      'blob:https://acme.io/x', '', null, undefined,
    ]) {
      expect(safeLogoUrl(value as string | null | undefined), String(value)).toBeNull();
    }
  });
});
