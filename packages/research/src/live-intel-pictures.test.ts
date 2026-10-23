import { describe, expect, it, vi } from 'vitest';
import type { LiveIntelItem } from '@mi/contracts';
import { withPictures, worthReadingForPicture } from './live-intel';

const item = (i: number, url: string): LiveIntelItem => ({ id: `s${i}`, url, title: `Story ${i}`, summary: '', publishedDate: null, source: 'news', sentiment: 'neutral' } as unknown as LiveIntelItem);
const page = (html: string) => ({ status: 'retrieved', text: html, finalUrl: undefined }) as never;

describe('story pictures at research time', () => {
  it('does not waste page reads on social and forum hosts', () => {
    expect(worthReadingForPicture('https://www.reddit.com/r/x/comments/1')).toBe(false);
    expect(worthReadingForPicture('https://x.com/acme/status/1')).toBe(false);
    expect(worthReadingForPicture('https://www.linkedin.com/posts/acme')).toBe(false);
    expect(worthReadingForPicture('https://www.reuters.com/acme')).toBe(true);
    expect(worthReadingForPicture('not a url')).toBe(false);
  });

  it('saves a picture for every one of the first twenty stories, not just the first six, and skips social hosts', async () => {
    const items = Array.from({ length: 25 }, (_, i) => item(i, i === 3 ? 'https://www.reddit.com/r/x/1' : `https://news${i}.example.com/story`));
    const read = vi.fn(async (url: string) => page(`<meta property="og:image" content="https://cdn.example.com/${encodeURIComponent(new URL(url).hostname)}.jpg">`));
    const out = await withPictures(read as never, items, 20);
    expect(read).toHaveBeenCalledTimes(19);
    expect(out.filter((i) => i.imageUrl)).toHaveLength(19);
    expect(out[3]!.imageUrl).toBeUndefined();
    expect(out[10]!.imageUrl).toBe('https://cdn.example.com/news10.example.com.jpg');
    expect(out[22]!.imageUrl).toBeUndefined();
  });

  it('finds a picture from the page\'s structured data when it publishes no og image', async () => {
    const html = '<script type="application/ld+json">{"@type":"NewsArticle","image":"https://cdn.example.com/ld.jpg"}</script>';
    const out = await withPictures((async () => page(html)) as never, [item(0, 'https://news.example.com/a')], 5);
    expect(out[0]!.imageUrl).toBe('https://cdn.example.com/ld.jpg');
  });
});
