/**
 * Plain wording for what the Overview can and cannot say about time. Nothing
 * here guesses: a story is "recent" only when dates support it, and an
 * undated item says so.
 */
import type { LiveIntelItem } from '@mi/contracts';
import { formatDate } from '@/lib/format';

type Story = Pick<LiveIntelItem, 'stale' | 'publishedDate'>;

const hasDate = (item: Story): boolean => {
  const raw = item.publishedDate?.trim();
  return Boolean(raw) && Number.isFinite(new Date(raw as string).getTime());
};

/**
 * "15 stories (dates not reported)" until stories carry a reported date;
 * "recent" only when every counted story does. Stale items are not counted.
 */
export function storiesCaption(items: readonly Story[]): string | null {
  const live = items.filter((item) => !item.stale);
  if (live.length === 0) return null;
  const noun = live.length === 1 ? 'story' : 'stories';
  const dated = live.filter(hasDate).length;
  if (dated === live.length) return `${live.length} recent ${noun}`;
  if (dated === 0) return `${live.length} ${noun} (dates not reported)`;
  return `${live.length} ${noun} (${dated} with a reported date)`;
}

/**
 * "Backed by 1 source": how many distinct publishers stand behind the figures
 * shown, counted by site from linked citations only. A coverage signal; null
 * when no figure has a linked source (nothing is implied).
 */
export function sourceCoverage(figures: ReadonlyArray<{ citations: ReadonlyArray<{ url: string; title?: string | null }> }>): string | null {
  const sites = new Set<string>();
  for (const figure of figures) {
    const link = figure.citations.find((c) => /^https?:\/\//i.test(c.url));
    if (!link) continue;
    let site: string;
    try {
      site = new URL(link.url).hostname.replace(/^www\./, '').toLowerCase();
    } catch { continue; }
    // Search redirects hide the publisher: count by its recorded name instead.
    if (/vertexaisearch|grounding-api-redirect/.test(site)) site = (link.title ?? '').trim().toLowerCase();
    if (site) sites.add(site);
  }
  return sites.size === 0 ? null : `Backed by ${sites.size} ${sites.size === 1 ? 'source' : 'sources'}`;
}

const MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];
const PART_MONTH: Record<string, number> = { early: 0, mid: 5, late: 9, spring: 2, summer: 5, fall: 8, winter: 11 };

/**
 * Where a written milestone date falls, as year*12+month (month 0-11), or null
 * when it cannot be read with certainty. Reads the forms research uses
 * ("March 2026", "April 29, 2026", "Q2 2026", "Early 2024", "2025"); a year
 * alone counts as its first month. It orders; it never rewrites the date.
 */
export function eventDateIndex(raw: string): number | null {
  const text = raw.trim();
  const iso = /^(\d{4})-(\d{2})(?:-\d{2})?$/.exec(text);
  if (iso) return Number(iso[2]) >= 1 && Number(iso[2]) <= 12 ? Number(iso[1]) * 12 + Number(iso[2]) - 1 : null;
  const years = text.match(/\b(?:1[5-9]\d{2}|20\d{2}|21\d{2})\b/g) ?? [];
  if (years.length !== 1) return null;
  const year = Number(years[0]);
  const words = text.replace(year.toString(), ' ').toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
  const quarter = words.map((w) => /^q([1-4])$/.exec(w)).find(Boolean);
  if (quarter) return year * 12 + (Number(quarter[1]) - 1) * 3;
  const month = words.map((w) => MONTHS.findIndex((m) => m === w || (w.length === 3 && m.startsWith(w)))).find((i) => i >= 0);
  if (month !== undefined) return year * 12 + month;
  const part = words.map((w) => PART_MONTH[w]).find((i) => i !== undefined);
  if (part !== undefined) return year * 12 + part;
  return words.length === 0 ? year * 12 : null;
}

/**
 * "stated 5 Oct 2026" for a milestone dated after the research was captured:
 * a forward-looking claim is a statement made on the capture date, not a
 * fact on its own date. Null for past or unreadable dates, or when the
 * capture date is unknown (never a guessed one).
 */
export function statedNote(eventDate: string, capturedAt: string | null | undefined): string | null {
  const at = eventDateIndex(eventDate);
  const captured = capturedAt ? new Date(capturedAt) : null;
  if (at === null || !captured || !Number.isFinite(captured.getTime())) return null;
  if (at <= captured.getUTCFullYear() * 12 + captured.getUTCMonth()) return null;
  const day = formatDate(captured);
  return `stated ${day}`;
}

/**
 * Milestones newest first, in one consistent order. Dates that cannot be read
 * go last in the order research gave them; titles are passed through untouched.
 */
export function newestFirst<T extends { date: string }>(events: readonly T[]): T[] {
  return events
    .map((event, order) => ({ event, order, at: eventDateIndex(event.date) }))
    .sort((a, b) => (a.at === null && b.at === null ? a.order - b.order
      : a.at === null ? 1 : b.at === null ? -1 : b.at - a.at || a.order - b.order))
    .map((row) => row.event);
}
