import { useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft, ArrowRight, ArrowUpRight, BookOpen, ExternalLink, Printer, Share2 } from 'lucide-react';
import { publisherOf, type CardWithCompany } from '@mi/contracts';
import { Dialog, DialogContent, DialogTitle, DialogDescription } from '@/components/ui/Modal';
import { useMarket } from '@/hooks/data';
import { useRepository } from '@/lib/repository/RepositoryProvider';
import { buildCardShare, buildReportShare } from '@/lib/share/codec';
import { verifyCardForShare } from '@/lib/share/preflight';
import { ShareDialog } from '@/features/share/ShareDialog';
import { useDeepDive } from '@/features/deepdive/DeepDive';
import { CardStage } from './CardStage';
import { SaveCardButton } from './GameCard';
import { ViceDisclaimer } from './CardDisclaimer';
import { buildCardView, sourceUrl } from './card-view';
import { printScoped } from '@/lib/print';

type Props = {
  data: CardWithCompany | null; open: boolean; onOpenChange: (open: boolean) => void;
  marketId?: string; position?: number; total?: number;
  deckView?: string;
  onPrevious?: () => void; onNext?: () => void;
};

const capturedDate = new Intl.DateTimeFormat('en-US', {
  month: 'short', day: 'numeric', year: 'numeric',
});
const pendingCompanySnapshot = 'No source-backed company snapshot is ready yet.';

export function CardReader({ data, open, ...props }: Props) {
  if (!data) return null;
  return <CardReaderBody key={data.card.id} data={data} open={open} {...props} />;
}

function CardReaderBody({ data, open, onOpenChange, marketId,
  deckView, position, total, onPrevious, onNext }: Omit<Props, 'data'> & { data: CardWithCompany }) {
  const { card, company, viceClaims } = data;
  const view = buildCardView(data);
  const marketName = useMarket(marketId).data?.name ?? null;
  const repo = useRepository();
  const { chat } = useDeepDive();
  const [shareOpen, setShareOpen] = useState(false);
  const [fullFinding, setFullFinding] = useState(false);
  const dashboardUrl = company && !view.signal ? `/company/${company.id}/dashboard/overview?${new URLSearchParams({
    ...(marketId ? { deck: marketId } : {}), card: card.id, ...(deckView ? { view: deckView } : {}),
  })}` : null;
  const companySite = sourceUrl(company?.websiteUrl);
  const summary = card.summary?.trim() || view.description?.trim();
  const summarySources = (card.citations ?? []).filter((citation) => sourceUrl(citation.url)).slice(0, 2);
  const findingPoints = card.cardType === 'vice'
    ? viceClaims.map((claim) => claim.claimText)
    : card.keyPoints;
  const findingMarkdown = [
    `# ${view.title}`,
    summary ?? '',
    findingPoints.length ? `## What the research shows\n\n${findingPoints.map((point) => `- ${point}`).join('\n')}` : '',
    view.citations.length ? `## Sources\n\n${view.citations.map((citation) =>
      `- [${citation.title || publisherOf(citation.url, citation.title)}](${citation.url})`).join('\n')}` : '',
  ].filter(Boolean).join('\n\n');

  return <Dialog open={open} onOpenChange={onOpenChange}>
    <DialogContent size="2xl" className="card-inspector">
      <DialogTitle className="sr-only">Inspect {view.title} card</DialogTitle>
      <DialogDescription className="sr-only">
        A concise research summary with sourced figures. Open the full dashboard for deeper evidence and analysis.
      </DialogDescription>
      <div className="card-inspector__layout">
        <CardStage data={data} view={view} />
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
                {summary || 'No concise research summary has been recorded for this card.'}
              </p>
              {companySite && <a className="card-inspector__site" href={companySite} target="_blank" rel="noopener noreferrer">
                Company website <ExternalLink size={11} aria-hidden="true" />
              </a>}
              {summarySources.length > 0 ? <div className="card-inspector__summary-sources">
                <span>Related sources</span>
                {summarySources.map((citation) => <a key={citation.url} href={citation.url}
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
              {view.profileMetrics.map((item) => {
                const metric = item.metric;
                const citation = item.citations[0];
                const status = metric?.confidence === 'user_verified' ? 'Human checked' :
                  citation?.credibility === 'primary' ? 'Primary source' :
                    citation?.credibility === 'reputable_secondary' ? 'Independent reporting' :
                      citation?.credibility === 'industry' ? 'Industry source' :
                        citation ? 'Source linked' : 'No source-backed figure';
                const date = metric ? new Date(metric.capturedAt) : null;
                const formattedDate = date && Number.isFinite(date.getTime()) ? capturedDate.format(date) : null;

                return <li className="card-inspector__fact" key={item.key}>
                  <span className="card-inspector__fact-label">{item.label}</span>
                  <strong className="card-inspector__fact-value">{item.display}</strong>
                  <div className="card-inspector__fact-meta">
                    <span>{status}</span>
                    {citation && <a href={citation.url} target="_blank" rel="noopener noreferrer"
                      aria-label={`Source for ${item.label}: ${publisherOf(citation.url, citation.title)}`}>
                      <span>{publisherOf(citation.url, citation.title)}</span><ExternalLink size={10} aria-hidden="true" />
                    </a>}
                    {formattedDate && <time dateTime={metric!.capturedAt}>Recorded {formattedDate}</time>}
                  </div>
                </li>;
              })}
            </ul>
            <p className="card-inspector__trust-note">
              Figures without a source receipt or human check stay unknown; estimates aren’t shown as confirmed facts.
            </p>
          </section>}

          {view.signal && !fullFinding && <section className="card-inspector__signals" aria-label="Finding and sources">
            {card.cardType === 'vice' && viceClaims.length > 0 ? <>
              <ViceDisclaimer />
              <ul className="card-inspector__findings">
                {viceClaims.slice(0, 2).map((claim) => <li key={claim.id}>
                  <p>{claim.claimText}</p>
                  <a href={claim.sourceUrl} target="_blank" rel="noopener noreferrer">
                    <ExternalLink size={10} aria-hidden="true" />{publisherOf(claim.sourceUrl, claim.sourceTitle)}
                  </a>
                </li>)}
              </ul>
            </> : <>
              {card.keyPoints.slice(0, 2).length > 0 && <ul className="card-inspector__findings">
                {card.keyPoints.slice(0, 2).map((point, i) => <li key={i}><p>{point}</p></li>)}
              </ul>}
              {view.citations.length > 0 ? <div className="card-inspector__source-list">
                {view.citations.slice(0, 3).map((citation) => <a key={citation.url} href={citation.url}
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
                {view.citations.map((citation) => <a key={citation.url} href={citation.url}
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
              <button type="button" className="btn-ghost" onClick={() => setShareOpen(true)}>
                <Share2 size={14} aria-hidden="true" /> Share report
              </button>
              <button type="button" className="btn-ghost" onClick={() => {
                onOpenChange(false);
                chat({ kind: 'cards', deckId: card.deckId, cardIds: [card.id], subject: card.title },
                  { seed: `Dig into "${card.title ?? view.title}" — what does the evidence support?` });
              }}>
                Ask AI about this finding <ArrowUpRight size={14} aria-hidden="true" />
              </button>
            </div>
          </section>}

          {/* Route departure unmounts the reader. Closing it separately also
              navigates the deck query and competes with this destination. */}
          {dashboardUrl ? <Link to={dashboardUrl} className="card-inspector__cta">
            <span>Open full company dashboard</span><ArrowUpRight size={17} />
          </Link> : !fullFinding && <button type="button" className="card-inspector__cta" onClick={() => {
            onOpenChange(false);
            chat({ kind: 'cards', deckId: card.deckId, cardIds: [card.id], subject: card.title },
              { seed: `Dig into "${card.title}" — what's the full picture?` });
          }}>Ask about this finding <ArrowUpRight size={17} /></button>}
          <div className="card-inspector__actions">
            <div className="flex items-center gap-1"><SaveCardButton cardId={card.id} />
              <button type="button" className="card-control" aria-label="Share card" onClick={() => setShareOpen(true)}><Share2 size={15} /></button>
              <span className="ml-2 text-[11px] text-muted">Keep or share this card</span></div>
            {(onPrevious || onNext) && <div className="flex items-center gap-1">
              <button type="button" className="card-control" aria-label="Previous card" onClick={onPrevious} disabled={!onPrevious}><ArrowLeft size={15} /></button>
              <button type="button" className="card-control" aria-label="Next card" onClick={onNext} disabled={!onNext}><ArrowRight size={15} /></button>
            </div>}
          </div>
        </div>
      </div>
      <ShareDialog open={shareOpen} onOpenChange={setShareOpen} title={view.title}
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
