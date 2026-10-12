import { describe, expect, it, vi } from 'vitest';
import type { Company } from '@mi/contracts';
import { displayName, matchToSource, mergeLiveIntel, officialChannelUrl, parseChannelVideos, researchLiveIntel } from './live-intel';
import type { LlmClient } from './types';
import type { OriginalSourceReceipt } from './original-source';

const company = (over: Partial<Company> = {}): Company => ({
  id: 'cmp_a', name: 'Anthropic, PBC', oneLiner: '', logoUrl: null, hqLocation: null, websiteUrl: 'https://www.anthropic.com', ...over,
} as Company);

const page = (url: string, html: string): OriginalSourceReceipt => ({
  requestedUrl: url, finalUrl: url, status: 'retrieved', retrievedAt: '2026-10-11T00:00:00Z', httpStatus: 200, text: html, truncated: false,
});

const REDIRECT = 'https://vertexaisearch.cloud.google.com/grounding-api-redirect/abc';

describe('displayName', () => {
  it('drops legal forms and parentheticals', () => {
    expect(displayName('Anthropic, PBC')).toBe('Anthropic');
    expect(displayName('SpaceX (Space Exploration Technologies Corp.)')).toBe('SpaceX');
    expect(displayName('Mistral AI SAS')).toBe('Mistral AI');
  });
});

describe('matchToSource', () => {
  const resolved = new Map([[REDIRECT, { finalUrl: 'https://www.reuters.com/tech/anthropic-raises-2026', title: 'Anthropic raises $13 billion in new funding', image: 'https://img.reuters.com/a.jpg', site: 'Reuters' }]]);
  const citations = [{ title: 'reuters.com', url: REDIRECT }];

  it('maps a story to the real article the redirect led to', () => {
    const hit = matchToSource({ url: 'https://www.reuters.com/technology/anthropic-raises', title: 'Anthropic raises $13 billion' }, citations, resolved);
    expect(hit?.url).toBe('https://www.reuters.com/tech/anthropic-raises-2026');
    expect(hit?.page?.image).toBe('https://img.reuters.com/a.jpg');
  });

  it('keeps an exact echo of a returned link, resolved to its real address', () => {
    expect(matchToSource({ url: REDIRECT, title: 'x' }, citations, resolved)?.url).toBe('https://www.reuters.com/tech/anthropic-raises-2026');
  });

  it('drops a story whose publisher the search never returned', () => {
    expect(matchToSource({ url: 'https://www.madeup.com/story', title: 'Anthropic raises $13 billion' }, citations, resolved)).toBeNull();
  });

  it('drops a same-publisher story whose headline matches none of the returned pages', () => {
    const two = new Map<string, { finalUrl: string; title: string | null; image: string | null; site: string | null }>([...resolved, ['r2', { finalUrl: 'https://www.reuters.com/other', title: 'Oil prices fall again', image: null, site: 'Reuters' }]]);
    expect(matchToSource({ url: 'https://www.reuters.com/x', title: 'Completely different headline about chips' }, citations, two)).toBeNull();
  });
});

describe('videos', () => {
  it('finds the official channel on the homepage', () => {
    expect(officialChannelUrl('<a href="https://www.youtube.com/@anthropic-ai">YouTube</a>')).toBe('https://www.youtube.com/@anthropic-ai');
    expect(officialChannelUrl('<p>no channel</p>')).toBeNull();
  });

  it('parses channel videos and ignores unknown layouts', () => {
    const lockup = (id: string, title: string) => `"lockupViewModel":{"contentImage":{"x":"https://i.ytimg.com/vi/${id}/hq720.jpg"},"lockupMetadataViewModel":{"title":{"content":"${title}"},"metadata":{"contentMetadataViewModel":{"metadataRows":[{"metadataParts":[{"text":{"content":"158K"},"accessibilityLabel":"158 thousand views"},{"text":{"content":"2w ago"},"accessibilityLabel":"2 weeks ago"}]}]}}`;
    const html = `x${lockup('DdCEmlAydcw', 'Inside the lab \\u0026 more')}${lockup('ROF2Nv_KjOM', 'Second')}`;
    expect(parseChannelVideos(html, 'https://www.youtube.com/@a')).toEqual([
      { id: 'DdCEmlAydcw', title: 'Inside the lab & more', views: '158K', age: '2 weeks ago', channelUrl: 'https://www.youtube.com/@a' },
      { id: 'ROF2Nv_KjOM', title: 'Second', views: '158K', age: '2 weeks ago', channelUrl: 'https://www.youtube.com/@a' },
    ]);
    expect(parseChannelVideos('<html>nothing</html>', 'c')).toEqual([]);
  });
});

describe('mergeLiveIntel', () => {
  it('dedupes by link and headline and puts the newest first', () => {
    const base = { source: 'news' as const, summary: '', detail: null, sentiment: 'neutral' as const, publishedAt: '2026-10-11T00:00:00.000Z', stale: false };
    const out = mergeLiveIntel('c', [[
      { ...base, id: '', title: 'Old story', url: 'https://a.com/1', publishedDate: '2026-09-01' },
      { ...base, id: '', title: 'New story', url: 'https://b.com/2', publishedDate: '2026-10-10' },
    ], [
      { ...base, id: '', title: 'New story', url: 'https://c.com/3', publishedDate: '2026-10-10' },
      { ...base, id: '', title: 'Undated', url: 'https://a.com/1#x', publishedDate: null },
    ]]);
    expect(out.map((i) => i.title)).toEqual(['New story', 'Old story']);
    expect(out[0]!.id).toBe('c-intel-0');
  });
});

describe('researchLiveIntel', () => {
  it('combines feed stories (namesakes removed) with grounded stories on real addresses', async () => {
    const client: LlmClient = {
      ground: vi.fn().mockResolvedValue({ text: 'notes', citations: [{ title: 'reuters.com', url: REDIRECT }], queries: [] }),
      structure: vi.fn().mockImplementation(async (prompt: string) => prompt.startsWith('Label the sentiment')
        ? { labels: [{ i: 0, sentiment: 'positive' }] }
        : { items: [{ source: 'news', title: 'Anthropic raises $13 billion', url: 'https://www.reuters.com/x', summary: 's', detail: null, publishedDate: '2026-10-09', sentiment: 'positive' }] }),
    } as unknown as LlmClient;
    const newsSearch = vi.fn().mockResolvedValue([
      { url: 'https://www.cnbc.com/anthropic-ipo', title: 'Anthropic weighs IPO', snippet: 'The AI lab…', published: '2026-10-10', publisher: 'CNBC' },
      { url: 'https://www.cnbc.com/anthropology', title: 'Anthropology department news', snippet: 'Unrelated', published: '2026-10-10' },
    ]);
    const readPage = vi.fn(async (url: string) => {
      if (url === REDIRECT) return page('https://www.reuters.com/tech/anthropic-raises', '<meta property="og:title" content="Anthropic raises $13 billion"><meta property="og:image" content="https://img.reuters.com/a.jpg"><meta property="og:site_name" content="Reuters">');
      if (url === 'https://www.anthropic.com') return page(url, '<a href="https://www.youtube.com/@anthropic-ai">yt</a>');
      return { requestedUrl: url, status: 'unavailable', retrievedAt: '', reason: 'x' } as OriginalSourceReceipt;
    });
    const { content, citations } = await researchLiveIntel({ company: company(), context: 'Anthropic', client, newsSearch, readPage, now: () => new Date('2026-10-11T00:00:00Z') });
    expect(content.items.map((i) => [i.title, i.url, i.publisher, i.imageUrl])).toEqual([
      ['Anthropic weighs IPO', 'https://www.cnbc.com/anthropic-ipo', 'CNBC', null],
      ['Anthropic raises $13 billion', 'https://www.reuters.com/tech/anthropic-raises', 'Reuters', 'https://img.reuters.com/a.jpg'],
    ]);
    expect(content.items[0]!.sentiment).toBe('positive');
    expect(citations.some((c) => c.url.includes('vertexaisearch'))).toBe(false);
  });

  it('still returns feed stories when grounded search fails', async () => {
    const client = { ground: vi.fn().mockRejectedValue(new Error('quota')), structure: vi.fn().mockResolvedValue({ labels: [] }) } as unknown as LlmClient;
    const newsSearch = vi.fn().mockResolvedValue([{ url: 'https://x.com/a', title: 'Anthropic ships Claude', snippet: '' }]);
    const { content } = await researchLiveIntel({ company: company(), context: 'Anthropic', client, newsSearch });
    expect(content.items).toHaveLength(1);
  });

  it('reports an outage instead of an empty tab when no lane can run', async () => {
    const client = { ground: vi.fn().mockRejectedValue(new Error('quota')), structure: vi.fn() } as unknown as LlmClient;
    await expect(researchLiveIntel({ company: company(), context: 'Anthropic', client })).rejects.toThrow(/unavailable/);
  });
});
