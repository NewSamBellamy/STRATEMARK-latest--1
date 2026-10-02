import { useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft, ArrowRight, ArrowUpRight, ExternalLink, Share2 } from 'lucide-react';
import { publisherOf, type CardWithCompany } from '@mi/contracts';
import { Dialog, DialogContent, DialogTitle, DialogDescription } from '@/components/ui/Modal';
import { useMarket } from '@/hooks/data';
import { useRepository } from '@/lib/repository/RepositoryProvider';
import { buildCardShare } from '@/lib/share/codec';
import { verifyCardForShare } from '@/lib/share/preflight';
import { ShareDialog } from '@/features/share/ShareDialog';
import { useDeepDive } from '@/features/deepdive/DeepDive';
import { CardStage } from './CardStage';
import { SaveCardButton } from './GameCard';
import { ViceDisclaimer } from './CardDisclaimer';
import { buildCardView, sourceUrl } from './card-view';

type Props = {
  data: CardWithCompany | null; open: boolean; onOpenChange: (open: boolean) => void;
  marketId?: string; position?: number; total?: number;
  deckView?: string;
  onPrevious?: () => void; onNext?: () => void;
};

const capturedDate = new Intl.DateTimeFormat('en-US', {
  month: 'short', day: 'numeric', year: 'numeric',
});

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
  const dashboardUrl = company && !view.signal ? `/company/${company.id}/dashboard/overview?${new URLSearchParams({
    ...(marketId ? { deck: marketId } : {}), card: card.id, ...(deckView ? { view: deckView } : {}),
  })}` : null;
  const companySite = sourceUrl(company?.websiteUrl);
  const summary = card.summary?.trim() || view.description?.trim();
  const summarySources = (card.citations ?? []).filter((citation) => sourceUrl(citation.url)).slice(0, 2);

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
            </div> : summary && <span className="card-inspector__summary-warning">
              No source receipt is attached to this summary.
            </span>}
          </section>

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

          {view.signal && <section className="card-inspector__signals" aria-label="Finding and sources">
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

          {dashboardUrl ? <Link to={dashboardUrl} className="card-inspector__cta" onClick={() => onOpenChange(false)}>
            <span>Open full company dashboard</span><ArrowUpRight size={17} />
          </Link> : <button type="button" className="card-inspector__cta" onClick={() => {
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
        subtitle={marketName ? `${marketName} — market research snapshot` : 'Market research snapshot'}
        build={async (onStage) => {
          const fresh = await verifyCardForShare(repo, data, onStage);
          return buildCardShare(fresh, marketName);
        }} />
    </DialogContent>
  </Dialog>;
}
