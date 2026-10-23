import { describe, expect, it } from 'vitest';
import {
  MAX_IMAGE_BYTES, PREVIEW_HIT_TTL_S, PREVIEW_MISS_TTL_S, PREVIEW_UA, SERVABLE_IMAGE_TYPE,
  imageRequestHeaders, pageRequestHeaders, previewCacheSeconds, readPrefix,
} from './image-fetch';

describe('preview image policy', () => {
  it('caches a miss for ten minutes and a hit for a week', () => {
    expect(previewCacheSeconds({ image: null })).toBe(PREVIEW_MISS_TTL_S);
    expect(PREVIEW_MISS_TTL_S).toBe(600);
    expect(previewCacheSeconds({ image: 'https://cdn.example.com/a.jpg' })).toBe(PREVIEW_HIT_TTL_S);
  });

  it('introduces itself as a browser that still names Stratemark', () => {
    expect(PREVIEW_UA).toMatch(/^Mozilla\/5\.0 .*Chrome\/.* Stratemark-Preview\/1\.0/);
    expect(pageRequestHeaders()['User-Agent']).toBe(PREVIEW_UA);
  });

  it('sends the page as Referer to the image host, else the image origin; never our app', () => {
    const img = new URL('https://cdn.example.com/a/b.jpg');
    expect(imageRequestHeaders(img, new URL('https://news.example.org/story?x=1')).Referer).toBe('https://news.example.org/story?x=1');
    expect(imageRequestHeaders(img, null).Referer).toBe('https://cdn.example.com/');
    expect(Object.keys(imageRequestHeaders(img, null)).map((k) => k.toLowerCase())).not.toContain('origin');
  });

  it('serves rasters only (no SVG) and allows a 4 MB hero', () => {
    expect(SERVABLE_IMAGE_TYPE.test('image/svg+xml')).toBe(false);
    expect(SERVABLE_IMAGE_TYPE.test('image/webp')).toBe(true);
    expect(MAX_IMAGE_BYTES).toBe(4 * 1024 * 1024);
  });

  it('readPrefix keeps the head of an over-long page instead of failing it', async () => {
    const chunk = new Uint8Array(1000).fill(65);
    const body = new ReadableStream<Uint8Array>({
      pull(controller) { controller.enqueue(chunk); },
    });
    const out = await readPrefix(new Response(body), 2500);
    expect(out.byteLength).toBe(2500);
    const short = await readPrefix(new Response('hello'), 2500);
    expect(new TextDecoder().decode(short)).toBe('hello');
  });
});
