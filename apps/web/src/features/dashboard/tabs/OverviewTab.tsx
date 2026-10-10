import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ArrowRight, ExternalLink, MapPin } from 'lucide-react';
import type { CompanyMetric } from '@mi/contracts';
import { useCompany, useCompanyMetrics, useDashboardTab } from '@/hooks/data';
import { useRepository } from '@/lib/repository/RepositoryProvider';
import { ResearchMarkdown } from '@/components/ResearchMarkdown';
import { ErrorState } from '@/components/states/ErrorState';
import { cn } from '@/lib/cn';
import { formatMetricValue } from '@/lib/format';
import { METRIC_COLORS } from '@/lib/theme';
import { DigDeeperMenu } from '@/features/deepdive/DeepDive';
import { AiCover } from '@/components/media/AiCover';
import { HydratingPanel } from './HydratingPanel';
import {
  barPercent,
  extractTakeaways,
  missingCoreTypes,
  parseOverviewSections,
  pickKpis,
  positionRankings,
  rankInDeck,
  splitAttribution,
  type PeerRanking,
} from '../dashboardModel';
import { KpiTile, KpiTileSkeleton, RankChip, Section, metricLabel, useTabHref } from '../dashboardKit';
import { usePeers } from '../usePeers';
import { useCachedDashboardTab } from '../useCachedTab';

/**
 * Overview: a scannable executive summary.
 *
 *   1. Headline figures (sourced, dated, confidence-marked, ranked in the deck)
 *   2. Position in this market (rank vs deck peers, known figures only)
 *   3. Key takeaways, each with its own citations
 *   4. The research brief, one section at a time (no wall of prose)
 *   5. Recent signals, from tabs that are already researched
 *
 * Regions fill independently: figures and peers render the moment they exist,
 * the narrative hydrates in place.
 */

const SECTION_LABELS: Record<string, string> = {
  'source-reported background': 'Who they are',
  'products and services': 'What they do',
  'market position': 'Where they stand',
  'customers and distribution': 'Customers & reach',
};
const sectionLabel = (title: string) => SECTION_LABELS[title.toLowerCase()] ?? title;
const plainLabel = (t: CompanyMetric['metricType']) => metricLabel({ metricType: t, passageSupport: null, reportedSupport: null });

function SourceChips({ links }: { links: Array<{ title: string; url: string }> }) {
  if (links.length === 0) return null;
  return (
    <div className="mt-2 flex flex-wrap gap-1.5">
      {links.map((link) => (
        <a
          key={link.url}
          href={link.url}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex max-w-[220px] items-center gap-1 rounded-full border border-border bg-surface-2 px-2 py-0.5 text-[11px] text-muted transition-colors hover:text-primary-ink"
        >
          <ExternalLink className="h-3 w-3 shrink-0" aria-hidden />
          <span className="truncate">{link.title}</span>
        </a>
      ))}
    </div>
  );
}

function Paragraph({ block }: { block: string }) {
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

// ---- Position in this market ----------------------------------------------

function PositionRow({ ranking, href }: { ranking: PeerRanking; href: string }) {
  const max = ranking.points[0]?.value ?? 0;
  const self = ranking.points.find((p) => p.isSelf)!;
  const color = METRIC_COLORS[ranking.metricType];
  const label = plainLabel(ranking.metricType);
  return (
    <li className="grid grid-cols-[minmax(0,1fr)] items-center gap-x-4 gap-y-1.5 py-3 sm:grid-cols-[130px_minmax(0,1fr)_auto]">
      <div className="min-w-0">
        <Link to={href} className="text-[13px] font-medium text-content hover:text-primary-ink hover:underline">
          {label}
        </Link>
        <p className="text-[12px] tabular-nums text-muted">{formatMetricValue(ranking.metricType, self.value)}</p>
      </div>
      <div
        className="relative h-7"
        role="img"
        aria-label={`${label}: ranked ${ranking.rank} of ${ranking.of} companies with a known figure`}
      >
        <div className="absolute inset-x-0 top-1/2 h-1.5 -translate-y-1/2 rounded-full bg-border" />
        <div
          className="absolute left-0 top-1/2 h-1.5 -translate-y-1/2 rounded-full"
          style={{ width: `${barPercent(self.value, max)}%`, background: color, opacity: self.confidence === 'estimated' ? 0.55 : 1 }}
        />
        {ranking.points.filter((p) => !p.isSelf).map((p) => (
          <span
            key={p.companyId}
            className="absolute top-1/2 h-3 w-0.5 -translate-x-1/2 -translate-y-1/2 rounded bg-faint/70 transition-all hover:h-5 hover:bg-content"
            style={{ left: `${barPercent(p.value, max)}%` }}
            title={`${p.name}: ${formatMetricValue(ranking.metricType, p.value)}${p.confidence === 'estimated' ? ' (estimated)' : ''}`}
          />
        ))}
        <span
          className="absolute top-1/2 h-3.5 w-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-surface"
          style={{ left: `${barPercent(self.value, max)}%`, background: color }}
          title={`This company: ${formatMetricValue(ranking.metricType, self.value)}`}
        />
      </div>
      <div className="sm:text-right"><RankChip ranking={ranking} href={href} /></div>
    </li>
  );
}

function PositionBlock({ companyId, metrics }: { companyId: string; metrics: CompanyMetric[] }) {
  const peerState = usePeers();
  const href = useTabHref(companyId);
  const { ranked, unrankable } = useMemo(
    () => positionRankings(companyId, peerState.peers),
    [companyId, peerState.peers],
  );
  const total = peerState.peers.length;
  const unknownPeerTotal = Math.max(0, ...ranked.map((r) => r.unknownPeers));

  let body;
  if (peerState.status === 'no_deck') {
    body = (
      <Empty
        title="Open this company from its deck to compare"
        text="Rankings use only the other companies in the deck you came from, so this view needs that context."
      />
    );
  } else if (peerState.status === 'loading') {
    body = (
      <ul className="divide-y divide-border" aria-hidden>
        {[0, 1, 2].map((i) => (
          <li key={i} className="flex items-center gap-4 py-4">
            <div className="h-3 w-24 animate-pulse rounded bg-border" style={{ animationDelay: `${i * 90}ms` }} />
            <div className="h-1.5 flex-1 animate-pulse rounded-full bg-border" style={{ animationDelay: `${i * 90 + 40}ms` }} />
          </li>
        ))}
      </ul>
    );
  } else if (ranked.length === 0) {
    const hasGaps = metrics.some((m) => m.value == null || m.confidence === 'unknown');
    body = (
      <Empty
        title="Not enough comparable figures yet"
        text={`A rank needs a known figure here and at least one deck peer with the same figure. ${total > 1 ? `${total - 1} peer${total === 2 ? '' : 's'} in this deck checked.` : 'This deck has no other companies yet.'}${hasGaps ? ' Unknown figures are never ranked as zero; they fill in as research lands.' : ''}`}
      />
    );
  } else {
    body = (
      <>
        <ul className="divide-y divide-border">
          {ranked.map((r) => <PositionRow key={r.metricType} ranking={r} href={href('metrics', { metric: r.metricType })} />)}
        </ul>
        <p className="mt-2 border-t border-border pt-2.5 text-[11.5px] leading-snug text-faint">
          Ranked among {total} deck {total === 1 ? 'company' : 'companies'} using known figures only
          {unknownPeerTotal > 0 ? `; up to ${unknownPeerTotal} peer${unknownPeerTotal === 1 ? ' is' : 's are'} unknown on a given metric and excluded, never ranked last` : ''}.
          {unrankable.length > 0 && ` Not yet comparable: ${unrankable.slice(0, 4).map(plainLabel).join(', ')}${unrankable.length > 4 ? '…' : ''}.`}
        </p>
      </>
    );
  }
  return (
    <Section
      title="Position in this market"
      hint="Where this company sits against the rest of the deck. Dot = this company, ticks = peers."
      action={ranked.length > 0 ? <Link to={href('metrics')} className="inline-flex items-center gap-1 text-[12px] text-primary-ink hover:underline">Compare all <ArrowRight className="h-3 w-3" aria-hidden /></Link> : undefined}
    >
      <div className="panel p-5">{body}</div>
    </Section>
  );
}

// ---- Archive passages ------------------------------------------------------

/** From the deck's own research archive, retrieved locally (free, no web call). */
function FromArchive({ companyId }: { companyId: string }) {
  const repo = useRepository();
  const enabled = typeof repo.searchResearchCorpus === 'function';
  const query = useQuery({
    queryKey: ['corpus', 'what-matters', companyId],
    queryFn: async () => (await repo.searchResearchCorpus!({
      query: 'market position competition momentum risks headwinds outlook customers',
      companyIds: [companyId], limit: 3,
    })) ?? [],
    enabled,
    staleTime: 60_000,
  });
  const passages = query.data ?? [];
  if (!enabled || (query.isSuccess && passages.length === 0)) return null;
  return (
    <Section title="From the research archive" label="What matters" hint="Retrieved from this deck’s saved evidence.">
      {query.isLoading && <p className="text-sm text-muted">Searching the research archive…</p>}
      <div className="grid gap-3 md:grid-cols-3">
        {passages.map((passage) => (
          <article key={passage.evidenceId} className="panel-2 p-4">
            <p className="mb-2 text-[11px] font-medium uppercase tracking-wide text-muted">
              {passage.topic} · {passage.capturedAt.slice(0, 10)}
            </p>
            <p className="text-sm leading-relaxed text-content">{passage.snippet}</p>
            {passage.citations.length > 0 && (
              <p className="mt-2 text-xs text-muted">
                {passage.citations.slice(0, 2).map((citation, index) => (
                  <a key={citation.url ?? index} href={citation.url} target="_blank" rel="noopener noreferrer"
                    className="text-primary-ink hover:underline">
                    {citation.title || citation.url.replace(/^https?:\/\//, '').slice(0, 40)}{index < Math.min(1, passage.citations.length - 1) ? ' · ' : ''}
                  </a>
                ))}
              </p>
            )}
          </article>
        ))}
      </div>
    </Section>
  );
}

// ---- Recent signals --------------------------------------------------------

const SENTIMENT_DOT = { positive: '#16A34A', neutral: '#9A9AA1', negative: '#DC2626' } as const;

function RecentSignals({ companyId }: { companyId: string }) {
  const href = useTabHref(companyId);
  const intel = useCachedDashboardTab(companyId, 'live_intel').data;
  const history = useCachedDashboardTab(companyId, 'history').data;
  const items = [...(intel?.content.items ?? [])]
    .filter((i) => !i.stale)
    .sort((a, b) => (b.publishedDate ?? b.publishedAt).localeCompare(a.publishedDate ?? a.publishedAt))
    .slice(0, 3);
  const timeline = (history?.content.timeline ?? []).slice(-3).reverse();
  return (
    <Section
      title="Recent signals"
      action={<Link to={href('live_intel')} className="inline-flex items-center gap-1 text-[12px] text-primary-ink hover:underline">Live intel <ArrowRight className="h-3 w-3" aria-hidden /></Link>}
    >
      <div className="panel divide-y divide-border">
        {items.length > 0 ? items.map((item) => (
          <a
            key={item.id}
            href={item.url}
            target="_blank"
            rel="noopener noreferrer"
            className="group block px-4 py-3 transition-colors hover:bg-surface-2/60"
          >
            <p className="line-clamp-2 text-[13px] font-medium leading-snug text-content group-hover:text-primary-ink">{item.title}</p>
            <p className="mt-1 flex items-center gap-1.5 text-[11px] text-faint">
              <span className="h-1.5 w-1.5 rounded-full" style={{ background: SENTIMENT_DOT[item.sentiment] }} aria-hidden />
              {item.source === 'news' ? 'News' : item.source === 'x' ? 'X' : 'Reddit'}
              <span aria-hidden>·</span>
              {item.publishedDate ?? item.publishedAt.slice(0, 10)}
            </p>
          </a>
        )) : (
          <p className="px-4 py-4 text-[12.5px] leading-snug text-muted">
            No news researched for this company yet. <Link to={href('live_intel')} className="text-primary-ink hover:underline">Open Live intel</Link> to run it.
          </p>
        )}
        {timeline.length > 0 && (
          <div className="px-4 py-3">
            <p className="mb-1.5 text-[10.5px] font-semibold uppercase tracking-[0.12em] text-faint">Company timeline</p>
            <ol className="space-y-1.5 border-l border-border pl-3">
              {timeline.map((e, i) => (
                <li key={i} className="relative text-[12.5px] leading-snug">
                  <span className="absolute -left-[16.5px] top-1.5 h-1.5 w-1.5 rounded-full bg-border" aria-hidden />
                  <span className="tabular-nums text-faint">{e.date}</span>
                  <span className="text-content"> {e.title}</span>
                </li>
              ))}
            </ol>
          </div>
        )}
      </div>
    </Section>
  );
}

// ---- Tab -------------------------------------------------------------------

export function OverviewTab({ companyId }: { companyId: string }) {
  const query = useDashboardTab(companyId, 'overview');
  const company = useCompany(companyId).data;
  const metricsQ = useCompanyMetrics(companyId);
  const metrics = useMemo(() => metricsQ.data ?? [], [metricsQ.data]);
  const peerState = usePeers();
  const href = useTabHref(companyId);
  const name = company?.name ?? 'this company';
  const [briefIdx, setBriefIdx] = useState(0);

  const tiles = useMemo(() => {
    const kpis = pickKpis(metrics);
    // Fill the grid with labelled gaps for core metrics that have no row at all.
    const gaps: CompanyMetric[] = missingCoreTypes(metrics, 4 - kpis.length).map((t) => ({
      id: `gap-${t}`, companyId, metricType: t, value: null, confidence: 'unknown', source: null,
      citations: [], methodNote: null, capturedAt: '',
    } as CompanyMetric));
    return [...kpis, ...gaps];
  }, [metrics, companyId]);

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
  const hasGaps = tiles.some((m) => m.value == null || m.confidence === 'unknown');

  return (
    <div className="cascade space-y-7">
      <Section title="Headline figures" hint="Each value carries its source, date and confidence. Unknown means no evidence yet, not zero.">
        {metricsQ.isPending ? (
          <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
            {[0, 1, 2, 3].map((i) => <KpiTileSkeleton key={i} i={i} />)}
          </div>
        ) : tiles.length === 0 ? (
          <Empty title="No quantitative figures yet" text="Research has not surfaced any sourced figures for this company. They appear here as they land." />
        ) : (
          <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
            {tiles.map((m) => {
              const ranking = peerState.status === 'ready' ? rankInDeck(companyId, m.metricType, peerState.peers) : null;
              return <KpiTile key={m.id} metric={m} ranking={ranking} href={href('metrics', { metric: m.metricType })} />;
            })}
          </div>
        )}
        {!metricsQ.isPending && tiles.length > 0 && (
          <p className="mt-2 text-[11.5px] text-faint">
            <Link to={href('metrics')} className="text-primary-ink hover:underline">
              {hasGaps ? 'See every figure and what would fill the gaps' : 'See every figure, source and peer comparison'}
            </Link>
          </p>
        )}
      </Section>

      <div className="grid gap-7 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div className="min-w-0 space-y-7">
          <PositionBlock companyId={companyId} metrics={metrics} />

          {query.isPending ? (
            <HydratingPanel label="Overview" variant="compact" />
          ) : query.isError ? (
            <ErrorState
              title="Failed to load the overview"
              message={query.error instanceof Error ? query.error.message : String(query.error)}
              onRetry={() => void query.refetch()}
            />
          ) : !result ? (
            <Section title="Research brief">
              <Empty title="Not researched yet" text="No overview has been saved for this company. Use Research above, or re-run this tab, to generate a sourced brief." />
            </Section>
          ) : !structured ? (
            <Section title="Research brief">
              <article className="markdown panel p-6">
                {result.content.markdown.trim()
                  ? <ResearchMarkdown text={result.content.markdown} />
                  : <p className="text-sm text-muted">No overview is available from the saved research yet.</p>}
              </article>
            </Section>
          ) : (
            <>
              {takeaways.length > 0 && (
                <Section title="Key takeaways" hint="The lead finding from each researched section, with its sources.">
                  <ol className="panel divide-y divide-border">
                    {takeaways.map((t, i) => (
                      <li key={t.section} className="flex gap-3.5 px-5 py-4">
                        <span className="mt-0.5 w-5 shrink-0 font-display text-sm font-semibold tabular-nums text-faint">{i + 1}</span>
                        <div className="min-w-0">
                          <p className="text-[10.5px] font-semibold uppercase tracking-[0.12em] text-faint">{sectionLabel(t.section)}</p>
                          <p className="mt-0.5 text-[14.5px] leading-relaxed text-content">{t.text}</p>
                          <SourceChips links={t.links} />
                        </div>
                      </li>
                    ))}
                  </ol>
                </Section>
              )}

              {active && (
                <Section title="Research brief" hint="One section at a time. Every paragraph keeps its source links.">
                  <div className="panel overflow-hidden">
                    <div role="tablist" aria-label="Research brief sections" className="flex gap-1 overflow-x-auto border-b border-border px-3 pt-2">
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
                  </div>
                </Section>
              )}
              <FromArchive companyId={companyId} />
            </>
          )}

          <div className="flex justify-end">
            <DigDeeperMenu
              topics={['Business model & how they make money', 'Competitive landscape & closest rivals', 'Risks & headwinds']}
              companyId={companyId}
              companyName={name}
            />
          </div>
        </div>

        <aside className="min-w-0 space-y-7">
          <RecentSignals companyId={companyId} />
          {company && (company.hqLocation || company.websiteUrl) && (
            <Section title="Company profile">
              <div className="panel space-y-2 p-4 text-sm">
                {company.hqLocation && (
                  <>
                    <p className="flex items-start gap-2 text-muted">
                      <MapPin className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
                      {company.hqLocation}
                    </p>
                    <div className="h-[110px] overflow-hidden rounded-lg border border-border">
                      <AiCover
                        cacheKey={`hq:${companyId}`}
                        title={`${name} — ${company.hqLocation}`}
                        context={`A cityscape of ${company.hqLocation} that is INSTANTLY RECOGNIZABLE as that specific place: its most famous landmarks, skyline silhouette, geography and light (e.g. San Francisco = Golden Gate Bridge + fog + hills + bay). Concrete and place-specific, never a generic city.`}
                        url={company.websiteUrl ?? ''}
                        source="news"
                        compact
                      />
                    </div>
                  </>
                )}
                {company.websiteUrl && (
                  <a href={company.websiteUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1.5 text-primary-ink hover:underline">
                    <ExternalLink className="h-3.5 w-3.5" aria-hidden />
                    {company.websiteUrl.replace(/^https?:\/\//, '')}
                  </a>
                )}
              </div>
            </Section>
          )}
        </aside>
      </div>
    </div>
  );
}
