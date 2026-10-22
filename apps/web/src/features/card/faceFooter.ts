/**
 * The card face's footer: two plain facts a reader can use at a glance, in
 * place of the old "3/4 figures sourced · 5 sources tracked" line (the source
 * count now lives in the card reader).
 *
 * - Left: the year the company was founded, only when that year carries a
 *   usable source (the reader shows the source). Otherwise nothing.
 * - Right: when the card's research last changed ("Updated 22 Oct"), from the
 *   latest timestamp the card and its figures actually carry.
 */
import type { CardWithCompany } from '@mi/contracts';
import { safeHttpUrl } from '@/lib/sourceHref';

export interface FaceFooter {
  lead: string | null;
  updated: string | null;
}

/** The newest timestamp the card's own research carries, or null when it has none. */
export function cardUpdatedAt(data: CardWithCompany): Date | null {
  const stamps: (string | null | undefined)[] = [
    data.card.createdAt,
    data.company?.founded?.capturedAt,
    ...data.metrics.flatMap((m) => [m.capturedAt, m.lastVerifiedAt]),
    ...data.viceClaims.map((v) => v.capturedAt),
  ];
  let latest: number | null = null;
  for (const stamp of stamps) {
    if (!stamp) continue;
    const t = Date.parse(stamp);
    if (Number.isFinite(t) && (latest == null || t > latest)) latest = t;
  }
  return latest == null ? null : new Date(latest);
}

/** "22 Oct" this year, "30 Jul 2025" another year. */
export function shortDate(date: Date, now: Date = new Date()): string {
  const sameYear = date.getFullYear() === now.getFullYear();
  return date.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', ...(sameYear ? {} : { year: 'numeric' }) });
}

export function faceFooter(data: CardWithCompany, now?: Date): FaceFooter {
  const founded = data.company?.founded;
  const sourced = founded && founded.citations.some((c) => safeHttpUrl(c.url));
  const at = cardUpdatedAt(data);
  return {
    lead: sourced ? `Founded ${founded.year}` : null,
    updated: at ? `Updated ${shortDate(at, now)}` : null,
  };
}
