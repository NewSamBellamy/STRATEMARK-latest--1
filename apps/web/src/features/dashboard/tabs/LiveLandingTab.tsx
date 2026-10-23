import { useEffect, useRef, useState } from 'react';
import { ClipboardCheck, ExternalLink, Globe, Loader2, MonitorPlay } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useAuditSite, useCompany, useDashboardTab } from '@/hooks/data';
import { QueryBoundary } from '@/components/states/QueryBoundary';
import { useReadOnly } from '@/lib/readOnly';
import { HydratingPanel } from './HydratingPanel';
import { EmptyNote, SectionHeader } from './TabKit';
import {
  SHOT_MAX_ATTEMPTS as MAX_ATTEMPTS,
  SHOT_PLACEHOLDER_MAX_WIDTH as PLACEHOLDER_MAX_WIDTH,
  SHOT_RETRY_MS as RETRY_MS,
  pageShotUrl,
  pageShotUrlAlt,
} from '@/lib/screenshot';
import { probeSiteChallenge } from '@/lib/media/siteChallenge';
import { getRealCover } from '@/lib/media/realCover';
import { forgetShotProvider, recalledShotProvider, rememberShotProvider } from '@/lib/media/siteShotMemory';
import { useImageSlot } from '@/lib/media/useImageSlot';
import { imageReferrerPolicy } from '@/lib/hostedApi';

/** How long a capture may sit on "Capturing the live site" before we give up on it. */
export const CAPTURE_TIMEOUT_MS = 35_000;

/** Shown instead of a CAPTCHA screenshot, or a capture that never arrived. `inLink` when a parent link already opens the site. */
function PreviewUnavailable({ url, inLink }: { url: string; inLink: boolean }) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-2 px-4 text-center" data-testid="preview-unavailable">
      <div className="rounded-full bg-surface-2 p-3 text-muted"><Globe className="h-5 w-5" /></div>
      <p className="text-[12.5px] font-medium text-content">Preview unavailable - site blocks automated capture</p>
      {inLink ? (
        <span className="text-[12px] text-primary-ink">Open the site</span>
      ) : (
        <a href={url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-[12px] text-primary-ink hover:underline">
          <ExternalLink className="h-3 w-3" aria-hidden /> Open live site
        </a>
      )}
    </div>
  );
}

/** A live capture of the site. `quiet` renders nothing instead of the error
 * panel when both capture services are refused (for small inline previews). */
export function SitePreview({ url, fallbackShot, quiet = false, onFail }: { url: string; fallbackShot: string | null; quiet?: boolean; onFail?: () => void }) {
  const [attempt, setAttempt] = useState(0);
  // After mShots exhausts its attempts, ONE pass through the independent
  // second provider (thum.io) — the permanent "works here, not there" fix.
  // A site whose second provider worked last time starts there: no retry loop on a repeat visit.
  const [provider, setProvider] = useState<'primary' | 'alt'>(() => recalledShotProvider(url) ?? 'primary');
  // The page's own preview image: the last resort before the honest "unavailable" state.
  const [og, setOg] = useState<string | null>(null);
  const audit = useImageSlot('site-shot');
  const [settled, setSettled] = useState(false);
  const [failed, setFailed] = useState(false);
  const [unavailable, setUnavailable] = useState<'blocked' | 'timeout' | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    // Also on url change: a retry queued for the old url must not bump the new one.
    [url],
  );

  const scheduleRetry = () => {
    if (provider === 'alt') {
      forgetShotProvider(url);
      setFailed(true);
      onFail?.();
      return;
    }
    if (attempt >= MAX_ATTEMPTS) {
      setProvider('alt');
      return;
    }
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setAttempt((a) => a + 1), RETRY_MS);
  };

  useEffect(() => { audit.report('requested', url, url); }, [audit, url]);

  const gaveUp = failed || unavailable === 'timeout';
  useEffect(() => {
    if (!gaveUp) return;
    let live = true;
    void getRealCover(url).then((c) => { if (live && c?.src) setOg(c.src); });
    return () => { live = false; };
  }, [gaveUp, url]);
  useEffect(() => {
    if (gaveUp && !og && !(failed && fallbackShot)) audit.report('fallback', url, url);
  }, [audit, gaveUp, og, failed, fallbackShot, url]);

  const retryAll = () => {
    if (timer.current) clearTimeout(timer.current);
    setFailed(false);
    setUnavailable(null);
    setSettled(false);
    setProvider('primary');
    setAttempt((a) => a + 1); // fresh cache-buster
  };

  // A site that answers with a bot challenge would be screenshotted as its CAPTCHA.
  useEffect(() => {
    setUnavailable(null);
    let live = true;
    void probeSiteChallenge(url).then((blocked) => { if (live && blocked) setUnavailable('blocked'); });
    return () => { live = false; };
  }, [url]);

  // A capture that never settles ("Capturing the live site" forever) gets the same honest fallback.
  useEffect(() => {
    if (settled || failed) return;
    const t = setTimeout(() => setUnavailable((u) => u ?? 'timeout'), CAPTURE_TIMEOUT_MS);
    return () => clearTimeout(t);
  }, [url, settled, failed, attempt]);

  const ogImage = og ? (
    <img src={og} alt={`Preview of ${url}`} referrerPolicy={imageReferrerPolicy(og)}
      onLoad={() => audit.report('loaded', og, url)} onError={() => setOg(null)}
      className="h-full w-full object-cover object-top dark:opacity-80 dark:brightness-90" />
  ) : null;
  // A capture that timed out can still show the site's own preview picture; a CAPTCHA wall never does.
  if (unavailable === 'timeout' && ogImage) return ogImage;
  if (unavailable) return <PreviewUnavailable url={url} inLink={quiet} />;

  if (failed && fallbackShot) {
    return (
      <img
        src={fallbackShot}
        onLoad={() => audit.report('loaded', fallbackShot, url)}
        alt="Site preview"
        className="h-full w-full object-cover object-top dark:opacity-80 dark:brightness-90"
      />
    );
  }
  if (failed && ogImage) return ogImage;
  if (failed && quiet) return null;
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
        className="h-full w-full object-cover object-top dark:opacity-80 dark:brightness-90"
        onLoad={(e) => {
          const w = (e.target as HTMLImageElement).naturalWidth;
          // Placeholder → the capture is still rendering server-side; retry.
          if (w > 0 && w < PLACEHOLDER_MAX_WIDTH) scheduleRetry();
          else {
            setSettled(true);
            rememberShotProvider(url, provider);
            audit.report('loaded', (e.target as HTMLImageElement).currentSrc, url);
          }
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
  // A shared page never loads another site inside it, and never researches or audits: it only shows what was shared.
  const readOnly = useReadOnly();

  return (
    <QueryBoundary query={query} loading={<HydratingPanel label="Website" />}>
      {(result) => {
        const { url, screenshotUrl } = result.content;
        const embeddable = result.content.embeddable && !readOnly;
        if (!/^https?:\/\//.test(url)) {
          return (
            <EmptyNote title="No official website recorded">
              The Website tab shows a capture of the company’s own site. It fills in once research
              identifies {name}’s official domain.
            </EmptyNote>
          );
        }
        return (
          <div className="cascade">
            <SectionHeader
              title="Website"
              description={`${name}’s own site as it looks right now, captured for a first-hand read of how they present themselves. Audit the messaging or open the site directly.`}
              actions={
              <div className="flex flex-wrap items-center gap-2">
                {!readOnly && <button
                  type="button"
                  className="btn-ghost text-xs disabled:opacity-60"
                  title="A full review of this page: what works, what's missing and what to test, saved as a report with screenshots you can export as PDF. Uses one search on your key."
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
                </button>}
                {embeddable && (
                  <button
                    type="button"
                    className="btn-ghost text-xs"
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
                  className="btn-ghost text-xs"
                >
                  <ExternalLink className="h-3.5 w-3.5" />
                  Open site
                </a>
              </div>
              }
            />

            {/* Browser-chrome frame: the preview reads as a window onto the
                real site, not a broken image. */}
            <div className="panel overflow-hidden">
              <div className="flex items-center gap-2 border-b border-border bg-surface-2/70 px-3 py-2">
                <span className="flex gap-1.5">
                  <span className="h-2.5 w-2.5 rounded-full bg-border" />
                  <span className="h-2.5 w-2.5 rounded-full bg-border" />
                  <span className="h-2.5 w-2.5 rounded-full bg-border" />
                </span>
                <span className="ml-2 flex min-w-0 flex-1 items-center gap-1.5 rounded-md bg-surface px-2.5 py-1 text-[11px] text-muted">
                  <Globe className="h-3 w-3 shrink-0" />
                  <span className="truncate">{url.replace(/^https?:\/\//, '')}</span>
                </span>
              </div>
              <div className="h-[380px] bg-white sm:h-[520px]">
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
            <p className="mt-2 text-[11px] text-faint">
              {tryEmbed && embeddable
                ? `Live embed of ${url.replace(/^https?:\/\//, '')}.`
                : `Third-party screenshot of ${url.replace(/^https?:\/\//, '')}; it may lag the live page.`}
            </p>
          </div>
        );
      }}
    </QueryBoundary>
  );
}
