import { describe, expect, it } from 'vitest';
import { previewDetailFromHtml } from './page-preview';

const PAGE = 'https://news.example.com/story/1';
const ld = (json: unknown) => `<script type="application/ld+json">${JSON.stringify(json)}</script>`;

describe('previewDetailFromHtml', () => {
  it('prefers the og image', () => {
    const d = previewDetailFromHtml(`<meta property="og:image" content="https://cdn.example.com/og.jpg">${ld({ image: 'https://cdn.example.com/ld.jpg' })}`, PAGE);
    expect(d).toMatchObject({ image: 'https://cdn.example.com/og.jpg', imageKind: 'og' });
  });

  it('falls back to JSON-LD: a string, an object and an array', () => {
    for (const image of [
      'https://cdn.example.com/a.jpg',
      { '@type': 'ImageObject', url: 'https://cdn.example.com/a.jpg' },
      ['https://cdn.example.com/a.jpg', 'https://cdn.example.com/b.jpg'],
    ]) {
      const d = previewDetailFromHtml(ld({ '@type': 'NewsArticle', image }), PAGE);
      expect(d.imageKind, JSON.stringify(image)).toBe('jsonld');
      expect(d.image).toBe('https://cdn.example.com/a.jpg');
    }
  });

  it('looks inside @graph and resolves a relative thumbnail against the page', () => {
    const d = previewDetailFromHtml(ld({ '@graph': [{ '@type': 'WebSite' }, { '@type': 'Article', thumbnailUrl: '/a.jpg' }] }), PAGE);
    expect(d).toMatchObject({ image: 'https://news.example.com/a.jpg', imageKind: 'jsonld' });
  });

  it('survives malformed JSON-LD', () => {
    expect(previewDetailFromHtml('<script type="application/ld+json">{oops</script>', PAGE).image).toBeNull();
  });

  it('falls back to the first large content image and skips icons, sprites, tiny and tracking images', () => {
    const html = `<body>
      <img src="/img/logo.png" width="600" height="300">
      <img src="https://cdn.example.com/pixel.gif">
      <img src="https://cdn.example.com/small.jpg" width="40" height="40">
      <img src="data:image/png;base64,AAAA">
      <img src="/photos/hero.jpg" width="1200" height="630">
      <img src="https://cdn.example.com/later.jpg" width="900" height="500"></body>`;
    expect(previewDetailFromHtml(html, PAGE)).toMatchObject({ image: 'https://news.example.com/photos/hero.jpg', imageKind: 'content' });
  });

  it('uses the widest srcset candidate', () => {
    const d = previewDetailFromHtml('<img srcset="/s.jpg 480w, /l.jpg 1600w, /m.jpg 800w" alt="Hero">', PAGE);
    expect(d.image).toBe('https://news.example.com/l.jpg');
  });

  it('never returns an unsafe address', () => {
    const html = '<meta property="og:image" content="http://insecure.example/a.jpg"><img src="https://127.0.0.1/a.jpg" width="900" height="500"><img src="https://localhost/a.jpg" width="900" height="500">';
    expect(previewDetailFromHtml(html, PAGE).image).toBeNull();
  });

  it('reports the page icon, apple-touch first and largest, even when there is no picture', () => {
    const d = previewDetailFromHtml('<link rel="icon" href="/f16.png" sizes="16x16"><link rel="apple-touch-icon" href="/touch.png" sizes="180x180"><link rel="icon" href="/f.svg">', PAGE);
    expect(d).toMatchObject({ image: null, imageKind: null, icon: 'https://news.example.com/touch.png' });
  });
});
