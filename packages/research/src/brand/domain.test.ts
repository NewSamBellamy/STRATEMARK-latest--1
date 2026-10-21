import { describe, expect, it } from 'vitest';
import type { OriginalSourceReceipt } from '../original-source';
import { discoverOfficialDomain, homepageMentionsName, normalizeBrandName } from './domain';
import { faviconUrl } from '../logos';

const receipt = (url: string, text: string | null): OriginalSourceReceipt => ({
  requestedUrl: url, finalUrl: url, status: text ? 'retrieved' : 'failed',
  retrievedAt: new Date().toISOString(), httpStatus: text ? 200 : 404, text, truncated: false,
} as unknown as OriginalSourceReceipt);

const json = (body: unknown): Response => new Response(JSON.stringify(body), { status: 200 });

describe('faviconUrl', () => {
  it('always carries fallback_opts so the 16px placeholder is never served', () => {
    expect(faviconUrl('openai.com')).toContain('fallback_opts=TYPE,SIZE,URL');
    expect(faviconUrl(null)).toBeNull();
  });
});

describe('homepageMentionsName', () => {
  it('matches title / og:site_name and ignores legal suffixes', () => {
    expect(homepageMentionsName('<title>Safe Superintelligence Inc.</title>', 'Safe Superintelligence')).toBe(true);
    expect(homepageMentionsName('<meta property="og:site_name" content="Athletic Brewing Co.">', 'Athletic Brewing Company')).toBe(true);
    expect(homepageMentionsName('<title>Ineffable Corp</title>', 'Ineffable Intelligence')).toBe(false);
  });
  it('normalizes names', () => expect(normalizeBrandName('Foo Bar (Beta) Inc.')).toBe('foo bar'));
});

describe('discoverOfficialDomain', () => {
  const pages: Record<string, string> = {
    'https://modelbest.cn': '<html><head><title>ModelBest | Edge AI</title></head></html>',
    'https://wrong.com': '<html><head><title>Something Else</title></head></html>',
  };
  const read = async (url: string) => receipt(url, pages[url.replace(/\/$/, '')] ?? null);

  it('takes the DuckDuckGo official site when the heading matches the name', async () => {
    const fetchImpl = (async (u: string) =>
      String(u).includes('duckduckgo')
        ? json({ Heading: 'ModelBest', Results: [{ FirstURL: 'https://modelbest.cn' }] })
        : json({})) as unknown as typeof fetch;
    expect(await discoverOfficialDomain('ModelBest', read, { fetchImpl })).toEqual({ url: 'https://modelbest.cn', via: 'duckduckgo' });
  });

  it('rejects a clearbit hit whose homepage does not carry the name, and excluded hosts', async () => {
    const fetchImpl = (async (u: string) =>
      String(u).includes('clearbit') ? json([{ name: 'Ghia', domain: 'wrong.com' }]) : json({})) as unknown as typeof fetch;
    expect(await discoverOfficialDomain('Ghia', read, { fetchImpl })).toBeNull();
  });

  it('falls back to a verified slug when lookups are empty', async () => {
    const p: Record<string, string> = { 'https://ineffable.ai': '<title>Ineffable Intelligence</title>' };
    const fetchImpl = (async () => json({})) as unknown as typeof fetch;
    const r = await discoverOfficialDomain('Ineffable Intelligence', async (u) => receipt(u, p[u.replace(/\/$/, '')] ?? null), { fetchImpl });
    expect(r).toEqual({ url: 'https://ineffable.ai', via: 'slug' });
  });
});
