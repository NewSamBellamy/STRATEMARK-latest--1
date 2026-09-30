import { BookmarkSimple } from '@phosphor-icons/react';
import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import type { CardWithCompany } from '@mi/contracts';
import { EmptyState } from '@/components/states/EmptyState';
import { QueryBoundary } from '@/components/states/QueryBoundary';
import { CardGridSkeleton } from '@/components/states/Skeleton';
import { CardGrid } from '@/features/deck/CardGrid';
import { buildCardView } from '@/features/card/card-view';
import { useSavedCards } from '@/hooks/data';

function savedIdentity(entry: CardWithCompany): string {
  if (!entry.company) return entry.card.id;
  let company = entry.company.name.trim().toLowerCase();
  if (entry.company.websiteUrl) {
    try {
      company = new URL(entry.company.websiteUrl).hostname.replace(/^www\./, '').toLowerCase();
    } catch {
      // The company name remains the stable fallback for malformed legacy URLs.
    }
  }
  return `${entry.card.cardType}:${company}`;
}

export function collapseSavedCards(cards: CardWithCompany[]): CardWithCompany[] {
  const unique = new Map<string, CardWithCompany>();
  const strength = (entry: CardWithCompany) => {
    const view = buildCardView(entry);
    return view.sourcedCount * 100 + view.knownCount;
  };
  for (const entry of cards) {
    const key = savedIdentity(entry);
    const current = unique.get(key);
    if (!current || strength(entry) > strength(current)) unique.set(key, entry);
  }
  return [...unique.values()];
}

export default function SavedCardsPage() {
  const cards = useSavedCards();
  const uniqueCards = useMemo(() => collapseSavedCards(cards.data ?? []), [cards.data]);
  return (
    <div className="mx-auto max-w-6xl">
      <header className="mb-7">
        <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-primary">
          Your collection
        </p>
        <div className="mt-1 flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="font-display text-[32px] font-semibold tracking-[-0.03em] text-content">
              Saved cards
            </h1>
            <p className="mt-1 text-sm text-muted">
              Your shortlist across every market. Repeated company cards are merged automatically.
            </p>
          </div>
          {uniqueCards.length > 0 && (
            <span className="text-[12px] tabular-nums text-muted">
              {uniqueCards.length} saved {uniqueCards.length === 1 ? 'card' : 'cards'}
            </span>
          )}
        </div>
      </header>
      <QueryBoundary
        query={cards}
        loading={<CardGridSkeleton count={3} />}
        errorTitle="Saved cards couldn't load"
        isEmpty={(data) => data.length === 0}
        empty={
          <EmptyState
            title="No saved cards yet"
            description="Bookmark company cards from any deck to save them here for quick access."
            icon={<BookmarkSimple weight="duotone" size={24} />}
            action={
              <Link to="/history" className="btn-primary mt-2">
                Browse decks
              </Link>
            }
          />
        }
      >
        {() => <CardGrid cards={uniqueCards} cohortCards={uniqueCards} />}
      </QueryBoundary>
    </div>
  );
}
