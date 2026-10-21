/**
 * A small hand-written bar chart for one overview series: fixed size, no chart library (recharts draws at zero width in
 * a hidden print document).
 *
 * Integrity (AGENTS.md Rule 9): bars are drawn ONLY when the series is `chartable` (at least two sourced numbers), and
 * only for sourced values. A company with no sourced figure is never a bar, never a zero-length one: it is named in a
 * "Not found" line under the chart. A stated range is shown as text, never charted. Every bar is labelled with the
 * model's own `display` string; this file formats no number (the only numbers it computes are SVG coordinates).
 */
import type { DeckSource, OverviewSeries } from '../fullReportModel';

const W = 240;
const LABEL_W = 78;
const BAR_MAX = 122;
const ROW = 14;
const BAR_H = 7;
const NAME_MAX = 17;

const shortName = (name: string) => (name.length > NAME_MAX ? `${name.slice(0, NAME_MAX - 1).trimEnd()}…` : name);

export function PrintBars({ series, sources }: { series: OverviewSeries; sources: readonly DeckSource[] }) {
  const bars = series.chartable
    ? series.entries.filter((e) => e.status === 'sourced' && e.value != null && e.display != null).sort((a, b) => b.value! - a.value!)
    : [];
  const drawn = series.chartable && bars.length >= 2;
  const max = drawn ? Math.max(...bars.map((b) => b.value!)) : 0;
  const ranges = series.entries.filter((e) => e.status === 'range' && e.display != null);
  const noteNumbers = [...new Set(series.entries.flatMap((e) => (e.note != null ? [e.note] : [])))].sort((a, b) => a - b);
  const notes = noteNumbers.flatMap((n) => { const s = sources.find((x) => x.n === n); return s ? [s] : []; });
  const height = bars.length * ROW + 4;

  return (
    <figure className="sm-chart" data-testid={`chart-${series.key}`} data-drawn={drawn ? 'true' : 'false'}>
      <figcaption className="sm-chart__title">{series.label}</figcaption>
      {drawn ? (
        <svg className="sm-chart__svg" viewBox={`0 0 ${W} ${height}`} width="100%" role="img" aria-label={`${series.label}, sourced figures only`}>
          {bars.map((b, i) => {
            const y = 2 + i * ROW;
            const len = Math.max(2, (b.value! / max) * BAR_MAX);
            return (
              <g key={b.companyId} data-testid="chart-bar">
                <text x={0} y={y + 6.2} className="sm-chart__name">{shortName(b.name)}</text>
                <rect x={LABEL_W} y={y} width={len} height={BAR_H} rx={1} className={b.confidence === 'estimated' ? 'sm-chart__bar sm-chart__bar--est' : 'sm-chart__bar'} />
                <text x={LABEL_W + len + 3} y={y + 6.2} className="sm-chart__val">{b.display}{b.confidence === 'estimated' ? ' est.' : ''}</text>
              </g>
            );
          })}
        </svg>
      ) : (
        <p className="sm-chart__none">Fewer than two sourced figures, so no chart is drawn.</p>
      )}
      {ranges.length > 0 && (
        <p className="sm-chart__line">Stated as a range, not charted: {ranges.map((r) => `${r.name} (${r.display})`).join(', ')}</p>
      )}
      {series.unknown.length > 0 && <p className="sm-chart__line sm-chart__line--unknown">Not found: {series.unknown.join(', ')}</p>}
      {notes.length > 0 && (
        <p className="sm-chart__notes">Notes: {notes.map((s) => <span key={s.n}><sup className="sm-note">{s.n}</sup> {s.publisher} </span>)}</p>
      )}
    </figure>
  );
}
