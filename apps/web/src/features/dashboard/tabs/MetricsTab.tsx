import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { ChevronDown, ChevronsUpDown, ChevronUp, ExternalLink, Loader2, Pencil, Radar } from 'lucide-react';
import {
  METRIC_TYPE_LABELS,
  classifyMarketProfile,
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
import { buildMetricViews } from '@/features/card/card-view';
import { DigDeeperMenu } from '@/features/deepdive/DeepDive';
import { FactCheck } from '@/features/factcheck/FactCheck';
import { ChartPanel, CompositionDonut, Delta, ShareDonut, TrendArea, TrendBar, TrendLine } from './metricViz';
import {
  FAMILY_LABELS,
  FILL_HINT,
  METRIC_FAMILY,
  barPercent,
  formatAsOf,
  isKnown,
  metricAsOf,
  missingCoreTypes,
  orderMetrics,
  rankInDeck,
  sortMetricRows,
  type MetricFamily,
  type PeerEntry,
  type PeerRanking,
  type SortKey,
} from '../dashboardModel';
import { ConfidenceMark, Section, metricLabel } from '../dashboardKit';
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
    <div className="flex items-start justify-between gap-3">
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
              <a href={c.url} target="_blank" rel="noopener noreferrer"
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
  const unknownNames = peers.filter((p) => !knownIds.has(p.companyId) && p.companyId !== selfId).map((p) => p.name);
  return (
    <div>
      <h4 className="mb-1.5 flex items-center justify-between text-[10.5px] font-semibold uppercase tracking-[0.12em] text-muted">
        <span>Versus this deck</span>
        {ranking.rank != null && ranking.of > 1 && (
          <span className="normal-case tracking-normal text-faint tabular-nums">#{ranking.rank} of {ranking.of} known</span>
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
                  <span className="truncate font-semibold text-content" title={p.name}>{p.name}</span>
                ) : (
                  <Link to={hrefFor(p.companyId, ranking.metricType)} className="truncate text-muted hover:text-primary-ink hover:underline" title={`Open ${p.name}’s metrics`}>
                    {p.name}
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
                  {p.confidence === 'estimated' && <span className="ml-1 text-[10px] text-faint">est.</span>}
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
  metric, companyId, companyName, ranking, peers, highlight, hrefFor,
}: {
  metric: CompanyMetric;
  companyId: string;
  companyName: string;
  ranking: PeerRanking;
  peers: PeerState;
  highlight: boolean;
  hrefFor: (peerId: string, type: MetricType) => string;
}) {
  const known = isKnown(metric);
  const asOf = known ? formatAsOf(metric) : null;
  return (
    <aside
      aria-label={`${metricLabel(metric)} detail`}
      className={cn('panel space-y-5 p-5 lg:sticky lg:top-4', highlight && 'ring-2 ring-emerald-400/70')}
    >
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
          {asOf && <span className="text-[12px] text-muted">{asOf}</span>}
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
      <SourceDrill metric={metric} />
      <PeerComparison ranking={ranking} selfId={companyId} hrefFor={hrefFor} peerStatus={peers.status} peers={peers.peers} />
      {known && (
        <div className="flex justify-end border-t border-border pt-3">
          <FactCheck
            claim={`${companyName}'s ${metricLabel(metric)} is ${formatMetricValue(metric.metricType, metric.value)}`}
            companyName={companyName}
            companyId={companyId}
            metricType={metric.metricType}
            storedValue={metric.value}
          />
        </div>
      )}
    </aside>
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
  rows, selected, onSelect, sort, onSort, peersReady,
}: {
  rows: Row[];
  selected: MetricType | null;
  onSelect: (t: MetricType) => void;
  sort: { key: SortKey; dir: 'asc' | 'desc' };
  onSort: (k: SortKey) => void;
  peersReady: boolean;
}) {
  return (
    <div className="panel overflow-hidden">
      <table className="w-full border-collapse text-[13px]">
        <caption className="sr-only">Company metrics. Select a row for sources and peer comparison.</caption>
        <thead>
          <tr className="border-b border-border bg-surface-2/50 text-[10.5px] text-muted">
            <SortHeader label="Metric" k="metric" sort={sort} onSort={onSort} />
            <SortHeader label="Value" k="value" sort={sort} onSort={onSort} />
            <SortHeader label="Confidence" k="confidence" sort={sort} onSort={onSort} className="hidden sm:table-cell" />
            <SortHeader label="As of" k="asof" sort={sort} onSort={onSort} className="hidden md:table-cell" />
            <SortHeader label="Deck rank" k="rank" sort={sort} onSort={onSort} className="hidden sm:table-cell" />
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {rows.map(({ metric, ranking, rank }) => {
            const known = isKnown(metric);
            const isSel = selected === metric.metricType;
            const cite = metric.citations.find((c) => /^https?:\/\//i.test(c.url));
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
                <td className="px-3 py-3">
                  <span className="flex items-center gap-2 font-medium text-content">
                    <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: METRIC_COLORS[metric.metricType] }} aria-hidden />
                    {metricLabel(metric)}
                  </span>
                  <span className="mt-0.5 block pl-4 text-[11px] text-faint">{FAMILY_LABELS[METRIC_FAMILY[metric.metricType]]}</span>
                </td>
                <td className="px-3 py-3">
                  {known ? (
                    <span className="font-display text-[15px] font-semibold tabular-nums text-content">
                      {formatMetricValue(metric.metricType, metric.value)}
                    </span>
                  ) : (
                    <span title={UNKNOWN_REASON}><UnknownInline /></span>
                  )}
                  {cite && known && (
                    <a
                      href={cite.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      onClick={(e) => e.stopPropagation()}
                      className="mt-0.5 block max-w-[150px] truncate text-[11px] text-primary-ink hover:underline"
                      title={`Source: ${publisherOf(cite.url, cite.title)}`}
                    >
                      {publisherOf(cite.url, cite.title)} ↗
                    </a>
                  )}
                </td>
                <td className="hidden px-3 py-3 sm:table-cell"><ConfidenceMark confidence={metric.confidence} /></td>
                <td className="hidden px-3 py-3 text-[12px] tabular-nums text-muted md:table-cell">
                  {/* Only a source-stated date is an "as of"; capture time is not the figure's date. */}
                  {!known ? '—' : metricAsOf(metric).kind === 'as_of'
                    ? (metricAsOf(metric).iso ?? '').slice(0, 10) || '—'
                    : <span title={formatAsOf(metric) ?? undefined}>Undated</span>}
                </td>
                <td className="hidden px-3 py-3 sm:table-cell">
                  {rank != null && ranking.of > 1
                    ? <span className="text-[12px] tabular-nums text-muted"><span className="font-semibold text-content">#{rank}</span> of {ranking.of}</span>
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
    </div>
  );
}


/**
 * The KPI band — the founder's reference dashboards all open with one: the
 * headline figures in a single strip before any chart. Confidence dots ride
 * along; an unknown renders as an honest gap, not a zero.
 */
function KpiBand({ tiles }: { tiles: CompanyMetric[] }) {
  const DOT: Record<string, string> = {
    verified: '#16A34A',
    estimated: '#CA8A04',
    unknown: '#9A9AA1',
    user_verified: '#0284C7',
  };
  return (
    <section aria-label="Company headline metrics" className="panel grid w-full min-w-0 grid-cols-2 divide-border sm:grid-cols-3 sm:divide-x lg:grid-cols-5">
      {tiles.map((m) => (
        <div key={m.id} className="min-w-0 px-4 py-3.5">
          <div className="flex items-center gap-1.5">
            <span className="text-[10px] font-semibold uppercase tracking-widest text-muted">
              {metricLabel(m)}
            </span>
            <span
              className="h-1.5 w-1.5 rounded-full"
              style={{ background: DOT[m.confidence] }}
              title={`Confidence: ${m.confidence.replace('_', ' ')}`}
            />
          </div>
          <div
            className={
              m.value != null && m.confidence !== 'unknown'
                ? 'mt-1 font-display text-xl font-semibold tabular-nums text-content'
                : 'mt-1 font-display text-xl font-semibold text-faint'
            }
            title={m.value != null && m.confidence !== 'unknown' ? undefined : UNKNOWN_REASON}
          >
            {m.value != null && m.confidence !== 'unknown'
              ? formatMetricValue(m.metricType, m.value)
              : '—'}
          </div>
        </div>
      ))}
    </section>
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

  return (
    <div className="font-display text-3xl font-semibold tabular-nums leading-none text-content">
      {formatMetricValue(metric.metricType, metric.value)}
    </div>
  );
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

/**
 * An Unknown row that a known sibling already answers is noise, not a gap:
 * "Revenue: Unknown" under a sourced annual revenue, "Market cap: Unknown"
 * under a sourced valuation, AUM on a company that isn't a fund manager.
 */
function pruneRedundantGaps(rows: CompanyMetric[], financialFirm: boolean): CompanyMetric[] {
  const known = new Set(rows.filter(isKnown).map((m) => m.metricType));
  const answeredBy: Partial<Record<MetricType, MetricType[]>> = {
    revenue: ['arr'], arr: ['revenue'],
    market_cap: ['valuation'], valuation: ['market_cap'],
    last_round: ['market_cap'], funding_total: ['market_cap'],
  };
  return rows.filter((m) => {
    if (isKnown(m)) return true;
    if (m.metricType === 'aum' && !financialFirm) return false;
    return !(answeredBy[m.metricType] ?? []).some((t) => known.has(t));
  });
}

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
  const [family, setFamily] = useState<MetricFamily | 'all'>('all');
  const [picked, setPicked] = useState<MetricType | null>(null);
  const [sort, setSort] = useState<{ key: SortKey; dir: 'asc' | 'desc' }>({ key: 'metric', dir: 'asc' });
  const wanted = params.get('metric') as MetricType | null;

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
        const seen = new Set<MetricType>();
        const projected = buildMetricViews(metrics, company?.websiteUrl).map(({ metric }) => metric);
        const deduped = orderMetrics(projected).filter((m) => !seen.has(m.metricType) && !!seen.add(m.metricType));
        const financialFirm = company ? classifyMarketProfile(company) === 'financial_firm' : false;
        const real = pruneRedundantGaps(deduped, financialFirm);
        // Core figures with no row at all stay visible as labelled gaps, so a
        // sparse company reads as "not yet found", not as an empty page.
        const gaps: CompanyMetric[] = missingCoreTypes(deduped, 4).map((t) => ({
          id: `gap-${t}`, companyId, metricType: t, value: null, confidence: 'unknown', source: null,
          citations: [], methodNote: null, capturedAt: '',
        } as CompanyMetric));
        const all = orderMetrics(pruneRedundantGaps([...deduped, ...gaps], financialFirm));
        const rows: Row[] = all.map((metric) => {
          const ranking = rankInDeck(companyId, metric.metricType, peerState.peers);
          return { metric, ranking, rank: ranking.rank };
        });
        const familyCounts = (f: MetricFamily) => rows.filter((r) => METRIC_FAMILY[r.metric.metricType] === f).length;
        const filtered = rows.filter((r) => family === 'all' || METRIC_FAMILY[r.metric.metricType] === family);
        const sorted = sortMetricRows(filtered, sort.key, sort.dir);
        const firstKnown = sorted.find((r) => isKnown(r.metric)) ?? sorted.find((r) => !r.metric.id.startsWith('gap-')) ?? sorted[0];
        const wantedType = picked ?? (wanted && all.some((m) => m.metricType === wanted) ? wanted : null);
        const selectedRow = sorted.find((r) => r.metric.metricType === wantedType) ?? firstKnown;
        const tiles = real.filter(isKnown); // the headline band shows only figures that exist
        const series = seriesQ.data?.content;
        const knownCount = real.filter(isKnown).length;
        const hasSeries = !!series && (series.revenue.length > 1 || series.users.length > 1 || series.churn.length > 1 || series.capTable.length > 0);
        const onSort = (k: SortKey) =>
          setSort((s) => (s.key === k ? { key: k, dir: s.dir === 'asc' ? 'desc' : 'asc' } : { key: k, dir: k === 'value' || k === 'asof' ? 'desc' : 'asc' }));
        return (
          <div className="cascade space-y-6">
            <div className="space-y-3">
              {tiles.length > 0 && <KpiBand tiles={tiles} />}
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div role="group" aria-label="Filter metrics by family" className="flex flex-wrap items-center gap-1.5">
                  {(['all', 'financials', 'value_funding', 'reach_scale'] as const).map((f) => {
                    const count = f === 'all' ? rows.length : familyCounts(f);
                    if (f !== 'all' && count === 0) return null;
                    return (
                      <button
                        key={f}
                        type="button"
                        aria-pressed={family === f}
                        onClick={() => setFamily(f)}
                        className={cn(
                          'inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-[12px] font-medium transition-colors',
                          family === f ? 'border-ink bg-ink text-ink-fg' : 'border-border bg-surface text-muted hover:text-content',
                        )}
                      >
                        {f === 'all' ? 'All' : FAMILY_LABELS[f]}
                        <span className={cn('tabular-nums', family === f ? 'opacity-70' : 'text-faint')}>{count}</span>
                      </button>
                    );
                  })}
                  <span className="ml-1 text-[12px] text-faint">{knownCount} of {rows.length} figures known</span>
                </div>
                <span className="flex flex-wrap items-center justify-end gap-1.5">
                  <HuntMetricsButton
                    companyId={companyId}
                    metrics={metrics}
                    onFilled={(types) => {
                      setJustFilled(new Set(types));
                      setFamily('all');
                    }}
                  />
                  <DigDeeperMenu
                    topics={real.map((m) => m.passageSupport?.definition === 'annual_revenue' ? 'Annual revenue & growth' : DEEP_TOPIC[m.metricType])}
                    companyId={companyId}
                    companyName={companyName}
                  />
                </span>
              </div>
            </div>

            <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)]">
              <MetricTable
                rows={sorted}
                selected={selectedRow?.metric.metricType ?? null}
                onSelect={setPicked}
                sort={sort}
                onSort={onSort}
                peersReady={peerState.status === 'ready'}
              />
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
                />
              )}
            </div>

            {knownCount === 0 && (
              <p className="rounded-xl border border-dashed border-border bg-surface-2/40 px-4 py-3 text-[12.5px] leading-snug text-muted">
                No sourced figures have been found for {companyName} yet. Each row above says what kind of source would fill it;
                use Find more metrics or correct a figure yourself. Nothing here is estimated to fill a gap.
              </p>
            )}

            {hasSeries && series && (
              <Section title="Reported history" hint="Series the research found for this company. Charts only appear where real data points exist.">
              <div className="grid gap-4 lg:grid-cols-2">
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
