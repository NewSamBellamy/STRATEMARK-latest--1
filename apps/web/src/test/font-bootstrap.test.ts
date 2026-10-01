import { readFileSync } from 'node:fs';
import path from 'node:path';
import { expect, it } from 'vitest';

const html = readFileSync(path.join(process.cwd(), 'index.html'), 'utf8');
const script = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].find((match) =>
  match[1]!.includes('font.href'),
)?.[1];
it('does not request or preconnect remote fonts in a read-only native preview', () => {
  expect(html).not.toMatch(/<link[^>]*https:\/\/fonts/);
  expect(script).toContain("window.mi.storageMode === 'staged_readonly'");
  expect(script!.indexOf("window.mi.storageMode === 'staged_readonly'")).toBeLessThan(
    script!.indexOf('https://fonts.googleapis.com'),
  );
});
it('preserves the existing font stylesheet and preconnects in normal desktop and browser mode', () => {
  expect(script).toContain("link.rel = 'preconnect'");
  expect(script).toContain("font.rel = 'stylesheet'");
  expect(script).toContain('Google+Sans+Flex');
});
