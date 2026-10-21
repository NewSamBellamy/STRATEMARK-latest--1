import { useState } from 'react';
import {
  AlertCircle,
  CalendarDays,
  ExternalLink,
  Hash,
  MessageSquare,
  Newspaper,
  RefreshCw,
} from 'lucide-react';
import { publisherOf, type LiveIntelItem } from '@mi/contracts';
import { useCompany, useDashboardTab, useRerunDashboardTab } from '@/hooks/data';
import { QueryBoundary } from '@/components/states/QueryBoundary';
import { HydratingPanel } from './HydratingPanel';
import { Modal } from '@/components/ui/Modal';
import { StoryImage, VideoStrip } from '@/components/media/StoryMedia';
import { LiveBadge } from '../LiveBadge';
import { DigDeeper } from '@/features/deepdive/DeepDive';
import { formatRelative } from '@/lib/format';
import { faviconUrl } from '@/lib/screenshot';
import { cn } from '@/lib/cn';
import { EmptyNote, FilterChip, SearchBox, SectionHeader } from './TabKit';
import { SecFilings } from './SecFilings';
import { matchesQuery, RECENCY_LABEL, recencyBucket } from './tabHelpers';

/**
 * A link the reader can ACTUALLY open. Grounding often returns opaque
 * `vertexaisearch…/grounding-api-redirect` URLs that expire or bounce off bot
 * walls — a dead "Read the full article" is a broken promise. For those, link
 * a Google search for the exact headline + publisher instead: it always
 * resolves, and the real article is the top result.
 */
function articleHref(item: LiveIntelItem): string | null {
  if (!/^https?:\/\//.test(item.url)) return null;
  if (/vertexaisearch|grounding-api-redirect/i.test(item.url)) {
    const publisher = publisherOf(item.url, null);
    const q = `"${item.title}"${publisher && publisher !== 'source' ? ` ${publisher}` : ''}`;
    return `https://www.google.com/search?q=${encodeURIComponent(q)}`;
  }
  return item.url;
}

const SOURCE_ICON = { news: Newspaper, x: Hash, reddit: MessageSquare } as const;
const SENTIMENT_STYLE = {
  positive: 'text-positive',
  neutral: 'text-neutral',
  negative: 'text-negative',
} as const;

/**
 * Newsfeed order: the most recent VERIFIED-dated story leads. Dated items sort
 * by reported publish date (newest first); undated items follow by discovery
 * time; stale-flagged items sink to the bottom regardless.
 */
function newsOrder(items: LiveIntelItem[]): LiveIntelItem[] {
  const ts = (it: LiveIntelItem): number => {
    const t = it.publishedDate ? Date.parse(it.publishedDate) : NaN;
    return Number.isNaN(t) ? Number.NEGATIVE_INFINITY : t;
  };
  return [...items].sort((a, b) => {
    if (a.stale !== b.stale) return a.stale ? 1 : -1;
    const da = ts(a);
    const db = ts(b);
    if (da !== db) return db - da;
    return Date.parse(b.publishedAt) - Date.parse(a.publishedAt);
  });
}

/** "2026-08-19" → "Aug 19, 2026"; unparseable strings render as written. */
function fmtPublishDate(raw: string): string {
  const t = Date.parse(raw);
  if (Number.isNaN(t)) return raw;
  return new Date(t).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

/** The story, opened: capture, dated meta, reported paragraph with quotes. */
export function ArticleReader({
  item,
  companyId,
  companyName,
  onClose,
}: {
  item: LiveIntelItem;
  companyId: string;
  companyName: string;
  onClose: () => void;
}) {
  const Icon = SOURCE_ICON[item.source];
  const href = articleHref(item);
  const publisher = item.publisher ?? (href ? publisherOf(item.url, null) : null);
  return (
    <Modal
      open
      onOpenChange={(o) => {
        if (!o) onClose();
      }}
      title={item.title}
      description={item.summary}
    >
      <div className="space-y-4">
        {/* The publisher's own picture for this story; none means none. */}
        <StoryImage pageUrl={item.url} imageUrl={item.imageUrl} publisher={item.publisher}
          credit className="h-[220px] rounded-xl border border-border" />

        <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 text-xs text-muted">
          <span className="inline-flex items-center gap-1.5">
            <Icon className="h-3.5 w-3.5" />
            <span className="uppercase">{item.source}</span>
          </span>
          {publisher && (
            <span className="inline-flex items-center gap-1.5">
              <img src={faviconUrl(item.url)} alt="" className="h-3.5 w-3.5 rounded-sm" />
              {publisher}
            </span>
          )}
          <span className="inline-flex items-center gap-1.5">
            <CalendarDays className="h-3.5 w-3.5" />
            {item.publishedDate
              ? `Published ${fmtPublishDate(item.publishedDate)}`
              : `Found by research ${formatRelative(item.publishedAt)}`}
          </span>
          <span className={cn('font-semibold', SENTIMENT_STYLE[item.sentiment])}>
            {item.sentiment}
          </span>
        </div>

        <p className="text-sm leading-relaxed text-content/90">
          {item.detail ?? item.summary}
        </p>

        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border pt-4">
          {href ? (
            <a
              href={href}
              target="_blank"
              rel="noopener noreferrer"
              className="btn-primary"
              title={
                href === item.url
                  ? 'Open the original article'
                  : 'The research link was a temporary redirect — this finds the original article by its exact headline.'
              }
            >
              <ExternalLink className="h-4 w-4" />
              {href === item.url ? 'Read the full article' : 'Find the full article'}
            </a>
          ) : (
            <span className="text-[11px] text-faint">No public link surfaced for this item.</span>
          )}
          <DigDeeper
            topic={item.title}
            companyId={companyId}
            companyName={companyName}
            context={item.detail ?? item.summary ?? null}
            label="Research this story"
          />
        </div>
      </div>
    </Modal>
  );
}

const SOURCE_LABEL = { news: 'News', x: 'X', reddit: 'Reddit' } as const;
const SENTIMENT_DOT = {
  positive: 'bg-emerald-500',
  neutral: 'bg-slate-400',
  negative: 'bg-rose-500',
} as const;

function IntelRow({
  item,
  onOpen,
}: {
  item: LiveIntelItem;
  onOpen: () => void;
}) {
  const Icon = SOURCE_ICON[item.source];
  const href = articleHref(item);
  const publisher = item.publisher ?? (/^https?:\/\//.test(item.url) ? publisherOf(item.url, null) : null);
  return (
    <li
      className={cn(
        'flex cursor-pointer gap-4 px-4 py-3.5 transition-colors hover:bg-surface-2/60',
        item.stale && 'opacity-60',
      )}
      onClick={onOpen}
    >
      <div className="min-w-0 flex-1">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted">
        {publisher && href ? (
          <a
            href={href}
            target="_blank"
            rel="noopener noreferrer"
            onClick={(e) => e.stopPropagation()}
            className="inline-flex items-center gap-1.5 font-medium text-content hover:text-primary-ink hover:underline"
            title="Open the source"
          >
            <img src={faviconUrl(item.url)} alt="" className="h-3.5 w-3.5 rounded-sm" />
            {publisher}
            <ExternalLink className="h-2.5 w-2.5" aria-hidden />
          </a>
        ) : (
          <span className="inline-flex items-center gap-1.5">
            <Icon className="h-3.5 w-3.5" aria-hidden />
            {SOURCE_LABEL[item.source]}
          </span>
        )}
        <span aria-hidden>·</span>
        {/* The honest date: the story's reported publish date when research
            surfaced one; otherwise when WE found it — never a fake "just now". */}
        <span title={item.publishedDate ? 'Reported publish date' : 'When our research surfaced this item'}>
          {item.publishedDate
            ? fmtPublishDate(item.publishedDate)
            : `found ${formatRelative(item.publishedAt)}`}
        </span>
        <span className={cn('ml-auto inline-flex items-center gap-1.5 font-medium', SENTIMENT_STYLE[item.sentiment])}>
          <span className={cn('h-1.5 w-1.5 rounded-full', SENTIMENT_DOT[item.sentiment])} aria-hidden />
          {item.sentiment}
        </span>
      </div>
      {/* The row opens on a click anywhere; keyboard and screen-reader users get the same through the headline,
          a real button (a row that is itself a button cannot hold the source link). */}
      <p className="mt-1.5 font-medium text-content">
        <button type="button" className="text-left" onClick={(e) => { e.stopPropagation(); onOpen(); }}>{item.title}</button>
      </p>
      {item.summary && <p className="mt-0.5 line-clamp-2 text-sm text-muted">{item.summary}</p>}
      {item.stale && (
        <p className="mt-2 inline-flex items-center gap-1.5 rounded-md bg-amber-50 px-2 py-1 text-xs text-amber-700">
          <AlertCircle className="h-3.5 w-3.5" />
          Flagged stale — pruned from the rest of the dashboard on next refresh.
        </p>
      )}
      </div>
      <StoryImage pageUrl={item.url} imageUrl={item.imageUrl} publisher={item.publisher}
        className="hidden h-[72px] w-[112px] shrink-0 self-center rounded-lg sm:block" />
    </li>
  );
}

/** Stand-in when a story has no picture: the publisher's mark on a quiet panel. */
function PublisherPlate({ item }: { item: LiveIntelItem }) {
  const publisher = item.publisher ?? publisherOf(item.url, null);
  return (
    <div className="absolute inset-0 flex items-center justify-center bg-gradient-to-br from-surface-2 to-surface-muted">
      <span className="inline-flex items-center gap-2 text-[13px] font-medium text-muted">
        {/^https?:\/\//.test(item.url) && <img src={faviconUrl(item.url)} alt="" className="h-5 w-5 rounded" />}
        {publisher ?? SOURCE_LABEL[item.source]}
      </span>
    </div>
  );
}

function StoryMeta({ item }: { item: LiveIntelItem }) {
  const publisher = item.publisher ?? publisherOf(item.url, null);
  return (
    <p className="flex flex-wrap items-center gap-x-1.5 text-[11.5px] text-muted">
      <span className="font-medium text-content/80">{publisher ?? SOURCE_LABEL[item.source]}</span>
      {item.publishedDate && <><span aria-hidden>·</span><span>{fmtPublishDate(item.publishedDate)}</span></>}
      <span className={cn('ml-1 h-1.5 w-1.5 rounded-full', SENTIMENT_DOT[item.sentiment])} title={item.sentiment} aria-hidden />
    </p>
  );
}

/** The scoop: the newest story large with its picture, the next three beside it. */
export function TopStories({ items, onOpen }: { items: LiveIntelItem[]; onOpen: (id: string) => void }) {
  const [lead, ...rest] = items.filter((i) => !i.stale).slice(0, 4);
  if (!lead) return null;
  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)]">
      <button type="button" onClick={() => onOpen(lead.id)}
        className="panel group overflow-hidden text-left transition-shadow hover:shadow-md">
        <StoryImage pageUrl={lead.url} imageUrl={lead.imageUrl} publisher={lead.publisher} credit
          className="aspect-[16/9] w-full" fallback={<PublisherPlate item={lead} />} />
        <div className="space-y-1.5 p-4">
          <StoryMeta item={lead} />
          <h3 className="text-[18px] font-semibold leading-snug text-content group-hover:text-primary-ink">{lead.title}</h3>
          {lead.summary && <p className="line-clamp-3 text-[13.5px] leading-relaxed text-muted">{lead.summary}</p>}
        </div>
      </button>
      {rest.length > 0 && (
        <div className="grid content-start gap-3">
          {rest.map((item) => (
            <button key={item.id} type="button" onClick={() => onOpen(item.id)}
              className="panel group flex gap-3 overflow-hidden p-2.5 text-left transition-shadow hover:shadow-md">
              <StoryImage pageUrl={item.url} imageUrl={item.imageUrl} publisher={item.publisher}
                className="h-[84px] w-[128px] shrink-0 rounded-md" fallback={<PublisherPlate item={item} />} />
              <div className="min-w-0 space-y-1 py-0.5">
                <StoryMeta item={item} />
                <p className="line-clamp-3 text-[13.5px] font-medium leading-snug text-content group-hover:text-primary-ink">{item.title}</p>
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export function LiveIntelTab({ companyId }: { companyId: string }) {
  const query = useDashboardTab(companyId, 'live_intel');
  const companyNameRaw = useCompany(companyId).data?.name;
  const companyName = companyNameRaw ?? 'this company';
  const rerun = useRerunDashboardTab(companyId, 'live_intel');
  const [openId, setOpenId] = useState<string | null>(null);
  const [source, setSource] = useState<LiveIntelItem['source'] | 'all'>('all');
  const [sentiment, setSentiment] = useState<LiveIntelItem['sentiment'] | 'all'>('all');
  const [search, setSearch] = useState('');
  return (
    <QueryBoundary query={query} loading={<HydratingPanel label="Live Intel" />}
      isEmpty={(r) => r.content.items.length === 0}
      empty={(r) => {
        // Empty-state taxonomy (red team #16): "researched, nothing surfaced"
        // and "never searched" are different facts and must read differently.
        const researchedAt = r.lastRefreshedAt
          ? new Date(r.lastRefreshedAt).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
          : null;
        return (
          <EmptyNote
            title={researchedAt ? 'No stories met the sourcing bar' : 'No stories yet'}
            action={
              <button
                type="button"
                className="btn-ghost text-xs"
                disabled={rerun.isPending}
                title="Run a fresh grounded news search now."
                onClick={() => rerun.mutate()}
              >
                <RefreshCw className={`h-3.5 w-3.5 ${rerun.isPending ? 'animate-spin' : ''}`} />
                {rerun.isPending ? 'Searching latest news…' : 'Search latest news'}
              </button>
            }
          >
            {researchedAt
              ? <>Live Intel researched {companyName} on {researchedAt} and nothing published surfaced. Sources come and go — search again for fresh coverage.</>
              : <>Live Intel searches fresh coverage of {companyName}. Run the first search now — or after the next research pass — and the latest verified stories will collect here.</>}
          </EmptyNote>
        );
      }}>
      {(result) => {
        const all = newsOrder(result.content.items);
        const open = openId != null ? (all.find((i) => i.id === openId) ?? null) : null;
        const sourceCounts = all.reduce<Record<string, number>>((a, i) => ({ ...a, [i.source]: (a[i.source] ?? 0) + 1 }), {});
        const sentimentCounts = all.reduce<Record<string, number>>((a, i) => ({ ...a, [i.sentiment]: (a[i.sentiment] ?? 0) + 1 }), {});
        const ordered = all.filter(
          (i) =>
            (source === 'all' || i.source === source) &&
            (sentiment === 'all' || i.sentiment === sentiment) &&
            matchesQuery(`${i.title} ${i.summary} ${publisherOf(i.url, null) ?? ''}`, search),
        );
        const buckets = (['week', 'month', 'quarter', 'older', 'undated'] as const)
          .map((b) => ({ bucket: b, items: ordered.filter((i) => recencyBucket(i.publishedDate) === b) }))
          .filter((g) => g.items.length > 0);
        return (
          <div className="cascade">
            <SectionHeader
              title="Live intel"
              count={`${all.length} ${all.length === 1 ? 'story' : 'stories'}`}
              description="Latest first. Dates are the reported publish date; items without one are grouped separately, never shown as recent. Open a story for the full picture."
              actions={
                <>
                  <button
                    type="button"
                    className="btn-ghost text-xs"
                    disabled={rerun.isPending}
                    title="Run a fresh grounded news search now — new stories, reported publish dates, article detail."
                    onClick={() => rerun.mutate()}
                  >
                    <RefreshCw className={`h-3.5 w-3.5 ${rerun.isPending ? 'animate-spin' : ''}`} />
                    {rerun.isPending ? 'Searching latest news…' : 'Refresh news'}
                  </button>
                  <LiveBadge lastRefreshedAt={result.content.lastRefreshedAt} />
                </>
              }
            />
            <div className="mb-8 space-y-8">
              <TopStories items={all} onOpen={setOpenId} />
              {(result.content.videos?.length ?? 0) > 0 && (
                <section aria-label="Videos from the company">
                  <h4 className="mb-3 text-[11px] font-semibold uppercase tracking-widest text-muted">From their channel</h4>
                  <VideoStrip videos={result.content.videos!} />
                </section>
              )}
              <SecFilings companyName={companyNameRaw} />
            </div>
            <h4 className="mb-2 text-[11px] font-semibold uppercase tracking-widest text-muted">All coverage</h4>
            <div className="mb-3 flex flex-wrap items-center gap-2">
              {all.length > 5 && (
                <SearchBox
                  value={search}
                  onChange={setSearch}
                  label="Search stories"
                  placeholder="Search stories or publishers"
                  className="w-full sm:w-60"
                />
              )}
              {Object.keys(sourceCounts).length > 1 && (
                <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="Filter by source type">
                  <FilterChip active={source === 'all'} onClick={() => setSource('all')} count={all.length}>All</FilterChip>
                  {(['news', 'x', 'reddit'] as const)
                    .filter((s) => (sourceCounts[s] ?? 0) > 0)
                    .map((s) => (
                      <FilterChip key={s} active={source === s} onClick={() => setSource(s)} count={sourceCounts[s]}>
                        {SOURCE_LABEL[s]}
                      </FilterChip>
                    ))}
                </div>
              )}
              {Object.keys(sentimentCounts).length > 1 && (
                <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="Filter by sentiment">
                  {(['positive', 'neutral', 'negative'] as const)
                    .filter((s) => (sentimentCounts[s] ?? 0) > 0)
                    .map((s) => (
                      <FilterChip
                        key={s}
                        active={sentiment === s}
                        onClick={() => setSentiment(sentiment === s ? 'all' : s)}
                        count={sentimentCounts[s]}
                      >
                        <span className={cn('h-1.5 w-1.5 rounded-full', SENTIMENT_DOT[s])} aria-hidden />
                        <span className="capitalize">{s}</span>
                      </FilterChip>
                    ))}
                </div>
              )}
            </div>
            {buckets.length === 0 ? (
              <EmptyNote compact title="No stories match these filters">
                Clear the search or filters to see everything research retained.
              </EmptyNote>
            ) : (
              <div className="space-y-5">
                {buckets.map(({ bucket, items }) => (
                  <section key={bucket} aria-label={RECENCY_LABEL[bucket]}>
                    <h4 className="mb-1.5 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-widest text-muted">
                      {RECENCY_LABEL[bucket]}
                      <span className="font-normal tabular-nums text-faint">{items.length}</span>
                    </h4>
                    <ul className="panel divide-y divide-border overflow-hidden">
                      {items.map((item) => (
                        <IntelRow key={item.id} item={item} onOpen={() => setOpenId(item.id)} />
                      ))}
                    </ul>
                  </section>
                ))}
              </div>
            )}
            {open && (
              <ArticleReader
                item={open}
                companyId={companyId}
                companyName={companyName}
                onClose={() => setOpenId(null)}
              />
            )}
          </div>
        );
      }}
    </QueryBoundary>
  );
}
