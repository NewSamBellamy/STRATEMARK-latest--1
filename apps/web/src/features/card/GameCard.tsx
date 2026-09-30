import { useState } from 'react';
import { Bookmark, Share2, ArrowUpRight } from 'lucide-react';
import type { CardWithCompany } from '@mi/contracts';
import { useSaveCard, useSavedCards, useUnsaveCard } from '@/hooks/data';
import { cn } from '@/lib/cn';
import { CollectibleCard } from './CollectibleCard';
import { buildCardView } from './card-view';

export interface GameCardProps {
  data: CardWithCompany;
  deckStatus?: 'running' | 'refreshing' | 'partial' | 'failed' | 'ready' | 'ready_stale';
  onOpen?: () => void;
  onShare?: () => void;
  hideActions?: boolean;
  className?: string;
}

export function GameCard({ data, onOpen, onShare, hideActions, className }: GameCardProps) {
  const view = buildCardView(data);
  return <div className={cn('card-sleeve', className)}>
    {onOpen ? <button type="button" className="card-sleeve__open" onClick={onOpen}
      aria-label={`${view.title} — ${view.type} card`}>
      <CollectibleCard data={data} view={view} />
    </button> : <CollectibleCard data={data} view={view} />}
    {!hideActions && <div className="card-sleeve__actions">
      <span className="flex min-w-0 items-center gap-1 text-[11px] text-muted">
        {onOpen && <><ArrowUpRight size={13} aria-hidden="true" /> Inspect card</>}
      </span>
      <div className="flex gap-1"><SaveCardButton cardId={data.card.id} />
        {onShare && <button type="button" className="card-control" aria-label="Share card" onClick={onShare}><Share2 size={15} /></button>}
      </div>
    </div>}
  </div>;
}

export function SaveCardButton({ cardId }: { cardId: string }) {
  const saved = useSavedCards();
  const save = useSaveCard();
  const unsave = useUnsaveCard();
  const [message, setMessage] = useState('');
  const isSaved = (saved.data ?? []).some((c) => c.card.id === cardId);
  return <span className="relative inline-flex">
    <button type="button" className="card-control" aria-label={isSaved ? 'Unsave card' : 'Save card'}
      aria-pressed={isSaved} disabled={saved.isLoading || saved.isError || save.isPending || unsave.isPending}
      onClick={() => (isSaved ? unsave : save).mutate(cardId, {
        onSuccess: () => setMessage(isSaved ? 'Card removed from saved cards.' : 'Card saved.'),
        onError: () => setMessage('Could not update saved cards. Please try again.'),
      })}>
      <Bookmark size={15} fill={isSaved ? 'currentColor' : 'none'} />
    </button>
    <span role="status" className="sr-only">{message}</span>
  </span>;
}
