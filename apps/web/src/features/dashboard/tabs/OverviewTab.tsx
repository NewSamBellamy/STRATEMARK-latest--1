import { sourceHref } from '@/lib/sourceHref';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, ChevronLeft, ChevronRight, ExternalLink, SearchX } from 'lucide-react';
import { publisherOf, type CompanyMetric, type CompanyVideo, type LiveIntelItem } from '@mi/contracts';
import { useCompany, useCompanyMetrics, useDashboardTab } from '@/hooks/data';
import { ResearchMarkdown } from '@/components/ResearchMarkdown';
import { ErrorState } from '@/components/states/ErrorState';
import { cn } from '@/lib/cn';
import { HydratingPanel } from './HydratingPanel';
import {
  FILL_HINT,
  extractTakeaways,
  pickKpis,
  isKnown,
  parseOverviewSections,
  rankInDeck,
  splitAttribution,
  type PeerRanking,
} from '../dashboardModel';
import { metricLabel, useTabHref } from '../dashboardKit';
import { TabSection } from './TabKit';
import { SourceCheck } from '../SourceCheck';
import { usePeers } from '../usePeers';
import { buildFigureSet, currencyCaptionFor, figureDisplay, figureTrust, linkedCitation } from '../figureSet';
import { figureCaveats, rowDates, type FigureCaveats } from '../figureCaveats';
import { useCachedDashboardTab } from '../useCachedTab';
import { newestFirst, sourceCoverage, statedNote } from '../overviewTruth';
import { ArticleReader, StoryMeta } from './LiveIntelTab';
import { SitePreview } from './LiveLandingTab';
import { StoryImage, VideoPlayer, VideoTile } from '@/components/media/StoryMedia';
import { MarketPeers, OverviewSnapshot } from './OverviewSnapshot';
import { OverviewCoverage } from './OverviewCoverage';
import { YourResearch } from './YourResearch';
import { overviewParagraph } from '../overviewSummary';
import { UNSUPPORTED_COMPANY_SUMMARY } from '@mi/research';

/**
 * Overview: the company in one screen, nothing repeated.
 *
 *   1. Key figures: the card's own four, each with its source and date
 *   2. What's happening: the newest stories with their own pictures
 *   3. Summary beside a live capture of their website
 *   4. Their own videos, then dated milestones
 *   5. The full research brief, folded away
 *
 * Peer comparison lives on Metrics (one place), and sources live with the
 * figure or sentence they back, not in a box at the bottom.
 */

const SECTION_LABELS: Record<string, string> = {
  'source-reported background': 'Who they are',
  'products and services': 'What they do',
  'market position': 'Where they stand',
  'customers and distribution': 'Customers & reach',
};
const sectionLabel = (title: string) => SECTION_LABELS[title.toLowerCase()] ?? title;

/** Sources as a quiet inline line ("anthropic.com · reuters.com"), not a row of pills. */
function SourceChips({ links }: { links: Array<{ title: string; url: string }> }) {
  if (links.length === 0) return null;
  const seen = new Set<string>();
  const unique = links.filter((link) => {
    const name = publisherOf(link.url, link.title);
    return !seen.has(name) && Boolean(seen.add(name));
  });
  return (
    <p className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11.5px] text-faint">
      {unique.slice(0, 4).map((link, i) => (
        <span key={link.url} className="inline-flex items-center gap-2">
          {i > 0 && <span aria-hidden>·</span>}
          <a href={sourceHref(link.url, link.title)} target="_blank" rel="noopener noreferrer" className="hover:text-primary-ink hover:underline">
            {publisherOf(link.url, link.title)}
          </a>
        </span>
      ))}
      {unique.length > 4 && <span>+{unique.length - 4}</span>}
    </p>
  );
}

/** One brief paragraph with its own source chips; shared with tabs that reuse the brief. */
export function Paragraph({ block }: { block: string }) {
  const { text, links } = splitAttribution(block);
  return (
    <div>
      <div className="markdown text-[14.5px] leading-7 text-content"><ResearchMarkdown text={text} /></div>
      <SourceChips links={links} />
    </div>
  );
}

/** "- Label: value — attribution ([source](url))" → a clean figure row. */
function FigureRow({ line }: { line: string }) {
  const match = line.match(/^(.+?):\s*(.+?)\s+—\s+(.+)$/);
  if (!match) return <li className="py-2 text-sm text-content">{line}</li>;
  const [, label = '', value = '', attribution = ''] = match;
  return (
    <li className="flex items-baseline justify-between gap-4 py-2.5">
      <span className="text-sm text-muted">{label}</span>
      <span className="text-right">
        <span className="font-display text-base font-semibold tabular-nums text-content">{value}</span>
        <span className="block text-xs text-muted"><ResearchMarkdown text={attribution} /></span>
      </span>
    </li>
  );
}

function Empty({ title, text }: { title: string; text: string }) {
  return (
    <div className="rounded-xl border border-dashed border-border bg-surface-2/40 px-4 py-6 text-center">
      <p className="text-sm font-medium text-content">{title}</p>
      <p className="mx-auto mt-1 max-w-md text-[12.5px] leading-snug text-muted">{text}</p>
    </div>
  );
}

// ---- Key figures: the same figure set the Metrics tab reads ----------------

// One strip of figures divided by hairlines (the strip's background shows through a 1px gap).
// The cells divide the row evenly: all in one row where there is width, and a lone last cell
// in the 2-up grid spans it, so no slot is left empty.
const ORPHAN_SPAN = '[&>:last-child:nth-child(odd)]:col-span-2';
const KPI_COLUMNS: Record<number, string> = {
  0: 'lg:grid-cols-4',
  1: 'lg:grid-cols-1 lg:[&>:last-child:nth-child(odd)]:col-span-1',
  2: 'lg:grid-cols-2',
  3: 'lg:grid-cols-3 lg:[&>:last-child:nth-child(odd)]:col-span-1',
  4: 'lg:grid-cols-4',
  5: 'lg:grid-cols-5 lg:[&>:last-child:nth-child(odd)]:col-span-1',
  6: 'lg:grid-cols-3',
};

/**
 * Where a figure sits in the deck: a short track with the deck's companies as ticks, the
 * leader on the left and this company marked. Drawn from the rank alone (only companies with
 * a known, comparable figure take part), so it adds no number of its own.
 */
export function RankTrack({ rank, of }: { rank: number; of: number }) {
  const at = of > 1 ? ((rank - 1) / (of - 1)) * 100 : 0;
  return (
    <span className="relative block h-2 w-full" aria-hidden>
      <span className="absolute inset-x-0 top-1/2 h-px -translate-y-1/2 bg-border" />
      <span className="absolute top-1/2 h-2 w-2 -translate-x-1/2 -translate-y-1/2 rounded-full bg-content ring-2 ring-surface" style={{ left: `${at}%` }} />
    </span>
  );
}

/**
 * One key figure. It reads the same figure set as Metrics, so a figure found
 * there is found here, an estimate keeps its "est." marker, and a figure that
 * does not exist stays "Not found yet" (never imputed). The currency is shown
 * as reported; the card face and its figure counter are separate and untouched.
 */
function FigureTile({ metric, ranking, href, group }: { metric: CompanyMetric; ranking: PeerRanking | null; href: string; group: FigureCaveats }) {
  const type = metric.metricType;
  const label = metricLabel(metric);
  if (!isKnown(metric)) {
    return (
      <article className="flex min-w-0 flex-col bg-surface px-4 py-4 sm:px-5" aria-label={`${label}: Not found yet`}>
        <h3 className="truncate text-[11.5px] font-medium text-muted">{label}</h3>
        <p className="mt-2 flex items-center gap-1.5 text-[15px] font-medium text-faint">
          <SearchX className="h-4 w-4" aria-hidden />
          Not found yet
        </p>
        <p className="mt-1.5 text-[11.5px] leading-snug text-faint">{FILL_HINT[type]}</p>
      </article>
    );
  }
  const citation = linkedCitation(metric);
  const dates = rowDates(metric, group);
  const currency = currencyCaptionFor(metric);
  const estimated = metric.confidence === 'estimated';
  const display = figureDisplay(metric);
  const ranked = ranking?.rank != null && ranking.of > 1 ? ranking : null;
  return (
    <article
      className="flex min-w-0 flex-col bg-surface px-4 py-4 sm:px-5"
      aria-label={`${label}: ${display}${estimated ? ' (estimated)' : ''}`}
    >
      <h3 className="truncate text-[11.5px] font-medium text-muted">{label}</h3>
      <p className="mt-1.5 font-display text-[28px] font-semibold leading-none tracking-tight tabular-nums text-content">
        {display}
        {/* A real space, not margin: copy-paste and screen readers otherwise get "$8.0Best.". */}
        {estimated && <>{' '}<abbr title="Estimated" className="align-top text-[11px] font-normal tracking-normal text-faint no-underline">est.</abbr></>}
      </p>
      {ranked && (
        <Link to={href} className="group/rank mt-3 block rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
          title={`Ranked among ${ranked.of} companies in this deck with a known figure${ranked.unknownPeers ? `; ${ranked.unknownPeers} without one are left out` : ''}${ranked.includesEstimates ? '; includes estimates' : ''}.`}>
          <RankTrack rank={ranked.rank!} of={ranked.of} />
          <span className="mt-1.5 block text-[11.5px] text-muted group-hover/rank:text-primary-ink">
            <span className="font-semibold tabular-nums text-content">#{ranked.rank}</span> of {ranked.of} in this deck
          </span>
        </Link>
      )}
      <div className="mt-auto pt-3 text-[11px] leading-snug text-faint">
        <p className="truncate">
          {citation ? (
            <a href={sourceHref(citation.url, citation.title)} target="_blank" rel="noopener noreferrer" className="inline-flex max-w-full items-center gap-1 text-muted hover:text-primary-ink hover:underline">
              <span className="truncate">{publisherOf(citation.url, citation.title)}</span>
              <ExternalLink className="h-3 w-3 shrink-0" aria-hidden />
            </a>
          ) : metric.confidence === 'user_verified' ? 'Your correction' : 'No link recorded'}
        </p>
        <p className="mt-0.5">
          {figureTrust(metric)}{dates.period ? ` · For ${dates.period}` : dates.notReported ? ' · Period not reported' : ''}
        </p>
        {dates.record && <p>{dates.record}</p>}
        {currency && <p className="mt-1 text-muted">{currency}</p>}
        <SourceCheck metric={metric} label={label} className="mt-1" groupedUndated={group.noPeriod} />
      </div>
    </article>
  );
}

// ---- What's happening ----------------------------------------------------

/** The scoop: today's stories with their pictures. Starts the news search if
 * this company has none yet (the same pass the Live Intel tab would run). */
const HEADLINES = 3;

/** A story's own stored picture, or the publisher's initial: never fetched here, never made up. */
export function StoryThumb({ item }: { item: LiveIntelItem }) {
  const publisher = item.publisher ?? publisherOf(item.url, null) ?? '';
  const initial = (publisher.replace(/^(?:www\.|the\s+)/i, '').match(/[A-Za-z0-9]/)?.[0] ?? '•').toUpperCase();
  const monogram = (
    <span className="grid h-full w-full place-items-center bg-surface-2 font-display text-lg font-semibold text-muted" aria-hidden>{initial}</span>
  );
  return (
    <span className="relative block h-14 w-[76px] shrink-0 overflow-hidden rounded-lg border border-border sm:h-16 sm:w-24">
      {item.imageUrl
        ? <StoryImage pageUrl={null} imageUrl={item.imageUrl} publisher={item.publisher} className="absolute inset-0" fallback={monogram} />
        : monogram}
    </span>
  );
}

function Happening({ companyId, companyName }: { companyId: string; companyName: string }) {
  const href = useTabHref(companyId);
  const intel = useDashboardTab(companyId, 'live_intel');
  const [openId, setOpenId] = useState<string | null>(null);
  const items = useMemo(() => [...(intel.data?.content.items ?? [])]
    .filter((i) => !i.stale)
    .sort((a, b) => (b.publishedDate ?? '').localeCompare(a.publishedDate ?? '')), [intel.data]);
  const open = openId ? items.find((i) => i.id === openId) ?? null : null;
  return (
    <TabSection
      title="What's happening"
      action={items.length > HEADLINES ? <Link to={href('live_intel')} className="inline-flex items-center gap-1 text-[12px] text-primary-ink hover:underline">All {items.length} stories <ArrowRight className="h-3 w-3" aria-hidden /></Link> : undefined}
    >
      {intel.isPending ? (
        <div className="panel h-[168px] animate-pulse bg-surface-2" aria-label="Finding the latest stories" />
      ) : items.length > 0 ? (
        // Compact on purpose: Live Intel owns the lead story and picture block. Each row shows
        // the picture research stored with the story; with none, the publisher's initial.
        <ul className="panel divide-y divide-border overflow-hidden">
          {items.slice(0, HEADLINES).map((item) => (
            <li key={item.id}>
              <button type="button" onClick={() => setOpenId(item.id)}
                className="group flex w-full items-start gap-4 px-4 py-3.5 text-left transition-colors hover:bg-surface-muted focus-visible:bg-surface-muted focus-visible:outline-none sm:px-5">
                <StoryThumb item={item} />
                <span className="min-w-0 flex-1 space-y-1">
                  <StoryMeta item={item} />
                  <span className="block text-[14.5px] font-medium leading-snug text-content group-hover:text-primary-ink">{item.title}</span>
                  {item.summary && item.summary.trim() !== item.title.trim() && (
                    <span className="line-clamp-1 block text-[12.5px] leading-snug text-muted max-sm:hidden">{item.summary}</span>
                  )}
                </span>
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="panel px-4 py-4 text-[13px] leading-snug text-muted">
          No recent coverage found. <Link to={href('live_intel')} className="text-primary-ink hover:underline">Search again</Link>
        </p>
      )}
      {open && <ArticleReader item={open} companyId={companyId} companyName={companyName} onClose={() => setOpenId(null)} />}
    </TabSection>
  );
}

/**
 * The company's own videos in one sideways row. Arrow buttons appear only when more are
 * stored than fit; the row also scrolls by touch, trackpad and keyboard.
 */
export function VideoScroller({ videos }: { videos: readonly CompanyVideo[] }) {
  const ref = useRef<HTMLUListElement>(null);
  const [playing, setPlaying] = useState<CompanyVideo | null>(null);
  const [edges, setEdges] = useState({ start: false, end: false });
  const sync = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    const start = el.scrollLeft > 1;
    const end = el.scrollLeft + el.clientWidth < el.scrollWidth - 1;
    setEdges((prev) => (prev.start === start && prev.end === end ? prev : { start, end }));
  }, []);
  useEffect(() => {
    sync();
    const el = ref.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(sync);
    ro.observe(el);
    return () => ro.disconnect();
  }, [sync, videos.length]);
  const page = (dir: 1 | -1) => {
    const el = ref.current;
    if (!el) return;
    const reduce = typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    el.scrollBy({ left: dir * el.clientWidth * 0.9, behavior: reduce ? 'auto' : 'smooth' });
  };
  const arrow = 'grid h-8 w-8 place-items-center rounded-full border border-border bg-surface text-content shadow-soft transition-colors hover:bg-surface-2 disabled:opacity-35 disabled:shadow-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40';
  const scrollable = edges.start || edges.end;
  return (
    <div>
      {scrollable && (
        <div className="mb-2 flex justify-end gap-1.5">
          <button type="button" className={arrow} onClick={() => page(-1)} disabled={!edges.start} aria-label="Earlier videos"><ChevronLeft className="h-4 w-4" aria-hidden /></button>
          <button type="button" className={arrow} onClick={() => page(1)} disabled={!edges.end} aria-label="More videos"><ChevronRight className="h-4 w-4" aria-hidden /></button>
        </div>
      )}
      <ul ref={ref} onScroll={sync} aria-label="Company videos"
        className="-mx-1 flex snap-x snap-mandatory gap-4 overflow-x-auto scroll-smooth px-1 pb-2 motion-reduce:scroll-auto [scrollbar-width:thin]">
        {videos.map((v) => (
          <li key={v.id} className="w-[72%] shrink-0 snap-start sm:w-[calc((100%-2rem)/3)] lg:w-[calc((100%-3rem)/4)]">
            <VideoTile video={v} onPlay={() => setPlaying(v)} />
          </li>
        ))}
      </ul>
      {playing && <VideoPlayer video={playing} onClose={() => setPlaying(null)} />}
    </div>
  );
}

/** The company's own latest videos, when its site links a YouTube channel. */
function Watch({ companyId }: { companyId: string }) {
  const videos = useCachedDashboardTab(companyId, 'live_intel').data?.content.videos ?? [];
  if (!videos.length) return null;
  return (
    <TabSection title="Watch" hint={videos.length > 1 ? `${videos.length} videos from the company's own channel` : "From the company's own channel"}>
      <VideoScroller videos={videos} />
    </TabSection>
  );
}

const TIMELINE_COLUMNS: Record<number, string> = { 1: 'md:grid-cols-1', 2: 'md:grid-cols-2', 3: 'md:grid-cols-3', 4: 'md:grid-cols-4', 5: 'md:grid-cols-5' };

/** Dated milestones, from the History tab when it has been researched. */
function Milestones({ companyId }: { companyId: string }) {
  const href = useTabHref(companyId);
  const history = useCachedDashboardTab(companyId, 'history').data;
  const timeline = newestFirst(history?.content.timeline ?? []).slice(0, 5);
  const ordered = [...timeline].reverse();
  if (!timeline.length) return null;
  return (
    <TabSection
      title="Milestones"
      action={<Link to={href('history')} className="inline-flex items-center gap-1 text-[12px] text-primary-ink hover:underline">Full history <ArrowRight className="h-3 w-3" aria-hidden /></Link>}
    >
      {/* A mini timeline, oldest to newest: across on wide screens, down on phones. */}
      <ol className={cn('panel relative grid gap-y-4 px-5 py-5 max-md:pl-9 md:gap-x-4 md:pt-6', TIMELINE_COLUMNS[ordered.length])} aria-label="Recent milestones, oldest first">
        <span aria-hidden className="absolute bottom-6 left-[21px] top-6 w-px bg-border md:inset-x-5 md:bottom-auto md:left-5 md:top-[29px] md:h-px md:w-auto" />
        {ordered.map((e, i) => {
          const latest = i === ordered.length - 1;
          const note = statedNote(e.date, history?.lastRefreshedAt);
          return (
            <li key={`${e.date}-${i}`} className="relative min-w-0 md:pt-5">
              <span aria-hidden className={cn(
                'absolute -left-[19px] top-1 h-2.5 w-2.5 rounded-full border-2 md:left-0 md:top-0',
                latest ? 'border-primary bg-primary' : 'border-primary/60 bg-surface',
              )} />
              <p className="text-[11.5px] font-medium tabular-nums text-muted">
                {e.date}
                {note && <span className="ml-1 font-normal text-faint">{note}</span>}
              </p>
              <p className="mt-0.5 line-clamp-3 text-[13px] leading-snug text-content" title={e.title}>{e.title}</p>
            </li>
          );
        })}
      </ol>
    </TabSection>
  );
}

/** A live capture of the company's own site, beside the summary. Hidden when
 * capture services are refused. */
function SiteGlance({ url }: { url: string }) {
  const [failed, setFailed] = useState(false);
  if (failed) return null;
  let host = url;
  try { host = new URL(url).hostname.replace(/^www\./, ''); } catch { /* keep raw */ }
  return (
    // Stretches to the summary's height beside it (no hole under a shorter capture); stacked, it keeps 16:10.
    <a href={url} target="_blank" rel="noopener noreferrer" className="panel group flex flex-col overflow-hidden" title={`Open ${host}`}>
      <div className="flex items-center gap-1.5 border-b border-border bg-surface-muted px-3 py-1.5">
        <span className="h-2 w-2 rounded-full bg-border" /><span className="h-2 w-2 rounded-full bg-border" /><span className="h-2 w-2 rounded-full bg-border" />
        <span className="ml-2 truncate text-[11px] text-faint">{host}</span>
        <ExternalLink className="ml-auto h-3 w-3 text-faint group-hover:text-primary-ink" aria-hidden />
      </div>
      <div className="relative aspect-[16/10] overflow-hidden bg-surface-2 lg:aspect-auto lg:min-h-[180px] lg:flex-1 dark:ring-1 dark:ring-inset dark:ring-border">
        <div className="absolute inset-0"><SitePreview url={url} fallbackShot={null} quiet onFail={() => setFailed(true)} /></div>
      </div>
    </a>
  );
}

// ---- Tab -------------------------------------------------------------------

export function OverviewTab({ companyId }: { companyId: string }) {
  const query = useDashboardTab(companyId, 'overview');
  const metricsQ = useCompanyMetrics(companyId);
  const metrics = useMemo(() => metricsQ.data ?? [], [metricsQ.data]);
  const peerState = usePeers();
  const href = useTabHref(companyId);
  const [briefIdx, setBriefIdx] = useState(0);

  // The same figure set the Metrics tab reads, from live metrics so a fresh
  // correction shows at once. Estimates are included and marked.
  const companyQ = useCompany(companyId);
  const site = companyQ.data?.websiteUrl && /^https?:\/\//.test(companyQ.data.websiteUrl) ? companyQ.data.websiteUrl : null;
  const figures = useMemo(
    () => (companyQ.data ? buildFigureSet(metrics, companyQ.data, companyId) : null),
    [companyQ.data, metrics, companyId],
  );
  const keyFigures = useMemo(() => (figures ? pickKpis(figures.all, 6, 4) : []), [figures]);
  const coverage = useMemo(() => sourceCoverage(keyFigures.filter(isKnown)), [keyFigures]);
  const caveats = useMemo(() => figureCaveats(keyFigures), [keyFigures]);

  const result = query.data;
  const parsed = useMemo(
    () => (result ? parseOverviewSections(result.content.markdown) : { sections: [], figures: [] }),
    [result],
  );
  const structured = parsed.sections.length > 0 || parsed.figures.length > 0;
  const takeaways = useMemo(() => extractTakeaways(parsed.sections), [parsed.sections]);
  const products = useCachedDashboardTab(companyId, 'products_roadmap').data?.content.products;
  const description = companyQ.data?.oneLiner && companyQ.data.oneLiner !== UNSUPPORTED_COMPANY_SUMMARY ? companyQ.data.oneLiner : null;
  const paragraph = useMemo(() => overviewParagraph({
    name: companyQ.data?.name ?? '',
    description,
    takeaways,
    productNames: (products ?? []).map((p) => p.name),
  }), [companyQ.data?.name, description, takeaways, products]);
  const briefTabs = [
    ...parsed.sections.map((s) => ({ key: s.title, label: sectionLabel(s.title), section: s as { title: string; body: string } | null })),
    ...(parsed.figures.length > 0 ? [{ key: '__figures', label: 'Sourced figures', section: null }] : []),
  ];
  const active = briefTabs[Math.min(briefIdx, Math.max(0, briefTabs.length - 1))];

  // The summary and the company's own site lead the tab; figures follow.
  const summarySection = (
    <>
      {query.isPending ? (
        <HydratingPanel label="Overview" variant="compact" />
      ) : query.isError ? (
        <ErrorState
          title="Failed to load the overview"
          message={query.error instanceof Error ? query.error.message : String(query.error)}
          onRetry={() => void query.refetch()}
        />
      ) : !result ? (
        <TabSection title="Summary">
          <Empty title="Not researched yet" text="Use Research above to generate a sourced brief." />
        </TabSection>
      ) : !structured ? (
        <TabSection title="Summary">
          <article className="markdown panel p-6">
            {result.content.markdown.trim()
              ? <ResearchMarkdown text={result.content.markdown} />
              : <p className="text-sm text-muted">No overview is available from the saved research yet.</p>}
          </article>
        </TabSection>
      ) : paragraph.sentences.length > 0 && (
        <TabSection title="Summary">
          <div className={cn('grid gap-4', site && 'lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]')}>
          <div className="panel flex min-w-0 flex-col p-5 sm:p-6">
            <h3 className="text-[11.5px] font-medium text-muted">Who they are</h3>
            <p className="mt-2 max-w-[68ch] text-[15px] leading-7 text-content">{paragraph.sentences.join(' ')}</p>
            <SourceChips links={paragraph.links} />
            <div className="mt-auto flex flex-wrap items-center gap-x-4 gap-y-1 pt-4 text-[12px]">
              {paragraph.products.length > 0 && (
                <Link to={href('products_roadmap')} className="inline-flex items-center gap-1 text-primary-ink hover:underline">
                  Products &amp; roadmap <ArrowRight className="h-3 w-3" aria-hidden />
                </Link>
              )}
              <a href="#research-brief" onClick={(e) => { e.preventDefault(); const el = document.getElementById('research-brief') as HTMLDetailsElement | null; if (el) { el.open = true; el.scrollIntoView({ block: 'start' }); } }}
                className="inline-flex items-center gap-1 text-muted hover:text-primary-ink hover:underline">
                Read the full brief
              </a>
            </div>
          </div>
          {site && <SiteGlance url={site} />}
          </div>
        </TabSection>
      )}
    </>
  );

  return (
    <div className="cascade space-y-8">
      {summarySection}

      <TabSection
        title="Key figures"
        action={<Link to={href('metrics')} className="inline-flex items-center gap-1 text-[12px] text-primary-ink hover:underline">All figures and peers <ArrowRight className="h-3 w-3" aria-hidden /></Link>}
      >
        {metricsQ.isPending || !figures ? (
          <div className="grid grid-cols-2 gap-px overflow-hidden rounded-xl border border-border bg-border md:grid-cols-4">
            {[0, 1, 2, 3].map((i) => (
              <div key={i} className="bg-surface px-5 py-4" aria-hidden>
                <div className="h-2.5 w-16 animate-pulse rounded bg-surface-2 motion-reduce:animate-none" />
                <div className="mt-3 h-7 w-24 animate-pulse rounded bg-surface-2 motion-reduce:animate-none" />
                <div className="mt-4 h-2.5 w-20 animate-pulse rounded bg-surface-2 motion-reduce:animate-none" />
              </div>
            ))}
          </div>
        ) : (
          <>
          <div className={cn('grid grid-cols-2 gap-px overflow-hidden rounded-xl border border-border bg-border shadow-soft', ORPHAN_SPAN, KPI_COLUMNS[Math.min(keyFigures.length, 6)])}>
            {keyFigures.map((metric) => {
              const ranking = isKnown(metric) && peerState.status === 'ready'
                ? rankInDeck(companyId, metric.metricType, peerState.peers) : null;
              return <FigureTile key={metric.metricType} metric={metric} ranking={ranking} group={caveats}
                href={href('metrics', { metric: metric.metricType })} />;
            })}
          </div>
          {(coverage || caveats.line) && (
            <p className="mt-2 text-[11.5px] text-faint">{[coverage, caveats.line].filter(Boolean).join(' · ')}</p>
          )}
          </>
        )}
      </TabSection>

      {figures && (
        <OverviewCoverage companyId={companyId} figuresFound={figures.known.length} figureSlots={figures.all.length} />
      )}

      <YourResearch companyId={companyId} />

      <Happening companyId={companyId} companyName={companyQ.data?.name ?? 'this company'} />

      <OverviewSnapshot companyId={companyId} companyName={companyQ.data?.name ?? 'this company'} />
      <MarketPeers companyId={companyId} />
      <Watch companyId={companyId} />
      <Milestones companyId={companyId} />

      {structured && active && (
        <details id="research-brief" className="panel group scroll-mt-4 overflow-hidden">
          <summary className="flex cursor-pointer list-none items-center justify-between px-5 py-3.5 text-[13px] font-medium text-content hover:bg-surface-muted">
            Read the full research brief
            <span className="text-faint transition-transform group-open:rotate-90">›</span>
          </summary>
          <div role="tablist" aria-label="Research brief sections" className="flex gap-1 overflow-x-auto border-y border-border px-3 pt-2">
            {briefTabs.map((t, i) => (
              <button
                key={t.key}
                role="tab"
                type="button"
                aria-selected={active.key === t.key}
                onClick={() => setBriefIdx(i)}
                className={cn(
                  '-mb-px whitespace-nowrap border-b-2 px-3 py-2 text-[13px] font-medium transition-colors',
                  active.key === t.key ? 'border-primary text-content' : 'border-transparent text-muted hover:text-content',
                )}
              >
                {t.label}
              </button>
            ))}
          </div>
          <div role="tabpanel" aria-label={active.label} className="max-w-[72ch] space-y-4 p-6">
            {active.section
              ? active.section.body.split('\n\n').map((b) => b.trim()).filter(Boolean).map((block, i) => <Paragraph key={i} block={block} />)
              : <ul className="divide-y divide-border">{parsed.figures.map((line, i) => <FigureRow key={i} line={line} />)}</ul>}
          </div>
        </details>
      )}
    </div>
  );
}
