import { useEffect, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { CardWithCompany } from '@mi/contracts';
import { Button } from '@/components/ui/button';
import { GameCard } from '@/features/card/GameCard';
import { NativeCardReader } from '@/features/deck/NativeCardReader';
import { qk } from '@/lib/query/keys';

export default function NativeSavedCardsPage() {
  const [params, setParams] = useSearchParams();
  const selectedId = params.get('card');
  // Keep the open research snapshot after unsaving; removal is only collection membership.
  const [opened, setOpened] = useState<CardWithCompany | null>(null);
  const opener = useRef<HTMLElement | null>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const qc = useQueryClient();
  const cards = useQuery({
    queryKey: qk.savedCards,
    networkMode: 'always',
    queryFn: () => {
      if (!window.mi?.listSavedCards) throw new Error('Native collection is unavailable.');
      return window.mi.listSavedCards();
    },
  });
  const markets = useQuery({
    queryKey: qk.markets,
    enabled: !!window.mi?.listMarkets,
    networkMode: 'always',
    queryFn: () => window.mi!.listMarkets(),
  });
  const runs = useQuery({
    queryKey: ['native-runs'],
    enabled: !!window.mi?.listNativeRuns,
    networkMode: 'always',
    staleTime: 0,
    queryFn: () => window.mi!.listNativeRuns!(),
    refetchInterval: (query) =>
      selectedId && query.state.data?.some((run) => ['queued', 'running'].includes(run.status))
        ? 1000
        : false,
  });
  useEffect(
    () =>
      window.mi?.onDeckRefresh?.(() => {
        void qc.invalidateQueries({ queryKey: qk.savedCards });
        void qc.invalidateQueries({ queryKey: qk.markets });
        void qc.invalidateQueries({ queryKey: ['native-runs'] });
        if (selectedId)
          void qc.invalidateQueries({ queryKey: ['native-card-evidence', selectedId] });
      }),
    [qc, selectedId],
  );
  const selected = selectedId
    ? opened?.card.id === selectedId
      ? opened
      : (cards.data?.find((entry) => entry.card.id === selectedId) ?? null)
    : null;
  useEffect(() => {
    // Direct entry resolves from the saved list, but removal must not discard its reader.
    if (selected && opened?.card.id !== selected.card.id) setOpened(selected);
  }, [selected, opened?.card.id]);
  const run = runs.data?.find((item) => item.deckId === selected?.card.deckId);
  return (
    <section className="mx-auto max-w-6xl">
      <header className="mb-7">
        <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-primary">
          Your collection
        </p>
        <h1
          ref={heading}
          tabIndex={-1}
          className="mt-1 font-display text-[32px] font-semibold tracking-[-0.03em] text-content"
        >
          Saved cards
        </h1>
        <p className="mt-1 text-sm text-muted">
          Your local shortlist across markets. Each card keeps its original deck, role and sources.
        </p>
        {cards.data && (
          <p className="mt-2 text-xs text-muted">
            {cards.data.length} saved {cards.data.length === 1 ? 'card' : 'cards'}
          </p>
        )}
      </header>
      {window.mi?.researchProvenance === 'synthetic_fixture' && (
        <p
          role="status"
          className="mb-5 rounded-xl border border-amber-300 bg-amber-50 p-4 font-semibold text-amber-950"
        >
          Synthetic fixture collection · No provider calls or live research.
        </p>
      )}
      {window.mi?.nativeResearchWritable === false && (
        <p className="mb-5 text-sm text-muted">
          Collection changes are disabled in this read-only workspace. Saved cards and sources
          remain readable.
        </p>
      )}
      {cards.isLoading && <p role="status">Opening saved cards…</p>}
      {cards.isError && (
        <p role="alert" className="mb-5 text-sm text-amber-800">
          Saved cards could not be read. Any previously loaded cards remain available.
          <Button
            variant="ghost"
            size="sm"
            disabled={cards.isFetching}
            onClick={() => void cards.refetch()}
          >
            Retry saved cards
          </Button>
        </p>
      )}
      {(markets.isError || runs.isError) && (
        <p className="mb-5 text-xs text-muted">
          Some market context could not be read. Cards and retained sources remain available.
        </p>
      )}
      {cards.isSuccess && !cards.data.length && (
        <div className="rounded-xl border border-dashed border-border p-10 text-center">
          <h2 className="font-display text-lg">No saved cards yet</h2>
          <p className="mt-2 text-sm text-muted">
            Open a card from a deck and choose Save card to keep it here.
          </p>
          <Link to="/library" className="mt-3 inline-block text-sm text-primary underline">
            Browse Library
          </Link>
        </div>
      )}
      <div className="grid gap-7 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {(cards.data ?? []).map((entry) => {
          const sourceRun = runs.data?.find((item) => item.deckId === entry.card.deckId);
          const market = markets.data?.find((item) => item.id === sourceRun?.marketId);
          return (
            <article key={entry.card.id}>
              <GameCard
                data={entry}
                hideActions
                onOpen={() => {
                  opener.current =
                    document.activeElement instanceof HTMLElement ? document.activeElement : null;
                  setOpened(entry);
                  const next = new URLSearchParams(params);
                  next.set('card', entry.card.id);
                  setParams(next);
                }}
              />
              <p className="mt-3 text-xs text-muted">
                {market?.name ?? sourceRun?.scope.goal ?? `Source deck ${entry.card.deckId}`}
              </p>
              {sourceRun && (
                <Link
                  className="mt-1 inline-block text-xs text-primary underline"
                  to={`/markets/${encodeURIComponent(sourceRun.marketId)}/deck?${new URLSearchParams({ card: entry.card.id, type: entry.card.cardType })}`}
                >
                  Open source deck
                </Link>
              )}
            </article>
          );
        })}
      </div>
      <NativeCardReader
        card={selected}
        sourceDeckName={
          markets.data?.find((item) => item.id === run?.marketId)?.name ?? run?.scope.goal
        }
        returnFocus={opener.current}
        fallbackFocus={heading.current}
        active={['queued', 'running'].includes(run?.status ?? '')}
        onClose={() => {
          const next = new URLSearchParams(params);
          next.delete('card');
          setParams(next);
        }}
      />
    </section>
  );
}
