/**
 * Real pictures for a topic report: the cover image each source publishes for
 * link previews, and a capture of the source page itself. Both are credited
 * and tied to the page they came from; nothing is generated. A section with
 * no picture simply has none: the layout does not need one to hold together.
 */
import { publisherOf, usableCitations, type Report, type ReportSection, type ReportTopic } from '@mi/contracts';
import { getRealCover, type RealCover } from '@/lib/media/realCover';
import { SHOT_MAX_ATTEMPTS, SHOT_PLACEHOLDER_MAX_WIDTH, SHOT_RETRY_MS, pageShotUrl, pageShotUrlAlt } from '@/lib/screenshot';
import { isDirectSource } from '@/lib/sourceHref';
import type { ReportImage } from './topicReportModel';

/** Page captures cost time, so only the first few sections get one. */
const SHOT_SECTIONS = 3;
/** Sources tried per section before giving up on a cover. */
const COVER_TRIES = 3;
/** How many capture attempts of the primary service before the second one. */
const PRIMARY_SHOT_ATTEMPTS = Math.min(4, SHOT_MAX_ATTEMPTS);

/**
 * Hosts whose pages a capture service only ever gets a login or "blocked" wall
 * from. A capture of those would print the wall as if it were the source, so no
 * page capture is taken (a picture the page itself publishes is still used).
 */
const NO_CAPTURE_HOSTS = /(^|\.)(reddit\.com|redd\.it|x\.com|twitter\.com|t\.co|facebook\.com|fb\.com|instagram\.com|linkedin\.com|tiktok\.com|threads\.net|bsky\.app|quora\.com|discord\.com)$/i;

export function captureAllowed(pageUrl: string): boolean {
  try { return !NO_CAPTURE_HOSTS.test(new URL(pageUrl).hostname); } catch { return false; }
}

export interface ReportImageDeps {
  cover: (pageUrl: string) => Promise<RealCover | null>;
  /** A displayable capture URL of the page, or null when none materialises. */
  shot: (pageUrl: string) => Promise<string | null>;
}

function loadWidth(src: string, timeoutMs: number): Promise<number> {
  return new Promise((resolve) => {
    if (typeof Image === 'undefined') { resolve(0); return; }
    const img = new Image();
    const timer = setTimeout(() => resolve(0), timeoutMs);
    img.onload = () => { clearTimeout(timer); resolve(img.naturalWidth); };
    img.onerror = () => { clearTimeout(timer); resolve(0); };
    img.src = src;
  });
}

const wait = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** The capture service answers with a small "generating" placeholder first; keep asking until the real one arrives. */
async function liveShot(pageUrl: string): Promise<string | null> {
  for (let attempt = 0; attempt < PRIMARY_SHOT_ATTEMPTS; attempt += 1) {
    const src = pageShotUrl(pageUrl, attempt);
    if ((await loadWidth(src, 8000)) >= SHOT_PLACEHOLDER_MAX_WIDTH) return src;
    if (attempt < PRIMARY_SHOT_ATTEMPTS - 1) await wait(SHOT_RETRY_MS);
  }
  const alt = pageShotUrlAlt(pageUrl);
  return (await loadWidth(alt, 10000)) >= SHOT_PLACEHOLDER_MAX_WIDTH ? alt : null;
}

const DEFAULT_DEPS: ReportImageDeps = { cover: getRealCover, shot: liveShot };

/** One section's pictures: a cover from its sources, and (when asked) a capture of its lead source. */
export async function resolveSectionImages(
  section: ReportSection,
  withShot: boolean,
  used: Set<string> = new Set(),
  deps: ReportImageDeps = DEFAULT_DEPS,
): Promise<ReportImage[]> {
  const pages = usableCitations(section.citations).filter((c) => isDirectSource(c.url) && /^https:\/\//i.test(c.url));
  const images: ReportImage[] = [];
  for (const page of pages.slice(0, COVER_TRIES)) {
    const cover = await deps.cover(page.url).catch(() => null);
    if (cover?.src && !used.has(cover.src)) {
      used.add(cover.src);
      images.push({ src: cover.src, credit: cover.publisher ?? publisherOf(page.url, page.title), sourceUrl: page.url, kind: 'cover' });
      break;
    }
  }
  const first = pages.find((page) => captureAllowed(page.url));
  if (first && withShot) {
    const shot = await deps.shot(first.url).catch(() => null);
    if (shot) images.push({ src: shot, credit: publisherOf(first.url, first.title), sourceUrl: first.url, kind: 'screenshot' });
  }
  return images;
}

/** Which sections get a page capture: the first few that have a source to capture. */
export function shotSections(sections: readonly ReportSection[]): Set<ReportTopic> {
  const picked = new Set<ReportTopic>();
  for (const section of sections) {
    if (picked.size >= SHOT_SECTIONS) break;
    if (usableCitations(section.citations).some((c) => isDirectSource(c.url) && /^https:\/\//i.test(c.url) && captureAllowed(c.url))) picked.add(section.topic);
  }
  return picked;
}

export async function resolveReportImages(
  report: Pick<Report, 'sections'>,
  deps: ReportImageDeps = DEFAULT_DEPS,
): Promise<Map<ReportTopic, ReportImage[]>> {
  const sections = report.sections ?? [];
  const withShot = shotSections(sections);
  const used = new Set<string>();
  const out = new Map<ReportTopic, ReportImage[]>();
  await Promise.all(sections.map(async (section) => {
    const images = await resolveSectionImages(section, withShot.has(section.topic), used, deps);
    if (images.length > 0) out.set(section.topic, images);
  }));
  return out;
}

/** A cover and a capture for one dated update, each credited to the page it came from. Pictures are never made up. */
export async function resolveUpdateImages(
  updates: ReadonlyArray<{ id: string; url: string; title: string }>,
  deps: ReportImageDeps = DEFAULT_DEPS,
): Promise<Map<string, ReportImage[]>> {
  const out = new Map<string, ReportImage[]>();
  const used = new Set<string>();
  await Promise.all(updates.map(async (update, index) => {
    if (!isDirectSource(update.url) || !/^https:\/\//i.test(update.url)) return;
    const images: ReportImage[] = [];
    const cover = await deps.cover(update.url).catch(() => null);
    if (cover?.src && !used.has(cover.src)) {
      used.add(cover.src);
      images.push({ src: cover.src, credit: cover.publisher ?? publisherOf(update.url, update.title), sourceUrl: update.url, kind: 'cover' });
    }
    // A page capture only for the first few, and only when the page published no picture of its own.
    if (images.length === 0 && index < SHOT_SECTIONS && captureAllowed(update.url)) {
      const shot = await deps.shot(update.url).catch(() => null);
      if (shot) images.push({ src: shot, credit: publisherOf(update.url, update.title), sourceUrl: update.url, kind: 'screenshot' });
    }
    if (images.length > 0) out.set(update.id, images);
  }));
  return out;
}
