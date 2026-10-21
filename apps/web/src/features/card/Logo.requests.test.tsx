import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { render } from '@testing-library/react';
import { Logo } from './Logo';

// A shared link carries the company's website and logo address, so whoever
// made the link chooses what the viewer's browser is asked to fetch.
describe('what a card asks the network for', () => {
  const requested: string[] = [];
  const original = Object.getOwnPropertyDescriptor(HTMLImageElement.prototype, 'src')!;

  beforeEach(() => {
    requested.length = 0;
    Object.defineProperty(HTMLImageElement.prototype, 'src', {
      configurable: true,
      get() { return original.get!.call(this); },
      set(value: string) { if (value) requested.push(String(value)); },
    });
  });
  afterEach(() => { Object.defineProperty(HTMLImageElement.prototype, 'src', original); });

  const asked = async (props: { name: string; website: string | null; logoUrl: string | null }) => {
    const { unmount } = render(<Logo {...props} />);
    // Probing happens in an effect; give it a tick to issue its requests.
    await new Promise((resolve) => setTimeout(resolve, 20));
    unmount();
    return [...requested];
  };

  it('never builds a request from a private address, a port, or text smuggled into the website', async () => {
    for (const [i, website] of ['192.168.1.1/cgi-bin/reboot?', 'localhost:8080/admin?x=', 'x.com&size=1&url=https://y.com', 'attacker.io:8443/p?leak=1'].entries()) {
      const urls = await asked({ name: `Zzyx Probe ${i}`, website, logoUrl: null });
      expect(urls, website).toEqual([]);
    }
  });

  it('does not request an http or internal logoUrl', async () => {
    const urls = await asked({ name: 'Qqq Probe', website: null, logoUrl: 'http://169.254.169.254/latest/meta-data/' });
    expect(urls).toEqual([]);
  });

  it('asks only the company host for its icon, with nothing from the path or query', async () => {
    const urls = await asked({ name: 'Zzyx Realco', website: 'realco.io/cgi-bin/x?leak=1#y', logoUrl: null });
    expect(urls.length).toBeGreaterThan(0);
    expect(urls).toContain('https://realco.io/apple-touch-icon.png');
    expect(urls.filter((u) => /leak|cgi-bin/.test(u))).toEqual([]);
  });

  it('still tries an ordinary https logo and an ordinary site, and a bare domain', async () => {
    const urls = await asked({ name: 'Zzyx Sunrun', website: 'https://www.sunrun.com', logoUrl: 'https://upload.wikimedia.org/logo.svg' });
    expect(urls[0]).toBe('https://upload.wikimedia.org/logo.svg');
    expect(urls).toContain('https://sunrun.com/apple-touch-icon.png');
    const bare = await asked({ name: 'Zzyx Spacex', website: 'shop.spacex.com', logoUrl: null });
    expect(bare).toContain('https://shop.spacex.com/apple-touch-icon.png');
  });
});
