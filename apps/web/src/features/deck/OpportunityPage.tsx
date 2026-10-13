import { sourceHref } from '@/lib/sourceHref';
import { useMemo } from 'react';
import { Link, useParams } from 'react-router-dom';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
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
import { METRIC_COLORS } from '@/lib/theme';

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
        const find = (t: string) => c.metrics.find((m) => m.metricType === t && m.value != null && m.value > 0)?.value ?? null;
        const share = find('market_share');
        const team = find('employees');
        if (share == null || team == null) return [];
        return [{ name: c.company!.name, team, share, arr: find('arr') ?? find('revenue') }];
      });
  }, [cards.data]);

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
          Positioning map — team size vs. market share
          <span className="ml-2 text-xs font-normal text-muted">bubble size = sourced revenue or ARR</span>
        </h2>
        {points.length > 0 ? (
          <div className="mt-2 h-[340px]" >
            <ResponsiveContainer width="100%" height="100%">
              <ScatterChart margin={{ top: 16, right: 24, bottom: 8, left: 4 }}>
                <CartesianGrid stroke="#ECEAE4" strokeDasharray="3 3" />
                <XAxis
                  type="number"
                  dataKey="team"
                  name="Team size"
                  scale="log"
                  domain={['auto', 'auto']}
                  tickFormatter={(t: number) => formatMetricValue('employees', t)}
                  stroke="#9A9AA1"
                  fontSize={11}
                />
                <YAxis
                  type="number"
                  dataKey="share"
                  name="Market share"
                  unit="%"
                  stroke="#9A9AA1"
                  fontSize={11}
                  width={44}
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
                  <circle
                    cx={props.cx}
                    cy={props.cy}
                    r={props.payload?.arr != null ? Math.max(6, Math.min(22, Math.sqrt(props.payload.arr / 1e6) * 1.6)) : 6}
                    fill={METRIC_COLORS.market_share}
                    fillOpacity={0.75}
                    stroke="#fff"
                    strokeWidth={1.5}
                  />
                )} />
              </ScatterChart>
            </ResponsiveContainer>
          </div>
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
                <ReactMarkdown remarkPlugins={[remarkGfm]}>{o.markdown}</ReactMarkdown>
              </article>
              {o.citations.length > 0 && (
                <footer className="mt-5 border-t border-border pt-3">
                  <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">
                    Sources ({o.citations.length})
                  </h3>
                  <div className="flex flex-wrap gap-x-4 gap-y-1">
                    {o.citations.slice(0, 8).map((c, i) => (
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
