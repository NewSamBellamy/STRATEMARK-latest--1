import { useCallback, useLayoutEffect, useRef, useState, type KeyboardEvent } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft, ArrowRight, ArrowUpRight, BookOpen, ExternalLink, FilePlus2, Printer, Share2 } from 'lucide-react';
import { publisherOf, type CardWithCompany } from '@mi/contracts';
import { Dialog, DialogContent, DialogTitle, DialogDescription } from '@/components/ui/Modal';
import { useMarket, useRemoveCard } from '@/hooks/data';
import { useSupports } from '@/lib/repository/RepositoryProvider';
import { useRepository } from '@/lib/repository/RepositoryProvider';
import { buildCardShare, buildReportShare } from '@/lib/share/codec';
import { verifyCardForShare } from '@/lib/share/preflight';
import { ShareDialog } from '@/features/share/ShareDialog';
import { ReportBuilderDialog } from '@/features/reports/ReportBuilderDialog';
import { useCompanyReportRun } from '@/features/reports/useCompanyReportRun';
import { FollowTodayButton } from '@/features/today/FollowTodayButton';
import { useDeepDive } from '@/features/deepdive/DeepDive';
import { CardStage } from './CardStage';
import { SaveCardButton } from './GameCard';
import { ViceDisclaimer } from './CardDisclaimer';
import { buildCardView, faceFigureStatus, sourceUrl } from './card-view';
import { printScoped } from '@/lib/print';
import { useReadOnly } from '@/lib/readOnly';
import { sourceHref } from '@/lib/sourceHref';
import { SafeLink } from '@/components/SafeLink';

type Props = {
  data: CardWithCompany | null; open: boolean; onOpenChange: (open: boolean) => void;
  marketId?: string; position?: number; total?: number;
  deckView?: string;
  onPrevious?: () => void; onNext?: () => void;
  /** The control that should regain focus when the reader closes on this card. */
  returnFocusTo?: (cardId: string) => HTMLElement | null;
};

const capturedDate = new Intl.DateTimeFormat('en-US', {
  month: 'short', day: 'numeric', year: 'numeric',
});
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
  deckView, position, total, onPrevious, onNext, onRestoreFocus }: Omit<Props, 'data' | 'returnFocusTo'> & {
  data: CardWithCompany; onRestoreFocus: (event: Event, cardId: string) => void;
}) {
  const { card, company, viceClaims } = data;
  const view = buildCardView(data);
  const marketName = useMarket(marketId).data?.name ?? null;
  const repo = useRepository();
  const { chat } = useDeepDive();
  const readOnly = useReadOnly();
  const [shareOpen, setShareOpen] = useState(false);
  const [reportOpen, setReportOpen] = useState(false);
  const runCompanyReport = useCompanyReportRun();
  const canReport = useSupports('generateReport');
  const [fullFinding, setFullFinding] = useState(false);
  const canRemove = useSupports('removeCard');
  const removeCard = useRemoveCard();
  const [confirmRemove, setConfirmRemove] = useState(false);
  const dashboardUrl = company && !view.signal ? `/company/${company.id}/dashboard/overview?${new URLSearchParams({
    ...(marketId ? { deck: marketId } : {}), card: card.id, ...(deckView ? { view: deckView } : {}),
  })}` : null;
  const companySite = sourceUrl(company?.websiteUrl);
  const summary = card.summary?.trim() || view.description?.trim();
  const summarySources = (card.citations ?? []).filter((citation) => sourceUrl(citation.url)).slice(0, 2);
  const findingPoints = card.cardType === 'vice'
    ? viceClaims.map((claim) => claim.claimText)
    : card.keyPoints;
  // The first click should add detail, not repeat the front's one-liner.
  const previewSummary = view.signal && summary === view.description?.trim()
    ? findingPoints.find((point) => ![summary, view.frontDescription?.trim(), view.frontFinding?.trim()].includes(point.trim()))?.trim()
    : summary;
  const previewPoints = findingPoints.filter((point) => ![previewSummary, view.frontDescription?.trim(), view.frontFinding?.trim()].includes(point.trim()));
  const findingMarkdown = [
    `# ${view.title}`,
    summary ?? '',
    findingPoints.length ? `## What the research shows\n\n${findingPoints.map((point) => `- ${point}`).join('\n')}` : '',
    view.citations.length ? `## Sources\n\n${view.citations.map((citation) =>
      `- [${citation.title || publisherOf(citation.url, citation.title)}](${citation.url})`).join('\n')}` : '',
  ].filter(Boolean).join('\n\n');

  return <Dialog open={open} onOpenChange={onOpenChange}>
    <DialogContent size="2xl" className={fullFinding ? 'card-inspector card-inspector--report' : 'card-inspector'}
      onCloseAutoFocus={(event) => onRestoreFocus(event, card.id)}
      onKeyDown={browseWithArrows(onPrevious, onNext)}>
      <DialogTitle className="sr-only">Inspect {view.title} card</DialogTitle>
      <DialogDescription className="sr-only">
        A concise research summary with sourced figures. Open the full dashboard for deeper evidence and analysis.
      </DialogDescription>
      <div className="card-inspector__layout">
        {!fullFinding && <CardStage data={data} view={view} />}
        <div className="card-inspector__detail">
          <div className="flex items-center justify-between gap-3 pr-8">
            <span className="text-[10px] font-semibold uppercase tracking-[.16em] text-muted">From your research deck</span>
            <span className="text-[11px] text-muted">{position && total ? `${position} of ${total}` : view.type}</span>
          </div>
          {!fullFinding && <>
            <h2 className="mt-3 font-display text-2xl font-semibold leading-tight text-content">{view.title}</h2>
            {company?.hqLocation && <p className="mt-1 text-[11px] text-muted">{company.hqLocation}</p>}

            <section className="card-inspector__summary" aria-label="Research summary">
              <p className="text-[10px] font-semibold uppercase tracking-widest text-muted">
                {view.signal ? 'Research finding' : 'Company snapshot'}
              </p>
              <p className="card-inspector__summary-text text-[13px] leading-relaxed text-content">
                {previewSummary || (view.signal ? 'No extended finding has been recorded yet.' : 'No concise research summary has been recorded for this card.')}
              </p>
              {companySite && <a className="card-inspector__site" href={companySite} target="_blank" rel="noopener noreferrer">
                Company website <ExternalLink size={11} aria-hidden="true" />
              </a>}
              {summarySources.length > 0 ? <div className="card-inspector__summary-sources">
                <span>Related sources</span>
                {summarySources.map((citation) => <a key={citation.url} href={sourceHref(citation.url, citation.title)}
                  target="_blank" rel="noopener noreferrer">
                  {publisherOf(citation.url, citation.title)} <ExternalLink size={10} aria-hidden="true" />
                </a>)}
              </div> : summary && summary !== pendingCompanySnapshot && <span className="card-inspector__summary-warning">
                No source receipt is attached to this summary.
              </span>}
            </section>
          </>}

          {!view.signal && <section className="card-inspector__fact-section" aria-label="Core company figures">
            <div className="flex items-baseline justify-between gap-2">
              <p className="text-[10px] font-semibold uppercase tracking-widest text-muted">Core company figures</p>
              <span className="text-[9px] text-muted">Source receipts</span>
            </div>
            <ul className="card-inspector__facts">
              {view.faceMetrics.map((item) => {
                const metric = item.metric;
                const citation = item.citations[0];
                const status = faceFigureStatus(item);
                const date = metric ? new Date(metric.capturedAt) : null;
                const formattedDate = date && Number.isFinite(date.getTime()) ? capturedDate.format(date) : null;

                return <li className="card-inspector__fact" key={`${item.key}-${item.label}`}>
                  <span className="card-inspector__fact-label">{item.label}</span>
                  <strong className="card-inspector__fact-value">{item.display}</strong>
                  <div className="card-inspector__fact-meta">
                    <span>{status}</span>
                    {citation && <a href={sourceHref(citation.url, citation.title)} target="_blank" rel="noopener noreferrer"
                      aria-label={`Source for ${item.label}: ${publisherOf(citation.url, citation.title)}`}>
                      <span>{publisherOf(citation.url, citation.title)}</span><ExternalLink size={10} aria-hidden="true" />
                    </a>}
                    {formattedDate && <time dateTime={metric!.capturedAt}>Recorded {formattedDate}</time>}
                    {metric?.quotedSupport && <span>Figure dated {metric.quotedSupport.asOf} · quoted from the page</span>}
                    {metric?.reportedSupport && <span>{metric.reportedSupport.asOf
                      ? `Figure dated ${metric.reportedSupport.asOf}` : 'Reporting date unavailable'}</span>}
                    {metric?.reportedBand && <span>{metric.reportedBand.asOf
                      ? `Range dated ${metric.reportedBand.asOf}` : 'Reporting date unavailable'}</span>}
                  </div>
                </li>;
              })}
            </ul>
            <p className="card-inspector__trust-note">
              Source-reported figures have search attribution, not independent verification. Unsupported estimates stay unknown.
            </p>
          </section>}

          {view.signal && !fullFinding && <section className="card-inspector__signals" aria-label="Finding and sources">
            {card.cardType === 'vice' && viceClaims.length > 0 ? <>
              <ViceDisclaimer />
              <ul className="card-inspector__findings">
                {viceClaims.slice(0, 2).map((claim) => <li key={claim.id}>
                  <p>{claim.claimText}</p>
                  <SafeLink href={claim.sourceUrl}>
                    <ExternalLink size={10} aria-hidden="true" />{publisherOf(claim.sourceUrl, claim.sourceTitle)}
                  </SafeLink>
                </li>)}
              </ul>
            </> : <>
              {previewPoints.slice(0, 2).length > 0 && <ul className="card-inspector__findings">
                {previewPoints.slice(0, 2).map((point, i) => <li key={i}><p>{point}</p></li>)}
              </ul>}
              {view.citations.length > 0 ? <div className="card-inspector__source-list">
                {view.citations.slice(0, 3).map((citation) => <a key={citation.url} href={sourceHref(citation.url, citation.title)}
                  target="_blank" rel="noopener noreferrer">
                  <ExternalLink size={10} aria-hidden="true" />{publisherOf(citation.url, citation.title)}
                </a>)}
              </div> : <p className="card-inspector__trust-note">No clickable source receipts have been saved for this finding yet.</p>}
            </>}
          </section>}

          {view.signal && !fullFinding && <button type="button" className="card-inspector__read-more"
            onClick={() => setFullFinding(true)}>
            <BookOpen size={15} aria-hidden="true" />
            <span>Read full finding</span>
            <span className="ml-auto text-[10px] font-normal text-muted">
              {view.sourceCount} {view.sourceCount === 1 ? 'source' : 'sources'}
            </span>
          </button>}

          {view.signal && fullFinding && <section className="brf-print-root finding-report"
            aria-label="Full research finding">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-[9px] font-semibold uppercase tracking-[.18em] text-muted">Stratemark research finding</p>
                <h3 className="mt-1 font-display text-xl font-semibold leading-tight text-content">{view.title}</h3>
              </div>
              <button type="button" className="brf-no-print text-[11px] text-muted hover:text-content"
                onClick={() => setFullFinding(false)}>Back to overview</button>
            </div>
            {summary && <p className="mt-3 text-[13px] leading-relaxed text-content">{summary}</p>}
            {findingPoints.length > 0 && <div className="mt-4">
              <p className="text-[9px] font-semibold uppercase tracking-widest text-muted">What the research shows</p>
              <ul className="card-inspector__findings mt-2">
                {findingPoints.map((point, index) => <li key={`${index}-${point}`}><p>{point}</p></li>)}
              </ul>
            </div>}
            <div className="mt-4 border-t border-border pt-3">
              <p className="text-[9px] font-semibold uppercase tracking-widest text-muted">
                Source receipts · {view.sourceCount}
              </p>
              {view.citations.length > 0 ? <div className="card-inspector__source-list mt-2">
                {view.citations.map((citation) => <a key={citation.url} href={sourceHref(citation.url, citation.title)}
                  target="_blank" rel="noopener noreferrer">
                  <ExternalLink size={10} aria-hidden="true" />{publisherOf(citation.url, citation.title)}
                </a>)}
              </div> : <p className="card-inspector__trust-note">
                No clickable source receipts have been saved. Treat this finding as incomplete.
              </p>}
            </div>
            <div className="brf-no-print mt-4 flex flex-wrap gap-2">
              <button type="button" className="btn-ghost" onClick={printScoped}>
                <Printer size={14} aria-hidden="true" /> Save as PDF
              </button>
              {!readOnly && <button type="button" className="btn-ghost" onClick={() => setShareOpen(true)}>
                <Share2 size={14} aria-hidden="true" /> Share report
              </button>}
              {!readOnly && <button type="button" className="btn-ghost" onClick={() => {
                onOpenChange(false);
                chat({ kind: 'cards', deckId: card.deckId, cardIds: [card.id], subject: card.title },
                  { seed: `Dig into "${card.title ?? view.title}" — what does the evidence support?` });
              }}>
                Ask AI about this finding <ArrowUpRight size={14} aria-hidden="true" />
              </button>}
            </div>
          </section>}

          {/* Route departure unmounts the reader. Closing it separately also
              navigates the deck query and competes with this destination. */}
          {dashboardUrl ? <Link to={dashboardUrl} className="card-inspector__cta">
            <span>Open full company dashboard</span><ArrowUpRight size={17} />
          </Link> : !fullFinding && !readOnly && <button type="button" className="card-inspector__cta" onClick={() => {
            onOpenChange(false);
            chat({ kind: 'cards', deckId: card.deckId, cardIds: [card.id], subject: card.title },
              { seed: `Dig into "${card.title}" — what's the full picture?` });
          }}>Ask about this finding <ArrowUpRight size={17} /></button>}
          <div className="card-inspector__actions">
            {readOnly ? <span /> : <div className="flex items-center gap-1"><SaveCardButton cardId={card.id} />
              {company && !view.signal && <FollowTodayButton companyId={company.id} companyName={company.name} />}
              <button type="button" className="card-control" aria-label="Share card" onClick={() => setShareOpen(true)}><Share2 size={15} /></button>
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
            {(onPrevious || onNext) && <div className="flex items-center gap-1">
              <button type="button" className="card-control" aria-label="Previous card" onClick={onPrevious} disabled={!onPrevious}><ArrowLeft size={15} /></button>
              <button type="button" className="card-control" aria-label="Next card" onClick={onNext} disabled={!onNext}><ArrowRight size={15} /></button>
            </div>}
          </div>
        </div>
      </div>
      {canReport && company && dashboardUrl && (
        <ReportBuilderDialog open={reportOpen} onOpenChange={setReportOpen} companyName={company.name}
          onStart={({ topics, focus }) => { void runCompanyReport({ companyId: company.id, companyName: company.name, topics, focus }); }} />
      )}
      <ShareDialog open={shareOpen} onOpenChange={setShareOpen} title={view.title}
        page={fullFinding ? undefined : { deckId: card.deckId, cardId: card.id }}
        subtitle={fullFinding ? 'Sourced research finding' : marketName ? `${marketName} — market research snapshot` : 'Market research snapshot'}
        build={async (onStage) => {
          if (fullFinding) return buildReportShare({
            title: view.title,
            kind: company ? 'company' : 'deck',
            markdown: findingMarkdown,
            citations: view.citations.map((citation) => ({ title: citation.title, url: citation.url })),
            createdAt: card.createdAt,
          }, marketName, [data]);
          const fresh = await verifyCardForShare(repo, data, onStage);
          return buildCardShare(fresh, marketName);
        }} />
    </DialogContent>
  </Dialog>;
}
