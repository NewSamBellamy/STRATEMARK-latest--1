import { useEffect, useState } from 'react';
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
import { buildCardView, sourceUrl } from '@/features/card/card-view';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
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
        }
      }),
    [qc, marketId, runId],
  );
  const viewType = params.get('type');
  const visible = (cards.data ?? []).filter(
    (entry) => !viewType || entry.card.cardType === viewType,
  );
  const selected = cards.data?.find((entry) => entry.card.id === params.get('card'));
  const view = selected ? buildCardView(selected) : null;
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
      <h1 className="mt-4 font-display text-3xl font-semibold text-content">{market.data.name}</h1>
      {window.mi?.nativeResearchWritable === false && (
        <p className="mt-3 text-sm text-muted">
          Research is disabled on this provenance-preserving reopen. Saved results are still
          readable.
        </p>
      )}
      <p className="mt-2 text-sm text-muted">
        {cards.data?.length ?? 0} saved cards · Research stays on this machine
      </p>
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
      <p className="mb-5 text-xs leading-5 text-muted">
        Native research preview: company research is retained. Passage verification, other card
        categories, sharing, questions and monitoring are still being built.
      </p>
      <div className="mb-6 flex flex-wrap gap-2" aria-label="Filter research cards">
        {[null, ...new Set((cards.data ?? []).map((entry) => entry.card.cardType))].map((type) => (
          <Button
            key={type ?? 'all'}
            variant={viewType === type || (!viewType && type === null) ? 'blue' : 'ghost'}
            size="sm"
            aria-pressed={viewType === type || (!viewType && type === null)}
            onClick={() => {
              const next = new URLSearchParams(params);
              if (type) next.set('type', type);
              else next.delete('type');
              next.delete('card');
              setParams(next);
            }}
          >
            {type ? CARD_TYPE_LABELS[type as CardType] : 'All cards'}
          </Button>
        ))}
      </div>
      {!visible.length && (
        <div className="rounded-xl border border-dashed border-border p-10 text-center text-sm text-muted">
          {['queued', 'running'].includes(run?.status ?? '')
            ? 'Research is underway. Cards appear after their results have been saved.'
            : 'No saved cards in this view. Retained activity explains incomplete research.'}
        </div>
      )}
      <div className="grid gap-7 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {visible.map((entry) => (
          <GameCard
            key={entry.card.id}
            data={entry}
            hideActions
            onOpen={() => {
              const next = new URLSearchParams(params);
              next.set('card', entry.card.id);
              setParams(next);
            }}
          />
        ))}
      </div>
      <Dialog
        open={!!selected}
        onOpenChange={(open) => {
          if (!open) {
            const next = new URLSearchParams(params);
            next.delete('card');
            setParams(next);
          }
        }}
      >
        <DialogContent size="2xl">
          <DialogTitle>{view?.title ?? 'Saved research'}</DialogTitle>
          <DialogDescription>
            Company research retained from this bounded pass. Source links are research leads; exact
            passage support is still pending.
          </DialogDescription>
          {selected && view && (
            <div className="mt-5 space-y-5 text-sm leading-6">
              <p>{view.description}</p>
              {selected.card.summary && (
                <p className="whitespace-pre-wrap">{selected.card.summary}</p>
              )}
              {!!selected.card.keyPoints?.length && (
                <ul className="list-disc space-y-2 pl-5">
                  {selected.card.keyPoints.map((point, index) => (
                    <li key={index}>{point}</li>
                  ))}
                </ul>
              )}
              <h2 className="font-display text-lg font-semibold">Sources to inspect</h2>
              {view.citations.length ? (
                <ul className="space-y-2">
                  {view.citations.map((citation, index) => (
                    <li key={index}>
                      <a
                        href={sourceUrl(citation.url) ?? undefined}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-primary underline"
                      >
                        {citation.title || new URL(citation.url).hostname}
                      </a>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-muted">No source links were retained for this result.</p>
              )}
              <p className="text-xs text-muted">
                Model-extracted numeric claims have been withheld from the card face until exact
                evidence support is reviewed.
              </p>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </section>
  );
}
