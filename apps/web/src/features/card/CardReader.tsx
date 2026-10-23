import { useCallback, useLayoutEffect, useRef, useState, type KeyboardEvent } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, ArrowRight, ArrowUpRight, ExternalLink, FilePlus2, Printer, Share2 } from 'lucide-react';
import type { CardWithCompany } from '@mi/contracts';
import { Dialog, DialogContent, DialogTitle, DialogDescription } from '@/components/ui/Modal';
import { useMarket, useRemoveCard } from '@/hooks/data';
import { useSupports } from '@/lib/repository/RepositoryProvider';
import { useRepository } from '@/lib/repository/RepositoryProvider';
import { buildCardShare } from '@/lib/share/codec';
import { verifyCardForShare } from '@/lib/share/preflight';
import { ShareDialog } from '@/features/share/ShareDialog';
import { ReportWizard } from '@/features/reports/ReportWizard';
import { useCompanyReportRun } from '@/features/reports/useCompanyReportRun';
import { FollowTodayButton } from '@/features/today/FollowTodayButton';
import { useDeepDive } from '@/features/deepdive/DeepDive';
import { CardStage } from './CardStage';
import { DropInResearch } from './DropInResearch';
import { cardAskSeed } from '@/features/deepdive/askSeed';
import { SaveCardButton } from './GameCard';
import { SignalFinding } from './SignalFinding';
import { SignalBriefBody, sourcedPoints, useSignalBrief } from './SignalBriefView';
import { buildCardView, sourceUrl } from './card-view';
import { buildCompanySummary } from './companySummary';
import { printScoped } from '@/lib/print';
import { useReadOnly } from '@/lib/readOnly';
import { sourceHref } from '@/lib/sourceHref';

type Props = {
  data: CardWithCompany | null; open: boolean; onOpenChange: (open: boolean) => void;
  marketId?: string; position?: number; total?: number;
  deckView?: string;
  onPrevious?: () => void; onNext?: () => void;
  /** At the last card of a lane: moves on to the next lane instead of a dead Next. */
  onNextLane?: () => void;
  /** The control that should regain focus when the reader closes on this card. */
  returnFocusTo?: (cardId: string) => HTMLElement | null;
};

const pendingCompanySnapshot = 'No source-backed company snapshot is ready yet.';

export function CardReader({ data, open, returnFocusTo, ...props }: Props) {
  // The reader is opened by URL state rather than a Radix trigger, so Radix
  // has nothing to hand focus back to and drops it on <body>. Remember what
  // was focused at open and restore it — or the caller's element for the card
  // last shown, so Prev/Next browsing returns to the card the reader ended on.
  const showing = open && data !== null;
  const showingRef = useRef(showing);
  const openerRef = useRef<HTMLElement | null>(null);
  useLayoutEffect(() => {
    if (showing && !showingRef.current) {
      openerRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    }
    showingRef.current = showing;
  }, [showing]);
  const restoreFocus = useCallback((event: Event, cardId: string) => {
    // Radix's own fallback is its (absent) trigger; take over either way.
    event.preventDefault();
    // Prev/Next remounts the reader for the new card: focus stays inside it.
    if (showingRef.current) return;
    // Only recover LOST focus — never steal it from whatever took over on
    // close (a chat panel, a route the reader linked to).
    if (document.activeElement && document.activeElement !== document.body) return;
    const target = returnFocusTo?.(cardId) ?? openerRef.current;
    if (target?.isConnected) target.focus();
  }, [returnFocusTo]);
  if (!data) return null;
  return <CardReaderBody key={data.card.id} data={data} open={open} onRestoreFocus={restoreFocus} {...props} />;
}

/** Left/Right browse the deck from the keyboard, but never while someone is typing or using a control that owns the arrows. */
function browseWithArrows(onPrevious?: () => void, onNext?: () => void) {
  return (event: KeyboardEvent) => {
    if (event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
    const target = event.target instanceof HTMLElement ? event.target : null;
    if (target?.closest('input, textarea, select, [contenteditable="true"], [role="tablist"], [role="slider"], [role="radiogroup"]')) return;
    const go = event.key === 'ArrowLeft' ? onPrevious : event.key === 'ArrowRight' ? onNext : undefined;
    if (!go) return;
    event.preventDefault();
    go();
  };
}

function CardReaderBody({ data, open, onOpenChange, marketId,
  deckView, position, total, onPrevious, onNext, onNextLane, onRestoreFocus }: Omit<Props, 'data' | 'returnFocusTo'> & {
  data: CardWithCompany; onRestoreFocus: (event: Event, cardId: string) => void;
}) {
  const { card, company } = data;
  const view = buildCardView(data);
  const marketName = useMarket(marketId).data?.name ?? null;
  const repo = useRepository();
  const { chat } = useDeepDive();
  const readOnly = useReadOnly();
  // What the card already has: read from storage, free, never a model call.
  const memory = useQuery({
    queryKey: ['cardMemory', card.id],
    queryFn: () => repo.getCardMemory!(card.id),
    enabled: typeof repo.getCardMemory === 'function' && !readOnly,
  });
  const chatCount = memory.data?.threads.length ?? 0;
  const reportCount = memory.data?.reports.length ?? 0;
  const memoryLine = [
    `${chatCount} ${chatCount === 1 ? 'chat' : 'chats'}`,
    reportCount > 0 ? `${reportCount} ${reportCount === 1 ? 'report' : 'reports'}` : null,
  ].filter(Boolean).join(' \u00b7 ');
  const [shareOpen, setShareOpen] = useState(false);
  const [reportOpen, setReportOpen] = useState(false);
  const runCompanyReport = useCompanyReportRun();
  const canReport = useSupports('generateReport');
  const briefControls = useSignalBrief(card.id, view.signal);
  const briefShown = briefControls.state.status === 'ready' && sourcedPoints(briefControls.state.brief).length > 0;
  const canRemove = useSupports('removeCard');
  const removeCard = useRemoveCard();
  const [confirmRemove, setConfirmRemove] = useState(false);
  const dashboardUrl = company && !view.signal ? `/company/${company.id}/dashboard/overview?${new URLSearchParams({
    ...(marketId ? { deck: marketId } : {}), card: card.id, ...(deckView ? { view: deckView } : {}),
  })}` : null;
  const companySite = sourceUrl(company?.websiteUrl);
  const summary = card.summary?.trim() || view.description?.trim();
  const summarySources = (card.citations ?? []).filter((citation) => sourceUrl(citation.url)).slice(0, 2);
  const companySummary = view.signal ? null : buildCompanySummary({
    name: view.title, summary, hqLocation: company?.hqLocation, foundedYear: company?.founded?.year ?? null,
    items: view.faceMetrics, descriptionSources: summarySources,
  });

  return <Dialog open={open} onOpenChange={onOpenChange}>
    <DialogContent size="2xl" className="card-inspector"
      onCloseAutoFocus={(event) => onRestoreFocus(event, card.id)}
      onKeyDown={browseWithArrows(onPrevious, onNext)}>
      <DialogTitle className="sr-only">Inspect {view.title} card</DialogTitle>
      <DialogDescription className="sr-only">
        A concise research summary with sourced figures. Open the full dashboard for deeper evidence and analysis.
      </DialogDescription>
      <div className="card-inspector__layout">
        <CardStage data={data} view={view} />
        <div className="card-inspector__detail">
          <div className="card-inspector__scroll">
          <div className="flex items-center justify-between gap-3 pr-8">
            <span className="text-[10px] font-semibold uppercase tracking-[.16em] text-muted">From your research deck</span>
            <span className="text-[11px] text-muted">{position && total ? `${position} of ${total}` : view.type}</span>
          </div>
          <h2 className="mt-3 font-display text-2xl font-semibold leading-tight text-content">{view.title}</h2>
          {company?.hqLocation && <p className="mt-1 text-[11px] text-muted">{company.hqLocation}</p>}
          <p className="mt-1 text-[11px] text-muted" data-testid="card-reader-provenance">
            {view.position} · {view.sourceCount > 0 ? `${view.sourceCount} ${view.sourceCount === 1 ? 'source' : 'sources'} tracked` : 'Research needed'}
          </p>

          {view.signal ? <>{briefShown ? <SignalBriefBody controls={briefControls} /> : <><SignalFinding data={data} citations={view.citations} /><SignalBriefBody controls={briefControls} /></>}</> : <section className="card-inspector__summary" aria-label="Company summary">
            <p className="text-[10px] font-semibold uppercase tracking-widest text-muted">Summary</p>
            <p className="card-inspector__prose">
              {companySummary?.sentences.map((sentence, index) => <span key={index}>{sentence}{' '}</span>)}
            </p>
            {companySummary && (companySummary.sources.length > 0 || companySite) && <div className="card-inspector__summary-sources">
              <span>Sources</span>
              {companySummary.sources.map((source) => <a key={source.url} href={sourceHref(source.url, source.title)}
                target="_blank" rel="noopener noreferrer"
                aria-label={source.labels.length > 0 ? `Source for ${source.labels.join(', ')}: ${source.publisher}` : `Source: ${source.publisher}`}>
                {source.publisher} <ExternalLink size={10} aria-hidden="true" />
              </a>)}
              {companySite && <a href={companySite} target="_blank" rel="noopener noreferrer">
                Company website <ExternalLink size={10} aria-hidden="true" />
              </a>}
            </div>}
            {summary && summary !== pendingCompanySnapshot && summarySources.length === 0 && <span className="card-inspector__summary-warning">
              No source receipt is attached to this summary.
            </span>}
          </section>}

          {company && !view.signal && !readOnly && <DropInResearch companyId={company.id} companyName={company.name} />}
          </div>

          {/* Route departure unmounts the reader. Closing it separately also
              navigates the deck query and competes with this destination. */}
          {dashboardUrl ? <Link to={dashboardUrl} className="card-inspector__cta">
            <span>Open full company dashboard</span><ArrowUpRight size={17} />
          </Link> : !readOnly && <button type="button" className="card-inspector__cta" onClick={() => {
            onOpenChange(false);
            // With history the button resumes the latest conversation (no question); with none it starts one.
            // view.title is never null (a company card has no title of its own, so card.title would read "null").
            chat({ kind: 'cards', deckId: card.deckId, cardIds: [card.id], subject: view.title },
              chatCount > 0 ? undefined : { seed: cardAskSeed(view.title) ?? undefined });
          }}>{chatCount > 0 ? <span className="flex flex-col items-start text-left">
              <span>Continue conversation ({chatCount})</span>
              <span className="text-[11px] font-normal opacity-80">{memoryLine}</span>
            </span> : 'Ask about this finding'} <ArrowUpRight size={17} /></button>}
          <div className="card-inspector__actions">
            {readOnly ? <span /> : <div className="flex items-center gap-1"><SaveCardButton cardId={card.id} />
              {company && !view.signal && <FollowTodayButton companyId={company.id} companyName={company.name} />}
              <button type="button" className="card-control" aria-label="Share card" onClick={() => setShareOpen(true)}><Share2 size={15} /></button>
              {view.signal && <button type="button" className="card-control" aria-label="Save as PDF" title="Save this finding as a PDF" onClick={printScoped}><Printer size={15} /></button>}
              {canReport && company && dashboardUrl && (
                <button type="button" className="card-control" aria-label="Create report" title={`Create a report on ${company.name}`}
                  onClick={() => setReportOpen(true)}><FilePlus2 size={15} /></button>
              )}
              <span className="ml-2 text-[11px] text-muted">{canReport && company && dashboardUrl ? 'Keep, share or write up this company' : 'Keep or share this card'}</span></div>}
            {canRemove && !readOnly && (confirmRemove ? (
              <span className="flex items-center gap-2 text-[11px]">
                <span className="text-muted">Remove {view.title} from this deck?</span>
                <button type="button" className="font-semibold text-negative hover:underline" disabled={removeCard.isPending}
                  onClick={() => removeCard.mutate(card.id, { onSuccess: () => onOpenChange(false) })}>
                  {removeCard.isPending ? 'Removing…' : 'Remove'}
                </button>
                <button type="button" className="text-muted hover:underline" onClick={() => setConfirmRemove(false)}>Cancel</button>
              </span>
            ) : (
              <button type="button" className="text-[11px] text-muted hover:text-negative hover:underline"
                title="Take this card out of the deck if it doesn't belong in this market. It won't be added back."
                onClick={() => setConfirmRemove(true)}>
                Doesn’t belong here
              </button>
            ))}
            {(onPrevious || onNext || onNextLane) && <div className="flex items-center gap-1">
              <button type="button" className="card-control" aria-label="Previous card" onClick={onPrevious} disabled={!onPrevious}><ArrowLeft size={15} /></button>
              {!onNext && onNextLane
                ? <button type="button" className="card-control w-auto shrink-0 grid-flow-col gap-1 whitespace-nowrap px-3 text-[11px]" aria-label="Next lane" onClick={onNextLane}>Next lane <ArrowRight size={15} /></button>
                : <button type="button" className="card-control" aria-label="Next card" onClick={onNext} disabled={!onNext}><ArrowRight size={15} /></button>}
            </div>}
          </div>
        </div>
      </div>
      {canReport && company && dashboardUrl && (
        <ReportWizard open={reportOpen} onOpenChange={setReportOpen} companyId={company.id} companyName={company.name}
          cardId={card.id} deckId={card.deckId}
          onStart={(input) => { void runCompanyReport({ companyId: company.id, companyName: company.name, ...input }); }} />
      )}
      <ShareDialog open={shareOpen} onOpenChange={setShareOpen} title={view.title}
        page={{ deckId: card.deckId, cardId: card.id }}
        subtitle={marketName ? `${marketName} — market research snapshot` : 'Market research snapshot'}
        build={async (onStage) => {
          const fresh = await verifyCardForShare(repo, data, onStage);
          return buildCardShare(fresh, marketName);
        }} />
    </DialogContent>
  </Dialog>;
}
