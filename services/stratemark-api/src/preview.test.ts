import { describe, expect, it } from 'vitest';
import { previewFromHtml } from './preview';

const page = 'https://www.reuters.com/business/story-123/';

describe('previewFromHtml', () => {
  it('takes the og:image, resolving relative paths against the page', () => {
    const html = `<html><head>
      <meta property="og:title" content="Anthropic raises &amp; expands">
      <meta property="og:site_name" content="Reuters">
      <meta property="og:image" content="/resizer/hero.jpg?w=1200">
    </head></html>`;
    expect(previewFromHtml(html, page)).toEqual({
      image: 'https://www.reuters.com/resizer/hero.jpg?w=1200',
      title: 'Anthropic raises & expands',
      site: 'Reuters',
    });
  });
  it('accepts content-before-property order, twitter:image and image_src fallbacks', () => {
    expect(previewFromHtml(`<meta content='https://cdn.example.com/a.png' name='twitter:image'>`, page).image)
      .toBe('https://cdn.example.com/a.png');
    expect(previewFromHtml(`<link rel="image_src" href="https://cdn.example.com/b.jpg">`, page).image)
      .toBe('https://cdn.example.com/b.jpg');
  });
  it('refuses unsafe or useless images', () => {
    for (const src of ['http://insecure.example.com/x.jpg', 'https://10.0.0.1/x.jpg', 'https://localhost/x.jpg',
      'https://cdn.example.com/pixel.gif', 'data:image/png;base64,AAAA']) {
      expect(previewFromHtml(`<meta property="og:image" content="${src}">`, page).image).toBeNull();
    }
    expect(previewFromHtml('<html><head><title>No preview</title></head></html>', page)).toEqual({ image: null, title: null, site: null });
  });
});
