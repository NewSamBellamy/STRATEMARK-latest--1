/**
 * What a share page may touch. It runs before anything else in the page (it is
 * the first import of the share entry), so no other module can read the
 * visitor's saved settings or call out before it is in place.
 *
 *  - Browser storage reads as empty and writes go nowhere, except the theme
 *    choice. A share opened in a browser that also holds the visitor's own
 *    Stratemark settings (an API key, say) must never see or use them.
 *  - Network calls from code (fetch, XHR, beacons, sockets) are refused except
 *    to this page's own address and to the public reference sources the
 *    screens read for portraits and founding years. Pictures loaded by the
 *    page as images are not calls from code and are unaffected.
 */
const KEEP_KEYS = new Set(['mi.theme']);
const PUBLIC_HOSTS = [/(^|\.)wikipedia\.org$/i, /(^|\.)wikidata\.org$/i, /(^|\.)wikimedia\.org$/i];

export function isAllowedRequest(rawUrl: string, pageOrigin: string): boolean {
  let url: URL;
  try {
    url = new URL(rawUrl, pageOrigin);
  } catch {
    return false;
  }
  if (url.protocol === 'data:' || url.protocol === 'blob:') return true;
  if (url.origin === pageOrigin && pageOrigin !== 'null') return true;
  return url.protocol === 'https:' && PUBLIC_HOSTS.some((host) => host.test(url.hostname));
}

interface GuardTarget {
  Storage?: { prototype: Storage };
  fetch?: typeof fetch;
  XMLHttpRequest?: { prototype: { open: (...args: unknown[]) => void } };
  WebSocket?: unknown;
  navigator?: { sendBeacon?: unknown };
  location: { origin: string };
}

export function installShareGuard(target: GuardTarget = window as unknown as GuardTarget): void {
  const storage = target.Storage?.prototype;
  if (storage) {
    const getItem = storage.getItem;
    const setItem = storage.setItem;
    const removeItem = storage.removeItem;
    storage.getItem = function (this: Storage, key: string) {
      return KEEP_KEYS.has(key) ? getItem.call(this, key) : null;
    };
    storage.setItem = function (this: Storage, key: string, value: string) {
      if (KEEP_KEYS.has(key)) setItem.call(this, key, value);
    };
    storage.removeItem = function (this: Storage, key: string) {
      if (KEEP_KEYS.has(key)) removeItem.call(this, key);
    };
  }
  const refused = () => new TypeError('A shared page does not contact other services.');
  const origin = target.location.origin;
  const realFetch = target.fetch?.bind(target);
  if (realFetch) {
    target.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      return isAllowedRequest(url, origin) ? realFetch(input, init) : Promise.reject(refused());
    }) as typeof fetch;
  }
  if (target.XMLHttpRequest) {
    const open = target.XMLHttpRequest.prototype.open;
    target.XMLHttpRequest.prototype.open = function (this: unknown, ...args: unknown[]) {
      if (!isAllowedRequest(String(args[1]), origin)) throw refused();
      return open.apply(this, args);
    };
  }
  if (target.navigator && 'sendBeacon' in target.navigator) target.navigator.sendBeacon = () => false;
  if (target.WebSocket !== undefined) {
    (target as { WebSocket: unknown }).WebSocket = function WebSocketRefused() {
      throw refused();
    };
  }
}
