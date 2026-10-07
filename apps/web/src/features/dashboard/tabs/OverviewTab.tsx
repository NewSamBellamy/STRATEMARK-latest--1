import { ResearchMarkdown } from '@/components/ResearchMarkdown';
import { ConfidenceBadge } from '@/features/card/ConfidenceBadge';
import { ExternalLink, MapPin } from 'lucide-react';
import { METRIC_TYPE_LABELS, metricDefinitionLabel } from '@mi/contracts';
import { useCompany, useCompanyMetrics, useDashboardTab } from '@/hooks/data';
import { QueryBoundary } from '@/components/states/QueryBoundary';
import { formatMetricValue } from '@/lib/format';
import { METRIC_COLORS } from '@/lib/theme';
import { DigDeeperMenu } from '@/features/deepdive/DeepDive';
import { AiCover } from '@/components/media/AiCover';

/**
 * Overview — the "front page" of a company. A readable grounded summary plus an
 * at-a-glance fact rail, with drill-downs so any thread can be pulled further.
 */
export function OverviewTab({ companyId }: { companyId: string }) {
  const query = useDashboardTab(companyId, 'overview');
  const company = useCompany(companyId).data;
  const metrics = useCompanyMetrics(companyId).data ?? [];
  const name = company?.name ?? 'this company';

  return (
    <QueryBoundary query={query}>
      {(result) => (
        <div className="grid gap-5 lg:grid-cols-[1fr_300px]">
          <article className="markdown panel p-6">
            {result.content.markdown.trim()
              ? <ResearchMarkdown text={result.content.markdown} />
              : <p className="text-sm text-muted">No overview is available from the saved research yet.</p>}
            <div className="mt-5 flex justify-end border-t border-border pt-4">
              <DigDeeperMenu
                topics={[
                  'Business model & how they make money',
                  'Competitive landscape & closest rivals',
                  'Risks & headwinds',
                ]}
                companyId={companyId}
                companyName={name}
              />
            </div>
          </article>

          <aside className="space-y-4">
            <div className="panel p-4">
              <h3 className="mb-3 text-xs font-semibold uppercase tracking-wide text-muted">
                At a glance
              </h3>
              <ul className="space-y-2.5">
                {metrics.slice(0, 6).map((m) => (
                  <li key={m.id} className="flex items-center justify-between gap-2 text-sm">
                    <span className="flex items-center gap-2 text-muted">
                      <span
                        className="h-2 w-2 rounded-full"
                        style={{ background: METRIC_COLORS[m.metricType] }}
                      />
                      {metricDefinitionLabel(m) ?? METRIC_TYPE_LABELS[m.metricType]}
                    </span>
                    <span className="flex items-center gap-1.5">
                      <span className="font-semibold tabular-nums text-content">
                        {formatMetricValue(m.metricType, m.value)}
                      </span>
                      {/* Trust state at a glance: the same badge the metrics
                          tab uses, so an estimate never looks verified. */}
                      <ConfidenceBadge
                        confidence={m.confidence}
                        note={m.methodNote}
                        source={m.source}
                        citations={m.citations}
                        metricLabel={metricDefinitionLabel(m) ?? METRIC_TYPE_LABELS[m.metricType]}
                      />
                    </span>
                  </li>
                ))}
                {metrics.length === 0 && (
                  <li className="text-sm text-muted">No quantitative metrics found.</li>
                )}
              </ul>
            </div>

            {company && (
              <div className="panel space-y-2 p-4 text-sm">
                {company.hqLocation && (
                  <>
                    <p className="flex items-start gap-2 text-muted">
                      <MapPin className="mt-0.5 h-4 w-4 shrink-0" />
                      {company.hqLocation}
                    </p>
                    {/* A glimpse of the place — generated from the HQ location
                        itself, so every company's panel carries its city's
                        light (founder's ask: "give people a glimpse of where
                        it's based out of"). */}
                    <div className="h-[110px] overflow-hidden rounded-lg border border-border">
                      <AiCover
                        cacheKey={`hq:${companyId}`}
                        title={`${name} — ${company.hqLocation}`}
                        context={`A cityscape of ${company.hqLocation} that is INSTANTLY RECOGNIZABLE as that specific place: its most famous landmarks, skyline silhouette, geography and light (e.g. San Francisco = Golden Gate Bridge + fog + hills + bay). Concrete and place-specific, never a generic city.`}
                        url={company.websiteUrl ?? ''}
                        source="news"
                        compact
                      />
                    </div>
                  </>
                )}
                {company.websiteUrl && (
                  <a
                    href={company.websiteUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1.5 text-primary-ink hover:underline"
                  >
                    <ExternalLink className="h-3.5 w-3.5" />
                    {company.websiteUrl.replace(/^https?:\/\//, '')}
                  </a>
                )}
              </div>
            )}
          </aside>
        </div>
      )}
    </QueryBoundary>
  );
}
