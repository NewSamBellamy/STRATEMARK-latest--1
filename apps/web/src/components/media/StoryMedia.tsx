/**
 * Real pictures for stories and the company's own videos.
 *
 * A story's picture is the one its publisher made for link previews
 * (og:image), loaded only when the row scrolls into view and credited to the
 * publisher. Nothing is generated: no picture means no picture.
 * Videos come from the company's own YouTube channel and play inside the app
 * (privacy-enhanced embed, loaded only when the reader presses play).
 */
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Play, X } from 'lucide-react';
import type { CompanyVideo } from '@mi/contracts';
import { Modal } from '@/components/ui/Modal';
import { SafeLink } from '@/components/SafeLink';
import { hasHostedApi, hostedUrl } from '@/lib/hostedApi';
import { getRealCover } from '@/lib/media/realCover';
import { cn } from '@/lib/cn';

/** True once the element has come near the viewport (then stays true). */
export function useInView<T extends Element>(margin = '300px'): [React.RefObject<T>, boolean] {
  const ref = useRef<T>(null);
  const [seen, setSeen] = useState(false);
  useEffect(() => {
    if (seen || !ref.current) return;
    if (typeof IntersectionObserver === 'undefined') { setSeen(true); return; }
    const io = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting)) { setSeen(true); io.disconnect(); }
    }, { rootMargin: margin });
    io.observe(ref.current);
    return () => io.disconnect();
  }, [seen, margin]);
  return [ref, seen];
}

/** Publisher images go through the hosted proxy when there is one, so the
 * publisher never sees the reader's address. */
function displayable(src: string): string {
  return hasHostedApi() ? hostedUrl(`image?url=${encodeURIComponent(src)}`) : src;
}

export interface StoryPicture { src: string; credit: string | null }

/** The story's own preview picture: stored by research, else read lazily. */
export function useStoryPicture(pageUrl: string | null | undefined, stored: string | null | undefined, publisher: string | null | undefined, enabled: boolean): StoryPicture | null | 'loading' {
  const [state, setState] = useState<StoryPicture | null | 'loading'>(stored ? { src: displayable(stored), credit: publisher ?? null } : 'loading');
  useEffect(() => {
    if (stored) { setState({ src: displayable(stored), credit: publisher ?? null }); return; }
    if (!enabled) return;
    if (!pageUrl || !/^https:\/\//i.test(pageUrl)) { setState(null); return; }
    let live = true;
    void getRealCover(pageUrl).then((c) => {
      if (live) setState(c?.src ? { src: c.src, credit: publisher ?? c.publisher } : null);
    });
    return () => { live = false; };
  }, [pageUrl, stored, publisher, enabled]);
  return state;
}

/**
 * A story picture that fills its box. While loading it shows a quiet shimmer;
 * when the story has no picture (or it fails to load) `fallback` is rendered,
 * or nothing.
 */
export function StoryImage({ pageUrl, imageUrl, publisher, className, fallback = null, credit = false }: {
  pageUrl: string | null | undefined;
  imageUrl?: string | null;
  publisher?: string | null;
  className?: string;
  fallback?: ReactNode;
  credit?: boolean;
}) {
  const [ref, inView] = useInView<HTMLDivElement>();
  const picture = useStoryPicture(pageUrl, imageUrl, publisher, inView);
  const [broken, setBroken] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const failed = picture === null || broken;
  if (failed && fallback === null) return <div ref={ref} className="hidden" />;
  return (
    <div ref={ref} className={cn('relative overflow-hidden bg-surface-2', className)}>
      {failed ? fallback : picture === 'loading' ? (
        <div className="absolute inset-0 animate-pulse bg-surface-2" aria-hidden />
      ) : (
        <>
          <img
            src={picture.src}
            alt=""
            loading="lazy"
            decoding="async"
            referrerPolicy="no-referrer"
            onLoad={() => setLoaded(true)}
            onError={() => setBroken(true)}
            className={cn('absolute inset-0 h-full w-full object-cover transition-opacity duration-500', loaded ? 'opacity-100' : 'opacity-0')}
          />
          {credit && picture.credit && loaded && (
            <span className="absolute bottom-1.5 right-1.5 rounded bg-black/55 px-1.5 py-0.5 text-[10px] text-white/90">
              Image: {picture.credit}
            </span>
          )}
        </>
      )}
    </div>
  );
}

// ---- Videos -----------------------------------------------------------------

export const videoThumb = (id: string) => `https://i.ytimg.com/vi/${id}/hqdefault.jpg`;

export function VideoTile({ video, onPlay, className }: { video: CompanyVideo; onPlay: () => void; className?: string }) {
  return (
    <button type="button" onClick={onPlay}
      className={cn('group block w-full text-left', className)}
      aria-label={`Play video: ${video.title}`}>
      <div className="relative aspect-video overflow-hidden rounded-lg bg-surface-2">
        <img src={videoThumb(video.id)} alt="" loading="lazy" referrerPolicy="no-referrer"
          className="absolute inset-0 h-full w-full object-cover transition-transform duration-300 group-hover:scale-[1.03]" />
        <span className="absolute inset-0 flex items-center justify-center bg-black/10 transition-colors group-hover:bg-black/25">
          <span className="flex h-11 w-11 items-center justify-center rounded-full bg-black/65 text-white shadow-lg">
            <Play className="ml-0.5 h-5 w-5" fill="currentColor" aria-hidden />
          </span>
        </span>
      </div>
      <p className="mt-2 line-clamp-2 text-[13px] font-medium leading-snug text-content group-hover:text-primary-ink">{video.title}</p>
      {(video.age || video.views) && (
        <p className="mt-0.5 text-[11px] text-faint">{[video.views && `${video.views} views`, video.age].filter(Boolean).join(' · ')}</p>
      )}
    </button>
  );
}

export function VideoPlayer({ video, onClose }: { video: CompanyVideo; onClose: () => void }) {
  return (
    <Modal open onOpenChange={(o) => { if (!o) onClose(); }} title={video.title}
      description={`From the company's own YouTube channel${video.age ? ` · ${video.age}` : ''}`}>
      <div className="relative aspect-video overflow-hidden rounded-xl bg-black">
        <iframe
          src={`https://www.youtube-nocookie.com/embed/${video.id}?autoplay=1&rel=0`}
          title={video.title}
          allow="autoplay; encrypted-media; picture-in-picture; fullscreen"
          allowFullScreen
          referrerPolicy="strict-origin-when-cross-origin"
          className="absolute inset-0 h-full w-full"
        />
      </div>
      <div className="mt-3 flex items-center justify-between text-xs text-muted">
        <a href={`https://www.youtube.com/watch?v=${video.id}`} target="_blank" rel="noopener noreferrer" className="hover:text-primary-ink hover:underline">
          Open on YouTube
        </a>
        <SafeLink href={video.channelUrl} className="hover:text-primary-ink hover:underline">
          Company channel
        </SafeLink>
      </div>
    </Modal>
  );
}

/** A row of the company's latest videos; plays inline. */
export function VideoStrip({ videos, max = 4 }: { videos: readonly CompanyVideo[]; max?: number }) {
  const [playing, setPlaying] = useState<CompanyVideo | null>(null);
  if (!videos.length) return null;
  return (
    <>
      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        {videos.slice(0, max).map((v) => <VideoTile key={v.id} video={v} onPlay={() => setPlaying(v)} />)}
      </div>
      {playing && <VideoPlayer video={playing} onClose={() => setPlaying(null)} />}
    </>
  );
}

export { X as CloseIcon };
