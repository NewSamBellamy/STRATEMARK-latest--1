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
  ZAxis,
  ResponsiveContainer,
} from 'recharts';
import { TIER_LABELS, type CardWithCompany, type MaturityTier } from '@mi/contracts';
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
import { formatUsd } from '@/lib/format';
import { TIER_COLORS } from '@/lib/theme';
import { buildCardView } from '@/features/card/card-view';
import { SettingsLink } from '@/components/SettingsLink';

interface Point {
  name: string;
  tier: number;
  share: number | null;
  arr: number | null;
  color: string;
}

export function buildOpportunityPoints(cards: CardWithCompany[]): Point[] {
  return cards
    .filter((card) => card.card.cardType === 'company' && card.company && card.card.tier != null)
    .flatMap((card) => {
      const view = buildCardView(card);
      const share = view.metrics.find(
        (entry) =>
          entry.metric.metricType === 'market_share' &&
          entry.metric.confidence === 'verified' &&
          entry.metric.value != null &&
          entry.citations.length > 0,
      );
      if (!share || !view.maturity) return [];
      const arr = view.metrics.find(
        (entry) =>
          entry.metric.metricType === 'arr' &&
          entry.metric.confidence === 'verified' &&
          entry.metric.value != null &&
          entry.citations.length > 0,
      );
      return [
        {
          name: card.company!.name,
          tier: card.card.tier as number,
          share: share.metric.value,
          arr: arr?.metric.value ?? null,
          color: TIER_COLORS[card.card.tier as MaturityTier],
        },
      ];
    });
}

/**
 * Market evidence snapshot — descriptive researched signals plus a sourced
 * hypothesis, not an objective competitive positioning or investment ranking.
 */
export default function OpportunityPage() {
  const { marketId } = useParams();
  const market = useMarket(marketId);
  const deck = useDeckByMarket(marketId);
  const cards = useCards(deck.data?.id);
  const opportunity = useMarketOpportunity(marketId);
  const rerunOpportunity = useRerunOpportunity(marketId);
  const hasKey = useApiKey((s) => s.hasKey);

  const points = useMemo(() => buildOpportunityPoints(cards.data ?? []), [cards.data]);

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
        <span className="text-xs font-semibold uppercase tracking-wide">Market evidence</span>
      </div>
      <h1 className="font-display text-2xl font-semibold text-content">
        {market.data?.name ?? 'Market'} — reported landscape and research notes
      </h1>

      {/* Descriptive map from reported data; market-share definitions may differ. */}
      <div className="panel mt-5 p-5">
        <h2 className="font-display text-sm font-semibold text-content">
          Cited market-share figures vs. composite size band
          <span className="ml-2 text-xs font-normal text-muted">
            bubble size = sourced ARR when available
          </span>
        </h2>
        <p className="mt-1 text-xs text-muted">
          Directional snapshot only. Market-share definitions, geographies, and periods may differ;
          citations are attribution, not independent verification.
        </p>
        {points.length > 0 ? (
          <div className="mt-2 h-[340px]">
            <ResponsiveContainer width="100%" height="100%">
              <ScatterChart margin={{ top: 16, right: 24, bottom: 8, left: 4 }}>
                <CartesianGrid stroke="#ECEAE4" strokeDasharray="3 3" />
                <XAxis
                  type="number"
                  dataKey="tier"
                  name="Scale band"
                  domain={[0.5, 8.5]}
                  ticks={[1, 2, 3, 4, 5, 6, 7, 8]}
                  tickFormatter={(t: number) => `T${t}`}
                  stroke="#9A9AA1"
                  fontSize={11}
                />
                <YAxis
                  type="number"
                  dataKey="share"
                  name="Cited share"
                  unit="%"
                  stroke="#9A9AA1"
                  fontSize={11}
                  width={44}
                />
                <ZAxis type="number" dataKey="arr" range={[80, 900]} />
                <ReTooltip
                  cursor={{ strokeDasharray: '3 3' }}
                  contentStyle={{
                    background: '#fff',
                    border: '1px solid #E5E3DD',
                    borderRadius: 8,
                    fontSize: 12,
                  }}
                  formatter={(value: number, key: string) =>
                    key === 'arr'
                      ? formatUsd(value)
                      : key === 'tier'
                        ? TIER_LABELS[value as MaturityTier]
                        : `${value}%`
                  }
                  labelFormatter={() => ''}
                  content={({ payload }) => {
                    const p = payload?.[0]?.payload as Point | undefined;
                    if (!p) return null;
                    return (
                      <div className="rounded-lg border border-border bg-surface px-3 py-2 text-xs shadow-soft">
                        <div className="font-semibold text-content">{p.name}</div>
                        <div className="text-muted">
                          {TIER_LABELS[p.tier as MaturityTier]} · share {p.share}% · ARR{' '}
                          {p.arr == null ? 'unknown' : formatUsd(p.arr)}
                        </div>
                      </div>
                    );
                  }}
                />
                <Scatter
                  data={points}
                  isAnimationActive={false}
                  shape={(props: { cx?: number; cy?: number; payload?: Point }) => (
                    <circle
                      cx={props.cx}
                      cy={props.cy}
                      r={Math.max(
                        6,
                        Math.min(22, Math.sqrt((props.payload?.arr ?? 0) / 1e6) * 1.6),
                      )}
                      fill={props.payload?.color ?? '#888'}
                      fillOpacity={0.75}
                      stroke="#fff"
                      strokeWidth={1.5}
                    />
                  )}
                />
              </ScatterChart>
            </ResponsiveContainer>
          </div>
        ) : (
          <p className="mt-3 text-sm text-muted">
            Not enough companies with sourced market-share data to plot yet — this view waits rather
            than plotting estimates or unsourced figures.
          </p>
        )}
      </div>

      {/* Grounded whitespace thesis — right-click to re-run the analysis. */}
      <ContextRerun
        label="the whitespace analysis"
        onRerun={() => rerunOpportunity.mutate()}
        running={rerunOpportunity.isPending}
        disabled={!hasKey}
        className="mt-4"
      >
        <div className="panel p-6">
          <QueryBoundary
            query={opportunity}
            loading={<FullPageLoader label="Analyzing the whitespace (grounded search)…" />}
          >
            {(o) =>
              o.citations.length > 0 ? (
                <>
                  <div className="mb-4">
                    <p className="text-xs font-semibold uppercase tracking-wide text-muted">
                      Research hypothesis
                    </p>
                    <p className="mt-1 text-xs text-muted">
                      A sourced starting point for investigation, not a verified market fact.
                    </p>
                  </div>
                  <article className="markdown">
                    <ReactMarkdown remarkPlugins={[remarkGfm]}>{o.markdown}</ReactMarkdown>
                  </article>
                  <footer className="mt-5 border-t border-border pt-3">
                    <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">
                      Sources ({o.citations.length})
                    </h3>
                    <div className="flex flex-wrap gap-x-4 gap-y-1">
                      {o.citations.slice(0, 8).map((c, i) => (
                        <a
                          key={i}
                          href={c.url}
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
                </>
              ) : (
                <div className="py-4 text-center">
                  <h2 className="font-display text-lg font-semibold text-content">
                    No sourced opportunity thesis yet
                  </h2>
                  <p className="mx-auto mt-2 max-w-lg text-sm text-muted">
                    Stratemark will not present an unsourced market conclusion. Run a grounded pass
                    when you are ready.
                  </p>
                  {hasKey ? (
                    <button
                      type="button"
                      className="btn-primary mt-4"
                      disabled={rerunOpportunity.isPending}
                      onClick={() => rerunOpportunity.mutate()}
                    >
                      {rerunOpportunity.isPending ? 'Researching…' : 'Research the opportunity'}
                    </button>
                  ) : (
                    <SettingsLink className="btn-primary mt-4 inline-flex">
                      Connect key
                    </SettingsLink>
                  )}
                </div>
              )
            }
          </QueryBoundary>
        </div>
      </ContextRerun>
    </div>
  );
}
