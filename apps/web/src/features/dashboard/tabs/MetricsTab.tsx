import { useState } from 'react';
import { Loader2, Pencil, Radar, SearchX } from 'lucide-react';
import {
  inferUserFootprintBasis,
  isScoreableUserFootprintBasis,
  metricDisplayLabel,
  userFootprintBasisFor,
  type SIGNAL_BANDS,
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
import { EmptyState } from '@/components/states/EmptyState';
import { Modal } from '@/components/ui/Modal';
import { formatMetricValue } from '@/lib/format';
import { METRIC_COLORS } from '@/lib/theme';
import { ConfidenceBadge } from '@/features/card/ConfidenceBadge';
import { DigDeeperMenu } from '@/features/deepdive/DeepDive';
import { FactCheck } from '@/features/factcheck/FactCheck';
import {
  BandGauge,
  ChartPanel,
  CompositionDonut,
  Delta,
  ShareDonut,
  TrendArea,
  TrendBar,
} from './metricViz';

/** Readable deep-dive topics per metric. */
const DEEP_TOPIC: Record<MetricType, string> = {
  market_share: 'Market share & competitive position',
  valuation: 'Valuation & funding history',
  market_cap: 'Market capitalization & stock performance',
  arr: 'Annual recurring revenue & growth',
  users: 'User / customer base & adoption',
  employees: 'Team size, hiring & key people',
};

const BAND_KEY: Partial<Record<MetricType, keyof typeof SIGNAL_BANDS>> = {
  market_share: 'marketShare',
  valuation: 'value',
  market_cap: 'value',
  arr: 'arr',
  employees: 'employees',
};

/** The display order; valuation/market_cap collapse to whichever is present. */
const ORDER: MetricType[] = [
  'market_share',
  'valuation',
  'market_cap',
  'arr',
  'users',
  'employees',
];

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
      : metric.metricType === 'users' || metric.metricType === 'employees'
        ? 'count'
        : 'USD';
  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      title={`Correct ${metricDisplayLabel(metric)}`}
      description={`${companyName} — your value becomes ground truth (User confirmed) and the scale band recomputes instantly.`}
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
              const correctedNote = note.trim() || null;
              const existingBasis = metric.userBasis ?? inferUserFootprintBasis(metric.methodNote);
              override.mutate(
                {
                  companyId: metric.companyId,
                  metricType: metric.metricType,
                  metricId: metric.id,
                  value: parsed,
                  note: correctedNote,
                  ...(metric.metricType === 'users' ? { userBasis: existingBasis } : {}),
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

/** Tile chrome shared by every metric: header, affordances, provenance. */
function MetricTile({
  metric,
  companyId,
  companyName,
  highlight = false,
  children,
}: {
  metric: CompanyMetric;
  companyId: string;
  companyName: string;
  /** Just filled from live sources — make the update VISIBLE. */
  highlight?: boolean;
  children: React.ReactNode;
}) {
  const [editing, setEditing] = useState(false);
  return (
    <div
      className={
        highlight
          ? 'panel flex flex-col p-5 ring-2 ring-emerald-400/70 transition-shadow'
          : 'panel flex flex-col p-5'
      }
    >
      <div className="flex items-center justify-between gap-2">
        <span className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-widest text-muted">
          {metricDisplayLabel(metric)}
          {highlight && (
            <span className="rounded-full border border-emerald-300 bg-emerald-50 px-1.5 py-px text-[9px] font-semibold normal-case tracking-normal text-emerald-700 dark:border-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300">
              Updated from live sources
            </span>
          )}
        </span>
        <span className="flex items-center gap-1.5">
          <ConfidenceBadge
            confidence={metric.confidence}
            note={metric.methodNote}
            source={metric.source}
            citations={metric.citations}
            metricLabel={metricDisplayLabel(metric)}
          />
          <button
            type="button"
            className="rounded-md p-1 text-faint transition-colors hover:bg-surface-2 hover:text-content"
            title="Correct this figure (you know better)"
            aria-label={`Correct ${metricDisplayLabel(metric)}`}
            onClick={() => setEditing(true)}
          >
            <Pencil className="h-3.5 w-3.5" />
          </button>
        </span>
      </div>
      {editing && (
        <OverrideModal
          metric={metric}
          companyName={companyName}
          open={editing}
          onOpenChange={setEditing}
        />
      )}

      <div className="mt-2 flex-1">{children}</div>

      {metric.confidence === 'estimated' && metric.methodNote && (
        <p className="mt-2 text-[11px] italic text-muted">How we got this: {metric.methodNote}</p>
      )}
      <div className="mt-2 flex items-center justify-between gap-2">
        {metric.source ? (
          <a
            href={metric.source}
            target="_blank"
            rel="noopener noreferrer"
            className="text-[11px] text-primary-ink hover:underline"
          >
            Source ↗
          </a>
        ) : (
          <span />
        )}
        <div className="flex items-center gap-1.5">
          {metric.value != null && metric.confidence !== 'unknown' && (
            <FactCheck
              claim={`${companyName}'s ${metricDisplayLabel(metric)} is ${formatMetricValue(metric.metricType, metric.value)}`}
              companyName={companyName}
              companyId={companyId}
              metricType={metric.metricType}
              metricId={metric.id}
              userBasis={metric.metricType === 'users' ? userFootprintBasisFor(metric) : undefined}
              storedValue={metric.value}
            />
          )}
        </div>
      </div>
    </div>
  );
}
/** Honest gap: unknown is a finding, not a blank (design system §4). */
function UnknownSlot() {
  return (
    <div className="flex h-full min-h-[72px] flex-col items-start justify-center gap-1 rounded-lg border border-dashed border-border bg-surface-2/50 px-3 py-2.5">
      <span className="flex items-center gap-1.5 font-display text-lg font-semibold text-muted">
        <SearchX className="h-4 w-4" />
        Unknown
      </span>
      <span className="text-[11px] leading-snug text-faint">
        No credible public figure found — we don’t invent data. Dig deeper or correct it if you know
        it.
      </span>
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
    <div className="panel grid grid-cols-2 divide-border sm:grid-cols-3 sm:divide-x lg:grid-cols-5">
      {tiles.map((m) => (
        <div key={m.id} className="px-4 py-3.5">
          <div className="flex items-center gap-1.5">
            <span className="text-[10px] font-semibold uppercase tracking-widest text-muted">
              {metricDisplayLabel(m)}
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
          >
            {m.value != null && m.confidence !== 'unknown'
              ? formatMetricValue(m.metricType, m.value)
              : '—'}
          </div>
        </div>
      ))}
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

  const bandKey = BAND_KEY[metric.metricType];
  return (
    <div>
      <div className="font-display text-3xl font-semibold tabular-nums leading-none text-content">
        {formatMetricValue(metric.metricType, metric.value)}
      </div>
      {bandKey && (
        <div className="mt-3">
          <BandGauge
            bandKey={bandKey}
            value={metric.value}
            confidence={metric.confidence}
            color={color}
          />
        </div>
      )}
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
  onFilled?: (metricIds: string[]) => void;
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
    <span className="flex items-center gap-2">
      {outcome && <span className="text-[11px] font-medium text-positive">{outcome}</span>}
      {softCount > 0 && (
        <button
          type="button"
          className="btn-ghost shrink-0"
          disabled={hunt.isPending}
          title="One grounded research pass hunts current figures for every metric still missing, unknown, or estimated — sourced, junk-gated, and written back everywhere."
          onClick={() =>
            hunt.mutate(companyId, {
              onSuccess: (r) => {
                // Name WHAT was filled — "filled 2 figures" with no visible
                // change was the filmed confusion.
                const filledMetrics = r.filledMetricIds?.length
                  ? r.metrics.filter((metric) => r.filledMetricIds?.includes(metric.id))
                  : r.filledTypes.flatMap((type) => {
                      const metric = r.metrics.find((candidate) => candidate.metricType === type);
                      return metric ? [metric] : [];
                    });
                setOutcome(
                  filledMetrics.length > 0
                    ? `Filled ${filledMetrics
                        .map((metric) => metricDisplayLabel(metric))
                        .join(' & ')} from live sources — highlighted below.`
                    : 'No additional figures met the sourcing bar — gaps stay honest.',
                );
                if (filledMetrics.length > 0) onFilled?.(filledMetrics.map((metric) => metric.id));
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

export function MetricsTab({ companyId }: { companyId: string }) {
  const metricsQ = useCompanyMetrics(companyId);
  const seriesQ = useDashboardTab(companyId, 'metrics');
  const companyName = useCompany(companyId).data?.name ?? 'this company';
  // Figures the hunt just filled — their widgets light up so the update is
  // impossible to miss.
  const [justFilled, setJustFilled] = useState<ReadonlySet<string>>(new Set());

  return (
    <QueryBoundary
      query={metricsQ}
      isEmpty={(m) => m.length === 0}
      empty={
        <EmptyState
          title="No metrics yet"
          description="Research didn’t surface quantitative metrics for this company."
        />
      }
    >
      {(metrics) => {
        const tiles = ORDER.flatMap((type) => {
          if (type === 'users') return metrics.filter((metric) => metric.metricType === 'users');
          const metric = metrics.find((candidate) => candidate.metricType === type);
          return metric ? [metric] : [];
        });
        const footprintMetric = [...metrics]
          .filter((metric) => metric.metricType === 'users')
          .sort((a, b) => {
            const usefulness = (metric: CompanyMetric) =>
              (isScoreableUserFootprintBasis(userFootprintBasisFor(metric)) ? 10 : 0) +
              (metric.confidence === 'user_verified'
                ? 4
                : metric.confidence === 'verified'
                  ? 3
                  : metric.confidence === 'estimated'
                    ? 1
                    : 0) +
              Math.min(metric.citations.length, 2);
            return usefulness(b) - usefulness(a);
          })[0];
        const headlineTiles = ORDER.flatMap((type) => {
          if (type === 'users') return footprintMetric ? [footprintMetric] : [];
          const metric = metrics.find((candidate) => candidate.metricType === type);
          return metric ? [metric] : [];
        });
        const footprintLabel = footprintMetric
          ? metricDisplayLabel(footprintMetric)
          : 'User footprint';
        const series = seriesQ.data?.content;
        const hasSeries = !!series && (series.revenue.length > 1 || series.users.length > 1);
        return (
          <div className="space-y-5">
            <div className="flex items-center justify-between gap-3">
              <KpiBand tiles={headlineTiles} />
              <span className="flex shrink-0 items-center gap-1.5">
                <HuntMetricsButton
                  companyId={companyId}
                  metrics={metrics}
                  onFilled={(metricIds) => setJustFilled(new Set(metricIds))}
                />
                <DigDeeperMenu
                  topics={[...new Set(tiles.map((m) => DEEP_TOPIC[m.metricType]))]}
                  companyId={companyId}
                  companyName={companyName}
                />
              </span>
            </div>
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {tiles.map((m) => (
                <MetricTile
                  key={m.id}
                  metric={m}
                  companyId={companyId}
                  companyName={companyName}
                  highlight={justFilled.has(m.id)}
                >
                  <MetricBody metric={m} />
                </MetricTile>
              ))}
            </div>

            {hasSeries && series && (
              <div className="grid gap-4 lg:grid-cols-2">
                {series.revenue.length > 1 && (
                  <ChartPanel
                    title="Revenue trend"
                    sub={`${series.revenue[0]!.period} → ${series.revenue[series.revenue.length - 1]!.period} · estimated series`}
                    right={<Delta data={series.revenue} fmt={(v) => formatMetricValue('arr', v)} />}
                    render={(w) => (
                      <TrendBar
                        data={series.revenue}
                        color={METRIC_COLORS.arr}
                        width={w}
                        fmt={(v) => formatMetricValue('arr', v)}
                      />
                    )}
                  />
                )}
                {series.users.length > 1 && (
                  <ChartPanel
                    title={`${footprintLabel} trend`}
                    sub={`${series.users[0]!.period} → ${series.users[series.users.length - 1]!.period} · estimated series`}
                    right={<Delta data={series.users} fmt={(v) => formatMetricValue('users', v)} />}
                    render={(w) => (
                      <TrendBar
                        data={series.users}
                        color={METRIC_COLORS.users}
                        width={w}
                        fmt={(v) => formatMetricValue('users', v)}
                      />
                    )}
                  />
                )}
                {series.churn.length > 1 && (
                  <ChartPanel
                    title="Churn"
                    sub="lower is better · estimated series"
                    right={<Delta data={series.churn} fmt={(v) => `${v.toFixed(1)}%`} />}
                    render={(w) => (
                      <TrendArea
                        data={series.churn}
                        color="#DC2626"
                        width={w}
                        fmt={(v) => `${v.toFixed(1)}%`}
                      />
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
                        palette={[
                          METRIC_COLORS.valuation,
                          METRIC_COLORS.users,
                          METRIC_COLORS.arr,
                          METRIC_COLORS.employees,
                          METRIC_COLORS.market_share,
                          '#64748B',
                        ]}
                        width={w}
                      />
                    )}
                  />
                )}
              </div>
            )}
          </div>
        );
      }}
    </QueryBoundary>
  );
}
