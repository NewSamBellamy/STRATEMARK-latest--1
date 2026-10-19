import { describe, expect, it } from 'vitest';
import { shareContentPolicy, withSharePolicy, SHARE_CSP_TOKEN } from './csp';

const directive = (policy: string, name: string) => policy.split('; ').find((part) => part.startsWith(`${name} `)) ?? '';

describe('the share page content-security policy', () => {
  it('allows calls only to itself, the public reference sources and the share Worker', () => {
    const policy = shareContentPolicy('https://stratemark-api.example.workers.dev/some/path');
    expect(directive(policy, 'connect-src')).toBe("connect-src 'self' https://*.wikipedia.org https://*.wikidata.org https://*.wikimedia.org https://stratemark-api.example.workers.dev");
    expect(shareContentPolicy()).not.toContain('workers.dev');
    expect(directive(shareContentPolicy('not a url'), 'connect-src')).not.toMatch(/not a url/);
    expect(directive(shareContentPolicy('javascript:alert(1)'), 'connect-src')).not.toContain('javascript');
  });

  it('starts from nothing and opens only what the viewer uses', () => {
    const policy = shareContentPolicy('https://api.example');
    expect(policy.startsWith("default-src 'none'")).toBe(true);
    expect(directive(policy, 'frame-src')).toBe('frame-src https://www.youtube-nocookie.com');
    for (const closed of ['object-src', 'base-uri', 'form-action', 'worker-src', 'manifest-src']) expect(directive(policy, closed), closed).toBe(`${closed} 'none'`);
    expect(directive(policy, 'img-src')).toBe('img-src https: data: blob:');
    expect(directive(policy, 'script-src')).toBe("script-src 'unsafe-inline'");
    expect(policy).not.toMatch(/\*(?!\.)|http:\/\//); // no bare wildcard, no plain http source
  });

  it('is written into share.html in place of its token, and nowhere else', () => {
    const html = `<head>${SHARE_CSP_TOKEN}<title>x</title></head>`;
    const out = withSharePolicy(html, 'https://api.example');
    expect(out).toContain('<meta http-equiv="Content-Security-Policy" content="default-src \'none\'');
    expect(out).not.toContain(SHARE_CSP_TOKEN);
    expect(withSharePolicy('<head></head>')).toBe('<head></head>');
  });
});
