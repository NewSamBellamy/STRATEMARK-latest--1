/**
 * Hosted share links, from the browser's side: pack the snapshot, upload it to
 * the share Worker, get back a short link that chat apps unfurl with a picture,
 * and keep the token that stops it.
 *
 * Nothing leaves the device until the person presses "Create link": the dialog
 * says plainly that the Worker keeps a read-only copy for a while.
 */
import type { ShareSnapshot } from '@mi/contracts';
import { SHARE_API_URL } from '@/lib/hostedApi';
import { shareMeta } from './bundle';
import { snapshotFingerprint, packSnapshot, toBase64 } from './wire';

export interface HostedShare {
  id: string;
  /** The link people paste. */
  url: string;
  /** The preview picture a chat app shows, or null when none was made. */
  imageUrl: string | null;
  /** When the Worker deletes it (ms since the epoch). */
  expiresAt: number;
  /** Stops the share. Kept on this device only. */
  deleteToken: string;
}

export class HostedShareError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
    this.name = 'HostedShareError';
  }
}

type Fetcher = typeof fetch;

/** The viewer page a share opens in: this app's own share.html, built next to it. */
export function viewerUrlForThisApp(baseHref: string = typeof document !== 'undefined' ? document.baseURI : 'http://localhost/'): string {
  return new URL('share.html', baseHref).href;
}

interface CreateOptions {
  apiUrl?: string;
  viewerUrl?: string;
  fetcher?: Fetcher;
  /** Draws the preview picture; null when drawing is not available (the link still works, without a picture). */
  renderImage?: ((snapshot: ShareSnapshot) => Promise<Uint8Array | null>) | null;
}

/** What went wrong, in words a person can act on. Never echoes a server body we did not write. */
function failure(status: number, serverMessage: unknown): HostedShareError {
  const said = typeof serverMessage === 'string' && serverMessage.length < 300 ? serverMessage : null;
  if (status === 413) return new HostedShareError(said ?? 'This is too large to host. Share a single card, or copy a private link.', status);
  if (status === 429) return new HostedShareError(said ?? 'This could not be shared right now. Try again later, or copy a private link.', status);
  if (status === 403) return new HostedShareError('Sharing is not set up for this address yet. Copy a private link instead.', status);
  if (status === 0) return new HostedShareError('Could not reach the sharing service. Check your connection and try again.', 0);
  return new HostedShareError('The sharing service could not make the link. Try again in a moment, or copy a private link.', status);
}

export async function createHostedShare(snapshot: ShareSnapshot, options: CreateOptions = {}): Promise<HostedShare> {
  const api = (options.apiUrl ?? SHARE_API_URL).replace(/\/+$/, '');
  const fetcher = options.fetcher ?? ((...args: Parameters<Fetcher>) => fetch(...args));
  const meta = shareMeta(snapshot);
  const data = await packSnapshot(snapshot);
  const png = options.renderImage ? await options.renderImage(snapshot).catch(() => null) : null;
  let response: Response;
  try {
    response = await fetcher(`${api}/v1/share`, {
      method: 'POST',
      credentials: 'omit',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        v: 1, kind: snapshot.kind, title: meta.title, description: meta.description,
        viewer: options.viewerUrl ?? viewerUrlForThisApp(), data, og: png ? toBase64(png) : null,
      }),
    });
  } catch {
    throw failure(0, null);
  }
  const body = await response.json().catch(() => null) as Partial<HostedShare> & { error?: unknown } | null;
  if (!response.ok) throw failure(response.status, body?.error);
  if (!body || typeof body.id !== 'string' || typeof body.url !== 'string' || typeof body.deleteToken !== 'string' || typeof body.expiresAt !== 'number') {
    throw failure(502, null);
  }
  return { id: body.id, url: body.url, imageUrl: typeof body.imageUrl === 'string' ? body.imageUrl : null, expiresAt: body.expiresAt, deleteToken: body.deleteToken };
}

/** Stop sharing. A share that is already gone counts as stopped. */
export async function stopHostedShare(share: Pick<HostedShare, 'id' | 'deleteToken'>, options: { apiUrl?: string; fetcher?: Fetcher } = {}): Promise<void> {
  const api = (options.apiUrl ?? SHARE_API_URL).replace(/\/+$/, '');
  const fetcher = options.fetcher ?? ((...args: Parameters<Fetcher>) => fetch(...args));
  let response: Response;
  try {
    response = await fetcher(`${api}/v1/share/${share.id}`, { method: 'DELETE', credentials: 'omit', headers: { 'X-Share-Token': share.deleteToken } });
  } catch {
    throw failure(0, null);
  }
  if (response.ok || response.status === 404) return;
  throw new HostedShareError('Could not stop sharing just now. Try again in a moment.', response.status);
}

// ---- Links made from this browser ---------------------------------------------

const REGISTRY_KEY = 'mi.shares';
const MAX_REMEMBERED = 50;

export interface RememberedShare extends HostedShare {
  /** What the link is of ("deck:abc", "card:abc:crd1"), so reopening the dialog finds it. */
  subject: string;
  /** Fingerprint of the research it holds, so an unchanged deck reuses its link and a changed one makes a new one. */
  fingerprint: string;
  title: string;
}

function readRegistry(storage: Pick<Storage, 'getItem'> | null): RememberedShare[] {
  try {
    const parsed = JSON.parse(storage?.getItem(REGISTRY_KEY) ?? '[]') as unknown;
    return Array.isArray(parsed)
      ? parsed.filter((s): s is RememberedShare => !!s && typeof s === 'object' && typeof (s as RememberedShare).id === 'string' && typeof (s as RememberedShare).deleteToken === 'string')
      : [];
  } catch {
    return [];
  }
}

function browserStorage(): Storage | null {
  try { return typeof localStorage === 'undefined' ? null : localStorage; } catch { return null; }
}

export function rememberShare(share: RememberedShare, storage: Pick<Storage, 'getItem' | 'setItem'> | null = browserStorage()): void {
  if (!storage) return;
  const kept = readRegistry(storage).filter((s) => s.id !== share.id).slice(0, MAX_REMEMBERED - 1);
  try { storage.setItem(REGISTRY_KEY, JSON.stringify([share, ...kept])); } catch { /* storage full or blocked: the link still works, it just cannot be stopped from here later */ }
}

export function forgetShare(id: string, storage: Pick<Storage, 'getItem' | 'setItem'> | null = browserStorage()): void {
  if (!storage) return;
  try { storage.setItem(REGISTRY_KEY, JSON.stringify(readRegistry(storage).filter((s) => s.id !== id))); } catch { /* nothing to do */ }
}

/** A link made earlier for the same research, still good for at least a day. */
export function findReusableShare(subject: string, fingerprint: string, now = Date.now(), storage: Pick<Storage, 'getItem'> | null = browserStorage()): RememberedShare | null {
  return readRegistry(storage).find((s) => s.subject === subject && s.fingerprint === fingerprint && s.expiresAt - now > 86_400_000) ?? null;
}

export { snapshotFingerprint };
