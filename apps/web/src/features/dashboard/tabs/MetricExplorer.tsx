/**
 * The Metrics tab's lead: the company's major figures as a strip that selects
 * one, and ONE detail panel for the figure picked (the caller passes it as
 * children, so the figure, its sources and the deck ranking are drawn once).
 * The table below selects into the same panel.
 *
 * Also here: the reported history for a figure (the series research found,
 * such as filed revenue), an interactive chart you can switch between area,
 * line and bars. Nothing is imputed, interpolated or filled with zeros;
 * points are only joined where real points exist. A figure that is not found
 * stays a labelled gap.
 */
import { useEffect, useRef, useState, type ReactNode } from 'react';
import type { CompanyMetric, MetricType, TimePoint } from '@mi/contracts';
import { cn } from '@/lib/cn';
import { formatMetricValue } from '@/lib/format';
import type { PeerRanking } from '../dashboardModel';
import { figureDisplay } from '../figureSet';
import { figureCurrency, withReportedCurrency } from '../figureCurrency';
import { metricLabel } from '../dashboardKit';
import { ChartPanel, Delta, TrendArea, TrendBar, TrendLine, useChartAccent } from './metricViz';

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
export function ExplorerValue({ type, value, metric }: { type: MetricType; value: number | null; metric: CompanyMetric }) {
  const shown = useCountUp(value);
  return (
    <p className="mt-1 font-display text-4xl font-semibold tabular-nums tracking-tight text-content" data-testid="explorer-value">
      {withReportedCurrency(formatMetricValue(type, shown ?? value), figureCurrency(metric))}
    </p>
  );
}

export function History({ type, history }: { type: MetricType; history: ReturnType<typeof historyFor> }) {
  const [which, setWhich] = useState(history[0]?.key ?? '');
  const active = history.find((h) => h.key === which) ?? history[0]!;
  const color = useChartAccent();
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
  rows, missing, selected, onSelect, highlight = false, children,
}: {
  rows: readonly ExplorerRow[];
  missing: readonly CompanyMetric[];
  selected: MetricType | null;
  onSelect: (type: MetricType) => void;
  /** Ring the panel when the selected figure was just filled from live sources. */
  highlight?: boolean;
  /** The one detail panel for the selected figure. */
  children?: ReactNode;
}) {
  // A figure that was not found can be selected too: the panel then shows what would fill it.
  const current: CompanyMetric | null = rows.find((r) => r.metric.metricType === selected)?.metric
    ?? missing.find((m) => m.metricType === selected) ?? rows[0]?.metric ?? missing[0] ?? null;
  if (!current) return null;
  const type = current.metricType;
  return (
    <section aria-label="Major metrics" className={cn('panel overflow-hidden', highlight && 'ring-2 ring-emerald-400/70')}>
      {/* The figure switcher: picking one re-sorts the deck chart below and swaps the detail. */}
      <div role="tablist" aria-label="Pick a metric" className="flex gap-2 overflow-x-auto border-b border-border bg-surface-2/40 p-2">
        {rows.map(({ metric, ranking }) => {
          const on = metric.metricType === type;
          const ranked = ranking.rank != null && ranking.of > 1;
          return (
            <button key={metric.metricType} type="button" role="tab" aria-selected={on}
              onClick={() => onSelect(metric.metricType)}
              className={cn(
                'relative min-w-[128px] flex-1 rounded-lg border px-3.5 py-2.5 text-left transition-[background-color,border-color,box-shadow] duration-200 motion-reduce:transition-none',
                on ? 'border-primary/50 bg-surface shadow-card' : 'border-transparent hover:border-border hover:bg-surface',
              )}>
              <span className={cn('block text-[10.5px] font-semibold uppercase tracking-wider', on ? 'text-primary-ink' : 'text-faint')}>{metricLabel(metric)}</span>
              <span className={cn('mt-0.5 block whitespace-nowrap font-display text-lg font-semibold tabular-nums', on ? 'text-content' : 'text-muted')}>
                {figureDisplay(metric)}
                {metric.confidence === 'estimated' && <>{' '}<abbr title="Estimated" className="text-[10px] font-normal text-faint no-underline">est.</abbr></>}
              </span>
              <span className="mt-0.5 block text-[11px] tabular-nums text-faint">{ranked ? `#${ranking.rank} of ${ranking.of} in deck` : ' '}</span>
            </button>
          );
        })}
        {missing.map((metric) => {
          const on = metric.metricType === type;
          return (
            <button key={metric.metricType} type="button" role="tab" aria-selected={on}
              onClick={() => onSelect(metric.metricType)}
              className={cn('min-w-[104px] flex-none rounded-lg border border-dashed px-3 py-2.5 text-left transition-colors',
                on ? 'border-primary/50 bg-surface text-content' : 'border-border/80 text-muted hover:bg-surface')}>
              <span className="block text-[10.5px] font-semibold uppercase tracking-wider text-faint">{metricLabel(metric)}</span>
              <span className="mt-0.5 block text-[12.5px]">Not found yet</span>
            </button>
          );
        })}
      </div>

      {/* The one detail panel. Not keyed by figure: the deck chart inside stays mounted, so switching figures animates it. */}
      <div role="tabpanel" aria-label={`${metricLabel(current)} detail`} className="p-5 sm:p-6">
        {children}
      </div>
    </section>
  );
}
