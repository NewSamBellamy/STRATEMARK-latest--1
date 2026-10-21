import { useEffect, useState } from 'react';
import { faviconUrl } from '@/lib/screenshot';
import { cn } from '@/lib/cn';

/** First letter of the site's name, for when its icon cannot be loaded. */
export function hostInitial(pageUrl: string): string {
  try {
    const host = new URL(pageUrl).hostname.replace(/^www\./, '');
    return (host[0] ?? '?').toUpperCase();
  } catch {
    return '?';
  }
}

/** A site's small icon. A blocked or missing icon becomes the site's initial, never a broken dot. */
export function Favicon({ url, className }: { url: string; className?: string }) {
  const [broken, setBroken] = useState(false);
  useEffect(() => setBroken(false), [url]);
  if (broken) {
    return (
      <span aria-hidden data-testid="favicon-initial"
        className={cn('inline-grid shrink-0 place-items-center rounded-sm bg-surface-2 text-[8px] font-semibold leading-none text-muted', className)}>
        {hostInitial(url)}
      </span>
    );
  }
  return (
    <img src={faviconUrl(url)} alt="" loading="lazy" referrerPolicy="no-referrer" onError={() => setBroken(true)}
      className={cn('shrink-0', className)} />
  );
}
