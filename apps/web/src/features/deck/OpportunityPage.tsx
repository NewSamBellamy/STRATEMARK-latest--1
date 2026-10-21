import { sourceHref } from '@/lib/sourceHref';
import { useMemo } from 'react';
import { Link, useParams } from 'react-router-dom';
import { SafeMarkdown } from '@/components/ResearchMarkdown';
import { ArrowLeft, ExternalLink, Target } from 'lucide-react';
import {
  CartesianGrid,
  Scatter,
  ScatterChart,
  Tooltip as ReTooltip,
  XAxis,
  YAxis,
  ResponsiveContainer,
} from 'recharts';
import {
  useCards,
  useDeckByMarket,
  useMarket,
  useMarketOpportunity,
  useRerunOpportunity,
} from '@/hooks/data';
import { QueryBoundary } from '@/components/states/QueryBoundary';
import { ContextRerun } from '@/components/ui/ContextRerun';
import { FullPageLoader } from '@/components/states/FullPageLoader';
import { useApiKey } from '@/lib/settings/apiKey';
import { formatMetricValue, formatUsd } from '@/lib/format';
import { figureCurrency } from '@/features/dashboard/figureCurrency';
import { assessedMetrics } from '@/features/dashboard/figureSet';
import { METRIC_COLORS } from '@/lib/theme';
import { tidyOpportunityProse } from '@/lib/opportunityProse';
import { shareAxis, teamAxis } from './positioningAxes';

interface Point {
  name: string;
  team: number;
  share: number;
  /** Sourced revenue/ARR, or null — bubbles never get an invented size. */
  arr: number | null;
}

/**
 * Market Opportunity — the deck-level strategy view: a positioning map built
 * from the deck's real researched data + a grounded whitespace thesis.
 */
export default function OpportunityPage() {
  const { marketId } = useParams();
  const market = useMarket(marketId);
  const deck = useDeckByMarket(marketId);
  const cards = useCards(deck.data?.id);
  const opportunity = useMarketOpportunity(marketId);
  const rerunOpportunity = useRerunOpportunity(marketId);
  const hasKey = useApiKey((s) => s.hasKey);

  const points = useMemo<Point[]>(() => {
    return (cards.data ?? [])
      .filter((c) => c.card.cardType === 'company' && c.company)
      .flatMap((c) => {
        // The same read-time facts the card, the tiles and the compare table read: an estimate the card calls
        // "Not found yet" does not size a bubble. A figure reported in another currency is not a dollar size.
        const own = assessedMetrics(c.metrics.filter((m) => m.companyId === c.company!.id), c.company);
        const find = (t: string) => {
          const m = own.find((x) => x.metricType === t && x.value != null && x.value > 0 && x.confidence !== 'unknown');
          return m && !figureCurrency(m) ? m.value : null;
        };
        const share = find('market_share');
        const team = find('employees');
        if (share == null || team == null) return [];
        return [{ name: c.company!.name, team, share, arr: find('arr') ?? find('revenue') }];
      });
  }, [cards.data]);
  // Axes are only built when there is something to plot (min/max of nothing is not a range).
  const xAxis = useMemo(
    () => (points.length ? teamAxis(Math.min(...points.map((p) => p.team)), Math.max(...points.map((p) => p.team))) : teamAxis(1, 1)),
    [points],
  );
  const yAxis = useMemo(() => shareAxis(points.length ? Math.max(...points.map((p) => p.share)) : 1), [points]);

  return (
    <div className="mx-auto max-w-5xl">
      <Link
        to={`/markets/${marketId}/deck`}
        className="mb-3 inline-flex items-center gap-1.5 text-sm text-muted hover:text-content"
      >
        <ArrowLeft className="h-4 w-4" />
        Back to deck
      </Link>
      <div className="mb-1 flex items-center gap-2 text-primary-ink">
        <Target className="h-5 w-5" />
        <span className="text-xs font-semibold uppercase tracking-wide">Market opportunity</span>
      </div>
      <h1 className="font-display text-2xl font-semibold text-content">
        {market.data?.name ?? 'Market'} — where the gap is
      </h1>

      {/* Positioning map from real deck data (no LLM in the chart). */}
      <div className="panel mt-5 p-5">
        <h2 className="font-display text-sm font-semibold text-content">
          Positioning map — team size vs. market share        </h2>
        {points.length > 0 ? (
          <div className="mt-2 h-[340px]" >
            <ResponsiveContainer width="100%" height="100%">
              <ScatterChart margin={{ top: 28, right: 56, bottom: 28, left: 8 }}>
                <CartesianGrid stroke="#ECEAE4" strokeDasharray="3 3" />
                <XAxis
                  type="number"
                  dataKey="team"
                  name="Team size"
                  scale="log"
                  domain={xAxis.domain}
                  ticks={xAxis.ticks}
                  allowDataOverflow
                  tickFormatter={(t: number) => formatMetricValue('employees', t)}
                  stroke="#9A9AA1"
                  fontSize={11}
                  label={{ value: 'Team size (employees, log scale)', position: 'insideBottom', offset: -16, fontSize: 11, fill: '#6B6B73' }}
                />
                <YAxis
                  type="number"
                  dataKey="share"
                  name="Market share"
                  domain={yAxis.domain}
                  ticks={yAxis.ticks}
                  tickFormatter={(t: number) => `${t}%`}
                  stroke="#9A9AA1"
                  fontSize={11}
                  width={64}
                  label={{ value: 'Market share', angle: -90, position: 'insideLeft', fontSize: 11, fill: '#6B6B73', style: { textAnchor: 'middle' } }}
                />
                                <ReTooltip
                  cursor={{ strokeDasharray: '3 3' }}
                  contentStyle={{ background: '#fff', border: '1px solid #E5E3DD', borderRadius: 8, fontSize: 12 }}
                  labelFormatter={() => ''}
                  content={({ payload }) => {
                    const p = payload?.[0]?.payload as Point | undefined;
                    if (!p) return null;
                    return (
                      <div className="rounded-lg border border-border bg-surface px-3 py-2 text-xs shadow-soft">
                        <div className="font-semibold text-content">{p.name}</div>
                        <div className="text-muted">
                          {formatMetricValue('employees', p.team)} people · share {p.share}%{p.arr != null ? ` · revenue ${formatUsd(p.arr)}` : ''}
                        </div>
                      </div>
                    );
                  }}
                />
                <Scatter data={points} isAnimationActive={false} shape={(props: { cx?: number; cy?: number; payload?: Point }) => (
                  <>
                    {/* The chart wraps each bubble in role="img": the title is its text alternative. */}
                    {props.payload && (
                      <title>
                        {`${props.payload.name}: ${formatMetricValue('employees', props.payload.team)} people, share ${props.payload.share}%${props.payload.arr != null ? `, revenue ${formatUsd(props.payload.arr)}` : ''}`}
                      </title>
                    )}
                    <circle
                      cx={props.cx}
                      cy={props.cy}
                      r={props.payload?.arr != null ? Math.max(6, Math.min(22, Math.sqrt(props.payload.arr / 1e6) * 1.6)) : 6}
                      fill={METRIC_COLORS.market_share}
                      fillOpacity={0.75}
                      stroke="#fff"
                      strokeWidth={1.5}
                    />
                    {props.payload && props.cx != null && props.cy != null && (
                      <text
                        x={props.cx}
                        y={props.cy - (props.payload.arr != null ? Math.max(6, Math.min(22, Math.sqrt(props.payload.arr / 1e6) * 1.6)) : 6) - 6}
                        textAnchor="middle"
                        fontSize={11}
                        fontWeight={600}
                        fill="currentColor"
                        className="text-content"
                      >
                        {props.payload.name}
                      </text>
                    )}
                  </>
                )} />
              </ScatterChart>
            </ResponsiveContainer>
          </div>
        ) : null}
        {points.length > 0 ? (
          <p className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted">
            <span className="inline-flex items-center gap-1.5">
              <span className="inline-block h-3 w-3 rounded-full" style={{ background: METRIC_COLORS.market_share, opacity: 0.75 }} />
              Larger bubble = more sourced revenue or ARR
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span className="inline-block h-1.5 w-1.5 rounded-full" style={{ background: METRIC_COLORS.market_share, opacity: 0.75 }} />
              Smallest bubble = none sourced
            </span>
          </p>
        ) : (
          <p className="mt-3 text-sm text-muted">
            Not enough companies with both sourced market share and team size to plot yet — the whitespace thesis below
            still runs from everything the deck knows.
          </p>
        )}
      </div>

      {/* Grounded whitespace thesis — re-run from the button (or right-click). */}
      <div className="mt-6 flex items-center justify-between gap-3">
        <h2 className="font-display text-sm font-semibold text-content">Where a new entrant could win</h2>
        <button
          type="button"
          className="btn-ghost px-3 py-1.5 text-[12px]"
          disabled={!hasKey || rerunOpportunity.isPending}
          onClick={() => rerunOpportunity.mutate()}
        >
          {rerunOpportunity.isPending ? 'Re-running…' : 'Re-run analysis'}
        </button>
      </div>
      <ContextRerun
        label="the whitespace analysis"
        onRerun={() => rerunOpportunity.mutate()}
        running={rerunOpportunity.isPending}
        disabled={!hasKey}
        className="mt-2"
      >
      <div className="panel p-6">
        <QueryBoundary
          query={opportunity}
          loading={<FullPageLoader label="Analyzing the whitespace (grounded search)…" />}
        >
          {(o) => (
            <>
              <article className="markdown">
                <SafeMarkdown>{tidyOpportunityProse(o.markdown)}</SafeMarkdown>
              </article>
              {o.citations.length > 0 && (
                <footer className="mt-5 border-t border-border pt-3">
                  <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">
                    Sources ({o.citations.length})
                  </h3>
                  <div className="flex flex-wrap gap-x-4 gap-y-1">
                    {o.citations.map((c, i) => (
                      <a
                        key={i}
                        href={sourceHref(c.url, c.title)}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1 text-xs text-primary-ink hover:underline"
                      >
                        <ExternalLink className="h-3 w-3" />
                        {c.title || 'source'}
                      </a>
                    ))}
                  </div>
                </footer>
              )}
            </>
          )}
        </QueryBoundary>
      </div>
      </ContextRerun>
    </div>
  );
}
