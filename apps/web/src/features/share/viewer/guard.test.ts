import { describe, expect, it, vi } from 'vitest';
import { installShareGuard, isAllowedRequest } from './guard';

function fakeWindow() {
  const store = new Map<string, string>([['mi.geminiApiKey', 'SECRET-KEY'], ['mi.theme', 'dark'], ['other-app', 'x']]);
  class FakeStorage {
    getItem(key: string) { return store.get(key) ?? null; }
    setItem(key: string, value: string) { store.set(key, value); }
    removeItem(key: string) { store.delete(key); }
  }
  const fetchSpy = vi.fn(async () => new Response('ok'));
  const open = vi.fn();
  class FakeXhr { open(...args: unknown[]) { open(...args); } }
  const target = {
    Storage: { prototype: FakeStorage.prototype as unknown as Storage },
    fetch: fetchSpy as unknown as typeof fetch,
    XMLHttpRequest: { prototype: FakeXhr.prototype as unknown as { open: (...args: unknown[]) => void } },
    WebSocket: class {},
    navigator: { sendBeacon: () => true },
    location: { origin: 'https://share.example.com' },
  };
  return { target, store, fetchSpy, open, storage: new FakeStorage() as unknown as Storage, xhr: new FakeXhr() };
}

describe('the share page guard', () => {
  it('shows the visitor\'s saved settings and keys as empty, and keeps only the theme', () => {
    const { target, storage } = fakeWindow();
    installShareGuard(target);
    expect(storage.getItem('mi.geminiApiKey')).toBeNull();
    expect(storage.getItem('mi.apiKey')).toBeNull();
    expect(storage.getItem('other-app')).toBeNull();
    expect(storage.getItem('mi.theme')).toBe('dark');
  });

  it('writes nothing to the visitor\'s storage except the theme', () => {
    const { target, storage, store } = fakeWindow();
    installShareGuard(target);
    storage.setItem('mi.usage', '99');
    storage.removeItem('mi.geminiApiKey');
    storage.setItem('mi.theme', 'light');
    expect(store.has('mi.usage')).toBe(false);
    expect(store.get('mi.geminiApiKey')).toBe('SECRET-KEY');
    expect(store.get('mi.theme')).toBe('light');
  });

  it('refuses calls from code to anything but this page and the public reference sources', async () => {
    const { target, fetchSpy } = fakeWindow();
    installShareGuard(target);
    await expect(target.fetch!('https://generativelanguage.googleapis.com/v1beta/models/x:generateContent')).rejects.toThrow('does not contact');
    await expect(target.fetch!('https://api.stratemark.example/v1/preview?url=x')).rejects.toThrow('does not contact');
    await expect(target.fetch!('http://en.wikipedia.org/w/api.php')).rejects.toThrow('does not contact');
    expect(fetchSpy).not.toHaveBeenCalled();
    await target.fetch!('https://en.wikipedia.org/w/api.php?action=query');
    await target.fetch!('https://www.wikidata.org/w/api.php');
    await target.fetch!('/og.png');
    expect(fetchSpy).toHaveBeenCalledTimes(3);
  });

  it('refuses XHR, beacons and sockets', () => {
    const { target, xhr, open } = fakeWindow();
    installShareGuard(target);
    expect(() => xhr.open('GET', 'https://evil.example/x')).toThrow('does not contact');
    xhr.open('GET', '/same-origin');
    expect(open).toHaveBeenCalledTimes(1);
    expect((target.navigator!.sendBeacon as () => boolean)()).toBe(false);
    expect(() => new (target.WebSocket as new () => unknown)()).toThrow('does not contact');
  });

  it('judges addresses by their real host, not by lookalikes', () => {
    const origin = 'https://share.example.com';
    expect(isAllowedRequest('https://en.wikipedia.org.evil.example/x', origin)).toBe(false);
    expect(isAllowedRequest('https://evilwikipedia.org/x', origin)).toBe(false);
    expect(isAllowedRequest('https://share.example.com.evil.example/x', origin)).toBe(false);
    expect(isAllowedRequest('https://upload.wikimedia.org/a.jpg', origin)).toBe(true);
    expect(isAllowedRequest('//evil.example/x', origin)).toBe(false);
    expect(isAllowedRequest('data:text/plain,hi', origin)).toBe(true);
    expect(isAllowedRequest('not a url at all', 'null')).toBe(false);
  });
});

describe('a hosted share reading its own research', () => {
  const origin = 'https://app.example.com';
  const shareApi = 'https://api.example.workers.dev';
  const id = 'abcdefghijklmnop';
  const allowed = (url: string, method = 'GET', api = shareApi) => isAllowedRequest(url, origin, { shareApi: api }, method);

  it('may GET its own share by id from the share Worker, and only that', () => {
    expect(allowed(`${shareApi}/v1/share/${id}`)).toBe(true);
    expect(allowed(`${shareApi}/v1/share/${id}`, 'get')).toBe(true);
    // Nothing else the Worker offers: the research relay, the page reader, the image proxy, the health route.
    for (const path of ['/v1/gemini/gemini-flash-latest:generateContent', '/v1/search', '/v1/news', '/v1/source', '/v1/asset-source', '/v1/image?url=https://x.example/a.png', '/v1/preview?url=https://x.example', '/health', '/v1/share', `/v1/share/${id}/extra`, `/v1/share/${id}?x=1`, `/v1/share/${id}#x`, '/v1/share/short', `/s/${id}`]) {
      expect(allowed(`${shareApi}${path}`), path).toBe(false);
    }
  });

  it('never writes: stopping or making a share is not something a share page does', () => {
    for (const method of ['POST', 'DELETE', 'PUT', 'PATCH']) expect(allowed(`${shareApi}/v1/share/${id}`, method), method).toBe(false);
  });

  it('judges the Worker by its real host, and is off when no Worker is configured', () => {
    expect(allowed(`https://api.example.workers.dev.evil.example/v1/share/${id}`)).toBe(false);
    expect(allowed(`https://evil.example/v1/share/${id}`)).toBe(false);
    expect(allowed(`http://api.example.workers.dev/v1/share/${id}`)).toBe(false);
    expect(allowed(`${shareApi}/v1/share/${id}`, 'GET', '')).toBe(false);
    expect(allowed(`${shareApi}/v1/share/${id}`, 'GET', 'not a url')).toBe(false);
    expect(isAllowedRequest(`${shareApi}/v1/share/${id}`, origin)).toBe(false);
  });

  it('is enforced on the page\'s own fetch and XHR, not just by the helper', async () => {
    const { target, fetchSpy, xhr, open } = fakeWindow();
    target.location = { origin };
    installShareGuard(target, { shareApi });
    await target.fetch!(`${shareApi}/v1/share/${id}`);
    await target.fetch!(`${shareApi}/v1/share/${id}`, { method: 'GET' });
    expect(fetchSpy).toHaveBeenCalledTimes(2);
    await expect(target.fetch!(`${shareApi}/v1/share/${id}`, { method: 'DELETE', headers: { 'X-Share-Token': 'x' } })).rejects.toThrow('does not contact');
    await expect(target.fetch!(new Request(`${shareApi}/v1/share/${id}`, { method: 'POST', body: 'x' }))).rejects.toThrow('does not contact');
    await expect(target.fetch!(`${shareApi}/v1/gemini/gemini-flash-latest:generateContent`, { method: 'POST' })).rejects.toThrow('does not contact');
    expect(fetchSpy).toHaveBeenCalledTimes(2);
    xhr.open('GET', `${shareApi}/v1/share/${id}`);
    expect(open).toHaveBeenCalledTimes(1);
    expect(() => xhr.open('DELETE', `${shareApi}/v1/share/${id}`)).toThrow('does not contact');
  });
});
