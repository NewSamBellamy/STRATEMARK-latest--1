import { describe, expect, it } from 'vitest';
import { pagePublishedAt } from './page-date';

const NOW = '2026-05-10T12:00:00.000Z';
const U = 'https://example.com/news/post';
const meta = (key: string, value: string, attr = 'property') => `<html><head><meta ${attr}="${key}" content="${value}"></head><body>x</body></html>`;

describe('pagePublishedAt', () => {
  it('reads JSON-LD and takes the later of published/modified', () => {
    const html = '<script type="application/ld+json">{"@graph":[{"@type":"Article","datePublished":"2025-01-02T08:00:00Z","dateModified":"2025-03-04"}]}</script>';
    expect(pagePublishedAt(html, U, NOW)).toBe('2025-03-04');
  });
  it('reads each meta source', () => {
    expect(pagePublishedAt(meta('article:modified_time', '2025-02-03T01:02:03+00:00'), U, NOW)).toBe('2025-02-03');
    expect(pagePublishedAt(meta('article:published_time', '2024-02-03'), U, NOW)).toBe('2024-02-03');
    expect(pagePublishedAt(meta('og:updated_time', '2024-06-07'), U, NOW)).toBe('2024-06-07');
    expect(pagePublishedAt(meta('pubdate', '2023-06-07', 'name'), U, NOW)).toBe('2023-06-07');
    expect(pagePublishedAt(meta('DC.date', '2022-06-07', 'name'), U, NOW)).toBe('2022-06-07');
    expect(pagePublishedAt(meta('date', '2021-06-07', 'name'), U, NOW)).toBe('2021-06-07');
  });
  it('takes the later of conflicting structured dates', () => {
    const html = meta('article:published_time', '2024-01-01') + meta('article:modified_time', '2024-09-09');
    expect(pagePublishedAt(html, U, NOW)).toBe('2024-09-09');
  });
  it('uses <time> only inside an article', () => {
    expect(pagePublishedAt('<body><time datetime="2024-05-05">x</time></body>', U, NOW)).toBeNull();
    expect(pagePublishedAt('<article><time datetime="2024-05-05">x</time></article>', U, NOW)).toBe('2024-05-05');
    expect(pagePublishedAt('<article></article><time datetime="2024-05-05">x</time>', U, NOW)).toBeNull();
  });
  it('falls back to the URL path', () => {
    expect(pagePublishedAt('<p>hi</p>', 'https://e.com/2024/03/15/post', NOW)).toBe('2024-03-15');
    expect(pagePublishedAt('<p>hi</p>', 'https://e.com/2024/02/post', NOW)).toBe('2024-02-29');
  });
  it('rejects future and pre-1995 dates', () => {
    expect(pagePublishedAt(meta('article:published_time', '2026-05-20'), U, NOW)).toBeNull();
    expect(pagePublishedAt(meta('article:published_time', '2026-05-11'), U, NOW)).toBe('2026-05-11');
    expect(pagePublishedAt(meta('article:published_time', '1990-01-01'), U, NOW)).toBeNull();
    expect(pagePublishedAt('<p/>', 'https://e.com/2030/01/01/x', NOW)).toBeNull();
  });
  it('returns null for garbage and nothing', () => {
    expect(pagePublishedAt(meta('article:published_time', 'last Tuesday'), U, NOW)).toBeNull();
    expect(pagePublishedAt(meta('article:published_time', '2025-13-45'), U, NOW)).toBeNull();
    expect(pagePublishedAt('<script type="application/ld+json">{broken</script><p>x</p>', U, NOW)).toBeNull();
    expect(pagePublishedAt('', 'not a url', NOW)).toBeNull();
    expect(pagePublishedAt('<p>x</p>', U, 'garbage')).toBeNull();
  });
  it('scans a 2 MB hostile input quickly and ignores dates past 512 KB', () => {
    const start = Date.now();
    expect(pagePublishedAt('<a '.repeat(700_000), U, NOW)).toBeNull();
    expect(pagePublishedAt('<meta content="' .repeat(150_000), U, NOW)).toBeNull();
    expect(pagePublishedAt('x'.repeat(2_000_000) + meta('date', '2024-01-01', 'name'), U, NOW)).toBeNull();
    expect(Date.now() - start).toBeLessThan(2000);
  });
});
