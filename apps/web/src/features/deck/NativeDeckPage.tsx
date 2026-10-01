import { useEffect, useRef, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  CARD_TYPE_LABELS,
  type CardType,
  type NativeResearchEvent,
  type NativeResearchRun,
} from '@mi/contracts';
import { useCards, useDeckByMarket, useMarket } from '@/hooks/data';
import { GameCard } from '@/features/card/GameCard';
import { NativeCardReader } from './NativeCardReader';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { qk } from '@/lib/query/keys';

type EventLog = { after: number; items: NativeResearchEvent[] };
// ponytail: keep the last 200 lightweight activity entries; full history remains in the vault.
const MAX_ACTIVITY = 200;

export default function NativeDeckPage() {
  const { marketId } = useParams();
  const fixture =
    !!window.mi &&
    'researchProvenance' in window.mi &&
    window.mi.researchProvenance === 'synthetic_fixture';
  const market = useMarket(marketId);
  const deck = useDeckByMarket(marketId);
  const cards = useCards(deck.data?.id);
  const [params, setParams] = useSearchParams();
  const selectedId = params.get('card');
  const opener = useRef<HTMLElement | null>(null);
  const searchInput = useRef<HTMLInputElement | null>(null);
  const [error, setError] = useState('');
  const [pending, setPending] = useState(false);
  const qc = useQueryClient();
  const runs = useQuery({
    queryKey: ['native-runs'],
    queryFn: () => window.mi!.listNativeRuns!(),
    staleTime: 0,
    refetchInterval: (query) =>
      query.state.data?.some((run) => ['queued', 'running'].includes(run.status)) ? 1000 : false,
  });
  const run = runs.data?.find((item) => item.marketId === marketId);
  const runId = run?.id;
  const events = useQuery({
    queryKey: ['native-events', runId],
    enabled: !!runId,
    staleTime: 0,
    queryFn: async () => {
      const previous = qc.getQueryData<EventLog>(['native-events', runId]);
      let after = previous?.after ?? 0;
      let items = new Map(previous?.items.map((event) => [event.sequence, event]));
      // A terminal run still drains its remaining bounded pages; no repeated card payloads.
      for (;;) {
        const incoming = await window.mi!.nativeRunEvents!(runId!, after);
        const next = Math.max(after, ...incoming.map((event) => event.sequence));
        for (const event of incoming) {
          if (event.sequence <= after) continue;
          const { message, stage, progress, kind } = event.progress;
          items.set(event.sequence, { ...event, progress: { message, stage, progress, kind } });
        }
        items = new Map([...items.entries()].sort(([a], [b]) => a - b).slice(-MAX_ACTIVITY));
        const advanced = next > after;
        after = next;
        if (incoming.length < 100 || !advanced) break;
      }
      return {
        after,
        items: [...items.values()].sort((a, b) => a.sequence - b.sequence).slice(-MAX_ACTIVITY),
      };
    },
    refetchInterval: ['queued', 'running'].includes(run?.status ?? '') ? 1000 : false,
  });
  useEffect(
    () =>
      window.mi?.onDeckRefresh?.((event) => {
        void qc.invalidateQueries({ queryKey: ['native-runs'] });
        void qc.invalidateQueries({ queryKey: qk.markets });
        if (event.marketId === marketId && runId) {
          void qc.invalidateQueries({ queryKey: ['native-events', runId] });
          if (selectedId)
            void qc.invalidateQueries({ queryKey: ['native-card-evidence', selectedId] });
        }
      }),
    [qc, marketId, runId, selectedId],
  );
  const viewType = params.get('type');
  const search = params.get('q') ?? '';
  const needle = search.trim().toLocaleLowerCase();
  const visible = (cards.data ?? []).filter((entry) => {
    if (viewType && entry.card.cardType !== viewType) return false;
    return (
      !needle ||
      [
        entry.company?.name,
        entry.company?.oneLiner,
        entry.card.title,
        entry.card.summary,
        ...entry.card.keyPoints,
      ]
        .join(' ')
        .toLocaleLowerCase()
        .includes(needle)
    );
  });
  const selected = cards.data?.find((entry) => entry.card.id === selectedId);
  function changeView(name: 'q' | 'type', value: string | null) {
    const next = new URLSearchParams(params);
    if (value) next.set(name, value);
    else next.delete(name);
    next.delete('card');
    // Typing must not leave one browser history entry per keystroke.
    setParams(next, { replace: name === 'q' });
  }
  async function control(command: 'pause' | 'resume' | 'cancel') {
    if (!run || pending) return;
    if (window.mi?.nativeResearchWritable === false) return;
    setPending(true);
    setError('');
    try {
      const changed = await window.mi!.controlNativeRun!(run.id, command);
      qc.setQueryData<NativeResearchRun[]>(['native-runs'], (current = []) => [
        changed,
        ...current.filter((item) => item.id !== changed.id),
      ]);
      await Promise.all([
        qc.invalidateQueries({ queryKey: ['native-runs'] }),
        qc.invalidateQueries({ queryKey: qk.markets }),
        qc.invalidateQueries({ queryKey: ['native-events', run.id] }),
      ]);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'Could not change research.');
    } finally {
      setPending(false);
    }
  }
  if (market.isLoading || deck.isLoading) return <p role="status">Opening saved research…</p>;
  if (market.isError || deck.isError || cards.isError || runs.isError)
    return (
      <p role="alert">
        Saved research could not be opened. <Link to="/library">Return to Library</Link>.
      </p>
    );
  if (!market.data || !deck.data)
    return (
      <p>
        This deck is unavailable. <Link to="/library">Return to Library</Link>.
      </p>
    );
  return (
    <section className="mx-auto max-w-6xl">
      {fixture && (
        <p
          role="status"
          className="mb-5 rounded-xl border border-amber-300 bg-amber-50 p-4 font-semibold text-amber-950"
        >
          Synthetic fixture research · Canned provider responses · No provider calls or live
          research.
        </p>
      )}
      <Link className="text-sm text-muted hover:text-primary" to="/library">
        ← Library
      </Link>
      <header className="mt-5 border-b border-border pb-6">
        <p className="text-xs font-semibold uppercase tracking-widest text-primary-ink">
          Research deck
        </p>
        <h1 className="mt-2 break-words font-display text-3xl font-semibold tracking-tight text-content sm:text-4xl">
          {market.data.name}
        </h1>
        {window.mi?.nativeResearchWritable === false && (
          <p className="mt-3 text-sm text-muted">
            Research is disabled on this provenance-preserving reopen. Saved results are still
            readable.
          </p>
        )}
        <p className="mt-2 text-sm text-muted">
          {cards.data?.length ?? 0} saved cards · Research stays on this machine
        </p>
      </header>
      {run && (
        <div className="my-6 rounded-xl border border-border bg-surface p-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p role="status" className="text-sm font-semibold capitalize">
              Research {run.status}
            </p>
            <div className="flex gap-2">
              {['running', 'queued'].includes(run.status) && (
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={pending || window.mi?.nativeResearchWritable === false}
                  onClick={() => void control('pause')}
                >
                  Pause
                </Button>
              )}
              {['paused', 'failed'].includes(run.status) && (
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={pending || window.mi?.nativeResearchWritable === false}
                  onClick={() => void control('resume')}
                >
                  Resume remaining work
                </Button>
              )}
              {!['completed', 'cancelled'].includes(run.status) && (
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={pending || window.mi?.nativeResearchWritable === false}
                  onClick={() => void control('cancel')}
                >
                  Cancel
                </Button>
              )}
            </div>
          </div>
          <p className="mt-2 text-sm text-muted">
            {events.data?.items.at(-1)?.progress.message ??
              'Your accepted scope and allowance have been saved.'}
          </p>
          {run.error && <p className="mt-2 text-sm text-amber-800">{run.error}</p>}
          <p className="mt-3 text-xs text-muted">
            {run.usage.requests} provider attempts ·{' '}
            {run.usage.sourceRequests == null
              ? 'Source attempts not recorded'
              : `${run.usage.sourceRequests} source attempts`}{' '}
            ·{' '}
            {run.usage.complete
              ? 'reported usage'
              : 'usage may include reserved or unreported tokens'}{' '}
            · Dollar cost not available
          </p>
          <details className="mt-3 text-sm">
            <summary className="cursor-pointer text-muted">Research activity</summary>
            <p className="mt-2 text-xs text-muted">
              Showing up to {MAX_ACTIVITY} recent entries. Earlier activity remains saved in the
              local vault.
            </p>
            {events.isError && (
              <p role="alert">Research activity could not be read. Saved cards remain available.</p>
            )}
            <ol className="mt-3 max-h-56 space-y-2 overflow-y-auto text-muted">
              {events.data?.items.map((event) => (
                <li key={event.sequence}>{event.progress.message}</li>
              ))}
            </ol>
          </details>
        </div>
      )}
      {error && (
        <p role="alert" className="my-3 text-sm text-red-700">
          {error}
        </p>
      )}
      <p className="my-5 text-xs leading-5 text-muted">
        Native research preview: company research is retained. Passage verification, other card
        categories, sharing, questions and monitoring are still being built.
      </p>
      <div className="mb-7 rounded-2xl border border-border bg-surface p-4 sm:p-5">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <h2 className="font-display text-xl font-semibold text-content">Browse this deck</h2>
          <p
            role="status"
            aria-live="polite"
            aria-atomic="true"
            className="rounded-full bg-primary/10 px-3 py-1.5 text-xs font-semibold text-primary-ink"
          >
            {cards.isLoading
              ? 'Loading saved cards…'
              : `Showing ${visible.length} of ${cards.data?.length ?? 0} cards`}
          </p>
        </div>
        <form role="search" onSubmit={(event) => event.preventDefault()}>
          <label
            htmlFor="native-deck-search"
            className="mb-2 block text-sm font-medium text-content"
          >
            Search this deck
          </label>
          <div className="flex flex-wrap items-center gap-2">
            <Input
              ref={searchInput}
              id="native-deck-search"
              type="search"
              value={search}
              placeholder="Company, title or card text"
              aria-describedby="native-deck-search-help"
              className="min-w-0 flex-1 basis-56"
              onChange={(event) => changeView('q', event.target.value)}
            />
            {search && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => {
                  changeView('q', null);
                  searchInput.current?.focus();
                }}
              >
                Clear search
              </Button>
            )}
          </div>
          <p id="native-deck-search-help" className="mt-2 text-xs leading-5 text-muted">
            Search retained names, summaries and card text. No new research is started.
          </p>
        </form>
        <div className="mt-4 border-t border-border pt-4">
          <p className="mb-2 text-xs font-medium text-muted">Card types in this deck</p>
          <div className="flex flex-wrap gap-2" role="group" aria-label="Filter research cards">
            {[null, ...new Set((cards.data ?? []).map((entry) => entry.card.cardType))].map(
              (type) => (
                <Button
                  key={type ?? 'all'}
                  variant={viewType === type || (!viewType && type === null) ? 'blue' : 'ghost'}
                  size="sm"
                  aria-pressed={viewType === type || (!viewType && type === null)}
                  onClick={() => changeView('type', type)}
                >
                  {type ? CARD_TYPE_LABELS[type as CardType] : 'All cards'}
                </Button>
              ),
            )}
          </div>
        </div>
      </div>
      {!cards.isLoading && !visible.length && (
        <div className="rounded-2xl border border-dashed border-border bg-surface p-8 text-center text-sm text-muted sm:p-10">
          {cards.data?.length ? (
            <>
              <h3 className="font-display text-xl font-semibold text-content">
                No cards match your search and filters.
              </h3>
              <p className="mt-2">
                Try another name or card text, or return to all retained cards.
              </p>
              <Button
                variant="ghost"
                className="mt-5"
                onClick={() => {
                  const next = new URLSearchParams(params);
                  next.delete('q');
                  next.delete('type');
                  next.delete('card');
                  setParams(next);
                  searchInput.current?.focus();
                }}
              >
                Reset search and filters
              </Button>
            </>
          ) : ['queued', 'running'].includes(run?.status ?? '') ? (
            'Research is underway. Cards appear after their results have been saved.'
          ) : (
            'No saved cards in this view. Retained activity explains incomplete research.'
          )}
        </div>
      )}
      <div className="grid gap-7 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {visible.map((entry) => (
          <GameCard
            key={entry.card.id}
            data={entry}
            hideActions
            onOpen={() => {
              opener.current =
                document.activeElement instanceof HTMLElement ? document.activeElement : null;
              const next = new URLSearchParams(params);
              next.set('card', entry.card.id);
              setParams(next);
            }}
          />
        ))}
      </div>
      <NativeCardReader
        card={selected ?? null}
        sourceDeckName={market.data.name}
        returnFocus={opener.current}
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
