import { sourceHref } from '@/lib/sourceHref';
import { useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { ChevronDown, ChevronsUpDown, ChevronUp, ExternalLink, Loader2, Pencil, Radar } from 'lucide-react';
import {
  METRIC_TYPE_LABELS,
  publisherOf,
  type CompanyMetric,
  type MetricType,
} from '@mi/contracts';
import {
  useCompany,
  useCompanyMetrics,
  useDashboardTab,
  useHuntMetrics,
  useOverrideMetric,
} from '@/hooks/data';
import { QueryBoundary } from '@/components/states/QueryBoundary';
import { HydratingPanel } from './HydratingPanel';
import { Modal } from '@/components/ui/Modal';
import { cn } from '@/lib/cn';
import { formatMetricValue } from '@/lib/format';
import { METRIC_COLORS, tint } from '@/lib/theme';
import { ConfidenceBadge } from '@/features/card/ConfidenceBadge';
import { UnknownSlot, UnknownInline, UNKNOWN_REASON } from '@/features/card/UnknownValue';
import { DigDeeperMenu } from '@/features/deepdive/DeepDive';
import { FactCheck } from '@/features/factcheck/FactCheck';
import { ChartPanel, CompositionDonut, Delta, ShareDonut, TrendArea, TrendBar, TrendLine } from './metricViz';
import { ExplorerValue, History, MetricExplorer, historyFor, type ExplorerSeries } from './MetricExplorer';
import {
  FAMILY_LABELS,
  FILL_HINT,
  METRIC_FAMILY,
  barPercent,
  isKnown,
  rankInDeck,
  sortMetricRows,
  type PeerEntry,
  type PeerRanking,
  type SortKey,
} from '../dashboardModel';
import { Section, metricLabel } from '../dashboardKit';
import { buildFigureSet, currencyCaptionFor, dropRestatedRevenue, figureDates, figureDisplay, figureTrust, linkedCitation } from '../figureSet';
import { figureCaveats, rowDates, type FigureCaveats } from '../figureCaveats';
import { shortCompanyName } from '../companyNames';
import { SourceCheck } from '../SourceCheck';
import { usePeers, type PeerState } from '../usePeers';
import { useSupports } from '@/lib/repository/RepositoryProvider';

/** Readable deep-dive topics per metric. */
const DEEP_TOPIC: Record<MetricType, string> = {
  market_share: 'Market share & competitive position',
  valuation: 'Valuation & funding history',
  market_cap: 'Market capitalization & stock performance',
  arr: 'Annual recurring revenue & growth',
  aum: 'Assets under management & fund performance',
  users: 'User / customer base & adoption',
  employees: 'Team size, hiring & key people',
  revenue: 'Annual revenue & growth',
  funding_total: 'Funding history & investors',
  last_round: 'Latest funding round',
  distribution: 'Distribution footprint & retail reach',
};


/** Human-in-the-loop correction: value + source note → user_verified → re-tier. */
function OverrideModal({
  metric,
  companyName,
  open,
  onOpenChange,
}: {
  metric: CompanyMetric;
  companyName: string;
  open: boolean;
  onOpenChange: (o: boolean) => void;
}) {
  const override = useOverrideMetric();
  const [value, setValue] = useState(metric.value != null ? String(metric.value) : '');
  const [note, setNote] = useState('');
  const unit =
    metric.metricType === 'market_share'
      ? 'percent (0–100)'
      : metric.metricType === 'users' || metric.metricType === 'employees' || metric.metricType === 'distribution'
        ? 'count'
        : 'USD';
  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      title={`Correct ${metricLabel(metric)}`}
      description={`${companyName} — your value becomes ground truth (User verified) and every view updates instantly.`}
    >
      <div className="space-y-4">
        <div>
          <label className="label" htmlFor="ov-value">
            New value <span className="text-muted">({unit}; leave blank to mark Unknown)</span>
          </label>
          <input
            id="ov-value"
            className="input tabular-nums"
            inputMode="decimal"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder={metric.value != null ? String(metric.value) : 'e.g. 15000000'}
          />
        </div>
        <div>
          <label className="label" htmlFor="ov-note">
            Why do you know this? <span className="text-muted">(stored as the source note)</span>
          </label>
          <input
            id="ov-note"
            className="input"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="e.g. Confirmed by their VP Sales, July 2026"
          />
        </div>
        <div className="flex justify-end gap-2">
          <button type="button" className="btn-ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </button>
          <button
            type="button"
            className="btn-primary"
            disabled={override.isPending}
            onClick={() => {
              const parsed = value.trim() === '' ? null : Number(value.replace(/[,$%\s]/g, ''));
              if (parsed !== null && !Number.isFinite(parsed)) return;
              override.mutate(
                {
                  companyId: metric.companyId,
                  metricType: metric.metricType,
                  value: parsed,
                  note: note.trim() || null,
                },
                { onSuccess: () => onOpenChange(false) },
              );
            }}
          >
            {override.isPending ? 'Saving…' : 'Save override'}
          </button>
        </div>
      </div>
    </Modal>
  );
}

/** Header row of the detail panel: label, family, correction affordance. */
function DetailHeader({
  metric, companyName, highlight,
}: { metric: CompanyMetric; companyName: string; highlight: boolean }) {
  const [editing, setEditing] = useState(false);
  const canCorrect = useSupports('overrideMetric');
  return (
    <div className="flex items-start gap-2">
      <div className="min-w-0">
        <p className="flex items-center gap-2 text-[10.5px] font-semibold uppercase tracking-[0.12em] text-muted">
          <span className="h-2 w-2 rounded-full" style={{ background: METRIC_COLORS[metric.metricType] }} aria-hidden />
          {FAMILY_LABELS[METRIC_FAMILY[metric.metricType]]}
          {highlight && (
            <span className="rounded-full border border-emerald-300 bg-emerald-50 px-1.5 py-px text-[9px] font-semibold normal-case tracking-normal text-emerald-700 dark:border-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300">
              Updated from live sources
            </span>
          )}
        </p>
        <h3 className="mt-0.5 font-display text-lg font-semibold text-content">{metricLabel(metric)}</h3>
      </div>
      {canCorrect && <button
        type="button"
        className="rounded-md p-1.5 text-faint transition-colors hover:bg-surface-2 hover:text-content"
        title="Correct this figure (you know better)"
        aria-label={`Correct ${metricLabel(metric)}`}
        onClick={() => setEditing(true)}
      >
        <Pencil className="h-3.5 w-3.5" />
      </button>}
      {editing && <OverrideModal metric={metric} companyName={companyName} open={editing} onOpenChange={setEditing} />}
    </div>
  );
}

/** Every source behind the figure, with the retained quote when there is one. */
function SourceDrill({ metric }: { metric: CompanyMetric }) {
  const quote = metric.passageSupport?.quote;
  const cites = metric.citations.filter((c) => /^https?:\/\//i.test(c.url));
  const known = isKnown(metric);
  if (!known) return null;
  return (
    <div>
      <h4 className="mb-1.5 text-[10.5px] font-semibold uppercase tracking-[0.12em] text-muted">Sources</h4>
      {cites.length > 0 ? (
        <ul className="space-y-1">
          {cites.map((c) => (
            <li key={c.url}>
              <a href={sourceHref(c.url, c.title)} target="_blank" rel="noopener noreferrer"
                className="group inline-flex max-w-full items-center gap-1.5 text-[12.5px] text-primary-ink hover:underline">
                <ExternalLink className="h-3 w-3 shrink-0" aria-hidden />
                <span className="truncate">{publisherOf(c.url, c.title)}</span>
                {c.credibility && c.credibility !== 'unknown' && (
                  <span className="shrink-0 rounded border border-border px-1 text-[10px] text-faint no-underline">
                    {c.credibility.replace('_', ' ')}
                  </span>
                )}
              </a>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-[12.5px] text-muted">No clickable source was recorded for this figure.</p>
      )}
      {quote && (
        <blockquote className="mt-2 border-l-2 border-border pl-3 text-[12.5px] italic leading-snug text-muted">
          “{quote}”
        </blockquote>
      )}
      {metric.confidence === 'estimated' && metric.methodNote && (
        <p className="mt-2 text-[12px] italic text-muted">How we got this: {metric.methodNote}</p>
      )}
    </div>
  );
}

/** The selected metric against the rest of the deck. Unknown peers are listed, never charted. */
function PeerComparison({
  ranking, selfId, hrefFor, peerStatus, peers,
}: {
  ranking: PeerRanking;
  selfId: string;
  hrefFor: (peerId: string, type: MetricType) => string;
  peerStatus: 'no_deck' | 'loading' | 'ready';
  peers: readonly PeerEntry[];
}) {
  const [all, setAll] = useState(false);
  const [hover, setHover] = useState<string | null>(null);
  const color = METRIC_COLORS[ranking.metricType];
  const max = ranking.points[0]?.value ?? 0;
  const shown = all ? ranking.points : ranking.points.slice(0, 8);
  const knownIds = new Set(ranking.points.map((p) => p.companyId));
  const unknownNames = peers.filter((p) => !knownIds.has(p.companyId) && p.companyId !== selfId).map((p) => shortCompanyName(p.name));
  return (
    <div>
      <h4 className="mb-1.5 flex flex-wrap items-center justify-between gap-x-3 text-[10.5px] font-semibold uppercase tracking-[0.12em] text-muted">
        <span>Versus this deck</span>
        {ranking.of > 1 && (
          <span className="normal-case tracking-normal text-faint tabular-nums">
            {ranking.rank != null ? `#${ranking.rank} of ${ranking.of} companies with this figure` : `${ranking.of} companies with this figure`}
            {ranking.includesEstimates ? ' · includes estimates' : ''}
          </span>
        )}
      </h4>
      {peerStatus === 'no_deck' ? (
        <p className="rounded-lg border border-dashed border-border bg-surface-2/40 px-3 py-3 text-[12.5px] leading-snug text-muted">
          Open this company from its deck to compare it with the other companies in that deck.
        </p>
      ) : peerStatus === 'loading' ? (
        <div className="space-y-2" aria-hidden>
          {[0, 1, 2].map((i) => <div key={i} className="h-4 animate-pulse rounded bg-border" style={{ animationDelay: `${i * 90}ms` }} />)}
        </div>
      ) : ranking.points.length === 0 ? (
        <p className="rounded-lg border border-dashed border-border bg-surface-2/40 px-3 py-3 text-[12.5px] leading-snug text-muted">
          No company in this deck has a known, comparable figure for this metric yet. Nothing is charted until one does.
        </p>
      ) : (
        <>
          <ul className="space-y-0.5" onMouseLeave={() => setHover(null)}>
            {shown.map((p) => (
              <li
                key={p.companyId}
                onMouseEnter={() => setHover(p.companyId)}
                className={cn(
                  'grid grid-cols-[minmax(0,92px)_minmax(0,1fr)_auto] items-center gap-2 rounded-md px-1.5 py-1 text-[12px] transition-colors',
                  hover === p.companyId && 'bg-surface-2',
                  p.isSelf && 'bg-primary/5',
                )}
              >
                {p.isSelf ? (
                  <span className="truncate font-semibold text-content" title={p.name}>{shortCompanyName(p.name)}</span>
                ) : (
                  <Link to={hrefFor(p.companyId, ranking.metricType)} className="truncate text-muted hover:text-primary-ink hover:underline" title={`Open ${p.name}’s metrics`}>
                    {shortCompanyName(p.name)}
                  </Link>
                )}
                <div className="h-2 overflow-hidden rounded-full bg-border/70">
                  <div
                    className={cn('h-full rounded-full', p.confidence === 'estimated' && 'mi-est-stripes')}
                    style={{
                      width: `${barPercent(p.value, max)}%`,
                      color,
                      background: p.confidence === 'estimated' ? tint(color, p.isSelf ? 0.5 : 0.3) : p.isSelf ? color : tint(color, 0.45),
                    }}
                  />
                </div>
                <span className={cn('tabular-nums', p.isSelf ? 'font-semibold text-content' : 'text-muted')}>
                  {formatMetricValue(ranking.metricType, p.value)}
                  {/* A real space, not margin: copy-paste and screen readers otherwise get "$8.0Best.". */}
                  {p.confidence === 'estimated' && <>{' '}<abbr title="Estimated" className="text-[10px] text-faint no-underline">est.</abbr></>}
                </span>
              </li>
            ))}
          </ul>
          {ranking.points.length > 8 && (
            <button type="button" className="mt-1 text-[12px] text-primary-ink hover:underline" onClick={() => setAll(!all)}>
              {all ? 'Show top 8' : `Show all ${ranking.points.length}`}
            </button>
          )}
        </>
      )}
      {peerStatus === 'ready' && unknownNames.length > 0 && (
        <p className="mt-2 text-[11.5px] leading-snug text-faint">
          <span className="font-medium text-muted">Unknown, not charted: </span>
          {unknownNames.slice(0, 6).join(', ')}{unknownNames.length > 6 ? ` and ${unknownNames.length - 6} more` : ''}.
        </p>
      )}
    </div>
  );
}

function MetricDetail({
  metric, companyId, companyName, ranking, peers, highlight, hrefFor, series,
}: {
  metric: CompanyMetric;
  companyId: string;
  companyName: string;
  ranking: PeerRanking;
  peers: PeerState;
  highlight: boolean;
  hrefFor: (peerId: string, type: MetricType) => string;
  series: ExplorerSeries | null;
}) {
  const known = isKnown(metric);
  const dates = known ? figureDates(metric) : null;
  const currency = known ? currencyCaptionFor(metric) : null;
  const history = known ? historyFor(metric.metricType, series) : [];
  return (
    <>
      {/* The one panel for the picked figure (the strip above and the table below both select it): the figure and its sources on the left, the one deck comparison on the right, so neither column leaves a hole. */}
      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,2fr)] lg:gap-x-10">
      <div className="min-w-0 space-y-5">
      <DetailHeader metric={metric} companyName={companyName} highlight={highlight} />
      <MetricBody metric={metric} />
      {known ? (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
          <ConfidenceBadge reported={metric.reportedSupport != null || metric.reportedBand != null}
            confidence={metric.confidence}
            note={metric.methodNote}
            source={metric.source}
            citations={metric.citations}
            metricLabel={metricLabel(metric)}
          />
          {dates && (
            <span className="text-[12px] text-muted">
              {dates.period ? `For ${dates.period}` : 'Period not reported'}
              {dates.record && <span className="text-faint"> · {dates.record}</span>}
            </span>
          )}
          {currency && <p className="basis-full text-[12px] text-muted">{currency}</p>}
        </div>
      ) : (
        <div className="space-y-2">
          <ConfidenceBadge confidence="unknown" note={metric.methodNote} source={metric.source} citations={metric.citations} metricLabel={metricLabel(metric)} />
          <p className="rounded-lg border border-dashed border-border bg-surface-2/40 px-3 py-2.5 text-[12.5px] leading-snug text-muted">
            <span className="font-medium text-content">What would fill this: </span>
            {FILL_HINT[metric.metricType]}
          </p>
        </div>
      )}
      {known && <SourceCheck metric={metric} label={metricLabel(metric)} />}
      <SourceDrill metric={metric} />
      </div>
      <div className="min-w-0">
        <PeerComparison ranking={ranking} selfId={companyId} hrefFor={hrefFor} peerStatus={peers.status} peers={peers.peers} />
      </div>
      </div>
      {known && history.length > 0 && (
        <div className="mt-5 border-t border-border pt-5">
          <History type={metric.metricType} history={history} />
        </div>
      )}
      {known && (
        <div className="mt-5 flex justify-end border-t border-border pt-3 empty:hidden">
          <FactCheck
            claim={`${companyName}'s ${metricLabel(metric)} is ${figureDisplay(metric)}`}
            hideWhenUnavailable
            companyName={companyName}
            companyId={companyId}
            metricType={metric.metricType}
            storedValue={metric.value}
          />
        </div>
      )}
    </>
  );
}

// ---- Sortable table --------------------------------------------------------

interface Row { metric: CompanyMetric; ranking: PeerRanking; rank: number | null }

function SortHeader({
  label, k, sort, onSort, className,
}: { label: string; k: SortKey; sort: { key: SortKey; dir: 'asc' | 'desc' }; onSort: (k: SortKey) => void; className?: string }) {
  const active = sort.key === k;
  const Icon = !active ? ChevronsUpDown : sort.dir === 'asc' ? ChevronUp : ChevronDown;
  return (
    <th scope="col" aria-sort={active ? (sort.dir === 'asc' ? 'ascending' : 'descending') : 'none'} className={cn('px-3 py-2 text-left font-semibold', className)}>
      <button type="button" onClick={() => onSort(k)} className={cn('inline-flex items-center gap-1 uppercase tracking-[0.1em] transition-colors hover:text-content', active && 'text-content')}>
        {label}
        <Icon className={cn('h-3 w-3', !active && 'opacity-50')} aria-hidden />
      </button>
    </th>
  );
}

function MetricTable({
  rows, selected, onSelect, sort, onSort, peersReady, group,
}: {
  group: FigureCaveats;
  rows: Row[];
  selected: MetricType | null;
  onSelect: (t: MetricType) => void;
  sort: { key: SortKey; dir: 'asc' | 'desc' };
  onSort: (k: SortKey) => void;
  peersReady: boolean;
}) {
  // When no source gave a period and every figure was captured the same day, the Period column
  // would be empty on every row: the group line above the table says it once instead.
  const showPeriod = !(group.noPeriod && group.record);
  return (
    <div className="panel overflow-hidden">
      <table className="w-full border-collapse text-[13px]">
        <caption className="sr-only">Company metrics. Select a row for sources and peer comparison.</caption>
        <thead>
          <tr className="border-b border-border bg-surface-2/50 text-[10.5px] text-muted">
            <SortHeader label="Figure" k="metric" sort={sort} onSort={onSort} />
            <SortHeader label="Value" k="value" sort={sort} onSort={onSort} />
            <SortHeader label="Source" k="confidence" sort={sort} onSort={onSort} className="hidden sm:table-cell" />
            {showPeriod && <SortHeader label="Period" k="asof" sort={sort} onSort={onSort} className="hidden md:table-cell" />}
            <SortHeader label="In deck" k="rank" sort={sort} onSort={onSort} className="hidden whitespace-nowrap text-right sm:table-cell" />
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {rows.map(({ metric, ranking, rank }) => {
            const known = isKnown(metric);
            const isSel = selected === metric.metricType;
            const cite = linkedCitation(metric);
            const trust = figureTrust(metric);
            const dates = known ? rowDates(metric, group) : null;
            const currency = known ? currencyCaptionFor(metric) : null;
            // Only what differs from the group line above the table; an empty string says nothing.
            const periodLine = dates ? (dates.period ?? (dates.notReported ? 'Period not reported' : null)) : null;
            const periodAndRecord = [periodLine, dates?.record].filter(Boolean).join(' · ');
            const rankTitle = `#${rank} of ${ranking.of} companies with this figure`;
            return (
              <tr
                key={metric.id}
                tabIndex={0}
                aria-selected={isSel}
                onClick={() => onSelect(metric.metricType)}
                onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onSelect(metric.metricType); } }}
                className={cn(
                  'cursor-pointer transition-colors hover:bg-surface-2/70 focus-visible:bg-surface-2',
                  isSel && 'bg-primary/5 shadow-[inset_2px_0_0_rgb(var(--c-primary))]',
                )}
              >
                <td className="px-3 py-2.5 align-top sm:align-middle">
                  <span className="flex items-center gap-2 whitespace-nowrap font-medium text-content">
                    <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: METRIC_COLORS[metric.metricType] }} aria-hidden />
                    {metricLabel(metric)}
                  </span>
                </td>
                <td className="px-3 py-2.5 align-top sm:align-middle">
                  {known ? (
                    <span className="whitespace-nowrap font-display text-[15px] font-semibold tabular-nums text-content">
                      {figureDisplay(metric)}
                    </span>
                  ) : (
                    <span title={UNKNOWN_REASON}><UnknownInline /></span>
                  )}
                  {/* Phone: the source, date and rank stay with the figure instead of vanishing with their columns. */}
                  {known && (
                    <span className="mt-0.5 block space-y-px text-[11px] text-faint sm:hidden">
                      {cite ? (
                        <a href={sourceHref(cite.url, cite.title)} target="_blank" rel="noopener noreferrer" onClick={(e) => e.stopPropagation()}
                          className="block max-w-[190px] truncate text-primary-ink hover:underline">
                          {publisherOf(cite.url, cite.title)} ↗
                        </a>
                      ) : <span className="block">{metric.confidence === 'user_verified' ? 'Your correction' : 'No link recorded'}</span>}
                      <span className="block">{[trust, periodAndRecord].filter(Boolean).join(' · ')}</span>
                      {rank != null && ranking.of > 1 && <span className="block" title={rankTitle}>#{rank} of {ranking.of} companies with this figure</span>}
                      {currency && <span className="block text-muted">{currency}</span>}
                    </span>
                  )}
                  {/* The Source column is hidden on a phone, so the check sits under the value there. */}
                  {known && <SourceCheck metric={metric} label={metricLabel(metric)} className="mt-0.5 max-w-[200px] sm:hidden" groupedUndated={group.noPeriod} />}
                </td>
                <td className="hidden px-3 py-2.5 sm:table-cell">
                  {/* Publisher and trust word share one line; the caption and the source check follow, each on its own. */}
                  {known && (
                    <span className="flex items-baseline gap-x-2">
                      {cite ? (
                        <a
                          href={sourceHref(cite.url, cite.title)}
                          target="_blank"
                          rel="noopener noreferrer"
                          onClick={(e) => e.stopPropagation()}
                          className="min-w-0 max-w-[220px] truncate text-[12.5px] text-primary-ink hover:underline"
                          title={`Source: ${publisherOf(cite.url, cite.title)}`}
                        >
                          {publisherOf(cite.url, cite.title)} ↗
                        </a>
                      ) : <span className="text-[12px] text-muted">{metric.confidence === 'user_verified' ? 'Your correction' : 'No link recorded'}</span>}
                      <span className="shrink-0 text-[11px] text-faint">{trust}</span>
                    </span>
                  )}
                  {known && periodAndRecord && <span className="block text-[11px] text-faint md:hidden">{periodAndRecord}</span>}
                  {currency && <span className="mt-0.5 block text-[11px] text-muted">{currency}</span>}
                  {known && <SourceCheck metric={metric} label={metricLabel(metric)} className="mt-0.5" groupedUndated={group.noPeriod} />}
                </td>
                {showPeriod && (
                  <td className="hidden whitespace-nowrap px-3 py-2.5 text-[12px] text-muted md:table-cell">
                    {/* Two different dates: the period the source reports, and when we captured it. */}
                    {!known ? '—' : (
                      <>
                        {periodLine && <span className="block tabular-nums">{periodLine}</span>}
                        {dates?.record && <span className="block text-[11px] text-faint">{dates.record}</span>}
                      </>
                    )}
                  </td>
                )}
                <td className="hidden whitespace-nowrap px-3 py-2.5 text-right sm:table-cell">
                  {rank != null && ranking.of > 1
                    ? <span className="text-[12px] tabular-nums text-muted" title={rankTitle}><span className="font-semibold text-content">#{rank}</span> of {ranking.of}</span>
                    : <span className="text-[12px] text-faint" title={peersReady ? 'Needs a known figure here and at least one known peer.' : 'Open from a deck to rank.'}>—</span>}
                </td>
              </tr>
            );
          })}
          {rows.length === 0 && (
            <tr><td colSpan={5} className="px-4 py-8 text-center text-[13px] text-muted">No metrics in this family yet.</td></tr>
          )}
        </tbody>
      </table>
      <p className="border-t border-border px-3 py-2.5 text-[11px] leading-snug text-faint">
        In deck: rank among the companies in this deck that have a figure for that row, so the count differs by row.
        {showPeriod && ' Period is what the source says the figure is for; captured is when we recorded it.'}
      </p>
    </div>
  );
}


/** Number + the right micro-visualization for the metric's semantic shape. */
function MetricBody({ metric }: { metric: CompanyMetric }) {
  const color = METRIC_COLORS[metric.metricType];
  const known = metric.value != null && metric.confidence !== 'unknown';
  if (!known) return <UnknownSlot />;

  // Share of a whole → radial against the rest of the market.
  if (metric.metricType === 'market_share') {
    return (
      <div className="flex items-center gap-4">
        <ShareDonut value={metric.value} confidence={metric.confidence} color={color} />
        <div className="min-w-0 text-[11px] leading-relaxed text-muted">
          The rest of the market holds{' '}
          <span className="font-semibold tabular-nums text-content">
            {(100 - (metric.value ?? 0)).toFixed(1)}%
          </span>
          .
        </div>
      </div>
    );
  }

  return <ExplorerValue key={metric.metricType} type={metric.metricType} value={metric.value} metric={metric} />;
}

/**
 * "Find more metrics": one grounded pass hunting every soft figure this
 * company still has. Renders only on live-research transports, and only
 * while soft figures actually exist — an honest button, not a decoration.
 */
function HuntMetricsButton({
  companyId,
  metrics,
  onFilled,
}: {
  companyId: string;
  metrics: CompanyMetric[];
  onFilled?: (types: MetricType[]) => void;
}) {
  const hunt = useHuntMetrics();
  const [outcome, setOutcome] = useState<string | null>(null);
  const softCount =
    metrics.filter(
      (m) =>
        m.confidence !== 'user_verified' &&
        m.confidence !== 'verified' &&
        (m.value == null || m.confidence === 'unknown' || m.confidence === 'estimated'),
    ).length + Math.max(0, 5 - metrics.length);
  if (!hunt.isAvailable || (softCount === 0 && !outcome)) return null;
  return (
    <span className="flex min-w-0 flex-wrap items-center gap-2">
      {outcome && <span className="text-[11px] font-medium text-positive">{outcome}</span>}
      {softCount > 0 && (
        <button
          type="button"
          className="btn-ghost shrink-0"
          disabled={hunt.isPending}
          title="Searches for current figures for every metric that is still missing or unchecked. Only sourced figures are kept, and they update everywhere."
          onClick={() =>
            hunt.mutate(companyId, {
              onSuccess: (r) => {
                // Name WHAT was filled — "filled 2 figures" with no visible
                // change was the filmed confusion.
                setOutcome(
                  r.filledTypes.length > 0
                    ? `Filled ${r.filledTypes.map((t) => {
                      const metric = r.metrics.find(m => m.metricType === t);
                      return metric ? metricLabel(metric) : METRIC_TYPE_LABELS[t];
                    }).join(' & ')} from live sources — highlighted below.`
                    : 'No additional figures met the sourcing bar — gaps stay honest.',
                );
                if (r.filledTypes.length > 0) onFilled?.(r.filledTypes);
              },
            })
          }
        >
          {hunt.isPending ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Radar className="h-4 w-4" />
          )}
          {hunt.isPending ? 'Hunting figures…' : 'Find more metrics'}
        </button>
      )}
    </span>
  );
}

export { dropRestatedRevenue };

export function MetricsTab({ companyId }: { companyId: string }) {
  const metricsQ = useCompanyMetrics(companyId);
  const seriesQ = useDashboardTab(companyId, 'metrics');
  const company = useCompany(companyId).data;
  const companyName = company?.name ?? 'this company';
  const peerState = usePeers();
  const [params] = useSearchParams();
  // Figures the hunt just filled — their widgets light up so the update is
  // impossible to miss.
  const [justFilled, setJustFilled] = useState<ReadonlySet<MetricType>>(new Set());
  const [picked, setPicked] = useState<MetricType | null>(null);
  const [sort, setSort] = useState<{ key: SortKey; dir: 'asc' | 'desc' }>({ key: 'metric', dir: 'asc' });
  const wanted = params.get('metric') as MetricType | null;
  // The table sits below the one detail panel: picking a row brings the panel into view only if it is off screen.
  const panelRef = useRef<HTMLDivElement>(null);
  const pickFromList = (type: MetricType) => {
    setPicked(type);
    panelRef.current?.scrollIntoView?.({ block: 'nearest' });
  };

  const peerHref = (peerId: string, type: MetricType) => {
    const next = new URLSearchParams(params);
    next.set('metric', type);
    return `/company/${peerId}/dashboard/metrics?${next.toString()}`;
  };

  return (
    <QueryBoundary
      query={metricsQ}
      loading={<HydratingPanel label="Metrics" variant="table" />}
    >
      {(metrics) => {
        const { all, real } = buildFigureSet(metrics, company, companyId);
        const rows: Row[] = all.map((metric) => {
          const ranking = rankInDeck(companyId, metric.metricType, peerState.peers);
          return { metric, ranking, rank: ranking.rank };
        });
        // Found figures form the table; missing ones are one line underneath,
        // each still selectable to see what kind of source would fill it.
        const sorted = sortMetricRows(rows.filter((r) => isKnown(r.metric)), sort.key, sort.dir);
        const missing = rows.filter((r) => !isKnown(r.metric));
        const wantedType = picked ?? (wanted && all.some((m) => m.metricType === wanted) ? wanted : null);
        // With nothing found, open on a row the research actually tried (its note
        // says why it is missing) rather than a blank placeholder gap.
        const selectedRow = rows.find((r) => r.metric.metricType === wantedType) ?? sorted[0] ??
          missing.find((r) => !r.metric.id.startsWith('gap-')) ?? missing[0];
        const series = seriesQ.data?.content;
        const knownCount = sorted.length;
        const caveats = figureCaveats(sorted.map((r) => r.metric));
        const unlinkedCount = sorted.filter((r) => r.metric.confidence !== 'user_verified' && !linkedCitation(r.metric)).length;
        // Older stored content predates the quarterly field.
        const quarterly = series?.revenueQuarterly ?? [];
        const hasSeries = !!series && (series.revenue.length > 1 || quarterly.length > 1 || series.users.length > 1 || series.churn.length > 1 || series.capTable.length > 0);
        const onSort = (k: SortKey) =>
          setSort((s) => (s.key === k ? { key: k, dir: s.dir === 'asc' ? 'desc' : 'asc' } : { key: k, dir: k === 'value' || k === 'asof' ? 'desc' : 'asc' }));
        return (
          <div className="cascade space-y-8">
            {/* The strip and the explorer read as one block; the table, the history charts are the next sections. */}
            <div className="space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
              <p className="text-[13px] text-muted">
                {knownCount > 0 ? <>
                  <span className="font-semibold text-content">{knownCount}</span> of {rows.length} figures found
                  {unlinkedCount === 0 ? ', each with its source.' : `; ${unlinkedCount} without a source link yet.`}
                  {' '}Select one for detail and how it compares in this deck.
                </> : 'No sourced figures found yet. Nothing here is estimated to fill a gap.'}
              </p>
              <span className="flex flex-wrap items-center justify-end gap-1.5">
                <HuntMetricsButton
                  companyId={companyId}
                  metrics={metrics}
                  onFilled={(types) => setJustFilled(new Set(types))}
                />
                <DigDeeperMenu
                  topics={real.map((m) => m.passageSupport?.definition === 'annual_revenue' ? 'Annual revenue & growth' : DEEP_TOPIC[m.metricType])}
                  companyId={companyId}
                  companyName={companyName}
                />
              </span>
            </div>

            <div ref={panelRef} className="scroll-mt-4">
            <MetricExplorer
              rows={sorted}
              missing={missing.map((r) => r.metric)}
              selected={selectedRow?.metric.metricType ?? null}
              onSelect={setPicked}
              highlight={!!selectedRow && justFilled.has(selectedRow.metric.metricType)}
            >
              {selectedRow && (
                <MetricDetail
                  key={selectedRow.metric.metricType}
                  metric={selectedRow.metric}
                  companyId={companyId}
                  companyName={companyName}
                  ranking={selectedRow.ranking}
                  peers={peerState}
                  highlight={justFilled.has(selectedRow.metric.metricType)}
                  hrefFor={peerHref}
                  series={series ? { revenue: series.revenue, revenueQuarterly: quarterly, users: series.users } : null}
                />
              )}
            </MetricExplorer>
            </div>
            </div>

            {/* The all-figures view: picking a row (or a "not found" chip) selects that figure in the one panel above. */}
            <div className="space-y-4">
              <div className="min-w-0 space-y-3">
                {caveats.line && <p className="text-[12px] text-faint">{caveats.line}</p>}
                {sorted.length > 0 && (
                  <MetricTable
                    group={caveats}
                    rows={sorted}
                    selected={selectedRow?.metric.metricType ?? null}
                    onSelect={pickFromList}
                    sort={sort}
                    onSort={onSort}
                    peersReady={peerState.status === 'ready'}
                  />
                )}
                {missing.length > 0 && (
                  <div className="flex flex-wrap items-center gap-1.5 text-[12.5px]">
                    <span className="mr-1 text-muted">Not found yet:</span>
                    {missing.map(({ metric }) => (
                      <button
                        key={metric.metricType}
                        type="button"
                        aria-pressed={selectedRow?.metric.metricType === metric.metricType}
                        onClick={() => pickFromList(metric.metricType)}
                        className={cn(
                          'rounded-full border border-dashed px-2.5 py-0.5 transition-colors',
                          selectedRow?.metric.metricType === metric.metricType
                            ? 'border-primary/60 bg-primary/5 text-content'
                            : 'border-border text-muted hover:text-content',
                        )}
                      >
                        {metricLabel(metric)}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>

            {hasSeries && series && (
              <Section title="Reported history" hint="Series the research found for this company. Charts only appear where real data points exist.">
              {/* An odd last chart spans the row instead of leaving an empty half. */}
              <div className="grid gap-4 lg:grid-cols-2 lg:[&>*:last-child:nth-child(odd)]:col-span-2">
                {series.revenue.length > 1 && (
                  <ChartPanel
                    title="Revenue trend"
                    sub={`${series.revenue[0]!.period} → ${series.revenue[series.revenue.length - 1]!.period} · ${series.revenue[0]!.period === 'Current' ? 'current point' : 'SEC filing-reported annual revenue'}`}
                    right={<Delta data={series.revenue} fmt={(v) => formatMetricValue('arr', v)} />}
                    views={{ options: [{ key: 'bar', label: 'Bar' }, { key: 'line', label: 'Line' }, { key: 'area', label: 'Area' }], default: 'bar' }}
                    render={(w, view) => view === 'line'
                      ? <TrendLine data={series.revenue} color={METRIC_COLORS.arr} width={w} fmt={(v) => formatMetricValue('arr', v)} />
                      : view === 'area'
                        ? <TrendArea data={series.revenue} color={METRIC_COLORS.arr} width={w} fmt={(v) => formatMetricValue('arr', v)} />
                        : <TrendBar data={series.revenue} color={METRIC_COLORS.arr} width={w} fmt={(v) => formatMetricValue('arr', v)} />}
                  />
                )}
                {quarterly.length > 1 && (
                  <ChartPanel
                    title="Quarterly revenue"
                    sub={`${quarterly[0]!.period} → ${quarterly[quarterly.length - 1]!.period} · three-month periods as filed with the SEC; a quarter reported only inside an annual total is not shown`}
                    right={<Delta data={quarterly} fmt={(v) => formatMetricValue('arr', v)} />}
                    views={{ options: [{ key: 'bar', label: 'Bar' }, { key: 'line', label: 'Line' }], default: 'bar' }}
                    render={(w, view) => view === 'line'
                      ? <TrendLine data={quarterly} color={METRIC_COLORS.arr} width={w} fmt={(v) => formatMetricValue('arr', v)} />
                      : <TrendBar data={quarterly} color={METRIC_COLORS.arr} width={w} fmt={(v) => formatMetricValue('arr', v)} />}
                  />
                )}
                {series.users.length > 1 && (
                  <ChartPanel
                    title="Users trend"
                    sub={`${series.users[0]!.period} → ${series.users[series.users.length - 1]!.period} · estimated series`}
                    right={<Delta data={series.users} fmt={(v) => formatMetricValue('users', v)} />}
                    views={{ options: [{ key: 'bar', label: 'Bar' }, { key: 'line', label: 'Line' }, { key: 'area', label: 'Area' }], default: 'bar' }}
                    render={(w, view) => view === 'line'
                      ? <TrendLine data={series.users} color={METRIC_COLORS.users} width={w} fmt={(v) => formatMetricValue('users', v)} />
                      : view === 'area'
                        ? <TrendArea data={series.users} color={METRIC_COLORS.users} width={w} fmt={(v) => formatMetricValue('users', v)} />
                        : <TrendBar data={series.users} color={METRIC_COLORS.users} width={w} fmt={(v) => formatMetricValue('users', v)} />}
                  />
                )}
                {series.churn.length > 1 && (
                  <ChartPanel
                    title="Churn"
                    sub="lower is better · estimated series"
                    right={<Delta data={series.churn} fmt={(v) => `${v.toFixed(1)}%`} />}
                    render={(w) => (
                      <TrendArea data={series.churn} color="#DC2626" width={w} fmt={(v) => `${v.toFixed(1)}%`} />
                    )}
                  />
                )}
                {series.capTable.length > 0 && (
                  <ChartPanel
                    title="Cap table"
                    sub="ownership composition"
                    render={(w) => (
                      <CompositionDonut
                        slices={series.capTable}
                        palette={[METRIC_COLORS.valuation, METRIC_COLORS.users, METRIC_COLORS.arr, METRIC_COLORS.employees, METRIC_COLORS.market_share, '#64748B']}
                        width={w}
                      />
                    )}
                  />
                )}
              </div>
              </Section>
            )}
          </div>
        );
      }}
    </QueryBoundary>
  );
}
