/**
 * The History tab's video, front and centre. It is the one video the search
 * chose and a second check accepted as this company's own story; the check's
 * one-line reason is shown under it. Nothing loads from YouTube until the
 * reader presses play (a thumbnail, then the privacy-enhanced embed).
 */
import { useState } from 'react';
import { Play } from 'lucide-react';
import type { HistoryVideo } from '@mi/contracts';
import { videoThumb } from '@/components/media/StoryMedia';

export function HistoryVideoHero({ video, companyName }: { video: HistoryVideo; companyName: string }) {
  const [playing, setPlaying] = useState(false);
  return (
    <section className="panel overflow-hidden" aria-label={`Video: ${video.title}`}>
      <div className="relative aspect-video bg-black">
        {playing ? (
          <iframe
            src={`https://www.youtube-nocookie.com/embed/${video.id}?autoplay=1&rel=0`}
            title={video.title}
            allow="autoplay; encrypted-media; picture-in-picture; fullscreen"
            allowFullScreen
            referrerPolicy="strict-origin-when-cross-origin"
            className="absolute inset-0 h-full w-full"
          />
        ) : (
          <button type="button" onClick={() => setPlaying(true)} className="group absolute inset-0 block w-full" aria-label={`Play video: ${video.title}`}>
            <img src={videoThumb(video.id)} alt="" loading="lazy" referrerPolicy="no-referrer" className="absolute inset-0 h-full w-full object-cover" />
            <span className="absolute inset-0 flex items-center justify-center bg-black/15 transition-colors group-hover:bg-black/30">
              <span className="flex h-16 w-16 items-center justify-center rounded-full bg-black/70 text-white shadow-lg">
                <Play className="ml-1 h-7 w-7" fill="currentColor" aria-hidden />
              </span>
            </span>
          </button>
        )}
      </div>
      <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-2 px-5 py-4">
        <div className="min-w-0">
          <p className="text-[11px] font-semibold uppercase tracking-widest text-faint">The {companyName} story, on video</p>
          <h3 className="mt-1 font-display text-[17px] font-semibold leading-snug text-content">{video.title}</h3>
          <p className="mt-1 text-[12px] text-muted">
            {video.channelUrl && /^https:[/][/](www[.])?youtube[.]com[/]/i.test(video.channelUrl)
              ? <a href={video.channelUrl} target="_blank" rel="noopener noreferrer" className="hover:text-primary-ink hover:underline">{video.channel}</a>
              : video.channel}
            {' · '}
            <a href={`https://www.youtube.com/watch?v=${video.id}`} target="_blank" rel="noopener noreferrer" className="hover:text-primary-ink hover:underline">Open on YouTube</a>
          </p>
        </div>
        <p className="max-w-sm text-[12px] leading-relaxed text-muted">
          <span className="font-medium text-content">Why this one: </span>{video.verdict}
          <span className="block text-[11px] text-faint">Found by search and checked against the company before it was shown.</span>
        </p>
      </div>
    </section>
  );
}
