/**
 * "Research this product" as one fan-out: the grounded brief (product-brief.ts),
 * product news (product-news.ts) and product videos (product-videos.ts), merged
 * into one stored ProductBrief. The repository keeps only thin hooks around
 * these pure functions.
 *
 * Cost: the news lanes are free searches with no model call; the videos path is
 * two free searches, oEmbed checks, and at most one structure call (none when
 * every survivor is the company's own channel). Extras are refreshed on a
 * cadence (news 3 days, videos 14 days), never on every open.
 */
import type { Citation, Company, ProductBrief } from '@mi/contracts';
import { usableCitations } from '@mi/contracts';
import { findProductNews } from './product-news';
import { findProductVideos } from './product-videos';
import type { VideoJsonFetcher } from './history-video';
import type { LlmClient } from './types';
import type { WebSearchFn } from './web-search';

export const NEWS_STALE_MS = 3 * 86_400_000;
export const VIDEOS_STALE_MS = 14 * 86_400_000;

export interface ProductExtrasArgs {
  company: Pick<Company, 'id' | 'name' | 'websiteUrl'>;
  productName: string;
  siblings?: readonly string[];
  client: LlmClient;
  fetchJson?: VideoJsonFetcher;
  newsLanes: ReadonlyArray<WebSearchFn | null | undefined>;
  videoLanes: ReadonlyArray<WebSearchFn | null | undefined>;
  /** Which parts to (re)run. */
  parts: { news: boolean; videos: boolean };
  signal?: AbortSignal;
  now?: () => Date;
}

export type ProductExtras = Partial<Pick<ProductBrief, 'news' | 'newsCheckedAt' | 'videos' | 'videosCheckedAt'>> & { citations: Citation[] };

/** The extras that really ran. A search that could not run leaves its field absent, so it is tried again later. */
export async function researchProductExtras(args: ProductExtrasArgs): Promise<ProductExtras> {
  const now = args.now?.() ?? new Date();
  const out: ProductExtras = { citations: [] };
  const [news, videos] = await Promise.all([
    args.parts.news
      ? findProductNews({ company: args.company, productName: args.productName, siblings: args.siblings, searches: args.newsLanes, now, signal: args.signal }).catch((e: unknown) => { if (args.signal?.aborted) throw e; return null; })
      : null,
    args.parts.videos
      ? findProductVideos({ company: args.company, productName: args.productName, siblings: args.siblings, client: args.client, fetchJson: args.fetchJson, searches: args.videoLanes, signal: args.signal, now: () => now }).catch((e: unknown) => { if (args.signal?.aborted) throw e; return null; })
      : null,
  ]);
  if (news?.searched) {
    out.news = news.items;
    out.newsCheckedAt = now.toISOString();
    out.citations.push(...news.items.map((n) => ({ title: `${n.title}${n.publisher ? ` (${n.publisher})` : ''}`, url: n.url })));
  }
  if (videos?.searched) {
    out.videos = videos.videos;
    out.videosCheckedAt = now.toISOString();
    out.citations.push(...videos.citations);
  }
  return out;
}

/** Whether the stored brief's news/videos are missing or older than their cadence (and so worth refreshing on an explicit ask). */
export function staleExtras(brief: ProductBrief, now: number, canVideos: boolean): { news: boolean; videos: boolean } {
  const old = (at: string | undefined, ms: number) => !at || !Number.isFinite(Date.parse(at)) || now - Date.parse(at) > ms;
  return { news: old(brief.newsCheckedAt, NEWS_STALE_MS), videos: canVideos && old(brief.videosCheckedAt, VIDEOS_STALE_MS) };
}

/** The brief with fresh extras applied; an extra that did not run keeps what was stored. */
export function mergeExtras(brief: ProductBrief, extras: ProductExtras): ProductBrief {
  const known = new Set(brief.citations.map((c) => c.url));
  const added = usableCitations(extras.citations).filter((c) => !known.has(c.url));
  return {
    ...brief,
    ...(extras.news !== undefined ? { news: extras.news, newsCheckedAt: extras.newsCheckedAt } : {}),
    ...(extras.videos !== undefined ? { videos: extras.videos, videosCheckedAt: extras.videosCheckedAt } : {}),
    citations: [...brief.citations, ...added].slice(0, 40),
  };
}

/** A brief with no researched prose, for a product whose grounded pass found nothing but whose news or videos were found. */
export function extrasOnlyBrief(identity: { companyId: string; productName: string; generatedAt: string }, extras: ProductExtras): ProductBrief {
  return mergeExtras({ ...identity, overview: '', metrics: [], sentiment: null, timeline: [], citations: [] }, extras);
}

/** Whether the extras found anything worth a page. */
export function extrasHaveContent(extras: ProductExtras): boolean {
  return (extras.news?.length ?? 0) > 0 || (extras.videos?.length ?? 0) > 0;
}
