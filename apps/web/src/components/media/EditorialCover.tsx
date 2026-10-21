/**
 * The on-brand placeholder for a story, product or report that has no real
 * image and no generated one. It is built the way the signal cards are: the same
 * illustrated art the vice, barrier, culture and insight cards use, with a flat
 * caption plate carrying what we actually know: the publisher (with its real
 * favicon) and the headline. The art is picked from the publisher, so one
 * publisher always looks the same and a page of them has variety. It can
 * never be a CAPTCHA screenshot, and it costs nothing.
 */
import { publisherOf } from '@mi/contracts';
import { DEFAULT_CARD_ART } from '@/features/card/MarketCardArt';
import { Favicon } from '@/components/media/Favicon';
import { cn } from '@/lib/cn';

const ART_KEYS = ['insight', 'barrier', 'culture', 'vice'] as const;

function hashCode(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (Math.imul(31, h) + s.charCodeAt(i)) | 0;
  return Math.abs(h);
}

export function EditorialCover({
  title,
  url,
  compact = false,
  className,
}: {
  title: string;
  url: string;
  /** Kept so existing callers need not change; the placeholder does not vary by source type. */
  source?: 'news' | 'x' | 'reddit';
  /** Row thumbnail (tiny type) vs reader hero (full masthead treatment). */
  compact?: boolean;
  className?: string;
}) {
  const publisher = publisherOf(url, null);
  const art = DEFAULT_CARD_ART[ART_KEYS[hashCode(publisher || title) % ART_KEYS.length]!]!;
  const hasRealUrl = /^https?:\/\//.test(url) && !/vertexaisearch|grounding-api-redirect/i.test(url);

  return (
    <div className={cn('relative flex h-full w-full flex-col justify-end overflow-hidden bg-[#e9e4d3]', className)} aria-hidden>
      <img src={art.src} alt="" draggable={false} className="absolute inset-0 h-full w-full object-cover" />
      <div className={cn('relative bg-[#14201d]/85 text-white', compact ? 'px-2 py-1.5' : 'px-4 py-3')}>
        <div className="flex items-center gap-1.5">
          {hasRealUrl && <Favicon url={url} className={compact ? 'h-3 w-3 rounded-sm' : 'h-4 w-4 rounded-sm'} />}
          <span className={cn('truncate font-semibold uppercase tracking-widest text-white/70', compact ? 'text-[7px]' : 'text-[10px]')}>{publisher}</span>
        </div>
        <p className={cn('font-display font-semibold leading-snug', compact ? 'mt-0.5 line-clamp-2 text-[9px]' : 'mt-1 line-clamp-3 text-base')}>{title}</p>
      </div>
    </div>
  );
}
