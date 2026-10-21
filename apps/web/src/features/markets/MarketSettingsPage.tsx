import { Link, useParams } from 'react-router-dom';
import { ArrowLeft, RefreshCw, Clock } from 'lucide-react';
import {
  REFRESH_CADENCES,
  REFRESH_CADENCE_LABELS,
  REFRESH_CADENCE_HOURS,
  type RefreshCadence,
} from '@mi/contracts';
import { useDeckByMarket, useMarket, useRefreshDeck, useUpdateCadence } from '@/hooks/data';
import { QueryBoundary } from '@/components/states/QueryBoundary';
import { formatDue, formatRelative } from '@/lib/format';
import { useSupports } from '@/lib/repository/RepositoryProvider';

export default function MarketSettingsPage() {
  const { marketId } = useParams();
  const market = useMarket(marketId);
  const deck = useDeckByMarket(marketId);
  const updateCadence = useUpdateCadence();
  const canSchedule = useSupports('updateMarketCadence');
  const refreshDeck = useRefreshDeck();

  return (
    <div className="mx-auto max-w-2xl">
      <Link
        to={`/markets/${marketId}/deck`}
        className="mb-4 inline-flex items-center gap-1.5 text-sm text-muted hover:text-content"
      >
        <ArrowLeft className="h-4 w-4" />
        Back to deck
      </Link>
      <h1 className="font-display text-2xl font-semibold text-content">Deck settings</h1>

      <QueryBoundary query={market}>
        {(m) => (
          <div className="mt-6 space-y-5">
            <div className="panel p-5">
              <h2 className="font-display text-lg text-content">{m.name}</h2>
              <p className="mt-1 text-sm text-muted">
                {m.scopeDefinition.vertical}
                {m.scopeDefinition.geography ? ` · ${m.scopeDefinition.geography}` : ''}
              </p>
            </div>

            <div className="panel space-y-4 p-5">
              <div>
                <label className="label" htmlFor="cadence">
                  Refresh cadence
                </label>
                <select
                  id="cadence"
                  className="input max-w-xs"
                  value={m.refreshCadence}
                  disabled={updateCadence.isPending || !canSchedule}
                  onChange={(e) =>
                    updateCadence.mutate({ id: m.id, cadence: e.target.value as RefreshCadence })
                  }
                >
                  {REFRESH_CADENCES.map((c) => (
                    <option key={c} value={c}>
                      {REFRESH_CADENCE_LABELS[c]} (every {REFRESH_CADENCE_HOURS[c]}h)
                    </option>
                  ))}
                </select>
                <p className="mt-2 max-w-md text-xs leading-relaxed text-muted">
                  {canSchedule
                    ? 'While the app is open, this deck refreshes on this schedule (one deck at a time). You can always refresh by hand.'
                    : 'Scheduled refresh isn’t available on the cloud engine yet. Use Refresh now instead.'}
                </p>
              </div>

              <div className="flex items-center justify-between border-t border-border pt-4">
                <span className="inline-flex items-center gap-2 text-sm text-muted">
                  <Clock className="h-4 w-4" />
                  <span>
                    Last refreshed: {formatRelative(deck.data?.lastRefreshedAt)}
                    {deck.data?.lastRefreshedAt && (
                      <>
                        {' · next auto-refresh: '}
                        {formatDue(
                          Date.parse(deck.data.lastRefreshedAt) +
                            REFRESH_CADENCE_HOURS[m.refreshCadence] * 3600 * 1000,
                        )}
                      </>
                    )}
                  </span>
                </span>
                <button
                  type="button"
                  className="btn-primary"
                  disabled={refreshDeck.isPending || !marketId}
                  onClick={() => marketId && refreshDeck.mutate(marketId)}
                >
                  <RefreshCw className={`h-4 w-4 ${refreshDeck.isPending ? 'animate-spin' : ''}`} />
                  {refreshDeck.isPending ? 'Refreshing…' : 'Refresh now'}
                </button>
              </div>
            </div>
          </div>
        )}
      </QueryBoundary>
    </div>
  );
}
