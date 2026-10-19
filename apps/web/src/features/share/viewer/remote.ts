/**
 * A share link opens share.html?s=<id>. When the page has no research embedded
 * (the hosted case), it fetches its own share by that id from the share Worker:
 * one GET, to the one address the page's guard allows, and nothing else.
 */
import type { ShareSnapshot } from '@mi/contracts';
import { unpackSnapshotText } from '@/lib/share/wire';
import { isShareSnapshot } from './embedded';

/** The id in `?s=...`, or null when the address carries none or a malformed one. */
export function shareIdFromSearch(search: string): string | null {
  const id = new URLSearchParams(search).get('s');
  return id && /^[A-Za-z0-9_-]{16}$/.test(id) ? id : null;
}

export type RemoteShareResult =
  | { ok: true; snapshot: ShareSnapshot }
  | { ok: false; reason: 'gone' | 'unreachable' | 'unreadable'; message: string };

const MESSAGES = {
  gone: 'This link is no longer available. Shared research expires after a while, and its owner can stop sharing it. Ask whoever sent it for a fresh link.',
  unreachable: 'The shared research could not be loaded. Check your connection and reload this page.',
  unreadable: 'This shared page could not be opened: its research is not in a form this page can read.',
} as const;

export function remoteShareUrl(apiUrl: string, id: string): string {
  return `${apiUrl.replace(/\/+$/, '')}/v1/share/${id}`;
}

export async function loadRemoteShare(id: string, apiUrl: string, fetcher: typeof fetch = (...args) => fetch(...args)): Promise<RemoteShareResult> {
  let response: Response;
  try {
    response = await fetcher(remoteShareUrl(apiUrl, id), { credentials: 'omit', headers: { Accept: 'application/json' } });
  } catch {
    return { ok: false, reason: 'unreachable', message: MESSAGES.unreachable };
  }
  if (response.status === 404) return { ok: false, reason: 'gone', message: MESSAGES.gone };
  if (!response.ok) return { ok: false, reason: 'unreachable', message: MESSAGES.unreachable };
  try {
    const body = await response.json() as { data?: unknown };
    const text = typeof body.data === 'string' ? await unpackSnapshotText(body.data) : null;
    const parsed: unknown = text === null ? null : JSON.parse(text);
    if (isShareSnapshot(parsed)) return { ok: true, snapshot: parsed };
  } catch {
    /* fall through to unreadable */
  }
  return { ok: false, reason: 'unreadable', message: MESSAGES.unreadable };
}
