import { useState } from 'react';
import { Link } from 'react-router-dom';
import * as Tabs from '@radix-ui/react-tabs';
import { ArrowLeft, ArrowRight, ArrowUpRight, ExternalLink, Radar, Share2 } from 'lucide-react';
import { isSignalCardType, publisherOf, type CardWithCompany } from '@mi/contracts';
import { Dialog, DialogContent, DialogTitle, DialogDescription } from '@/components/ui/Modal';
import { useMarket } from '@/hooks/data';
import { useRepository } from '@/lib/repository/RepositoryProvider';
import { buildCardShare } from '@/lib/share/codec';
import { verifyCardForShare } from '@/lib/share/preflight';
import { ShareDialog } from '@/features/share/ShareDialog';
import { useDeepDive } from '@/features/deepdive/DeepDive';
import { CmsBreakdown } from './CmsBreakdown';
import { ViceClaims } from './ViceClaims';
import { CardStage } from './CardStage';
import { SaveCardButton } from './GameCard';
import { buildCardView } from './card-view';

type Props = {
  data: CardWithCompany | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  deckUserValues: number[];
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
  deckUserValues,
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
  const latestChecked = view.metrics.reduce<number | null>((latest, entry) => {
    const captured = new Date(entry.metric.capturedAt).getTime();
    return Number.isFinite(captured) && (latest == null || captured > latest) ? captured : latest;
  }, null);
  const dashboardUrl = company
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
          Review the card, inspect its evidence and company stage, or explore the full research.
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
                  {latestChecked
                    ? ` · checked ${new Date(latestChecked).toLocaleDateString()}`
                    : ''}
                </span>
              </span>
              <button
                type="button"
                onClick={() => {
                  onOpenChange(false);
                  chat(
                    { kind: 'cards', deckId: card.deckId, cardIds: [card.id], subject: view.title },
                    { placeholder: `Ask the ${view.title} researcher…` },
                  );
                }}
              >
                Ask researcher <ArrowUpRight size={13} aria-hidden="true" />
              </button>
            </div>
            <Tabs.Root defaultValue="overview" className="flex min-h-0 flex-1 flex-col">
              <Tabs.List className="card-inspector__tabs" aria-label="Card details">
                <Tabs.Trigger value="overview" className="card-inspector__tab">
                  Overview
                </Tabs.Trigger>
                <Tabs.Trigger value="evidence" className="card-inspector__tab">
                  Evidence
                </Tabs.Trigger>
                {hasMaturity && (
                  <Tabs.Trigger value="maturity" className="card-inspector__tab">
                    Company stage
                  </Tabs.Trigger>
                )}
              </Tabs.List>
              <Tabs.Content value="overview" className="card-inspector__panel" tabIndex={0}>
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
                    {card.keyPoints.map((point, i) => (
                      <li key={i} className="flex gap-3 text-[12px] leading-relaxed text-content">
                        <span className="font-semibold tabular-nums text-muted">0{i + 1}</span>
                        <span>{point}</span>
                      </li>
                    ))}
                  </ul>
                )}
                {hasMaturity && (
                  <p className="mt-4 rounded-lg bg-surface-2 p-3 text-[11px] leading-relaxed text-muted">
                    {view.knownCount === 0
                      ? 'Stage pending: no usable figures were recorded for this company.'
                      : !view.maturity
                        ? `${view.knownCount} figures recorded · ${view.sourcedCount} with clickable source receipts. No comparable sourced figure supports showing a tier on the card.`
                        : `${view.knownCount} figures recorded · ${view.sourcedCount} with clickable source receipts.`}{' '}
                    Company stage describes scale and market maturity, not investment quality or
                    research confidence.
                  </p>
                )}
              </Tabs.Content>
              <Tabs.Content value="evidence" className="card-inspector__panel" tabIndex={0}>
                {view.metrics.length > 0 ? (
                  <ul className="space-y-2">
                    {view.metrics.map(({ metric, label, display, confidence, note, citations }) => (
                      <li
                        key={metric.id}
                        className="rounded-lg border border-border p-3 text-[12px]"
                      >
                        <div className="flex flex-wrap items-baseline justify-between gap-2">
                          <strong className="text-content">{label}</strong>
                          <span className="font-semibold tabular-nums text-content">{display}</span>
                        </div>
                        <div className="mt-1 flex flex-wrap items-center justify-between gap-2 text-[11px] text-muted">
                          <span>
                            {confidence} · Captured{' '}
                            {new Date(metric.capturedAt).toLocaleDateString()}
                          </span>
                          {citations[0] ? (
                            <a
                              href={citations[0].url}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="inline-flex items-center gap-1 text-primary-ink hover:underline"
                            >
                              <ExternalLink size={11} />
                              {publisherOf(citations[0].url, citations[0].title)}
                            </a>
                          ) : (
                            <span>No clickable source</span>
                          )}
                        </div>
                        {note && (
                          <p className="mt-2 text-[11px] italic text-muted">
                            How we got this: {note}
                          </p>
                        )}
                        {metric.metricType === 'market_share' && (
                          <p className="mt-1 text-[11px] text-muted">
                            Market scope is not recorded.
                          </p>
                        )}
                        {metric.conflicts?.length ? (
                          <p className="mt-1 text-[11px] text-muted">
                            Conflicting observations recorded; open research for the full account.
                          </p>
                        ) : null}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <div className="space-y-3 text-[12px] text-muted">
                    <p>
                      {view.citations.length
                        ? `${view.citations.length} research sources recorded.`
                        : 'No clickable sources recorded yet.'}
                    </p>
                    {view.citations.map((c) => (
                      <a
                        key={c.url}
                        href={c.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex items-center gap-1 text-primary-ink hover:underline"
                      >
                        <ExternalLink size={12} />
                        {publisherOf(c.url, c.title)}
                      </a>
                    ))}
                  </div>
                )}
                {isSignalCardType(card.cardType) && viceClaims.length > 0 && (
                  <div className="mt-4">
                    <ViceClaims claims={viceClaims} companyName={company?.name} />
                  </div>
                )}
              </Tabs.Content>
              {hasMaturity && (
                <Tabs.Content value="maturity" className="card-inspector__panel" tabIndex={0}>
                  <CmsBreakdown
                    card={card}
                    metrics={view.metrics.map((m) => m.metric)}
                    deckUserValues={deckUserValues}
                  />
                </Tabs.Content>
              )}
            </Tabs.Root>
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
                    { kind: 'cards', deckId: card.deckId, cardIds: [card.id], subject: card.title },
                    { seed: `Dig into "${card.title}" — what's the full picture?` },
                  );
                }}
              >
                Explore this market <ArrowUpRight size={17} />
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
