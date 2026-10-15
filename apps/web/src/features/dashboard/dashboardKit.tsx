import type { ReactNode } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { SearchX } from 'lucide-react';
import {
  CONFIDENCE_LABELS,
  METRIC_TYPE_LABELS,
  metricDefinitionLabel,
  type CompanyMetric,
  type Confidence,
  type MetricType,
} from '@mi/contracts';
import { cn } from '@/lib/cn';
import { formatMetricValue } from '@/lib/format';
import { METRIC_COLORS } from '@/lib/theme';
import { ConfidenceBadge } from '@/features/card/ConfidenceBadge';
import { distributionLabel } from '@/features/card/card-view';
import { UNKNOWN_REASON } from '@/features/card/UnknownValue';
import { FILL_HINT, formatAsOf, isKnown, type PeerRanking } from './dashboardModel';

/** The table's name for a figure. A distribution count says what it counts ("Countries 21"), as the card does, never a bare number. */
export const metricLabel = (m: Pick<CompanyMetric, 'metricType' | 'passageSupport' | 'reportedSupport'> & { methodNote?: string | null }) => {
  const byDefinition = metricDefinitionLabel(m);
  // A stored distribution figure carries the definition "distribution", whose label is the bare word:
  // for that one the source's own wording (countries, stockists) is the better name.
  if (m.metricType === 'distribution' && (!byDefinition || byDefinition === METRIC_TYPE_LABELS.distribution)) {
    return distributionLabel({ passageSupport: m.passageSupport, reportedSupport: m.reportedSupport, methodNote: m.methodNote ?? null });
  }
  return byDefinition ?? METRIC_TYPE_LABELS[m.metricType];
};

/** Build links between dashboard tabs, carrying the deck/card context along. */
export function useTabHref(companyId: string) {
  const [params] = useSearchParams();
  return (tab: string, extra?: Record<string, string>) => {
    const next = new URLSearchParams(params);
    next.delete('metric');
    for (const [k, v] of Object.entries(extra ?? {})) next.set(k, v);
    const qs = next.toString();
    return `/company/${companyId}/dashboard/${tab}${qs ? `?${qs}` : ''}`;
  };
}

export const CONFIDENCE_DOT: Record<Confidence, string> = {
  verified: '#16A34A',
  estimated: '#CA8A04',
  unknown: '#9A9AA1',
  user_verified: '#0284C7',
};

/** Compact confidence text for dense rows; the full badge (with sources) lives in detail views. */
export function ConfidenceMark({ confidence }: { confidence: Confidence }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-[12px] text-muted">
      <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: CONFIDENCE_DOT[confidence] }} aria-hidden />
      {CONFIDENCE_LABELS[confidence]}
    </span>
  );
}

/** Section chrome: one consistent hierarchy across both tabs. */
export function Section({
  title, hint, action, children, label,
}: {
  title: string;
  hint?: ReactNode;
  action?: ReactNode;
  children: ReactNode;
  label?: string;
}) {
  return (
    <section aria-label={label ?? title} className="min-w-0">
      <div className="mb-2.5 flex items-end justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted">{title}</h2>
          {hint && <p className="mt-0.5 text-[12px] text-faint">{hint}</p>}
        </div>
        {action}
      </div>
      {children}
    </section>
  );
}

export function RankChip({ ranking, href }: { ranking: PeerRanking | null | undefined; href?: string }) {
  if (!ranking || ranking.rank == null || ranking.of < 2) return null;
  const body = (
    <>
      <span className="font-semibold text-content">#{ranking.rank}</span> of {ranking.of} in deck
    </>
  );
  const cls = 'inline-flex items-center gap-1 rounded-md border border-border bg-surface-2 px-1.5 py-0.5 text-[11px] tabular-nums text-muted';
  const title = `Ranked among ${ranking.of} deck companies with a known ${ranking.metricType.replace('_', ' ')}${ranking.unknownPeers ? `; ${ranking.unknownPeers} unknown peer${ranking.unknownPeers === 1 ? '' : 's'} excluded` : ''}${ranking.includesEstimates ? '; includes estimated figures' : ''}.`;
  return href
    ? <Link to={href} className={cn(cls, 'transition-colors hover:border-primary/50 hover:text-content')} title={title}>{body}</Link>
    : <span className={cls} title={title}>{body}</span>;
}

/**
 * A headline figure: value, as-of date, confidence + source affordance, and
 * where it ranks in the deck. An Unknown is a labelled gap that says what
 * would fill it; it is never a zero.
 */
export function KpiTile({
  metric, ranking, href,
}: {
  metric: CompanyMetric;
  ranking?: PeerRanking | null;
  href?: string;
}) {
  const label = metricLabel(metric);
  const known = isKnown(metric);
  const asOf = known ? formatAsOf(metric) : null;
  return (
    <article
      className={cn(
        'flex min-w-0 flex-col rounded-xl border bg-surface p-4 shadow-soft',
        known ? 'border-border' : 'border-dashed border-border bg-surface-2/40 shadow-none',
      )}
      style={known ? { borderTopColor: METRIC_COLORS[metric.metricType], borderTopWidth: 2 } : undefined}
      aria-label={`${label} headline figure`}
    >
      <h3 className="truncate text-[10.5px] font-semibold uppercase tracking-[0.12em] text-muted">{label}</h3>
      {known ? (
        <>
          <p className="mt-1.5 font-display text-[26px] font-semibold leading-none tabular-nums text-content">
            {formatMetricValue(metric.metricType, metric.value)}
          </p>
          <p className="mt-1.5 min-h-[16px] text-[11px] text-faint">{asOf ?? ''}</p>
          <div className="mt-auto flex flex-wrap items-center gap-1.5 pt-3">
            <ConfidenceBadge reported={metric.reportedSupport != null || metric.reportedBand != null}
              confidence={metric.confidence}
              note={metric.methodNote}
              source={metric.source}
              citations={metric.citations}
              metricLabel={label}
            />
            <RankChip ranking={ranking} href={href} />
          </div>
        </>
      ) : (
        <div className="mt-1.5 flex flex-1 flex-col" title={UNKNOWN_REASON}>
          <p className="flex items-center gap-1.5 font-display text-lg font-semibold text-muted">
            <SearchX className="h-4 w-4" aria-hidden />
            Unknown
          </p>
          <p className="mt-1 text-[11px] leading-snug text-faint">
            <span className="font-medium text-muted">To fill: </span>
            {FILL_HINT[metric.metricType as MetricType]}
          </p>
        </div>
      )}
    </article>
  );
}

export function KpiTileSkeleton({ i = 0 }: { i?: number }) {
  return (
    <div className="rounded-xl border border-border bg-surface p-4" aria-hidden>
      <div className="h-2.5 w-16 animate-pulse rounded bg-border" style={{ animationDelay: `${i * 80}ms` }} />
      <div className="mt-3 h-6 w-24 animate-pulse rounded bg-border" style={{ animationDelay: `${i * 80 + 40}ms` }} />
      <div className="mt-3 h-3 w-20 animate-pulse rounded bg-border" style={{ animationDelay: `${i * 80 + 80}ms` }} />
    </div>
  );
}
