/**
 * Today's updates for one company: what its own releases and filings, the news
 * and the social conversation say, put in one short dated list.
 *
 * Nothing is written here. A headline is the publisher's own; a social item is
 * the stored research item with its source and the sentiment research tagged it
 * with. An item with no date it can honestly stand behind is left out, and the
 * list is never padded: fewer than five real items is shown as fewer than five.
 */
import type { CompanyMove, LiveIntelContent, MoveKind } from '@mi/contracts';

export type UpdateKind = 'release' | 'filing' | 'news' | 'social';

export interface TodayUpdate {
  /** Stable across visits: a move's id, or `social:` + the research item's id. */
  id: string;
  kind: UpdateKind;
  title: string;
  url: string;
  publisher: string | null;
  /** ISO. The source's own publish date when it gave one, else when research found the item. */
  at: string;
  /** 'published' = the source's own date; 'found' = when research found it (a capture date, not a publication date). */
  dateKind: 'published' | 'found';
  summary: string | null;
  /** Social items only: the sentiment research tagged the item with. */
  sentiment: 'positive' | 'neutral' | 'negative' | null;
  importance: 1 | 2 | 3;
  readAt: string | null;
}

export const MAX_UPDATES = 10;
export const MIN_WANTED = 5;
const DAY_MS = 86_400_000;
/** Look back this far first; widen to the second window only to reach the minimum. */
const WINDOWS_DAYS = [14, 60] as const;
const MAX_SOCIAL = 4;

const KIND_FOR_MOVE: Record<MoveKind, UpdateKind> = {
  launch: 'release',
  filing: 'filing',
  funding: 'news',
  deal: 'news',
  hire: 'news',
};

export function updatesFromMoves(moves: readonly CompanyMove[], companyId: string): TodayUpdate[] {
  return moves
    .filter((m) => m.companyId === companyId)
    .map((m) => ({
      id: m.id,
      kind: KIND_FOR_MOVE[m.kind],
      title: m.title,
      url: m.url,
      publisher: m.publisher,
      at: m.publishedAt,
      dateKind: 'published' as const,
      summary: null,
      sentiment: null,
      importance: m.importance,
      readAt: m.readAt,
    }));
}

/** Social items from the stored Live Intel research (Reddit and X). Other sources are news and come from the moves feed. */
export function updatesFromSocial(
  intel: Pick<LiveIntelContent, 'items'> | null | undefined,
  readIds: ReadonlySet<string>,
  now: Date = new Date(),
): TodayUpdate[] {
  const out: TodayUpdate[] = [];
  for (const item of intel?.items ?? []) {
    if (item.source !== 'x' && item.source !== 'reddit') continue;
    if (!/^https?:\/\//i.test(item.url)) continue;
    const published = item.publishedDate && !Number.isNaN(Date.parse(item.publishedDate)) ? new Date(item.publishedDate) : null;
    const found = !Number.isNaN(Date.parse(item.publishedAt)) ? new Date(item.publishedAt) : null;
    const when = published ?? found;
    // An item dated in the future cannot be right; an item with no date at all cannot be shown as "today's".
    if (!when || when.getTime() > now.getTime() + 15 * 60_000) continue;
    const id = `social:${item.id}`;
    out.push({
      id,
      kind: 'social',
      title: item.title,
      url: item.url,
      publisher: item.publisher ?? (item.source === 'reddit' ? 'Reddit' : 'X'),
      at: when.toISOString(),
      dateKind: published ? 'published' : 'found',
      summary: item.summary?.trim() || null,
      sentiment: item.sentiment,
      importance: 1,
      readAt: readIds.has(id) ? now.toISOString() : null,
    });
  }
  return out;
}

const byRecency = (a: TodayUpdate, b: TodayUpdate) => (a.at < b.at ? 1 : a.at > b.at ? -1 : b.importance - a.importance);

/** Up to ten updates, newest first, with room kept for the social conversation. Never padded. */
export function pickTodayUpdates(all: readonly TodayUpdate[], now: Date = new Date()): TodayUpdate[] {
  const seen = new Set<string>();
  const unique = all.filter((u) => {
    const key = u.url.replace(/[#?].*$/, '').replace(/\/$/, '').toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  let pool: TodayUpdate[] = [];
  for (const days of WINDOWS_DAYS) {
    const since = now.getTime() - days * DAY_MS;
    pool = unique.filter((u) => Date.parse(u.at) >= since);
    if (pool.length >= MIN_WANTED) break;
  }
  const social = pool.filter((u) => u.kind === 'social').sort(byRecency).slice(0, MAX_SOCIAL);
  const rest = pool.filter((u) => u.kind !== 'social').sort((a, b) => b.importance - a.importance || byRecency(a, b));
  // Fill from the others first, then give any unused room back to social.
  const takenRest = rest.slice(0, MAX_UPDATES - social.length);
  const room = MAX_UPDATES - takenRest.length - social.length;
  const moreSocial = room > 0 ? pool.filter((u) => u.kind === 'social').sort(byRecency).slice(social.length, social.length + room) : [];
  return [...takenRest, ...social, ...moreSocial].sort(byRecency);
}

export const KIND_LABEL: Record<UpdateKind, string> = {
  release: 'Release',
  filing: 'Filing',
  news: 'News',
  social: 'Social',
};

export function unreadCount(updates: readonly TodayUpdate[]): number {
  return updates.filter((u) => !u.readAt).length;
}
