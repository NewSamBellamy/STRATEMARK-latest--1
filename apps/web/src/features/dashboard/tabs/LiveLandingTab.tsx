import { useEffect, useRef, useState } from 'react';
import { ClipboardCheck, ExternalLink, Globe, Loader2, MonitorPlay } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useAuditSite, useCompany, useDashboardTab } from '@/hooks/data';
import { QueryBoundary } from '@/components/states/QueryBoundary';
import { HydratingPanel } from './HydratingPanel';
import {
  SHOT_MAX_ATTEMPTS as MAX_ATTEMPTS,
  SHOT_PLACEHOLDER_MAX_WIDTH as PLACEHOLDER_MAX_WIDTH,
  SHOT_RETRY_MS as RETRY_MS,
  pageShotUrl,
  pageShotUrlAlt,
} from '@/lib/screenshot';

function SitePreview({ url, fallbackShot }: { url: string; fallbackShot: string | null }) {
  const [attempt, setAttempt] = useState(0);
  // After mShots exhausts its attempts, ONE pass through the independent
  // second provider (thum.io) — the permanent "works here, not there" fix.
  const [provider, setProvider] = useState<'primary' | 'alt'>('primary');
  const [settled, setSettled] = useState(false);
  const [failed, setFailed] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  const scheduleRetry = () => {
    if (provider === 'alt') {
      setFailed(true);
      return;
    }
    if (attempt >= MAX_ATTEMPTS) {
      setProvider('alt');
      return;
    }
    timer.current = setTimeout(() => setAttempt((a) => a + 1), RETRY_MS);
  };

  const retryAll = () => {
    setFailed(false);
    setSettled(false);
    setProvider('primary');
    setAttempt((a) => a + 1); // fresh cache-buster
  };

  if (failed && fallbackShot) {
    return (
      <img
        src={fallbackShot}
        alt="Site preview"
        className="h-full w-full object-cover object-top"
      />
    );
  }
  if (failed) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 text-center">
        <div className="rounded-full bg-surface-2 p-4 text-muted">
          <Globe className="h-7 w-7" />
        </div>
        <p className="max-w-sm text-sm font-medium text-content">
          This site is anti-bot and we can't load a live capture. Please try again later.
        </p>
        <p className="max-w-sm text-[12px] leading-relaxed text-muted">
          Both capture services were refused (common for large companies). The audit still works —
          it reads the site through grounded search, not scraping.
        </p>
        <div className="flex items-center gap-2">
          <button type="button" onClick={retryAll} className="btn-ghost">
            <Loader2 className="h-4 w-4" />
            Try again
          </button>
          <a href={url} target="_blank" rel="noopener noreferrer" className="btn-primary">
            <MonitorPlay className="h-4 w-4" />
            Open live site
          </a>
        </div>
      </div>
    );
  }

  return (
    <div className="relative h-full w-full">
      <img
        key={`${provider}:${attempt}`}
        src={provider === 'alt' ? pageShotUrlAlt(url) : pageShotUrl(url, attempt)}
        alt={`Live preview of ${url}`}
        className="h-full w-full object-cover object-top"
        onLoad={(e) => {
          const w = (e.target as HTMLImageElement).naturalWidth;
          // Placeholder → the capture is still rendering server-side; retry.
          if (w > 0 && w < PLACEHOLDER_MAX_WIDTH) scheduleRetry();
          else setSettled(true);
        }}
        onError={() => scheduleRetry()}
      />
      {!settled && (
        <div className="absolute inset-x-0 bottom-0 flex items-center justify-center gap-2 bg-surface/85 px-3 py-2 text-[11px] font-medium text-muted backdrop-blur">
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
          {provider === 'alt'
            ? 'First capture service was refused — trying a second one…'
            : 'Capturing the live site — the preview sharpens in a few seconds…'}
        </div>
      )}
    </div>
  );
}

export function LiveLandingTab({ companyId }: { companyId: string }) {
  const query = useDashboardTab(companyId, 'live_landing');
  const name = useCompany(companyId).data?.name ?? 'this company';
  const audit = useAuditSite();
  const navigate = useNavigate();
  // Live embeds are opt-in: most real company sites send X-Frame-Options /
  // frame-ancestors and render as a silent blank frame — the "landing page
  // doesn't work" bug. The screenshot is the dependable default everywhere
  // (web, Electron, embeds); the iframe is a button away when allowed.
  const [tryEmbed, setTryEmbed] = useState(false);

  return (
    <QueryBoundary query={query} loading={<HydratingPanel label="Live Landing Page" />}>
      {(result) => {
        const { url, embeddable, screenshotUrl } = result.content;
        return (
          <div className="cascade">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <p className="text-sm text-muted">
                {name}’s live website, captured for a first-hand look at how they present
                themselves right now — audit the messaging or open the site directly.
              </p>
              {/* Compact actions (the full-size trio read as overwhelming). */}
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-[11px] font-medium text-muted transition-colors hover:bg-surface-2 hover:text-content disabled:opacity-60"
                  title="Full CRO/UX teardown of this page, saved as a visual report with screenshots — exportable as PDF. One grounded pass on your key."
                  disabled={audit.isPending}
                  onClick={() =>
                    audit.mutate(
                      { url, siteName: name, companyId },
                      { onSuccess: (r) => navigate(`/reports/${r.id}`) },
                    )
                  }
                >
                  {audit.isPending ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <ClipboardCheck className="h-3.5 w-3.5" />
                  )}
                  {audit.isPending ? 'Auditing…' : 'Audit this page'}
                </button>
                {embeddable && (
                  <button
                    type="button"
                    className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-[11px] font-medium text-muted transition-colors hover:bg-surface-2 hover:text-content"
                    onClick={() => setTryEmbed((v) => !v)}
                    title={
                      tryEmbed
                        ? 'Back to the screenshot preview (fast, always works)'
                        : 'Load the real site inside the app — browse it interactively (some sites block this)'
                    }
                  >
                    <MonitorPlay className="h-3.5 w-3.5" />
                    {tryEmbed ? 'Screenshot preview' : 'Use live site'}
                  </button>
                )}
                <a
                  href={url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-[11px] font-medium text-muted transition-colors hover:bg-surface-2 hover:text-content"
                >
                  <ExternalLink className="h-3.5 w-3.5" />
                  Open site
                </a>
              </div>
            </div>

            {/* Browser-chrome frame: the preview reads as a window onto the
                real site, not a broken image. */}
            <div className="panel overflow-hidden">
              <div className="flex items-center gap-2 border-b border-border bg-surface-2/70 px-3 py-2">
                <span className="flex gap-1.5">
                  <span className="h-2.5 w-2.5 rounded-full bg-[#FF5F57]" />
                  <span className="h-2.5 w-2.5 rounded-full bg-[#FEBC2E]" />
                  <span className="h-2.5 w-2.5 rounded-full bg-[#28C840]" />
                </span>
                <span className="ml-2 flex min-w-0 flex-1 items-center gap-1.5 rounded-md bg-surface px-2.5 py-1 text-[11px] text-muted">
                  <Globe className="h-3 w-3 shrink-0" />
                  <span className="truncate">{url.replace(/^https?:\/\//, '')}</span>
                </span>
              </div>
              <div className="h-[520px] bg-white">
                {tryEmbed && embeddable ? (
                  <iframe
                    title={`Live site for ${companyId}`}
                    src={url}
                    className="h-full w-full border-0 bg-white"
                    sandbox="allow-scripts allow-same-origin allow-popups"
                    referrerPolicy="no-referrer"
                    loading="lazy"
                  />
                ) : (
                  <SitePreview url={url} fallbackShot={screenshotUrl ?? null} />
                )}
              </div>
            </div>
          </div>
        );
      }}
    </QueryBoundary>
  );
}
