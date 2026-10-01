import { useEffect, useId, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { CardWithCompany, NativeCardEvidence } from '@mi/contracts';
import { buildCardView, sourceUrl } from '@/features/card/card-view';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/Modal';
import { Button } from '@/components/ui/button';
import { qk } from '@/lib/query/keys';

type Source = NativeCardEvidence['sources'][number];
const captureDate = new Intl.DateTimeFormat(undefined, {
  year: 'numeric',
  month: 'short',
  day: 'numeric',
  hour: 'numeric',
  minute: '2-digit',
  timeZoneName: 'short',
});
const SOURCE_STATES: Record<Source['retrievalStatus'], string> = {
  lead_only: 'Lead only · not captured',
  retrieved: 'Retrieved · support unreviewed',
  partial: 'Partial capture · support unreviewed',
  failed: 'Capture failed · no retained text',
  blocked: 'Capture blocked · no retained text',
};
function SavedSource({ source }: { source: Source }) {
  const [expanded, setExpanded] = useState(false);
  const excerptId = useId();
  const candidate = sourceUrl(source.url);
  const url =
    candidate && !new URL(candidate).username && !new URL(candidate).password ? candidate : null;
  const label = source.title || (url ? new URL(url).hostname : 'Unavailable source URL');
  const retained = ['retrieved', 'partial'].includes(source.retrievalStatus) && !!source.text;
  return (
    <li className="rounded-xl border border-border bg-surface p-4">
      {url ? (
        <a
          href={url}
          target="_blank"
          rel="noopener noreferrer"
          className="break-words font-semibold text-primary underline"
        >
          {label}
        </a>
      ) : (
        <span className="break-words font-semibold">{label}</span>
      )}
      <p className="mt-1 text-xs text-muted">{SOURCE_STATES[source.retrievalStatus]}</p>
      <p className="mt-1 text-xs text-muted">
        {source.fetchedAt ? (
          <>
            Captured:{' '}
            <time dateTime={source.fetchedAt} title={source.fetchedAt}>
              {captureDate.format(new Date(source.fetchedAt))}
            </time>
          </>
        ) : (
          'No capture date recorded'
        )}
      </p>
      {retained && (
        <>
          <Button
            variant="ghost"
            size="sm"
            className="mt-3"
            aria-expanded={expanded}
            aria-controls={excerptId}
            onClick={() => setExpanded(!expanded)}
          >
            {expanded ? 'Hide retained text' : 'Show retained text'}
          </Button>
          {expanded && (
            <div id={excerptId} className="mt-3 rounded-lg border border-border bg-surface-2 p-5">
              <p className="mb-3 text-xs text-muted">Saved plain text · unreviewed</p>
              <p className="max-h-80 overflow-y-auto whitespace-pre-wrap break-words font-serif leading-7 text-content">
                {source.text}
              </p>
            </div>
          )}
        </>
      )}
    </li>
  );
}
function NativeCardSources({
  cardId,
  leads,
  active,
}: {
  cardId: string;
  leads: { url: string; title: string }[];
  active: boolean;
}) {
  const evidence = useQuery({
    queryKey: ['native-card-evidence', cardId],
    enabled: !!window.mi?.getNativeCardEvidence,
    // Local IPC remains readable offline. This is never a page/provider retrieval endpoint.
    networkMode: 'always',
    staleTime: 30_000,
    queryFn: async () => {
      const saved = await window.mi!.getNativeCardEvidence!(cardId);
      if (saved.cardId !== cardId) throw new Error('Saved evidence belongs to a different card.');
      return saved;
    },
    refetchInterval: active ? 1000 : false,
  });
  const wasActive = useRef(active);
  const { refetch } = evidence;
  useEffect(() => {
    // Drain the final saved receipt when completion stops polling.
    if (wasActive.current && !active && window.mi?.getNativeCardEvidence) void refetch();
    wasActive.current = active;
  }, [active, refetch]);
  const sources: Source[] = evidence.data?.sources.length
    ? evidence.data.sources
    : leads.map((lead) => ({
        ...lead,
        retrievalStatus: 'lead_only',
        fetchedAt: null,
        text: null,
        sourceId: null,
        sourceRevision: null,
        passageId: null,
        support: 'unreviewed',
      }));
  return (
    <section
      aria-label="Source evidence"
      className="rounded-xl border border-border bg-surface-2 p-5"
    >
      <h2 className="font-display text-lg font-semibold">Sources to inspect</h2>
      <p className="mt-2 text-xs text-muted">
        Saved source material only. Capture does not verify a claim or its exact passage support.
        Opening this reader never fetches a public page or calls a provider.
      </p>
      {!window.mi?.getNativeCardEvidence && (
        <p className="mt-2 text-xs text-muted">
          Saved page evidence is unavailable in this bridge. These links are leads only.
        </p>
      )}
      {evidence.isFetching && !evidence.data && (
        <p role="status" className="mt-2 text-xs text-muted">
          Reading saved source evidence…
        </p>
      )}
      {evidence.isError && (
        <p role="alert" className="mt-2 text-sm text-amber-800">
          Saved source evidence could not be read. Citation leads and any previously retained text
          remain available.
        </p>
      )}
      {sources.length ? (
        <ul className="mt-4 space-y-3">
          {sources.map((source, index) => (
            <SavedSource key={`${cardId}:${source.url}:${index}`} source={source} />
          ))}
        </ul>
      ) : (
        <p className="mt-3 text-muted">
          No source links or page text were retained for this result.
        </p>
      )}
    </section>
  );
}

type ReaderProps = {
  card: CardWithCompany | null;
  onClose: () => void;
  active?: boolean;
  returnFocus?: HTMLElement | null;
  fallbackFocus?: HTMLElement | null;
};

function ReaderContent({
  card,
  active = false,
  returnFocus,
  fallbackFocus,
}: Omit<ReaderProps, 'card' | 'onClose'> & { card: CardWithCompany }) {
  const view = buildCardView(card);
  const fixture = window.mi?.researchProvenance === 'synthetic_fixture';
  const readonly = window.mi?.nativeResearchWritable === false;
  const qc = useQueryClient();
  const [message, setMessage] = useState('');
  const reasonId = useId();
  const saved = useQuery({
    queryKey: qk.savedCards,
    queryFn: () => window.mi!.listSavedCards(),
    enabled: !!window.mi?.listSavedCards,
    networkMode: 'always',
  });
  const isSaved = saved.data?.some((entry) => entry.card.id === card.card.id) ?? false;
  const change = useMutation({
    networkMode: 'always',
    mutationFn: async (remove: boolean) => {
      if (window.mi?.nativeResearchWritable === false)
        throw new Error('This native workspace is read-only.');
      if (remove) {
        if (!window.mi?.unsaveCard) throw new Error('Collection removal is unavailable.');
        await window.mi.unsaveCard(card.card.id);
      } else {
        if (!window.mi?.saveCard) throw new Error('Collection saving is unavailable.');
        const receipt = await window.mi.saveCard(card.card.id);
        if (receipt.cardId !== card.card.id)
          throw new Error('The save receipt belongs to a different card.');
      }
    },
    onMutate: () => {
      setMessage('');
    },
    onSuccess: async (_result, removed) => {
      setMessage(
        removed
          ? 'Removed from saved. Research and sources remain in the original deck.'
          : 'Card saved to your collection.',
      );
      await qc.invalidateQueries({ queryKey: qk.savedCards });
    },
  });
  const unavailable = !window.mi?.listSavedCards || !window.mi?.saveCard || !window.mi?.unsaveCard;
  const disabled = readonly || unavailable || saved.isPending || saved.isError || change.isPending;
  return (
    <DialogContent
      size="2xl"
      onCloseAutoFocus={(event) => {
        const target = returnFocus?.isConnected ? returnFocus : fallbackFocus;
        if (target?.isConnected) {
          event.preventDefault();
          target.focus();
        }
      }}
    >
      <DialogTitle>{view.title}</DialogTitle>
      <DialogDescription>
        {fixture && 'Synthetic fixture material · no live research. '}
        Research retained from this bounded pass. Source links are research leads; exact passage
        support is still pending.
      </DialogDescription>
      <div className="mt-5 space-y-5 text-sm leading-6">
        <p className="text-xs text-muted">
          {view.type} · Source deck {card.card.deckId}
        </p>
        <div className="rounded-xl border border-border bg-surface-2 p-4">
          <div className="flex flex-wrap gap-2">
            <Button
              variant="ghost"
              size="sm"
              disabled={disabled}
              aria-describedby={reasonId}
              onClick={() => change.mutate(isSaved)}
            >
              {isSaved ? 'Remove from saved' : 'Save card'}
            </Button>
            {message.startsWith('Removed from saved.') && !isSaved && (
              <Button
                variant="ghost"
                size="sm"
                disabled={disabled}
                aria-describedby={reasonId}
                onClick={() => change.mutate(false)}
              >
                Undo removal
              </Button>
            )}
          </div>
          <p id={reasonId} className="mt-2 text-xs text-muted">
            {readonly
              ? 'Collection changes are disabled in this read-only workspace. Saved cards and sources remain readable.'
              : unavailable
                ? 'Collection actions are unavailable in this native bridge.'
                : 'Saving keeps this exact card in your local collection. Removing it does not delete research or sources.'}
          </p>
          {saved.isLoading && (
            <p role="status" className="mt-2 text-xs text-muted">
              Checking saved collection…
            </p>
          )}
          {saved.isError && (
            <p role="alert" className="mt-2 text-sm text-amber-800">
              Saved collection status could not be read. No collection change will be sent.
              <Button variant="link" size="sm" onClick={() => void saved.refetch()}>
                Retry saved status
              </Button>
            </p>
          )}
          {change.isPending && (
            <p role="status" className="mt-2 text-xs text-muted">
              Confirming collection change…
            </p>
          )}
          {message && (
            <p role="status" className="mt-2 text-sm">
              {message}
            </p>
          )}
          {change.isError && (
            <p role="alert" className="mt-2 text-sm text-amber-800">
              Card could not be {change.variables ? 'removed from saved' : 'saved'}.{' '}
              {change.error instanceof Error ? change.error.message : 'Please try again.'}
            </p>
          )}
        </div>
        <p>{view.description}</p>
        {card.card.summary && <p className="whitespace-pre-wrap">{card.card.summary}</p>}
        {!!card.card.keyPoints?.length && (
          <ul className="list-disc space-y-2 pl-5">
            {card.card.keyPoints.map((point, index) => (
              <li key={index}>{point}</li>
            ))}
          </ul>
        )}
        <NativeCardSources cardId={card.card.id} leads={view.citations} active={active} />
        <p className="text-xs text-muted">
          Model-extracted numeric claims have been withheld from the card face until exact evidence
          support is reviewed.
        </p>
      </div>
    </DialogContent>
  );
}

/** Shared native inspector: saved reads only; explicit collection actions never run research. */
export function NativeCardReader({ card, onClose, ...props }: ReaderProps) {
  return (
    <Dialog
      open={!!card}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      {card && <ReaderContent key={card.card.id} card={card} {...props} />}
    </Dialog>
  );
}
