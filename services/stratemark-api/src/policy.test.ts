import { describe, expect, it } from 'vitest';
import { allowedModel, allowedOrigin, isPrivateIpv4, safePublicUrl, takeDailyCap, type Counter } from './policy';

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
});

function memoryKv(): Counter & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return {
    data,
    get: async (k) => data.get(k) ?? null,
    put: async (k, v) => { data.set(k, v); },
  };
}

describe('daily caps', () => {
  const day = new Date('2026-10-10T12:00:00Z');
  it('counts each call against the deployment and the visitor', async () => {
    const kv = memoryKv();
    expect((await takeDailyCap(kv, '1.1.1.1', 5, 2, day)).ok).toBe(true);
    expect((await takeDailyCap(kv, '1.1.1.1', 5, 2, day)).ok).toBe(true);
    const third = await takeDailyCap(kv, '1.1.1.1', 5, 2, day);
    expect(third).toMatchObject({ ok: false, reason: 'visitor' });
    expect((await takeDailyCap(kv, '2.2.2.2', 5, 2, day)).ok).toBe(true);
  });
  it('stops everyone at the global cap and resets the next UTC day', async () => {
    const kv = memoryKv();
    for (let i = 0; i < 3; i++) await takeDailyCap(kv, `9.9.9.${i}`, 3, 10, day);
    expect(await takeDailyCap(kv, '8.8.8.8', 3, 10, day)).toMatchObject({ ok: false, reason: 'global' });
    expect((await takeDailyCap(kv, '8.8.8.8', 3, 10, new Date('2026-10-11T00:01:00Z'))).ok).toBe(true);
  });
});
