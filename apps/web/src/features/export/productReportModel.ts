/**
 * A product's page as data, for the screen and for its PDF report. Everything
 * here is stored or sourced: the product's own record, the researched brief
 * when someone ran it, the roadmap items and news stories that name the
 * product. Where nothing is reported a figure is null ("Not reported"); a
 * researched figure with no usable source is dropped, never shown bare.
 */
import type { LiveIntelItem, Product, ProductBrief, RoadmapItem } from '@mi/contracts';
import { formatDate, formatDateLong } from '@/lib/format';
import { exportSource } from './exportModel';
import type { ReportCompanyInfo, ReportFootnote } from './topicReportModel';

export type Sentiment = 'positive' | 'neutral' | 'negative';

export interface ProductStory {
  title: string;
  url: string;
  publisher: string | null;
  date: string | null;
  sentiment: Sentiment;
}

export interface MetricRow {
  label: string;
  value: string | null;
  asOf: string | null;
  source: { title: string; url: string } | null;
}

export interface TimelineRow {
  date: string | null;
  title: string;
  detail: string;
  sourceUrl: string | null;
  origin: 'research' | 'roadmap';
}

const isWeb = (url: string | null | undefined): url is string => !!url && /^https?:\/\//i.test(url);

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** True when `text` names the product as a whole word. Names under 3 letters never match (too ambiguous). */
export function mentionsProduct(text: string, name: string, siblings: readonly string[] = []): boolean {
  const n = name.trim();
  if (n.length < 3) return false;
  const word = (w: string, flags: string) => new RegExp(`(^|[^\\p{L}\\p{N}])${escapeRe(w.trim())}(?=$|[^\\p{L}\\p{N}])`, flags);
  // A longer product of the same company that contains this name ("Claude Code" for "Claude") is not this product.
  let rest = text;
  for (const s of siblings.filter((x) => x.trim().length > n.length && word(n, 'iu').test(x)).sort((a, b) => b.length - a.length)) {
    rest = rest.replace(word(s, 'giu'), ' ');
  }
  return word(n, 'iu').test(rest);
}

export function relatedStories(items: readonly LiveIntelItem[], productName: string, max = 6, siblings: readonly string[] = []): ProductStory[] {
  return items
    .filter((i) => isWeb(i.url) && mentionsProduct(`${i.title} ${i.summary ?? ''}`, productName, siblings))
    .slice(0, max)
    .map((i) => ({ title: i.title, url: i.url, publisher: i.publisher ?? null, date: i.publishedDate ?? null, sentiment: i.sentiment }));
}

export function relatedRoadmap(items: readonly RoadmapItem[], productName: string, siblings: readonly string[] = []): RoadmapItem[] {
  return items.filter((r) => mentionsProduct(`${r.title} ${r.detail}`, productName, siblings));
}

export function sentimentTally(stories: readonly ProductStory[]): Record<Sentiment, number> {
  const out: Record<Sentiment, number> = { positive: 0, neutral: 0, negative: 0 };
  for (const s of stories) out[s.sentiment] += 1;
  return out;
}

const HORIZON_LABEL: Record<RoadmapItem['horizon'], string> = { now: 'On the roadmap: now', next: 'On the roadmap: next', later: 'On the roadmap: later' };

/** Sourced milestones first, in the order research gave them; roadmap items follow. No dates are made up. */
export function productTimeline(brief: ProductBrief | null, roadmap: readonly RoadmapItem[]): TimelineRow[] {
  const researched: TimelineRow[] = (brief?.timeline ?? []).map((t) => ({
    date: t.date.trim() || null,
    title: t.title,
    detail: t.detail,
    sourceUrl: isWeb(t.sourceUrl) ? t.sourceUrl : null,
    origin: 'research',
  }));
  const planned: TimelineRow[] = roadmap.map((r) => ({
    date: r.date?.trim() || null,
    title: r.title,
    detail: r.detail ? `${HORIZON_LABEL[r.horizon]}. ${r.detail}` : HORIZON_LABEL[r.horizon],
    sourceUrl: null,
    origin: 'roadmap',
  }));
  return [...researched, ...planned];
}

const STATUS_LABEL: Record<NonNullable<Product['status']>, string> = { live: 'Live', beta: 'Beta', sunset: 'Sunset' };

/** The product's stored facts first, then the researched metrics that carry a source. */
export function metricRows(product: Product, brief: ProductBrief | null): MetricRow[] {
  const rows: MetricRow[] = [
    { label: 'Status', value: product.status ? STATUS_LABEL[product.status] : null, asOf: null, source: null },
    { label: 'Revenue role', value: product.revenueNote?.trim() || null, asOf: null, source: null },
  ];
  if (brief?.launched) {
    const url = brief.launched.sourceUrl;
    rows.splice(1, 0, {
      label: 'Launched', value: isWeb(url) ? brief.launched.date : null, asOf: null,
      source: isWeb(url) ? { title: exportSource({ url }).title, url } : null,
    });
  }
  for (const m of brief?.metrics ?? []) {
    const sourced = isWeb(m.sourceUrl);
    rows.push({
      label: m.label,
      value: sourced && m.value?.trim() ? m.value.trim() : null,
      asOf: sourced ? m.asOf?.trim() || null : null,
      source: sourced ? { title: m.sourceTitle?.trim() || exportSource({ url: m.sourceUrl! }).title, url: m.sourceUrl! } : null,
    });
  }
  return rows;
}

export interface ProductNewsRow { title: string; url: string; publisher: string | null; date: string | null }
export interface ProductVideoRow { title: string; channel: string; url: string; date: string | null; official: boolean }

export interface ProductReportModel {
  company: ReportCompanyInfo;
  product: { name: string; status: string | null; url: string | null };
  dateText: string;
  /** The stored description, then the researched overview when there is one. */
  overview: { stored: string | null; researched: string | null };
  metrics: MetricRow[];
  sentiment: { summary: string; positive: string[]; negative: string[] } | null;
  stories: ProductStory[];
  timeline: TimelineRow[];
  footnotes: ReportFootnote[];
  /** Footnote number for each source url used above (keyed by the url as stored). */
  noteByUrl: Record<string, number>;
  researched: boolean;
  /** Who it is for, as sources state it; null = not reported. */
  audience: string | null;
  /** The first launch a source dates; null = not reported. */
  launched: { date: string; title: string } | null;
  /** Product-specific news (publisher headlines, dated), newest first. */
  news: ProductNewsRow[];
  /** Verified YouTube videos, latest first. */
  videos: ProductVideoRow[];
}

/** The brief's product news as rows, newest first; only web links. */
export function newsRows(brief: ProductBrief | null): ProductNewsRow[] {
  return (brief?.news ?? []).filter((n) => isWeb(n.url))
    .sort((a, b) => Date.parse(b.publishedAt) - Date.parse(a.publishedAt))
    .map((n) => ({ title: n.title, url: n.url, publisher: n.publisher, date: Number.isFinite(Date.parse(n.publishedAt)) ? formatDate(n.publishedAt) : null }));
}

export const youtubeWatch = (id: string): string => `https://www.youtube.com/watch?v=${id}`;

/** The brief's verified videos as rows, in the stored (latest first) order. */
export function videoRows(brief: ProductBrief | null): ProductVideoRow[] {
  return (brief?.videos ?? []).map((v) => ({
    title: v.title, channel: v.channel, url: youtubeWatch(v.id), official: v.official,
    date: v.publishedAt && Number.isFinite(Date.parse(v.publishedAt)) ? formatDate(v.publishedAt) : null,
  }));
}

export function buildProductReportModel(args: {
  company: ReportCompanyInfo;
  product: Product;
  brief: ProductBrief | null;
  stories: readonly ProductStory[];
  roadmap: readonly RoadmapItem[];
  now?: Date;
}): ProductReportModel {
  const { product, brief } = args;
  const sentiment = brief?.sentiment && (brief.sentiment.summary.trim() || brief.sentiment.positive.length || brief.sentiment.negative.length)
    ? { summary: brief.sentiment.summary.trim(), positive: brief.sentiment.positive, negative: brief.sentiment.negative }
    : null;
  const footnotes: ReportFootnote[] = [];
  const noteByUrl: Record<string, number> = {};
  const note = (url: string | null | undefined, title?: string | null) => {
    if (!isWeb(url) || noteByUrl[url] !== undefined) return;
    noteByUrl[url] = footnotes.length + 1;
    footnotes.push({ n: footnotes.length + 1, ...exportSource({ url, title }) });
  };
  const metrics = metricRows(product, brief);
  metrics.forEach((m) => note(m.source?.url, m.source?.title));
  brief?.sentiment?.sources.forEach((s) => note(s.url, s.title));
  const timeline = productTimeline(brief, args.roadmap);
  timeline.forEach((t) => note(t.sourceUrl));
  args.stories.forEach((s) => note(s.url, s.publisher ?? s.title));
  const news = newsRows(brief);
  news.forEach((n) => note(n.url, n.publisher ?? n.title));
  const videos = videoRows(brief);
  videos.forEach((v) => note(v.url, `${v.title} (${v.channel}, YouTube)`));
  return {
    company: args.company,
    product: { name: product.name, status: product.status ? STATUS_LABEL[product.status] : null, url: isWeb(product.url) ? product.url : null },
    dateText: formatDateLong(args.now ?? new Date()),
    overview: { stored: product.description?.trim() || null, researched: brief?.overview.trim() || null },
    metrics,
    sentiment,
    stories: [...args.stories],
    timeline,
    footnotes,
    noteByUrl,
    researched: !!brief,
    audience: brief?.audience?.trim() || null,
    launched: brief?.launched ? { date: brief.launched.date, title: brief.launched.title } : null,
    news,
    videos,
  };
}
