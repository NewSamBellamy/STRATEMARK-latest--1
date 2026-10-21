import { sourceHref } from '@/lib/sourceHref';
import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, ExternalLink, SearchX } from 'lucide-react';
import { publisherOf, type CompanyMetric } from '@mi/contracts';
import { useCompany, useCompanyMetrics, useDashboardTab } from '@/hooks/data';
import { ResearchMarkdown } from '@/components/ResearchMarkdown';
import { ErrorState } from '@/components/states/ErrorState';
import { cn } from '@/lib/cn';
import { METRIC_COLORS } from '@/lib/theme';
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
import { KpiTileSkeleton, metricLabel, useTabHref } from '../dashboardKit';
import { TabSection } from './TabKit';
import { SourceCheck } from '../SourceCheck';
import { usePeers } from '../usePeers';
import { buildFigureSet, currencyCaptionFor, figureDisplay, figureTrust, linkedCitation } from '../figureSet';
import { figureCaveats, rowDates, type FigureCaveats } from '../figureCaveats';
import { useCachedDashboardTab } from '../useCachedTab';
import { newestFirst, sourceCoverage, statedNote } from '../overviewTruth';
import { ArticleReader, StoryMeta } from './LiveIntelTab';
import { SitePreview } from './LiveLandingTab';
import { VideoStrip } from '@/components/media/StoryMedia';
import { MarketPeers, OverviewSnapshot } from './OverviewSnapshot';
import { OverviewCoverage } from './OverviewCoverage';

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

// Tiles divide the row evenly (never 3 + 2 with an empty slot): all in one row where there
// is width (xl), three across for three or six, and a lone last tile in the 2-up grid spans it.
const ORPHAN_SPAN = '[&>:last-child:nth-child(odd)]:col-span-2';
const KPI_COLUMNS: Record<number, string> = {
  0: 'lg:grid-cols-4',
  1: 'lg:grid-cols-1 lg:[&>:last-child:nth-child(odd)]:col-span-1',
  2: 'lg:grid-cols-2',
  3: 'lg:grid-cols-3 lg:[&>:last-child:nth-child(odd)]:col-span-1',
  4: 'xl:grid-cols-4',
  5: 'xl:grid-cols-5 xl:[&>:last-child:nth-child(odd)]:col-span-1',
  6: 'lg:grid-cols-3',
};

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
      <article className="flex min-w-0 flex-col rounded-xl border border-dashed border-border bg-surface-2/40 p-4" aria-label={`${label}: Not found yet`}>
        <h3 className="truncate text-[10.5px] font-semibold uppercase tracking-[0.12em] text-muted">{label}</h3>
        <p className="mt-1.5 flex items-center gap-1.5 font-display text-lg font-semibold text-muted">
          <SearchX className="h-4 w-4" aria-hidden />
          Not found yet
        </p>
        <p className="mt-1 text-[11.5px] leading-snug text-faint">{FILL_HINT[type]}</p>
      </article>
    );
  }
  const citation = linkedCitation(metric);
  const dates = rowDates(metric, group);
  const currency = currencyCaptionFor(metric);
  const estimated = metric.confidence === 'estimated';
  const display = figureDisplay(metric);
  return (
    <article
      className="flex min-w-0 flex-col rounded-xl border border-border bg-surface p-4 shadow-soft"
      style={{ borderTopColor: METRIC_COLORS[type], borderTopWidth: 2 }}
      aria-label={`${label}: ${display}${estimated ? ' (estimated)' : ''}`}
    >
      <h3 className="truncate text-[10.5px] font-semibold uppercase tracking-[0.12em] text-muted">{label}</h3>
      <p className="mt-1.5 font-display text-[26px] font-semibold leading-none tabular-nums text-content">
        {display}
        {/* A real space, not margin: copy-paste and screen readers otherwise get "$8.0Best.". */}
        {estimated && <>{' '}<abbr title="Estimated" className="text-[11px] font-normal text-faint no-underline">est.</abbr></>}
      </p>
      <p className="mt-2.5 truncate text-[11.5px] text-muted">
        {citation ? (
          <a href={sourceHref(citation.url, citation.title)} target="_blank" rel="noopener noreferrer" className="inline-flex max-w-full items-center gap-1 text-primary-ink hover:underline">
            <span className="truncate">{publisherOf(citation.url, citation.title)}</span>
            <ExternalLink className="h-3 w-3 shrink-0" aria-hidden />
          </a>
        ) : metric.confidence === 'user_verified' ? 'Your correction' : 'No link recorded'}
      </p>
      <p className="mt-0.5 text-[11px] text-faint">
        {figureTrust(metric)}{dates.period ? ` · For ${dates.period}` : dates.notReported ? ' · Period not reported' : ''}
      </p>
      {dates.record && <p className="text-[11px] text-faint">{dates.record}</p>}
      {currency && <p className="mt-1 text-[11px] leading-snug text-muted">{currency}</p>}
      <SourceCheck metric={metric} label={label} className="mt-1" groupedUndated={group.noPeriod} />
      {ranking?.rank != null && ranking.of > 1 && (
        <Link to={href} className="mt-auto pt-2 text-[11px] text-faint hover:text-primary-ink">
          <span className="font-semibold tabular-nums text-content">#{ranking.rank}</span> of {ranking.of} companies with this figure
        </Link>
      )}
    </article>
  );
}

// ---- What's happening ----------------------------------------------------

/** The scoop: today's stories with their pictures. Starts the news search if
 * this company has none yet (the same pass the Live Intel tab would run). */
const HEADLINES = 3;

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
        // Compact on purpose: Live Intel owns the lead story and picture block.
        <ul className="panel divide-y divide-border">
          {items.slice(0, HEADLINES).map((item) => (
            <li key={item.id}>
              <button type="button" onClick={() => setOpenId(item.id)} className="group block w-full space-y-1 px-5 py-3 text-left">
                <StoryMeta item={item} />
                <span className="block text-[14.5px] font-medium leading-snug text-content group-hover:text-primary-ink">{item.title}</span>
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

/** The company's own latest videos, when its site links a YouTube channel. */
function Watch({ companyId }: { companyId: string }) {
  const videos = useCachedDashboardTab(companyId, 'live_intel').data?.content.videos ?? [];
  if (!videos.length) return null;
  return (
    <TabSection title="Watch">
      <VideoStrip videos={videos} />
    </TabSection>
  );
}

/** Dated milestones, from the History tab when it has been researched. */
function Milestones({ companyId }: { companyId: string }) {
  const href = useTabHref(companyId);
  const history = useCachedDashboardTab(companyId, 'history').data;
  const timeline = newestFirst(history?.content.timeline ?? []).slice(0, 5);
  if (!timeline.length) return null;
  return (
    <TabSection
      title="Milestones"
      action={<Link to={href('history')} className="inline-flex items-center gap-1 text-[12px] text-primary-ink hover:underline">Full history <ArrowRight className="h-3 w-3" aria-hidden /></Link>}
    >
      <ol className="panel relative space-y-3 p-5">
        {timeline.map((e, i) => (
          <li key={i} className="grid grid-cols-[96px_minmax(0,1fr)] gap-3 text-[13.5px] leading-snug">
            <span className="tabular-nums text-faint">
              {e.date}
              {statedNote(e.date, history?.lastRefreshedAt) && <span className="block text-[11px]">{statedNote(e.date, history?.lastRefreshedAt)}</span>}
            </span>
            <span className="text-content">{e.title}</span>
          </li>
        ))}
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
  const briefTabs = [
    ...parsed.sections.map((s) => ({ key: s.title, label: sectionLabel(s.title), section: s as { title: string; body: string } | null })),
    ...(parsed.figures.length > 0 ? [{ key: '__figures', label: 'Sourced figures', section: null }] : []),
  ];
  const active = briefTabs[Math.min(briefIdx, Math.max(0, briefTabs.length - 1))];

  return (
    <div className="cascade space-y-8">
      <TabSection
        title="Key figures"
        action={<Link to={href('metrics')} className="inline-flex items-center gap-1 text-[12px] text-primary-ink hover:underline">All figures and peers <ArrowRight className="h-3 w-3" aria-hidden /></Link>}
      >
        {metricsQ.isPending || !figures ? (
          <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
            {[0, 1, 2, 3].map((i) => <KpiTileSkeleton key={i} i={i} />)}
          </div>
        ) : (
          <>
          <div className={cn('grid grid-cols-2 gap-4', ORPHAN_SPAN, KPI_COLUMNS[Math.min(keyFigures.length, 6)])}>
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

      <Happening companyId={companyId} companyName={companyQ.data?.name ?? 'this company'} />

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
      ) : takeaways.length > 0 && (
        <TabSection title="Summary">
          <div className={cn('grid gap-4', site && 'lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]')}>
          <dl className="panel divide-y divide-border">
            {takeaways.slice(0, 4).map((t) => (
              <div key={t.section} className="grid gap-x-6 gap-y-1 px-5 py-4 sm:grid-cols-[132px_minmax(0,1fr)]">
                <dt className="pt-0.5 text-[11px] font-semibold uppercase tracking-[0.1em] text-muted">{sectionLabel(t.section)}</dt>
                <dd className="min-w-0">
                  <p className="text-[14.5px] leading-relaxed text-content">{t.text}</p>
                  <SourceChips links={t.links} />
                </dd>
              </div>
            ))}
          </dl>
          {site && <SiteGlance url={site} />}
          </div>
        </TabSection>
      )}

      <OverviewSnapshot companyId={companyId} companyName={companyQ.data?.name ?? 'this company'} />
      <MarketPeers companyId={companyId} />
      <Watch companyId={companyId} />
      <Milestones companyId={companyId} />

      {structured && active && (
        <details className="panel group overflow-hidden">
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
