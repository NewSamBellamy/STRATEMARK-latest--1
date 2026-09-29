/**
 * Confidence-aware metric visualizations (design system §4–§5).
 *
 * Charts: bar charts for trends (modern, data-dense), donut for composition,
 * radial for share-of-market, segmented gauge for signal bands.
 *
 * Every form obeys the product's core promise: verified reads solid,
 * estimated reads softer (hatched/dashed), unknown is an honest gap.
 */
import { useId, useLayoutEffect, useRef, useState, type ReactElement } from 'react';
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Pie,
  PieChart,
  Tooltip as ReTooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { ArrowDownRight, ArrowUpRight } from 'lucide-react';
import {
  SIGNAL_BANDS,
  mapValueToTier,
  type CapTableSlice,
  type Confidence,
  type TimePoint,
} from '@mi/contracts';
import { cn } from '@/lib/cn';
import { chartTheme, tint, type ChartTheme } from '@/lib/theme';
import { useTheme } from '@/lib/settings/theme';

function useChartTheme(): ChartTheme {
  return chartTheme(useTheme((s) => s.resolved) === 'dark');
}

function tooltipStyle(c: ChartTheme) {
  return {
    background: c.tooltipBg,
    border: `1px solid ${c.tooltipBorder}`,
    borderRadius: 10,
    color: c.tooltipText,
    fontSize: 12,
    padding: '8px 12px',
    boxShadow: '0 4px 12px rgba(0,0,0,0.08)',
  } as const;
}

/** Measure-once container so recharts gets a real pixel width. */
export function useWidth(): readonly [React.RefObject<HTMLDivElement>, number] {
  const ref = useRef<HTMLDivElement>(null);
  const [w, setW] = useState(0);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const update = () => setW(el.clientWidth);
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, w] as const;
}

// ---- Share of market: radial donut ----------------------------------------

export function ShareDonut({
  value,
  confidence,
  color,
  size = 132,
}: {
  value: number | null;
  confidence: Confidence | undefined;
  color: string;
  size?: number;
}) {
  const id = useId().replace(/[:]/g, '');
  const c = useChartTheme();
  const known = value != null && confidence !== 'unknown';
  const estimated = confidence === 'estimated';
  const share = known ? Math.max(0, Math.min(100, value)) : 0;
  const data = [
    { name: 'share', v: share },
    { name: 'rest', v: Math.max(0.0001, 100 - share) },
  ];
  return (
    <div className="relative shrink-0" style={{ width: size, height: size }}>
      <PieChart width={size} height={size}>
        <defs>
          <pattern id={`hatch-${id}`} patternUnits="userSpaceOnUse" width="6" height="6" patternTransform="rotate(45)">
            <rect width="6" height="6" fill={tint(color, 0.28)} />
            <line x1="0" y1="0" x2="0" y2="6" stroke={color} strokeWidth="2.5" />
          </pattern>
        </defs>
        <Pie
          data={data} dataKey="v" cx="50%" cy="50%"
          innerRadius={size / 2 - 18} outerRadius={size / 2 - 4}
          startAngle={90} endAngle={-270} strokeWidth={0}
          isAnimationActive={false}
        >
          <Cell fill={known ? (estimated ? `url(#hatch-${id})` : color) : c.grid} />
          <Cell fill={c.grid} />
        </Pie>
      </PieChart>
      <div className="pointer-events-none absolute inset-0 grid place-items-center">
        <div className="text-center">
          <div className="font-display text-[22px] font-bold leading-none tabular-nums text-content">
            {known ? `${share}%` : '—'}
          </div>
          <div className="mt-1 text-[9px] uppercase tracking-widest text-muted">
            {known ? 'of market' : 'unknown'}
          </div>
        </div>
      </div>
    </div>
  );
}

// ---- Signal band gauge (T1–T8) --------------------------------------------

export function BandGauge({
  bandKey, value, confidence, color,
}: {
  bandKey: keyof typeof SIGNAL_BANDS;
  value: number | null;
  confidence: Confidence | undefined;
  color: string;
}) {
  const known = value != null && confidence !== 'unknown';
  const tier = known ? mapValueToTier(SIGNAL_BANDS[bandKey], value) : null;
  const estimated = confidence === 'estimated';
  return (
    <div title="Where this value sits on the T1–T8 company-stage signal band">
      <div className="flex items-center gap-1">
        {Array.from({ length: 8 }, (_, i) => {
          const on = tier != null && i < tier;
          return (
            <span
              key={i}
              className={cn(
                'h-2 flex-1 rounded-full transition-all',
                on && estimated && 'mi-est-stripes',
              )}
              style={{
                color,
                backgroundColor: on
                  ? estimated ? tint(color, 0.35) : color
                  : 'rgb(var(--c-border))',
              }}
            />
          );
        })}
      </div>
      <div className="mt-1.5 flex justify-between text-[9px] leading-none text-faint">
        <span>T1</span>
        <span className="font-semibold text-muted">
          {tier != null ? `T${tier} stage signal` : 'unknown'}
        </span>
        <span>T8</span>
      </div>
    </div>
  );
}

// ---- Delta badge ----------------------------------------------------------

export function Delta({ data, fmt }: { data: TimePoint[]; fmt?: (v: number) => string }) {
  if (data.length < 2) return null;
  const first = data[0]!.value;
  const last = data[data.length - 1]!.value;
  if (!Number.isFinite(first) || first === 0) return null;
  const pct = ((last - first) / Math.abs(first)) * 100;
  const up = pct >= 0;
  return (
    <span
      className={cn(
        'inline-flex items-center gap-0.5 rounded-full px-2 py-0.5 text-[10px] font-semibold tabular-nums',
        up ? 'bg-positive/10 text-positive' : 'bg-negative/10 text-negative',
      )}
      title={`${fmt ? fmt(first) : first} → ${fmt ? fmt(last) : last}`}
    >
      {up ? <ArrowUpRight className="h-3 w-3" /> : <ArrowDownRight className="h-3 w-3" />}
      {up ? '+' : ''}{pct.toFixed(0)}%
    </span>
  );
}

// ---- Bar chart for trends (modern alternative to area) --------------------

export function TrendBar({
  data, color, width, height = 180, fmt, estimated = true,
}: {
  data: TimePoint[];
  color: string;
  width: number;
  height?: number;
  fmt?: (v: number) => string;
  estimated?: boolean;
}) {
  const c = useChartTheme();
  return (
    <BarChart width={width} height={height} data={data} margin={{ top: 8, right: 8, bottom: 0, left: 4 }}>
      <CartesianGrid stroke={c.grid} strokeDasharray="3 3" vertical={false} />
      <XAxis dataKey="period" stroke={c.axis} fontSize={10} tickLine={false} axisLine={false} />
      <YAxis stroke={c.axis} fontSize={10} tickLine={false} axisLine={false} width={52} tickFormatter={fmt} />
      <ReTooltip contentStyle={tooltipStyle(c)} formatter={(v: number) => (fmt ? fmt(v) : v)} cursor={{ fill: tint(color, 0.06) }} />
      <Bar
        dataKey="value"
        fill={estimated ? tint(color, 0.6) : color}
        radius={[4, 4, 0, 0]}
        isAnimationActive={false}
        maxBarSize={32}
      />
    </BarChart>
  );
}

// ---- Area chart (kept for churn / smooth trends) --------------------------

export function TrendArea({
  data, color, width, height = 180, fmt, estimated = true,
}: {
  data: TimePoint[];
  color: string;
  width: number;
  height?: number;
  fmt?: (v: number) => string;
  estimated?: boolean;
}) {
  const id = useId().replace(/[:]/g, '');
  const c = useChartTheme();
  return (
    <AreaChart width={width} height={height} data={data} margin={{ top: 8, right: 12, bottom: 0, left: 4 }}>
      <defs>
        <linearGradient id={`fill-${id}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity={estimated ? 0.2 : 0.35} />
          <stop offset="100%" stopColor={color} stopOpacity={0.02} />
        </linearGradient>
      </defs>
      <CartesianGrid stroke={c.grid} strokeDasharray="3 3" vertical={false} />
      <XAxis dataKey="period" stroke={c.axis} fontSize={10} tickLine={false} axisLine={false} />
      <YAxis stroke={c.axis} fontSize={10} tickLine={false} axisLine={false} width={52} tickFormatter={fmt} domain={['auto', 'auto']} />
      <ReTooltip contentStyle={tooltipStyle(c)} formatter={(v: number) => (fmt ? fmt(v) : v)} />
      <Area
        type="monotone" dataKey="value" stroke={color} strokeWidth={2}
        strokeDasharray={estimated ? '6 4' : undefined}
        fill={`url(#fill-${id})`}
        dot={{ r: 2.5, fill: color, strokeWidth: 0 }}
        activeDot={{ r: 4 }}
        isAnimationActive={false}
      />
    </AreaChart>
  );
}

// ---- Composition donut (cap table) ----------------------------------------

export function CompositionDonut({
  slices, palette, width, height = 180,
}: {
  slices: CapTableSlice[];
  palette: string[];
  width: number;
  height?: number;
}) {
  const sorted = [...slices].sort((a, b) => b.pct - a.pct);
  const donut = Math.min(height, Math.max(120, width * 0.4));
  const c = useChartTheme();
  return (
    <div className="flex items-center gap-4">
      <PieChart width={donut} height={height}>
        <Pie
          data={sorted} dataKey="pct" nameKey="holder" cx="50%" cy="50%"
          innerRadius={donut / 2 - 26} outerRadius={donut / 2 - 8}
          strokeWidth={2} stroke={c.sliceStroke} isAnimationActive={false}
        >
          {sorted.map((_, i) => (
            <Cell key={i} fill={palette[i % palette.length]!} />
          ))}
        </Pie>
        <ReTooltip contentStyle={tooltipStyle(c)} formatter={(v: number) => `${v}%`} />
      </PieChart>
      <ul className="min-w-0 flex-1 space-y-1.5">
        {sorted.map((s, i) => (
          <li key={s.holder} className="flex items-center justify-between gap-2 text-xs">
            <span className="flex min-w-0 items-center gap-1.5 text-muted">
              <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: palette[i % palette.length] }} />
              <span className="truncate">{s.holder}</span>
            </span>
            <span className="font-semibold tabular-nums text-content">{s.pct}%</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Shared chart panel with a measured width. */
export function ChartPanel({
  title, sub, right, height = 180, render,
}: {
  title: string;
  sub?: string;
  right?: ReactElement | null;
  height?: number;
  render: (w: number) => ReactElement;
}) {
  const [ref, w] = useWidth();
  return (
    <div className="panel p-5">
      <div className="mb-3 flex items-center justify-between gap-2">
        <div>
          <h3 className="font-display text-sm font-semibold text-content">{title}</h3>
          {sub && <p className="mt-0.5 text-[10.5px] text-faint">{sub}</p>}
        </div>
        {right}
      </div>
      <div ref={ref} className="w-full" style={{ height }}>
        {w > 0 && render(w)}
      </div>
    </div>
  );
}
