import { ArrowUpRight, ExternalLink, MapPin } from 'lucide-react';
import { METRIC_TYPE_LABELS, type CompanyMetric, type MetricType } from '@mi/contracts';
import { Link, useLocation } from 'react-router-dom';
import { useCompany, useCompanyMetrics } from '@/hooks/data';
import { QueryBoundary } from '@/components/states/QueryBoundary';
import { formatMetricValue } from '@/lib/format';
import { ConfidenceBadge } from '@/features/card/ConfidenceBadge';

const PRIORITY = ['arr', 'market_cap', 'valuation', 'users', 'employees', 'market_share'] as const;
const METRIC_FAMILIES: ReadonlyArray<readonly MetricType[]> = [
  ['arr'],
  ['market_cap', 'valuation'],
  ['users'],
  ['employees'],
  ['market_share'],
] as const;

function strongestMetrics(metrics: CompanyMetric[]): CompanyMetric[] {
  const strength = (metric: CompanyMetric) =>
    (metric.confidence === 'user_verified' ? 6 : metric.confidence === 'verified' ? 4 : 2) +
    (metric.citations.length > 0 || metric.source ? 1 : 0);
  const seen = new Set<string>();
  return [...metrics]
    .filter((metric) => metric.value != null && metric.confidence !== 'unknown')
    .sort(
      (a, b) =>
        strength(b) - strength(a) ||
        PRIORITY.indexOf(a.metricType) - PRIORITY.indexOf(b.metricType),
    )
    .filter((metric) => {
      const family = ['valuation', 'market_cap'].includes(metric.metricType)
        ? 'company_value'
        : metric.metricType;
      if (seen.has(family)) return false;
      seen.add(family);
      return true;
    })
    .slice(0, 4);
}

/** Immediate card-to-research handoff: useful before any live research is requested. */
export function OverviewTab({ companyId }: { companyId: string }) {
  const { search } = useLocation();
  const company = useCompany(companyId);
  const metrics = useCompanyMetrics(companyId);
  const allMetrics = metrics.data ?? [];
  const headlineMetrics = strongestMetrics(allMetrics);
  const known = allMetrics.filter(
    (metric) => metric.value != null && metric.confidence !== 'unknown',
  );
  const sourced = known.filter((metric) => metric.citations.length > 0 || Boolean(metric.source));
  const verified = known.filter(
    (metric) => metric.confidence === 'verified' || metric.confidence === 'user_verified',
  );
  const missingCount = METRIC_FAMILIES.filter(
    (family) => !known.some((metric) => family.includes(metric.metricType)),
  ).length;

  return (
    <QueryBoundary query={company}>
      {(record) => (
        <div className="space-y-5">
          <section className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_310px]">
            <article className="rounded-2xl border border-[#bfd8cf] bg-[#edf6f1] p-6">
              <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-primary">
                Company brief
              </p>
              <p className="mt-3 max-w-3xl font-display text-[24px] font-semibold leading-snug tracking-[-0.02em] text-content">
                {record.oneLiner || 'A concise public description has not been captured yet.'}
              </p>
              <div className="mt-5 flex flex-wrap items-center gap-2 text-[12px] text-muted">
                {record.hqLocation && (
                  <span className="inline-flex items-center gap-1.5 rounded-full border border-[#cbded7] bg-white/70 px-3 py-1.5">
                    <MapPin className="h-3.5 w-3.5" />
                    {record.hqLocation}
                  </span>
                )}
                {record.websiteUrl && (
                  <a
                    href={record.websiteUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1.5 rounded-full border border-[#cbded7] bg-white/70 px-3 py-1.5 transition-colors hover:border-primary/50 hover:text-content"
                  >
                    <ExternalLink className="h-3.5 w-3.5" />
                    {record.websiteUrl.replace(/^https?:\/\//, '').replace(/\/$/, '')}
                  </a>
                )}
              </div>
            </article>

            <aside className="rounded-2xl border border-border bg-surface p-5">
              <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-faint">
                Evidence health
              </p>
              <div className="mt-3 flex items-end justify-between gap-3">
                <span className="font-display text-3xl font-semibold tabular-nums text-content">
                  {known.length ? `${sourced.length}/${known.length}` : '0'}
                </span>
                <span className="pb-1 text-[11px] text-muted">
                  {known.length ? 'known figures sourced' : 'credible figures captured'}
                </span>
              </div>
              <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-surface-2">
                <div
                  className="h-full rounded-full bg-primary transition-[width]"
                  style={{ width: `${known.length ? (sourced.length / known.length) * 100 : 0}%` }}
                />
              </div>
              <div className="mt-4 grid grid-cols-2 gap-2 border-t border-border pt-4 text-[11px]">
                <div>
                  <span className="block font-display text-lg font-semibold text-content">
                    {verified.length}
                  </span>
                  <span className="text-muted">sourced figures</span>
                </div>
                <div>
                  <span className="block font-display text-lg font-semibold text-content">
                    {missingCount}
                  </span>
                  <span className="text-muted">open questions</span>
                </div>
              </div>
            </aside>
          </section>

          <section>
            <div className="mb-3 flex items-end justify-between gap-3">
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-faint">
                  At a glance
                </p>
                <h2 className="mt-1 font-display text-xl font-semibold text-content">
                  Most useful public figures
                </h2>
              </div>
              <Link
                to={`/company/${companyId}/dashboard/metrics${search}`}
                className="inline-flex items-center gap-1 text-[12px] font-medium text-primary-ink hover:underline"
              >
                See all metrics <ArrowUpRight className="h-3.5 w-3.5" />
              </Link>
            </div>

            {headlineMetrics.length > 0 ? (
              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                {headlineMetrics.map((metric) => (
                  <article
                    key={metric.id}
                    className="rounded-xl border border-border bg-surface p-4"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <span className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted">
                        {METRIC_TYPE_LABELS[metric.metricType]}
                      </span>
                      <ConfidenceBadge
                        confidence={metric.confidence}
                        note={metric.methodNote}
                        source={metric.source}
                        citations={metric.citations}
                        metricLabel={METRIC_TYPE_LABELS[metric.metricType]}
                      />
                    </div>
                    <p className="mt-4 font-display text-[28px] font-semibold tracking-tight text-content">
                      {formatMetricValue(metric.metricType, metric.value)}
                    </p>
                  </article>
                ))}
              </div>
            ) : (
              <div className="rounded-xl border border-dashed border-border bg-surface px-5 py-6">
                <p className="font-medium text-content">
                  No credible public figures were captured.
                </p>
                <p className="mt-1 text-sm text-muted">
                  Ask the company researcher a focused question rather than filling the space with
                  estimates.
                </p>
              </div>
            )}
          </section>
        </div>
      )}
    </QueryBoundary>
  );
}
