import { useCallback, useState } from 'react';
import { Bookmark, Share2, ArrowUpRight, RefreshCw, LoaderCircle, Droplets } from 'lucide-react';
import type { CardWithCompany } from '@mi/contracts';
import { knownCompanyDomain, resolveLogo, rootDomain } from '@mi/research';
import { useSaveCard, useSavedCards, useUnsaveCard } from '@/hooks/data';
import { useDashboardHydrating } from '@/lib/living/useDashboardWarm';
import { cn } from '@/lib/cn';
import { CollectibleCard } from './CollectibleCard';
import { buildCardView } from './card-view';

export interface GameCardProps {
  data: CardWithCompany;
  deckUserValues?: number[];
  deckStatus?: 'running' | 'refreshing' | 'partial' | 'failed' | 'ready' | 'ready_stale';
  onOpen?: () => void;
  onShare?: () => void;
  hideActions?: boolean;
  className?: string;
}

export function GameCard({ data, onOpen, onShare, hideActions, deckStatus, className }: GameCardProps) {
  const view = buildCardView(data);
  // A pending entity card during an active run is being researched RIGHT NOW:
  // say so on the face so the deck visibly fills as the agents work.
  const researching = (deckStatus === 'running' || deckStatus === 'partial' || deckStatus === 'refreshing') &&
    !data.card.tier && (data.card.cardType === 'company' || data.card.cardType === 'infrastructure' || data.card.cardType === 'distribution');
  // Dashboards hydrating is a different fact from the card itself being
  // researched: the cascade warm pass is filling this company's tabs.
  const hydrating = useDashboardHydrating(data.company?.id);
  const [logoAvailable, setLogoAvailable] = useState<boolean | undefined>();
  const [logoRetryNonce, setLogoRetryNonce] = useState(0);
  const [logoUrlOverride, setLogoUrlOverride] = useState<string | null>(null);
  const [logoRetrying, setLogoRetrying] = useState(false);
  const onLogoAvailabilityChange = useCallback((available: boolean) => setLogoAvailable(available), []);
  const retryLogo = async () => {
    if (!data.company || logoRetrying) return;
    setLogoRetrying(true);
    setLogoAvailable(undefined);
    try {
      const resolved = await resolveLogo({
        name: data.company.name,
        domain: knownCompanyDomain(data.company.name) ?? rootDomain(data.company.websiteUrl),
      }, { force: true });
      if (resolved.url) setLogoUrlOverride(resolved.url);
    } catch {
      // The card still re-walks its existing public sources below.
    } finally {
      setLogoRetryNonce((nonce) => nonce + 1);
      setLogoRetrying(false);
    }
  };
  return <div className={cn('card-sleeve', className)}>
    {researching && (
      <span data-testid="card-researching"
        className="absolute left-3 top-3 z-10 inline-flex items-center gap-1.5 rounded-full border border-primary/40 bg-app/90 px-2.5 py-1 text-[10px] font-semibold text-primary-ink shadow-sm"
        title="A research agent is on this card right now — figures will appear as they are verified.">
        <LoaderCircle className="h-3 w-3 animate-spin" />
        Agent researching
      </span>
    )}
    {!researching && hydrating && (
      <span data-testid="card-hydrating"
        className="absolute left-3 top-3 z-10 inline-flex items-center gap-1.5 rounded-full border border-sky-300/60 bg-app/90 px-2.5 py-1 text-[10px] font-semibold text-sky-700 shadow-sm dark:text-sky-300"
        title="This desk's dashboards are filling in from live sources — open the card and watch it cascade.">
        <Droplets className="h-3 w-3 animate-pulse" />
        Dashboards hydrating
      </span>
    )}
    {onOpen ? <button type="button" className="card-sleeve__open" onClick={onOpen}
      aria-label={`${view.title} — ${view.type} card`}>
      <CollectibleCard data={data} view={view} logoRetryNonce={logoRetryNonce}
        logoUrlOverride={logoUrlOverride} onLogoAvailabilityChange={onLogoAvailabilityChange} />
    </button> : <CollectibleCard data={data} view={view} logoRetryNonce={logoRetryNonce}
      logoUrlOverride={logoUrlOverride} onLogoAvailabilityChange={onLogoAvailabilityChange} />}
    {!hideActions && <div className="card-sleeve__actions">
      <span className="flex min-w-0 items-center gap-1 text-[11px] text-muted">
        {onOpen && <><ArrowUpRight size={13} aria-hidden="true" /> Inspect card</>}
      </span>
      <div className="flex gap-1">
        {data.company && logoAvailable === false && <button type="button" className="card-control"
          aria-label={`Retry logo lookup for ${data.company.name}`} title="Try the saved and public logo sources again"
          disabled={logoRetrying} onClick={() => void retryLogo()}>
          {logoRetrying ? <LoaderCircle size={15} className="animate-spin" /> : <RefreshCw size={14} />}
        </button>}
        <SaveCardButton cardId={data.card.id} />
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
