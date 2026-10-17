/**
 * A real capture of any web page — article hero, product page, masthead.
 * Retries past the capture service's "generating…" placeholder until the true
 * capture arrives ("keeps trying until it's right"); hides itself entirely if
 * it never materializes, so a broken frame is never shown.
 */
import { useEffect, useRef, useState } from 'react';
import {
  SHOT_MAX_ATTEMPTS,
  SHOT_PLACEHOLDER_MAX_WIDTH,
  SHOT_RETRY_MS,
  pageShotUrl,
} from '@/lib/screenshot';

export function PageShot({ url, className }: { url: string; className?: string }) {
  const [attempt, setAttempt] = useState(0);
  const [failed, setFailed] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [url],
  );
  if (failed) return null;
  const retry = () => {
    if (attempt >= SHOT_MAX_ATTEMPTS) {
      setFailed(true);
      return;
    }
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setAttempt((a) => a + 1), SHOT_RETRY_MS);
  };
  return (
    <img
      key={attempt}
      src={pageShotUrl(url, attempt)}
      alt=""
      loading="lazy"
      className={className}
      onLoad={(e) => {
        const w = (e.target as HTMLImageElement).naturalWidth;
        if (w > 0 && w < SHOT_PLACEHOLDER_MAX_WIDTH) retry();
      }}
      onError={retry}
    />
  );
}
