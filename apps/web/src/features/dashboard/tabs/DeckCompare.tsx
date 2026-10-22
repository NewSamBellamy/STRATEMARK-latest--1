/**
 * The Metrics tab's lead chart: the picked figure across every company in the
 * deck, this company in the accent and its rank beside it. Switching figures
 * keeps each company's row and slides it to its new place, so you watch the
 * order change. Bars are linear from zero; a company with no sourced figure is
 * named under the chart as "not charted", never drawn as zero.
 *
 * A second view plots two figures against each other, only for companies that
 * have both.
 */
import { useEffect, useId, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { METRIC_TYPE_LABELS, type MetricType } from '@mi/contracts';
import { cn } from '@/lib/cn';
import { formatMetricValue } from '@/lib/format';
import { shortCompanyName } from '../companyNames';
import type { PeerEntry } from '../dashboardModel';
import {
  barShare, comparableTypes, deckComparison, niceTicks, scatterPoints, visibleBars,
  type CompareBar, type ScatterPoint,
} from './deckComparison';

const ROW = 34;
const LIMIT = 10;

/** Peer bars are neutral; this company is the one accent. Estimates are hatched. */
function barClass(b: Pick<CompareBar, 'isSelf' | 'estimate'>): string {
  if (b.isSelf) return b.estimate ? 'mi-est-stripes bg-primary/35 text-primary' : 'bg-primary';
  return b.estimate ? 'mi-est-stripes bg-content/10 text-content/30' : 'bg-content/25';
}

function Legend({ selfName }: { selfName: string }) {
  return (
    <ul className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-muted" aria-label="Chart key">
      <li className="flex items-center gap-1.5"><span className="h-2.5 w-4 rounded-sm bg-primary" aria-hidden />{selfName}</li>
      <li className="flex items-center gap-1.5"><span className="h-2.5 w-4 rounded-sm bg-content/25" aria-hidden />Other companies</li>
      <li className="flex items-center gap-1.5"><span className="mi-est-stripes h-2.5 w-4 rounded-sm bg-content/10 text-content/40" aria-hidden />Estimate</li>
    </ul>
  );
}

function BarRow({
  bar, index, max, href, active, onActive,
}: {
  bar: CompareBar;
  index: number;
  max: number;
  href: string | null;
  active: boolean;
  onActive: (id: string | null) => void;
}) {
  // A row that joins fades in at its real length: never grown from zero, which would draw a value nobody reported.
  const [shown, setShown] = useState(false);
  useEffect(() => {
    const f = requestAnimationFrame(() => setShown(true));
    return () => cancelAnimationFrame(f);
  }, []);
  const share = barShare(bar.value, max);
  const detail = [bar.estimate ? 'estimate' : bar.trust.toLowerCase(), bar.publisher ? `source ${bar.publisher}` : 'no source link recorded', bar.when].filter(Boolean).join(', ');
  return (
    <li
      data-compare-row
      onMouseEnter={() => onActive(bar.companyId)}
      onFocus={() => onActive(bar.companyId)}
      onBlur={() => onActive(null)}
      style={{ transform: `translateY(${index * ROW}px)`, height: ROW }}
      className={cn(
        'absolute inset-x-0 top-0 grid grid-cols-[18px_minmax(0,108px)_minmax(0,1fr)_auto] items-center gap-x-2.5 rounded-md px-1.5 sm:grid-cols-[18px_minmax(0,140px)_minmax(0,1fr)_auto]',
        'transition-[transform,opacity,background-color] duration-500 ease-[cubic-bezier(.2,.8,.2,1)] motion-reduce:transition-none',
        shown ? 'opacity-100' : 'opacity-0 motion-reduce:opacity-100',
        active && 'bg-surface-2',
        bar.isSelf && 'bg-primary/[0.06]',
      )}
    >
      <span className={cn('text-right text-[11px] tabular-nums', bar.isSelf ? 'font-semibold text-primary-ink' : 'text-faint')} aria-hidden>{index + 1}</span>
      {href ? (
        <Link to={href} className="truncate text-[12.5px] text-muted hover:text-primary-ink hover:underline focus-visible:text-content" title={`Open ${bar.name}'s metrics`}>
          {shortCompanyName(bar.name)}
          <span className="sr-only">: {bar.display}, {detail}</span>
        </Link>
      ) : (
        <span tabIndex={0} className="truncate rounded text-[12.5px] font-semibold text-content" title={bar.name}>
          {shortCompanyName(bar.name)}
          <span className="sr-only">(this company): {bar.display}, {detail}</span>
        </span>
      )}
      <span className="relative h-3.5 overflow-hidden rounded-[4px] bg-border/40" aria-hidden>
        <span
          className={cn('absolute inset-y-0 left-0 rounded-[4px] transition-[width] duration-500 ease-[cubic-bezier(.2,.8,.2,1)] motion-reduce:transition-none', barClass(bar))}
          style={{ width: `${Math.max(share ?? 0, 0.6)}%` }}
        />
      </span>
      <span className={cn('min-w-[64px] text-right text-[12px] tabular-nums', bar.isSelf ? 'font-semibold text-content' : 'text-muted')} aria-hidden>
        {bar.display}{bar.estimate && <span className="ml-0.5 text-[10px] text-faint"> est.</span>}
      </span>
    </li>
  );
}

function BarsView({
  bars, hrefFor, type,
}: { bars: CompareBar[]; hrefFor: (peerId: string, type: MetricType) => string; type: MetricType }) {
  const [all, setAll] = useState(false);
  const [active, setActive] = useState<string | null>(null);
  const rows = visibleBars(bars, LIMIT, all);
  const max = bars[0]?.value ?? 0;
  const hovered = rows.findIndex((b) => b.companyId === active);
  const tip = hovered >= 0 ? rows[hovered]! : null;
  return (
    <div>
      <div className="relative" style={{ height: rows.length * ROW }} onMouseLeave={() => setActive(null)}>
        <ol aria-label={`${METRIC_TYPE_LABELS[type]} by company, highest first`}>
          {rows.map((b, i) => (
            <BarRow key={b.companyId} bar={b} index={i} max={max}
              href={b.isSelf ? null : hrefFor(b.companyId, type)}
              active={active === b.companyId} onActive={setActive} />
          ))}
        </ol>
        {tip && (
          <div
            aria-hidden
            className="pointer-events-none absolute right-0 z-10 w-max max-w-[260px] rounded-lg border border-border bg-surface px-3 py-2 text-[11.5px] leading-snug shadow-card"
            style={hovered >= rows.length - 2 && hovered > 1 ? { bottom: (rows.length - hovered) * ROW + 2 } : { top: (hovered + 1) * ROW + 2 }}
          >
            <p className="font-semibold text-content">{tip.name}</p>
            <p className="tabular-nums text-content">{tip.display} <span className="text-muted">· {tip.estimate ? 'Estimate' : tip.trust}</span></p>
            <p className="text-muted">{tip.publisher ? `Source: ${tip.publisher}` : 'No source link recorded'}</p>
            {tip.when && <p className="text-faint">{tip.when}</p>}
          </div>
        )}
      </div>
      {bars.length > LIMIT && (
        <button type="button" className="mt-2 text-[12px] font-medium text-primary-ink hover:underline" onClick={() => setAll(!all)} aria-expanded={all}>
          {all ? `Show top ${LIMIT}` : `Show all ${bars.length}`}
        </button>
      )}
    </div>
  );
}

/** Beside the point, flipped away from the nearest edges so it never runs off the chart. */
function tipPlacement(fx: number, fy: number): React.CSSProperties {
  const tx = fx > 0.6 ? 'calc(-100% - 12px)' : '12px';
  const ty = fy < 0.4 ? '8px' : 'calc(-100% - 8px)';
  return { left: `${fx * 100}%`, top: `${fy * 100}%`, transform: `translate(${tx}, ${ty})` };
}

function ScatterView({
  selfId, types, peers, initialY,
}: { selfId: string; types: MetricType[]; peers: readonly PeerEntry[]; initialY: MetricType }) {
  const id = useId();
  const [yType, setY] = useState<MetricType>(types.includes(initialY) ? initialY : types[0]!);
  const [xType, setX] = useState<MetricType>(() => types.find((t) => t === 'employees' && t !== yType) ?? types.find((t) => t !== yType) ?? types[0]!);
  const [active, setActive] = useState<string | null>(null);
  const { points, left } = useMemo(() => scatterPoints(selfId, xType, yType, peers), [selfId, xType, yType, peers]);
  const W = 560, H = 300, L = 64, R = 16, T = 12, B = 34;
  const xs = niceTicks(Math.max(0, ...points.map((p) => p.x)));
  const ys = niceTicks(Math.max(0, ...points.map((p) => p.y)));
  const xMax = xs[xs.length - 1]! || 1, yMax = ys[ys.length - 1]! || 1;
  const px = (v: number) => L + (v / xMax) * (W - L - R);
  const py = (v: number) => H - B - (v / yMax) * (H - T - B);
  const tip: ScatterPoint | undefined = points.find((p) => p.companyId === active);
  const select = (label: string, value: MetricType, on: (t: MetricType) => void) => (
    <label className="flex items-center gap-1.5 text-[11.5px] text-muted">
      {label}
      <select className="rounded-md border border-border bg-surface px-2 py-1 text-[12px] text-content focus-visible:outline-primary" value={value} onChange={(e) => on(e.target.value as MetricType)}>
        {types.map((t) => <option key={t} value={t}>{METRIC_TYPE_LABELS[t]}</option>)}
      </select>
    </label>
  );
  return (
    <div>
      <div className="mb-2 flex flex-wrap items-center gap-3">
        {select('Up', yType, setY)}
        {select('Across', xType, setX)}
      </div>
      {points.length < 2 ? (
        <p className="rounded-lg border border-dashed border-border bg-surface-2/40 px-3 py-3 text-[12.5px] text-muted">
          Fewer than two companies have both of these figures sourced, so there is nothing to plot.
        </p>
      ) : (
        <div className="relative">
          <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full" role="img" aria-labelledby={`${id}-t`}>
            <title id={`${id}-t`}>{`${METRIC_TYPE_LABELS[yType]} against ${METRIC_TYPE_LABELS[xType]} for ${points.length} companies with both figures`}</title>
            {ys.map((v) => (
              <g key={`y${v}`}>
                <line x1={L} x2={W - R} y1={py(v)} y2={py(v)} className="stroke-border" strokeWidth={1} />
                <text x={L - 8} y={py(v) + 3.5} textAnchor="end" className="fill-faint text-[10px]">{formatMetricValue(yType, v)}</text>
              </g>
            ))}
            {xs.map((v) => (
              <text key={`x${v}`} x={px(v)} y={H - B + 16} textAnchor="middle" className="fill-faint text-[10px]">{formatMetricValue(xType, v)}</text>
            ))}
            <text x={W - R} y={H - 4} textAnchor="end" className="fill-muted text-[10.5px]">{METRIC_TYPE_LABELS[xType]} →</text>
            {[...points].sort((a, b) => Number(a.isSelf) - Number(b.isSelf)).map((p) => (
              <g key={p.companyId} tabIndex={0} role="img"
                aria-label={`${p.name}: ${METRIC_TYPE_LABELS[yType]} ${p.yDisplay}, ${METRIC_TYPE_LABELS[xType]} ${p.xDisplay}${p.estimate ? ', includes an estimate' : ''}`}
                onMouseEnter={() => setActive(p.companyId)} onMouseLeave={() => setActive(null)}
                onFocus={() => setActive(p.companyId)} onBlur={() => setActive(null)}
                style={{ transform: `translate(${px(p.x)}px, ${py(p.y)}px)` }}
                className="cursor-default outline-none transition-transform duration-500 ease-[cubic-bezier(.2,.8,.2,1)] motion-reduce:transition-none">
                <circle r={p.isSelf ? 7 : 5}
                  className={cn(p.isSelf ? 'stroke-primary' : 'stroke-muted', p.estimate ? (p.isSelf ? 'fill-primary/20' : 'fill-surface') : (p.isSelf ? 'fill-primary' : 'fill-muted/50'))}
                  strokeWidth={p.estimate ? 2 : 1} strokeDasharray={p.estimate ? '2.5 2' : undefined} />
                {(p.isSelf || active === p.companyId) && (
                  <text x={10} y={4} className={cn('text-[11px]', p.isSelf ? 'fill-content font-semibold' : 'fill-muted')}>{shortCompanyName(p.name)}</text>
                )}
              </g>
            ))}
          </svg>
          {tip && (
            <div aria-hidden className="pointer-events-none absolute z-10 w-max max-w-[240px] rounded-lg border border-border bg-surface px-3 py-2 text-[11.5px] leading-snug shadow-card"
              style={tipPlacement(px(tip.x) / W, py(tip.y) / H)}>
              <p className="font-semibold text-content">{tip.name}</p>
              <p className="tabular-nums text-muted">{METRIC_TYPE_LABELS[yType]}: <span className="text-content">{tip.yDisplay}</span></p>
              <p className="tabular-nums text-muted">{METRIC_TYPE_LABELS[xType]}: <span className="text-content">{tip.xDisplay}</span></p>
              {tip.estimate && <p className="text-faint">Includes an estimate (dashed ring)</p>}
            </div>
          )}
        </div>
      )}
      <p className="mt-2 text-[11.5px] leading-snug text-faint">
        Only companies with both figures sourced are plotted, on plain linear scales. Dashed rings include an estimate.
        {left.length > 0 && <> <span className="font-medium text-muted">Not plotted: </span>{left.slice(0, 8).join(', ')}{left.length > 8 ? ` and ${left.length - 8} more` : ''}.</>}
      </p>
    </div>
  );
}

export function DeckCompare({
  type, selfId, selfName, peerStatus, peers, hrefFor, figureTypes,
}: {
  type: MetricType;
  selfId: string;
  selfName: string;
  peerStatus: 'no_deck' | 'loading' | 'ready';
  peers: readonly PeerEntry[];
  hrefFor: (peerId: string, type: MetricType) => string;
  /** The figures this tab offers, for the two-figure view's pickers. */
  figureTypes: readonly MetricType[];
}) {
  const [view, setView] = useState<'bars' | 'scatter'>('bars');
  const cmp = useMemo(() => deckComparison(selfId, type, peers), [selfId, type, peers]);
  const scatterTypes = useMemo(() => comparableTypes(figureTypes, peers), [figureTypes, peers]);
  const canScatter = peerStatus === 'ready' && scatterTypes.length >= 2;
  const { ranking, bars } = cmp;
  const short = shortCompanyName(selfName);
  const selfMissing = cmp.notCharted.some((n) => n.isSelf);
  const others = cmp.notCharted.filter((n) => !n.isSelf).map((n) => n.name);
  const shownView = canScatter ? view : 'bars';
  return (
    <div>
      <div className="mb-3 flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
        <div className="min-w-0">
          <h4 className="text-[10.5px] font-semibold uppercase tracking-[0.12em] text-muted">Versus this deck</h4>
          {peerStatus === 'ready' && (
            <p className="mt-1 text-[13px] text-content">
              {shownView === 'scatter'
                ? 'Two figures side by side'
                : ranking.rank != null && ranking.of > 1
                  ? <><span className="font-display text-2xl font-semibold tabular-nums text-primary-ink">#{ranking.rank}</span><span className="ml-1.5 text-muted">of {ranking.of} companies with this figure sourced{ranking.includesEstimates ? ', estimates included' : ''}</span></>
                  : selfMissing && bars.length > 0
                    ? <span className="text-muted">{short} has no sourced figure here, so it is not ranked.</span>
                    : bars.length > 0 ? <span className="text-muted">{bars.length} {bars.length === 1 ? 'company has' : 'companies have'} this figure</span> : null}
            </p>
          )}
        </div>
        {canScatter && (
          <div role="group" aria-label="Chart view" className="flex shrink-0 overflow-hidden rounded-full border border-border text-[11.5px] font-medium">
            {(['bars', 'scatter'] as const).map((v) => (
              <button key={v} type="button" aria-pressed={shownView === v} onClick={() => setView(v)}
                className={cn('px-3 py-1 transition-colors', shownView === v ? 'bg-ink text-ink-fg' : 'bg-surface text-muted hover:text-content')}>
                {v === 'bars' ? 'Ranking' : 'Two figures'}
              </button>
            ))}
          </div>
        )}
      </div>

      {peerStatus === 'no_deck' ? (
        <p className="rounded-lg border border-dashed border-border bg-surface-2/40 px-3 py-3 text-[12.5px] leading-snug text-muted">
          Open this company from its deck to compare it with the other companies in that deck.
        </p>
      ) : peerStatus === 'loading' ? (
        <div className="space-y-2" aria-hidden>
          {[0, 1, 2].map((i) => <div key={i} className="h-4 animate-pulse rounded bg-border" style={{ animationDelay: `${i * 90}ms` }} />)}
        </div>
      ) : shownView === 'scatter' ? (
        <ScatterView selfId={selfId} types={scatterTypes} peers={peers} initialY={type} />
      ) : bars.length === 0 ? (
        <p className="rounded-lg border border-dashed border-border bg-surface-2/40 px-3 py-3 text-[12.5px] leading-snug text-muted">
          No company in this deck has a known, comparable figure for this metric yet. Nothing is charted until one does.
        </p>
      ) : (
        <>
          <BarsView bars={bars} hrefFor={hrefFor} type={type} />
          <div className="mt-3 flex flex-wrap items-center justify-between gap-x-4 gap-y-1">
            <Legend selfName={short} />
            <span className="text-[11px] text-faint">Hover or focus a bar for its source and date.</span>
          </div>
        </>
      )}

      {peerStatus === 'ready' && shownView === 'bars' && cmp.otherCurrency.length > 0 && (
        <p className="mt-2 text-[11.5px] leading-snug text-faint">
          <span className="font-medium text-muted">Not charted, reported in another currency: </span>
          {cmp.otherCurrency.map((o) => o.text).join(', ')}. {cmp.otherCurrency.some((o) => o.converted)
            ? 'Not ranked: figures in, or converted from, other currencies.'
            : 'Shown as reported, not converted to US dollars.'}
        </p>
      )}
      {peerStatus === 'ready' && shownView === 'bars' && (others.length > 0 || selfMissing) && (
        <p className="mt-1.5 text-[11.5px] leading-snug text-faint">
          <span className="font-medium text-muted">Not charted, no sourced figure: </span>
          {[...(selfMissing ? [`${short} (this company)`] : []), ...others].slice(0, 7).join(', ')}
          {others.length + (selfMissing ? 1 : 0) > 7 ? ` and ${others.length + (selfMissing ? 1 : 0) - 7} more` : ''}.
        </p>
      )}
    </div>
  );
}
