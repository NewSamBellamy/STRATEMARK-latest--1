/**
 * The Metrics tab's lead: the company's major figures as tiles, and one hero
 * panel that changes with the one you pick. What the hero draws depends on
 * what is honestly known:
 *
 *  - a reported history (the series research found, such as filed revenue):
 *    an interactive chart you can switch between area, line and bars, with
 *    values on hover; points are only joined where real points exist;
 *  - otherwise, where the company stands among the deck's companies for that
 *    figure (bars you can hover, this company highlighted), because that is
 *    real, comparable data;
 *  - otherwise, the single sourced figure on its own, saying so.
 *
 * Nothing is imputed, interpolated or filled with zeros. A figure that is not
 * found stays a labelled gap.
 */
import { useEffect, useRef, useState } from 'react';
import { Bar, BarChart, Cell, CartesianGrid, Tooltip as ReTooltip, XAxis, YAxis } from 'recharts';
import type { CompanyMetric, MetricType, TimePoint } from '@mi/contracts';
import { ConfidenceBadge } from '@/features/card/ConfidenceBadge';
import { cn } from '@/lib/cn';
import { formatMetricValue } from '@/lib/format';
import { METRIC_COLORS } from '@/lib/theme';
import { FILL_HINT, formatAsOf, isKnown, type PeerRanking } from '../dashboardModel';
import { metricLabel } from '../dashboardKit';
import { ChartPanel, Delta, TrendArea, TrendBar, TrendLine, tooltipStyle, useChartTheme, useWidth } from './metricViz';

export interface ExplorerRow {
  metric: CompanyMetric;
  ranking: PeerRanking;
}

export interface ExplorerSeries {
  revenue: TimePoint[];
  revenueQuarterly: TimePoint[];
  users: TimePoint[];
}

/** The reported history that belongs to a figure, with the honest name of what it is. Never more than was found. */
export function historyFor(type: MetricType, series: ExplorerSeries | null | undefined): Array<{ key: string; title: string; sub: string; data: TimePoint[] }> {
  if (!series) return [];
  const out: Array<{ key: string; title: string; sub: string; data: TimePoint[] }> = [];
  const span = (d: TimePoint[]) => `${d[0]!.period} to ${d[d.length - 1]!.period}`;
  if (type === 'arr' || type === 'revenue') {
    if (series.revenue.length > 1) out.push({ key: 'annual', title: 'Annual revenue', sub: `${span(series.revenue)} · as reported`, data: series.revenue });
    if (series.revenueQuarterly.length > 1) out.push({ key: 'quarterly', title: 'Quarterly revenue', sub: `${span(series.revenueQuarterly)} · three-month periods as filed`, data: series.revenueQuarterly });
  }
  if (type === 'users' && series.users.length > 1) out.push({ key: 'users', title: 'Users', sub: `${span(series.users)} · estimated series`, data: series.users });
  return out;
}

/** Counts up to a value over a short moment; shows the value at once under reduced motion. */
function useCountUp(target: number | null): number | null {
  const [shown, setShown] = useState<number | null>(target);
  const from = useRef<number | null>(target);
  useEffect(() => {
    if (target == null || from.current == null || typeof window === 'undefined' || window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) {
      from.current = target;
      setShown(target);
      return;
    }
    const start = from.current;
    const began = performance.now();
    let frame = 0;
    const tick = (now: number) => {
      const t = Math.min(1, (now - began) / 450);
      const eased = 1 - Math.pow(1 - t, 3);
      setShown(start + (target - start) * eased);
      if (t < 1) frame = requestAnimationFrame(tick);
      else from.current = target;
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [target]);
  return shown;
}

/** The big figure. A new value for the same metric (a hunt just found it) counts up; picking another metric shows it at once. */
function ExplorerValue({ type, value }: { type: MetricType; value: number | null }) {
  const shown = useCountUp(value);
  return (
    <p className="mt-1 font-display text-4xl font-semibold tabular-nums tracking-tight text-content" data-testid="explorer-value">
      {formatMetricValue(type, shown ?? value)}
    </p>
  );
}

function PeerBars({ ranking, type }: { ranking: PeerRanking; type: MetricType }) {
  const c = useChartTheme();
  const [ref, width] = useWidth();
  const points = ranking.points.slice(0, 12);
  const color = METRIC_COLORS[type];
  return (
    <div>
      <div className="mb-2 flex items-baseline justify-between gap-2">
        <h3 className="font-display text-sm font-semibold text-content">In this deck</h3>
        <p className="text-[11px] text-faint">
          {ranking.rank != null ? `#${ranking.rank} of ${ranking.of} with a figure` : `${ranking.of} with a figure`}
          {ranking.includesEstimates ? ' · includes estimates' : ''}
        </p>
      </div>
      <div ref={ref} className="w-full" style={{ height: Math.max(150, points.length * 26 + 24) }}>
        {width > 0 && (
          <BarChart width={width} height={Math.max(150, points.length * 26 + 24)} data={points} layout="vertical" margin={{ top: 0, right: 12, bottom: 0, left: 0 }}>
            <CartesianGrid stroke={c.grid} strokeDasharray="3 3" horizontal={false} />
            <XAxis type="number" stroke={c.axis} fontSize={10} tickLine={false} axisLine={false} tickFormatter={(v: number) => formatMetricValue(type, v)} />
            <YAxis type="category" dataKey="name" stroke={c.axis} fontSize={11} tickLine={false} axisLine={false} width={104}
              tickFormatter={(name: string) => (name.length > 16 ? `${name.slice(0, 15)}…` : name)} />
            <ReTooltip cursor={{ fill: 'rgba(120,130,125,0.08)' }} contentStyle={tooltipStyle(c)} formatter={(v: number) => formatMetricValue(type, v)} />
            <Bar dataKey="value" radius={[0, 4, 4, 0]} isAnimationActive>
              {points.map((p) => (
                <Cell key={p.companyId} fill={color} fillOpacity={p.isSelf ? 1 : 0.35} stroke={p.isSelf ? color : 'none'} strokeDasharray={p.confidence === 'estimated' ? '4 3' : undefined} />
              ))}
            </Bar>
          </BarChart>
        )}
      </div>
    </div>
  );
}

function History({ type, history }: { type: MetricType; history: ReturnType<typeof historyFor> }) {
  const [which, setWhich] = useState(history[0]?.key ?? '');
  const active = history.find((h) => h.key === which) ?? history[0]!;
  const color = METRIC_COLORS[type];
  const fmt = (v: number) => formatMetricValue(type, v);
  return (
    <div>
      {history.length > 1 && (
        <div role="tablist" aria-label="Which history" className="mb-2 flex gap-1.5">
          {history.map((h) => (
            <button key={h.key} type="button" role="tab" aria-selected={active.key === h.key}
              className={cn('rounded-full border px-3 py-1 text-[11.5px] font-medium', active.key === h.key ? 'border-primary bg-primary/8 text-primary' : 'border-border text-muted hover:text-content')}
              onClick={() => setWhich(h.key)}>
              {h.title}
            </button>
          ))}
        </div>
      )}
      <ChartPanel
        key={active.key}
        title={active.title}
        sub={active.sub}
        right={<Delta data={active.data} fmt={fmt} />}
        height={200}
        views={{ options: [{ key: 'area', label: 'Area' }, { key: 'line', label: 'Line' }, { key: 'bar', label: 'Bars' }], default: 'area' }}
        render={(w, view) => view === 'line'
          ? <TrendLine data={active.data} color={color} width={w} height={200} fmt={fmt} />
          : view === 'bar'
            ? <TrendBar data={active.data} color={color} width={w} height={200} fmt={fmt} />
            : <TrendArea data={active.data} color={color} width={w} height={200} fmt={fmt} />}
      />
    </div>
  );
}

export function MetricExplorer({
  rows, missing, selected, onSelect, series,
}: {
  rows: readonly ExplorerRow[];
  missing: readonly CompanyMetric[];
  selected: MetricType | null;
  onSelect: (type: MetricType) => void;
  series: ExplorerSeries | null | undefined;
}) {
  // A figure that was not found can be selected too: it shows what would fill it. It has no ranking.
  const found = rows.find((r) => r.metric.metricType === selected);
  const gap = found ? undefined : missing.find((m) => m.metricType === selected);
  const first = rows[0] ?? (missing[0] ? { metric: missing[0], ranking: null } : null);
  const current: { metric: CompanyMetric; ranking: PeerRanking | null } | null = found ?? (gap ? { metric: gap, ranking: null } : first);
  if (!current) return null;
  const known = isKnown(current.metric) ? current.metric : null;
  const history = historyFor(current.metric.metricType, series);
  const comparable = (current.ranking?.points.length ?? 0) >= 2;
  const type = current.metric.metricType;
  return (
    <section aria-label="Major metrics" className="panel overflow-hidden">
      <div role="tablist" aria-label="Pick a metric" className="flex gap-px overflow-x-auto border-b border-border bg-border">
        {rows.map(({ metric }) => {
          const on = metric.metricType === type;
          return (
            <button key={metric.metricType} type="button" role="tab" aria-selected={on}
              onClick={() => onSelect(metric.metricType)}
              className={cn('min-w-[132px] flex-1 bg-surface px-4 py-3 text-left transition-colors', on ? 'bg-surface' : 'bg-surface-2/50 hover:bg-surface')}
              style={on ? { boxShadow: `inset 0 -2px 0 ${METRIC_COLORS[metric.metricType]}` } : undefined}>
              <span className="block text-[10.5px] font-semibold uppercase tracking-wider text-faint">{metricLabel(metric)}</span>
              <span className={cn('mt-0.5 block font-display text-lg font-semibold tabular-nums', on ? 'text-content' : 'text-muted')}>
                {formatMetricValue(metric.metricType, metric.value)}
              </span>
            </button>
          );
        })}
        {missing.map((metric) => (
          <button key={metric.metricType} type="button" role="tab" aria-selected={metric.metricType === type}
            onClick={() => onSelect(metric.metricType)}
            className="min-w-[110px] flex-none border-l border-dashed border-border bg-surface-2/30 px-4 py-3 text-left text-muted hover:bg-surface">
            <span className="block text-[10.5px] font-semibold uppercase tracking-wider text-faint">{metricLabel(metric)}</span>
            <span className="mt-0.5 block text-[13px]">Not found yet</span>
          </button>
        ))}
      </div>

      {current && (
        <div key={current.metric.metricType} className="grid gap-6 p-5 lg:grid-cols-[minmax(0,260px)_minmax(0,1fr)]" role="tabpanel" aria-label={`${metricLabel(current.metric)} chart`}>
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-widest text-faint">{metricLabel(current.metric)}</p>
            {known ? (
              <>
                <ExplorerValue key={known.metricType} type={known.metricType} value={known.value} />
                <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1.5">
                  <ConfidenceBadge reported={known.reportedSupport != null || known.reportedBand != null} confidence={known.confidence} note={known.methodNote}
                    source={known.source} citations={known.citations} metricLabel={metricLabel(known)} />
                  {formatAsOf(known) && <span className="text-[12px] text-muted">{formatAsOf(known)}</span>}
                </div>
              </>
            ) : (
              <>
                <p className="mt-1 font-display text-2xl font-semibold text-muted">Not found yet</p>
                <p className="mt-2 rounded-lg border border-dashed border-border bg-surface-2/40 px-3 py-2.5 text-[12.5px] leading-snug text-muted">
                  <span className="font-medium text-content">What would fill this: </span>{FILL_HINT[current.metric.metricType]}
                </p>
              </>
            )}
          </div>
          <div className="min-w-0">
            {known && history.length > 0 ? (
              <History type={known.metricType} history={history} />
            ) : known && comparable && current.ranking ? (
              <PeerBars ranking={current.ranking} type={known.metricType} />
            ) : known ? (
              <p className="rounded-lg border border-dashed border-border bg-surface-2/40 px-4 py-6 text-[13px] leading-snug text-muted">
                One sourced figure so far. A chart appears when research finds a history for it, or when this company is opened from a deck with others to compare against. Nothing is drawn to fill the space.
              </p>
            ) : null}
          </div>
        </div>
      )}
    </section>
  );
}
