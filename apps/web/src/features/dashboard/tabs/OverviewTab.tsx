import { sourceHref } from '@/lib/sourceHref';
import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, ExternalLink, SearchX } from 'lucide-react';
import { publisherOf, type MetricType } from '@mi/contracts';
import { useCompany, useCompanyMetrics, useDashboardTab } from '@/hooks/data';
import { companyFace, faceFigureStatus, type CardView } from '@/features/card/card-view';
import { ResearchMarkdown } from '@/components/ResearchMarkdown';
import { ErrorState } from '@/components/states/ErrorState';
import { cn } from '@/lib/cn';
import { METRIC_COLORS } from '@/lib/theme';
import { HydratingPanel } from './HydratingPanel';
import {
  FILL_HINT,
  extractTakeaways,
  parseOverviewSections,
  rankInDeck,
  splitAttribution,
  type PeerRanking,
} from '../dashboardModel';
import { KpiTileSkeleton, Section, useTabHref } from '../dashboardKit';
import { usePeers } from '../usePeers';
import { useCachedDashboardTab } from '../useCachedTab';
import { ArticleReader, TopStories, type StoryCompany } from './LiveIntelTab';
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

// ---- At a glance: the card's own four figures -----------------------------

type FaceItem = CardView['faceMetrics'][number];
const SLOT_TYPE: Record<string, MetricType> = {
  employees: 'employees', revenue: 'revenue', reach: 'users', company_value: 'valuation', aum: 'aum',
};
const asOfFormat = new Intl.DateTimeFormat('en-US', { month: 'short', year: 'numeric', timeZone: 'UTC' });
const shortDate = (iso: string | null | undefined) => {
  const d = iso ? new Date(iso) : null;
  return d && Number.isFinite(d.getTime()) ? asOfFormat.format(d) : null;
};

/** Mirrors the card face exactly: same slots, same gates, same trust wording as the reader. */
function FaceTile({ item, ranking, href }: { item: FaceItem; ranking: PeerRanking | null; href: string }) {
  const known = item.metric !== undefined;
  const type = item.metric?.metricType ?? SLOT_TYPE[item.key] ?? 'valuation';
  const citation = item.citations[0];
  const dated = item.metric?.reportedSupport?.asOf ?? item.metric?.quotedSupport?.asOf ?? item.metric?.reportedBand?.asOf ?? null;
  const when = dated ? shortDate(dated) ?? dated : null;
  if (!known) {
    return (
      <article className="flex min-w-0 flex-col rounded-xl border border-dashed border-border bg-surface-2/40 p-4" aria-label={`${item.label}: ${item.display}`}>
        <h3 className="truncate text-[10.5px] font-semibold uppercase tracking-[0.12em] text-muted">{item.label}</h3>
        <p className="mt-1.5 flex items-center gap-1.5 font-display text-lg font-semibold text-muted">
          <SearchX className="h-4 w-4" aria-hidden />
          {item.display}
        </p>
        <p className="mt-1 text-[11.5px] leading-snug text-faint">{FILL_HINT[type]}</p>
      </article>
    );
  }
  return (
    <article
      className="flex min-w-0 flex-col rounded-xl border border-border bg-surface p-4 shadow-soft"
      style={{ borderTopColor: METRIC_COLORS[type], borderTopWidth: 2 }}
      aria-label={`${item.label}: ${item.display}`}
    >
      <h3 className="truncate text-[10.5px] font-semibold uppercase tracking-[0.12em] text-muted">{item.label}</h3>
      <p className="mt-1.5 font-display text-[26px] font-semibold leading-none tabular-nums text-content">{item.display}</p>
      <p className="mt-2.5 truncate text-[11.5px] text-muted" title={faceFigureStatus(item)}>
        {citation ? (
          <a href={sourceHref(citation.url, citation.title)} target="_blank" rel="noopener noreferrer" className="inline-flex max-w-full items-center gap-1 text-primary-ink hover:underline">
            <span className="truncate">{publisherOf(citation.url, citation.title)}</span>
            <ExternalLink className="h-3 w-3 shrink-0" aria-hidden />
          </a>
        ) : faceFigureStatus(item)}
      </p>
      <p className="mt-0.5 text-[11px] text-faint">
        {faceFigureStatus(item).replace(' · not verified', '')}{when ? ` · ${when}` : ''}
      </p>
      {ranking?.rank != null && ranking.of > 1 && (
        <Link to={href} className="mt-2 text-[11px] text-faint hover:text-primary-ink">
          <span className="font-semibold tabular-nums text-content">#{ranking.rank}</span> of {ranking.of} in this deck
        </Link>
      )}
    </article>
  );
}

// ---- What's happening ----------------------------------------------------

/** The scoop: today's stories with their pictures. Starts the news search if
 * this company has none yet (the same pass the Live Intel tab would run). */
function Happening({ companyId, companyName, company }: { companyId: string; companyName: string; company?: StoryCompany }) {
  const href = useTabHref(companyId);
  const intel = useDashboardTab(companyId, 'live_intel');
  const [openId, setOpenId] = useState<string | null>(null);
  const items = useMemo(() => [...(intel.data?.content.items ?? [])]
    .filter((i) => !i.stale)
    .sort((a, b) => (b.publishedDate ?? '').localeCompare(a.publishedDate ?? '')), [intel.data]);
  const open = openId ? items.find((i) => i.id === openId) ?? null : null;
  return (
    <Section
      title="What's happening"
      action={items.length > 4 ? <Link to={href('live_intel')} className="inline-flex items-center gap-1 text-[12px] text-primary-ink hover:underline">All {items.length} stories <ArrowRight className="h-3 w-3" aria-hidden /></Link> : undefined}
    >
      {intel.isPending ? (
        <div className="grid gap-4 lg:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)]" aria-label="Finding the latest stories">
          <div className="panel aspect-[16/10] animate-pulse bg-surface-2" />
          <div className="grid gap-3">{[0, 1, 2].map((i) => <div key={i} className="panel h-[104px] animate-pulse bg-surface-2" />)}</div>
        </div>
      ) : items.length > 0 ? (
        <TopStories items={items} onOpen={setOpenId} company={company} />
      ) : (
        <p className="panel px-4 py-4 text-[13px] leading-snug text-muted">
          No recent coverage found. <Link to={href('live_intel')} className="text-primary-ink hover:underline">Search again</Link>
        </p>
      )}
      {open && <ArticleReader item={open} companyId={companyId} companyName={companyName} onClose={() => setOpenId(null)} />}
    </Section>
  );
}

/** The company's own latest videos, when its site links a YouTube channel. */
function Watch({ companyId }: { companyId: string }) {
  const videos = useCachedDashboardTab(companyId, 'live_intel').data?.content.videos ?? [];
  if (!videos.length) return null;
  return (
    <Section title="Watch">
      <VideoStrip videos={videos} />
    </Section>
  );
}

/** Dated milestones, from the History tab when it has been researched. */
function Milestones({ companyId }: { companyId: string }) {
  const href = useTabHref(companyId);
  const history = useCachedDashboardTab(companyId, 'history').data;
  const timeline = (history?.content.timeline ?? []).slice(-5).reverse();
  if (!timeline.length) return null;
  return (
    <Section
      title="Milestones"
      action={<Link to={href('history')} className="inline-flex items-center gap-1 text-[12px] text-primary-ink hover:underline">Full history <ArrowRight className="h-3 w-3" aria-hidden /></Link>}
    >
      <ol className="panel relative space-y-3 px-5 py-4">
        {timeline.map((e, i) => (
          <li key={i} className="grid grid-cols-[96px_minmax(0,1fr)] gap-3 text-[13.5px] leading-snug">
            <span className="tabular-nums text-faint">{e.date}</span>
            <span className="text-content">{e.title}</span>
          </li>
        ))}
      </ol>
    </Section>
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
    <a href={url} target="_blank" rel="noopener noreferrer" className="panel group block self-start overflow-hidden" title={`Open ${host}`}>
      <div className="flex items-center gap-1.5 border-b border-border bg-surface-muted px-3 py-1.5">
        <span className="h-2 w-2 rounded-full bg-border" /><span className="h-2 w-2 rounded-full bg-border" /><span className="h-2 w-2 rounded-full bg-border" />
        <span className="ml-2 truncate text-[11px] text-faint">{host}</span>
        <ExternalLink className="ml-auto h-3 w-3 text-faint group-hover:text-primary-ink" aria-hidden />
      </div>
      <div className="aspect-[16/10] overflow-hidden bg-surface-2">
        <SitePreview url={url} fallbackShot={null} quiet onFail={() => setFailed(true)} />
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

  // The card's own face, however the dashboard was opened (from a card or a
  // link): the same four strongest sourced figures, from live metrics so a
  // fresh correction shows at once.
  const companyQ = useCompany(companyId);
  const site = companyQ.data?.websiteUrl && /^https?:\/\//.test(companyQ.data.websiteUrl) ? companyQ.data.websiteUrl : null;
  const face = useMemo(
    () => (companyQ.data ? companyFace(companyQ.data, metrics) : null),
    [companyQ.data, metrics],
  );

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
    <div className="cascade mx-auto max-w-4xl space-y-8">
      <Section
        title="Key figures"
        action={<Link to={href('metrics')} className="inline-flex items-center gap-1 text-[12px] text-primary-ink hover:underline">All figures and peers <ArrowRight className="h-3 w-3" aria-hidden /></Link>}
      >
        {metricsQ.isPending || !face ? (
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            {[0, 1, 2, 3].map((i) => <KpiTileSkeleton key={i} i={i} />)}
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            {face.map((item) => {
              const ranking = item.metric && peerState.status === 'ready'
                ? rankInDeck(companyId, item.metric.metricType, peerState.peers) : null;
              return <FaceTile key={`${item.key}-${item.label}`} item={item} ranking={ranking}
                href={href('metrics', { metric: item.metric?.metricType ?? SLOT_TYPE[item.key] ?? 'valuation' })} />;
            })}
          </div>
        )}
      </Section>

      {face && (
        <OverviewCoverage companyId={companyId} figuresFound={face.filter((i) => i.metric !== undefined).length} figureSlots={face.length} />
      )}

      <Happening companyId={companyId} companyName={companyQ.data?.name ?? 'this company'} company={companyQ.data ? { name: companyQ.data.name, website: companyQ.data.websiteUrl, logoUrl: companyQ.data.logoUrl } : undefined} />

      {query.isPending ? (
        <HydratingPanel label="Overview" variant="compact" />
      ) : query.isError ? (
        <ErrorState
          title="Failed to load the overview"
          message={query.error instanceof Error ? query.error.message : String(query.error)}
          onRetry={() => void query.refetch()}
        />
      ) : !result ? (
        <Section title="Summary">
          <Empty title="Not researched yet" text="Use Research above to generate a sourced brief." />
        </Section>
      ) : !structured ? (
        <Section title="Summary">
          <article className="markdown panel p-6">
            {result.content.markdown.trim()
              ? <ResearchMarkdown text={result.content.markdown} />
              : <p className="text-sm text-muted">No overview is available from the saved research yet.</p>}
          </article>
        </Section>
      ) : takeaways.length > 0 && (
        <Section title="Summary">
          <div className={cn('grid gap-4', site && 'lg:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]')}>
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
        </Section>
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
