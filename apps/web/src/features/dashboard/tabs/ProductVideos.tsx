/**
 * A product's verified YouTube videos, latest first. A tile shows YouTube's own
 * thumbnail; the player (privacy-enhanced youtube-nocookie) is created only when
 * a tile is pressed, so opening a product page loads no player and sets no cookie.
 * Titles and channels are YouTube's (oEmbed), never ours; a date is shown only when
 * the search that found the video reported one.
 */
import { useState } from 'react';
import { ExternalLink, Play } from 'lucide-react';
import type { ProductVideo } from '@mi/contracts';
import { videoThumb } from '@/components/media/StoryMedia';
import { formatDate } from '@/lib/format';
import { cn } from '@/lib/cn';

export function ProductVideos({ videos }: { videos: readonly ProductVideo[] }) {
  const [playing, setPlaying] = useState<string | null>(null);
  return (
    <ul className="grid gap-4 sm:grid-cols-2" aria-label="Product videos">
      {videos.map((v) => {
        const date = v.publishedAt && Number.isFinite(Date.parse(v.publishedAt)) ? formatDate(v.publishedAt) : null;
        return (
          <li key={v.id} className="min-w-0">
            <div className="relative aspect-video overflow-hidden rounded-xl bg-black">
              {playing === v.id ? (
                <iframe
                  src={`https://www.youtube-nocookie.com/embed/${v.id}?autoplay=1&rel=0`}
                  title={v.title}
                  allow="autoplay; encrypted-media; picture-in-picture; fullscreen"
                  allowFullScreen
                  referrerPolicy="strict-origin-when-cross-origin"
                  className="absolute inset-0 h-full w-full"
                />
              ) : (
                <button type="button" onClick={() => setPlaying(v.id)} aria-label={`Play video: ${v.title}`} className="group absolute inset-0 block w-full">
                  <img src={videoThumb(v.id)} alt="" loading="lazy" referrerPolicy="no-referrer"
                    className="absolute inset-0 h-full w-full object-cover transition-transform duration-300 group-hover:scale-[1.03]" />
                  <span className="absolute inset-0 flex items-center justify-center bg-black/15 transition-colors group-hover:bg-black/30">
                    <span className="flex h-12 w-12 items-center justify-center rounded-full bg-black/70 text-white shadow-lg">
                      <Play className="ml-0.5 h-5 w-5" fill="currentColor" aria-hidden />
                    </span>
                  </span>
                </button>
              )}
            </div>
            <p className="mt-2 line-clamp-2 text-[13px] font-medium leading-snug text-content">{v.title}</p>
            <p className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-faint">
              <span>{v.channel}</span>
              {date && <span>{date}</span>}
              <span className={cn(v.official ? 'rounded border border-emerald-300 bg-emerald-50 px-1 text-emerald-700' : 'hidden')}>Official channel</span>
              <a href={`https://www.youtube.com/watch?v=${v.id}`} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-0.5 text-primary-ink hover:underline">
                <ExternalLink className="h-3 w-3" aria-hidden /> YouTube
              </a>
            </p>
          </li>
        );
      })}
    </ul>
  );
}
