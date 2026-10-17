/**
 * Where a share link lands. A card share opens on the card itself (with the
 * same tilt as in the app), a short read of what it found, its sources, and a
 * way into the full company dashboard when there is one. A deck share goes
 * straight to the deck.
 */
import { useQuery } from '@tanstack/react-query';
import { Link, Navigate } from 'react-router-dom';
import { ArrowUpRight, ExternalLink } from 'lucide-react';
import { publisherOf, type ShareSnapshot } from '@mi/contracts';
import { useRepository } from '@/lib/repository/RepositoryProvider';
import { CardStage } from '@/features/card/CardStage';
import { buildCardView } from '@/features/card/card-view';
import { sourceHref } from '@/lib/sourceHref';

export function ShareHome({ snapshot }: { snapshot: ShareSnapshot }) {
  const repo = useRepository();
  const cardId = snapshot.focusCardId;
  const card = useQuery({
    queryKey: ['share-card', cardId],
    queryFn: () => repo.getCard(cardId as string),
    enabled: snapshot.kind === 'card' && !!cardId,
  });

  if (snapshot.kind === 'deck') {
    const market = snapshot.markets[0];
    return market ? <Navigate to={`/markets/${market.id}/deck`} replace /> : <p className="text-muted">This share has no deck in it.</p>;
  }
  if (card.isPending) return <p role="status" className="py-16 text-center text-muted">Opening the card…</p>;
  const data = card.data;
  if (!data) return <p className="py-16 text-center text-muted">This share has no card in it.</p>;

  const view = buildCardView(data);
  const { company } = data;
  const summary = data.card.summary?.trim() || view.description?.trim() || null;
  const points = (data.card.keyPoints ?? []).filter((p) => p.trim() && p.trim() !== summary).slice(0, 5);

  return (
    <div className="mx-auto grid max-w-5xl items-center gap-8 py-2 lg:grid-cols-[minmax(0,420px)_minmax(0,1fr)] lg:gap-14">
      <CardStage data={data} view={view} />
      <div className="min-w-0">
        <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-muted">{view.type}</p>
        <h1 className="mt-1 font-display text-3xl font-semibold leading-tight tracking-tight sm:text-4xl">{view.title}</h1>
        {company?.hqLocation && <p className="mt-1 text-[13px] text-muted">{company.hqLocation}</p>}
        {summary && <p className="mt-4 max-w-prose text-[15px] leading-relaxed text-content">{summary}</p>}
        {points.length > 0 && (
          <ul className="mt-4 max-w-prose list-disc space-y-1.5 pl-5 text-[14px] leading-relaxed text-content">
            {points.map((point) => <li key={point}>{point}</li>)}
          </ul>
        )}
        {company && !view.signal && (
          <Link
            to={`/company/${company.id}/dashboard/overview`}
            className="btn-primary mt-6 inline-flex"
          >
            View the full research <ArrowUpRight className="h-4 w-4" />
          </Link>
        )}
        {view.citations.length > 0 && (
          <div className="mt-6">
            <p className="text-[10px] font-semibold uppercase tracking-widest text-muted">Sources · {view.sourceCount}</p>
            <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1.5">
              {view.citations.map((citation) => (
                <a
                  key={citation.url}
                  href={sourceHref(citation.url, citation.title)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 text-[12.5px] text-primary-ink hover:underline"
                >
                  <ExternalLink className="h-3 w-3" aria-hidden />
                  {publisherOf(citation.url, citation.title)}
                </a>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
