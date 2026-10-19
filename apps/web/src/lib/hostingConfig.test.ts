import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * The hosting config is what a visitor's browser is told about the app on its first request. It is not exercised by
 * any other test, so a slip (a dropped header, a page that is cached for an hour, the voice button's permission taken
 * away, share.html rewritten to the app) would only show after a deploy.
 */
interface Rule { source: string; headers: Array<{ key: string; value: string }> }
const config = JSON.parse(readFileSync(resolve(process.cwd(), '../../firebase.json'), 'utf8')) as {
  hosting: { public: string; rewrites: Array<{ source: string; destination: string }>; headers: Rule[] };
};
const rule = (source: string) => config.hosting.headers.find((r) => r.source === source);
const header = (source: string, key: string) => rule(source)?.headers.find((h) => h.key.toLowerCase() === key.toLowerCase())?.value;

describe('what the hosting tells a visitor’s browser', () => {
  it('serves the built app and falls back to it for any address that is not a file (share.html is a file, so it is served as itself)', () => {
    expect(config.hosting.public).toBe('apps/web/dist');
    expect(config.hosting.rewrites).toEqual([{ source: '**', destination: '/index.html' }]);
  });

  it('sends the safe defaults on every response, and keeps the microphone for the page’s own voice button', () => {
    expect(header('**', 'X-Content-Type-Options')).toBe('nosniff');
    expect(header('**', 'Referrer-Policy')).toBe('strict-origin-when-cross-origin');
    const permissions = header('**', 'Permissions-Policy') ?? '';
    expect(permissions).toContain('microphone=(self)');
    expect(permissions).toContain('camera=()');
    expect(permissions).toContain('geolocation=()');
  });

  it('lets a fix reach visitors at once: pages are always revalidated, built assets (named by their content) are kept for a year', () => {
    expect(header('/', 'Cache-Control')).toBe('no-cache');
    expect(header('**/*.html', 'Cache-Control')).toBe('no-cache');
    expect(header('/assets/**', 'Cache-Control')).toBe('public, max-age=31536000, immutable');
  });

  it('does not forbid being framed: a share page can be embedded by whoever hosts it, and a frame rule would break that', () => {
    const all = config.hosting.headers.flatMap((r) => r.headers.map((h) => h.key.toLowerCase()));
    expect(all).not.toContain('x-frame-options');
  });
});
