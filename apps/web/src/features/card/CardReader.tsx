import { useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft, ArrowRight, ArrowUpRight, ExternalLink, Radar, Share2 } from 'lucide-react';
import { publisherOf, type CardWithCompany } from '@mi/contracts';
import { Dialog, DialogContent, DialogTitle, DialogDescription } from '@/components/ui/Modal';
import { useMarket } from '@/hooks/data';
import { useRepository } from '@/lib/repository/RepositoryProvider';
import { buildCardShare } from '@/lib/share/codec';
import { verifyCardForShare } from '@/lib/share/preflight';
import { ShareDialog } from '@/features/share/ShareDialog';
import { useDeepDive } from '@/features/deepdive/DeepDive';
import { CardStage } from './CardStage';
import { ViceClaims } from './ViceClaims';
import { SaveCardButton } from './GameCard';
import { buildCardView, sourceUrl } from './card-view';

type Props = {
  data: CardWithCompany | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  marketId?: string;
  position?: number;
  total?: number;
  deckView?: string;
  onPrevious?: () => void;
  onNext?: () => void;
};

export function CardReader({ data, open, ...props }: Props) {
  if (!data) return null;
  return <CardReaderBody key={data.card.id} data={data} open={open} {...props} />;
}

function CardReaderBody({
  data,
  open,
  onOpenChange,
  marketId,
  deckView,
  position,
  total,
  onPrevious,
  onNext,
}: Omit<Props, 'data'> & { data: CardWithCompany }) {
  const { card, company, viceClaims } = data;
  const view = buildCardView(data);
  const marketName = useMarket(marketId).data?.name ?? null;
  const repo = useRepository();
  const { chat } = useDeepDive();
  const [shareOpen, setShareOpen] = useState(false);
  const hasMaturity = card.cardType === 'company' && !view.signal;
  const researcherLabel = view.signal ? 'Market researcher' : 'Company researcher';
  const evidenceCount = view.signal ? view.citations.length : view.sourcedCount;
  const sourcedViceClaims = viceClaims.filter((claim) => sourceUrl(claim.sourceUrl) !== null);
  const viceSourceUrls = new Set(
    sourcedViceClaims
      .map((claim) => sourceUrl(claim.sourceUrl))
      .filter((url): url is string => url !== null),
  );
  const detailCitations = view.citations.filter((citation) => {
    const url = sourceUrl(citation.url);
    return !url || !viceSourceUrls.has(url);
  });
  const dashboardUrl =
    !view.signal && company
      ? `/company/${company.id}/dashboard/overview?${new URLSearchParams({
          ...(marketId ? { deck: marketId } : {}),
          card: card.id,
          ...(deckView ? { view: deckView } : {}),
        })}`
      : null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="2xl" className="card-inspector">
        <DialogTitle className="sr-only">Inspect {view.title} card</DialogTitle>
        <DialogDescription className="sr-only">
          Read a concise summary, follow its sources, or open the full research.
        </DialogDescription>
        <div className="card-inspector__layout">
          <CardStage data={data} view={view} />
          <div className="card-inspector__detail">
            <div className="flex items-center justify-between gap-3 pr-8">
              <span className="text-[10px] font-semibold uppercase tracking-[.16em] text-muted">
                From your research deck
              </span>
              <span className="text-[11px] text-muted">
                {position && total ? `${position} of ${total}` : view.type}
              </span>
            </div>
            <h2 className="mt-4 font-display text-2xl font-semibold leading-tight text-content">
              {view.title}
            </h2>
            {view.description && view.description.trim() !== card.summary?.trim() && (
              <p className="card-inspector__intro mt-2 max-w-[52ch] text-[13px] leading-relaxed text-muted">
                {view.description}
              </p>
            )}
            <div className="card-researcher">
              <span className="card-researcher__mark">
                <Radar size={15} aria-hidden="true" />
              </span>
              <span className="min-w-0 flex-1">
                <strong>{researcherLabel}</strong>
                <span>
                  {evidenceCount > 0
                    ? `${evidenceCount} sourced ${evidenceCount === 1 ? 'record' : 'records'}`
                    : 'Evidence needed'}
                  {view.latestCapturedAt
                    ? ` · as of ${new Date(view.latestCapturedAt).toLocaleDateString()}`
                    : ''}
                </span>
              </span>
              <button
                type="button"
                onClick={() => {
                  onOpenChange(false);
                  chat(
                    {
                      kind: 'cards',
                      deckId: card.deckId,
                      cardIds: [card.id],
                      cardType: card.cardType,
                      subject: view.title,
                    },
                    { placeholder: `Ask the ${view.title} researcher…`, returnToCard: card.id },
                  );
                }}
              >
                Ask researcher <ArrowUpRight size={13} aria-hidden="true" />
              </button>
            </div>
            <div
              className="card-inspector__panel"
              role="region"
              aria-label={`${view.signal ? 'Finding' : 'Company'} summary and sources`}
              tabIndex={0}
            >
              <p className="text-[10px] font-semibold uppercase tracking-widest text-muted">
                {view.signal ? 'Research finding' : 'Company snapshot'}
              </p>
              <p className="mt-2 text-[13px] leading-relaxed text-content">
                {card.summary ||
                  view.description ||
                  'A research summary has not been recorded yet.'}
              </p>
              {card.keyPoints.length > 0 && (
                <ul className="mt-4 space-y-2 border-t border-border pt-3">
                  {card.keyPoints.slice(0, 4).map((point, i) => (
                    <li key={i} className="flex gap-3 text-[12px] leading-relaxed text-content">
                      <span className="mt-1.5 h-1.5 w-1.5 flex-none rounded-full bg-primary/60" />
                      <span>{point}</span>
                    </li>
                  ))}
                </ul>
              )}
              {detailCitations.length > 0 && (
                <div className="mt-4 border-t border-border pt-3">
                  <p className="text-[10px] font-semibold uppercase tracking-widest text-muted">
                    {detailCitations.length > 4
                      ? `Showing 4 of ${detailCitations.length} sources`
                      : `Sources · ${detailCitations.length}`}
                  </p>
                  <div className="mt-2 flex flex-wrap gap-x-4 gap-y-2">
                    {detailCitations.slice(0, 4).map((citation) => (
                      <a
                        key={citation.url}
                        href={citation.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1 text-[11px] text-primary-ink hover:underline"
                      >
                        <ExternalLink size={11} />
                        {publisherOf(citation.url, citation.title)}
                      </a>
                    ))}
                  </div>
                </div>
              )}
              {sourcedViceClaims.length > 0 && (
                <div className="mt-4 border-t border-border pt-3">
                  <ViceClaims claims={sourcedViceClaims} companyName={company?.name} />
                </div>
              )}
              {hasMaturity && (
                <p className="mt-4 rounded-lg bg-surface-2 p-3 text-[11px] leading-relaxed text-muted">
                  {view.knownCount === 0
                    ? 'Stage unavailable: no usable figures have been recorded.'
                    : !view.maturity
                      ? `${view.knownCount} figures recorded, but the evidence does not support a reliable company stage yet.`
                      : `${view.maturity.label} stage · ${view.sourcedCount} sourced metrics. Stage describes company scale, not investment quality.`}
                </p>
              )}
            </div>
            {dashboardUrl ? (
              <Link
                to={dashboardUrl}
                className="card-inspector__cta"
                onClick={() => onOpenChange(false)}
              >
                <span>
                  Explore research{' '}
                  <span className="ml-2 font-normal opacity-75">
                    Sources, metrics & live signals
                  </span>
                </span>
                <ArrowUpRight size={17} />
              </Link>
            ) : (
              <button
                type="button"
                className="card-inspector__cta"
                onClick={() => {
                  onOpenChange(false);
                  chat(
                    {
                      kind: 'cards',
                      deckId: card.deckId,
                      cardIds: [card.id],
                      cardType: card.cardType,
                      subject: card.title,
                    },
                    {
                      seed: `Dig into "${card.title}" — what's the full picture?`,
                      returnToCard: card.id,
                    },
                  );
                }}
              >
                {card.cardType === 'insight'
                  ? 'Explore this trend'
                  : card.cardType === 'barrier'
                    ? 'Understand this barrier'
                    : 'Discuss this finding'}{' '}
                <ArrowUpRight size={17} />
              </button>
            )}
            <div className="mt-4 flex items-center justify-between gap-2">
              <div className="flex items-center gap-1">
                <SaveCardButton cardId={card.id} />
                <button
                  type="button"
                  className="card-control"
                  aria-label="Share card"
                  onClick={() => setShareOpen(true)}
                >
                  <Share2 size={15} />
                </button>
                <span className="ml-2 text-[11px] text-muted">Keep or share this card</span>
              </div>
              {(onPrevious || onNext) && (
                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    className="card-control"
                    aria-label="Previous card"
                    onClick={onPrevious}
                    disabled={!onPrevious}
                  >
                    <ArrowLeft size={15} />
                  </button>
                  <button
                    type="button"
                    className="card-control"
                    aria-label="Next card"
                    onClick={onNext}
                    disabled={!onNext}
                  >
                    <ArrowRight size={15} />
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
        <ShareDialog
          open={shareOpen}
          onOpenChange={setShareOpen}
          title={view.title}
          subtitle={
            marketName ? `${marketName} — market research snapshot` : 'Market research snapshot'
          }
          build={async (onStage) => {
            const fresh = await verifyCardForShare(repo, data, onStage);
            return buildCardShare(fresh, marketName);
          }}
        />
      </DialogContent>
    </Dialog>
  );
}
