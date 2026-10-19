import { describe, expect, it } from 'vitest';
import { safeHttpUrl } from './sourceHref';

describe('safeHttpUrl', () => {
  it('returns the normalised href for http(s) URLs with a real host', () => {
    expect(safeHttpUrl('https://www.sec.gov/Archives/x.htm')).toBe('https://www.sec.gov/Archives/x.htm');
    expect(safeHttpUrl('  http://example.com  ')).toBe('http://example.com/');
    expect(safeHttpUrl('HTTPS://Example.COM/a?b=1#c')).toBe('https://example.com/a?b=1#c');
  });

  it('refuses every scheme that runs or loads something else', () => {
    for (const value of [
      'javascript:alert(1)', 'JaVaScRiPt:alert(1)', ' javascript:alert(1)', 'java\tscript:alert(1)',
      'data:text/html,<script>alert(1)</script>', 'vbscript:msgbox(1)', 'file:///etc/passwd', 'blob:https://a.example/x',
      'mailto:a@b.example', 'ftp://files.example/x',
    ]) {
      expect(safeHttpUrl(value), value).toBeUndefined();
    }
  });

  it('refuses protocol-relative, relative and host-less values', () => {
    for (const value of ['//evil.example/phish', '/\\evil.example/x', '/#/settings', 'evil.example/x', '#top', 'https://', 'http:///', '']) {
      expect(safeHttpUrl(value), value).toBeUndefined();
    }
  });

  it('refuses a URL that hides its real host behind credentials', () => {
    expect(safeHttpUrl('https://sec.gov@evil.example/x')).toBeUndefined();
    expect(safeHttpUrl('https://user:pw@example.com/')).toBeUndefined();
  });

  it('treats missing and non-string values as no link', () => {
    expect(safeHttpUrl(undefined)).toBeUndefined();
    expect(safeHttpUrl(null)).toBeUndefined();
    expect(safeHttpUrl(5 as unknown as string)).toBeUndefined();
  });
});
