/**
 * A product's picture, honestly sourced and always something to look at:
 *   1. the preview picture of the product's own page, then of an official-domain
 *      page a source named for it (productsReport.pictureCandidates);
 *   2. the company's own site preview (credited as such);
 *   3. a clean typographic plate with the product's name.
 * Candidates are tried in order by chaining StoryImage fallbacks; nothing is generated
 * and no address is guessed. `onlyProduct` stops before the company-site step (cards).
 */
import { Logo } from '@/features/card/Logo';
import { StoryImage } from '@/components/media/StoryMedia';
import { cn } from '@/lib/cn';
import type { PictureCandidate } from '../productsReport';

export interface PictureSubject { name: string; website: string | null; logoUrl?: string | null }

/** The plate that stands in when no real picture exists. */
export function TypographicPlate({ product, company, className }: { product: string; company: PictureSubject; className?: string }) {
  return (
    <div className={cn('absolute inset-0 flex items-end justify-between gap-3 bg-gradient-to-br from-surface-2 via-surface to-surface-2 p-5', className)} data-testid="product-plate">
      <div className="min-w-0">
        <p className="truncate text-[10.5px] font-semibold uppercase tracking-[0.14em] text-faint">{company.name}</p>
        <p className="mt-1 line-clamp-2 font-display text-2xl leading-tight text-content sm:text-3xl">{product}</p>
      </div>
      <Logo name={company.name} website={company.website} logoUrl={company.logoUrl} className="h-11 w-11 shrink-0 rounded-full border border-border bg-surface" />
    </div>
  );
}

function Chain({ list, at, product, company }: { list: readonly PictureCandidate[]; at: number; product: string; company: PictureSubject }) {
  const c = list[at];
  if (!c) return <TypographicPlate product={product} company={company} />;
  return (
    <StoryImage
      pageUrl={c.url}
      subject={{ name: company.name, website: company.website }}
      publisher={c.kind === 'site' ? `${company.name} website` : null}
      credit
      className="absolute inset-0"
      fallback={<div className="absolute inset-0"><Chain list={list} at={at + 1} product={product} company={company} /></div>}
    />
  );
}

export function ProductPicture({ candidates, product, company, className, onlyProduct = false }: {
  candidates: readonly PictureCandidate[]; product: string; company: PictureSubject; className?: string; onlyProduct?: boolean;
}) {
  const list = onlyProduct ? candidates.filter((c) => c.kind !== 'site') : candidates;
  // A card with nothing product-specific shows no band at all: the company's homepage on every card is noise.
  if (onlyProduct && list.length === 0) return null;
  return (
    <div className={cn('relative overflow-hidden bg-surface-2', className)}>
      <Chain list={list} at={0} product={product} company={company} />
    </div>
  );
}
