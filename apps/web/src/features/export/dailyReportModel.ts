/**
 * The day's report for one company as data: a cover, then each dated update
 * with its source, the picture or page capture its source published, and the
 * sources as numbered footnotes. Nothing is written beyond what the sources
 * and the stored research said: headlines are the publishers' own, and social
 * items carry the sentiment research tagged them with.
 */
import { publisherOf } from '@mi/contracts';
import { formatDate, formatDateLong } from '@/lib/format';
import type { TodayUpdate } from '@/features/today/todayUpdates';
import { KIND_LABEL } from '@/features/today/todayUpdates';
import { exportSource } from './exportModel';
import type { ReportCompanyInfo, ReportImage } from './topicReportModel';

export interface DailyReportItem {
  n: number;
  kindLabel: string;
  title: string;
  /** "Reuters · Oct 15, 2026", or "Reddit · found Oct 15, 2026" when the source gave no date. */
  byline: string;
  summary: string | null;
  sentiment: TodayUpdate['sentiment'];
  images: ReportImage[];
  source: { title: string; url: string; direct: boolean };
}

export interface DailyReportModel {
  company: ReportCompanyInfo;
  dateText: string;
  items: DailyReportItem[];
  counts: Array<{ label: string; count: number }>;
}


export function buildDailyReportModel(
  company: ReportCompanyInfo,
  updates: readonly TodayUpdate[],
  images: ReadonlyMap<string, ReportImage[]> = new Map(),
  now: Date = new Date(),
): DailyReportModel {
  const items = updates.map((u, i): DailyReportItem => {
    const when = formatDate(u.at);
    return {
      n: i + 1,
      kindLabel: KIND_LABEL[u.kind],
      title: u.title,
      byline: `${u.publisher ?? publisherOf(u.url, u.title)} · ${u.dateKind === 'found' ? `found ${when}` : when}`,
      summary: u.summary,
      sentiment: u.sentiment,
      images: images.get(u.id) ?? [],
      source: exportSource({ url: u.url, title: u.publisher }),
    };
  });
  const counts = (['release', 'filing', 'news', 'social'] as const)
    .map((kind) => ({ label: KIND_LABEL[kind], count: updates.filter((u) => u.kind === kind).length }))
    .filter((c) => c.count > 0);
  return {
    company,
    dateText: formatDateLong(now, { weekday: true }),
    items,
    counts,
  };
}
