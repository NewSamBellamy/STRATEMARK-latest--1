import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type * as HostedApiModule from '@/lib/hostedApi';
import { loadLogo } from './ogImage';

const hosted = vi.hoisted(() => ({ on: true }));
vi.mock('@/lib/hostedApi', async (importActual) => ({
  ...(await importActual<typeof HostedApiModule>()),
  hasHostedApi: () => hosted.on,
  hostedUrl: (path: string) => `https://api.example.workers.dev/v1/${path.replace(/^\/+/, '')}`,
}));

/** jsdom does not decode pictures: an image "loads" when it is given an address, unless the address says it is broken. */
class FakeImage {
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  naturalWidth = 64;
  naturalHeight = 64;
  set src(value: string) { queueMicrotask(() => (value.includes('broken') ? this.onerror?.() : this.onload?.())); }
}

describe('the company logo drawn on a preview picture', () => {
  const fetchMock = vi.fn();
  beforeEach(() => {
    hosted.on = true;
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
    vi.stubGlobal('Image', FakeImage);
    vi.stubGlobal('URL', Object.assign(URL, { createObjectURL: vi.fn(() => 'blob:logo'), revokeObjectURL: vi.fn() }));
  });
  afterEach(() => { vi.unstubAllGlobals(); });

  const image = (type = 'image/png', size = 1000) => new Response(new Uint8Array(size), { status: 200, headers: { 'Content-Type': type } });

  it('is a data picture as it stands, and nothing else without the hosted Worker', async () => {
    expect(await loadLogo('data:image/png;base64,AAAA')).not.toBeNull();
    hosted.on = false;
    expect(await loadLogo('https://logo.example/acme.png')).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('is fetched through the Worker as a file, with no credentials, so the canvas is never tainted', async () => {
    fetchMock.mockResolvedValue(image());
    expect(await loadLogo('https://logo.example/acme.png?x=1&y=2')).not.toBeNull();
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`https://api.example.workers.dev/v1/image?url=${encodeURIComponent('https://logo.example/acme.png?x=1&y=2')}`);
    expect(init.credentials).toBe('omit');
  });

  it('is nothing when it cannot be had safely: not a web or data address, a failed or non-image answer, too large, or a network error', async () => {
    expect(await loadLogo(null), 'no address').toBeNull();
    expect(await loadLogo('javascript:alert(1)'), 'script address').toBeNull();
    expect(await loadLogo('data:text/html,<b>x</b>'), 'data page').toBeNull();
    fetchMock.mockResolvedValueOnce(new Response('no', { status: 404 }));
    expect(await loadLogo('https://logo.example/a.png'), 'not found').toBeNull();
    fetchMock.mockResolvedValueOnce(image('text/html'));
    expect(await loadLogo('https://logo.example/a.png'), 'a page').toBeNull();
    fetchMock.mockResolvedValueOnce(image('image/png', 2_500_000));
    expect(await loadLogo('https://logo.example/a.png'), 'too large').toBeNull();
    fetchMock.mockRejectedValueOnce(new Error('offline'));
    expect(await loadLogo('https://logo.example/a.png'), 'offline').toBeNull();
    expect(await loadLogo('data:image/png;broken'), 'undecodable').toBeNull();
  });
});
