/**
 * The Site Audit, rendered like the deliverable an agency would bill for:
 * a real screenshot of the page in a browser frame, a six-area scorecard
 * with an overall dial, what's working, what's missing (with the cost of
 * each gap), the design language read, and the tests to run first.
 *
 * Everything visual is honest: the screenshot is a live capture of the
 * actual page (retried past the renderer's placeholder), and every claim
 * keeps the sources the desk grounded it in.
 */
import { useEffect, useRef, useState } from 'react';
import {
  CalendarDays,
  CheckCircle2,
  ExternalLink,
  FlaskConical,
  Globe,
  Palette,
  Printer,
  XCircle,
} from 'lucide-react';
import { publisherOf, type Report, type SiteAuditArea, type SiteAuditContent } from '@mi/contracts';
import {
  pageShotUrl,
  SHOT_MAX_ATTEMPTS,
  SHOT_PLACEHOLDER_MAX_WIDTH,
  SHOT_RETRY_MS,
} from '@/lib/screenshot';
import {
  captureSite,
  isServiceConfigured,
  serviceConfig,
  type CaptureOutcome,
} from '@/lib/api/service';
import { useApiKey } from '@/lib/settings/apiKey';
import { printScoped } from '@/lib/print';
import { isDirectSource, sourceHref } from '@/lib/sourceHref';
import { cn } from '@/lib/cn';

const AREA_LABEL: Record<SiteAuditArea, string> = {
  value_proposition: 'Value proposition',
  messaging: 'Messaging & copy',
  cta: 'Calls to action',
  trust: 'Trust & social proof',
  design: 'Design & hierarchy',
  seo: 'Findability / SEO',
};

/**
 * Live page capture in a browser-chrome frame.
 *
 * Two paths, and which one runs depends only on whether the agent service is
 * configured:
 *
 *   SERVICE PRESENT — capture happens in real Chromium server-side and the
 *     result is VERIFIED before it is shown. A blocked page yields a generated
 *     card carrying the capture receipt (final URL, HTTP status, content hash)
 *     rather than a screenshot of a CAPTCHA. That receipt is the evidence the
 *     site was genuinely visited, which is what makes the audit trustworthy
 *     when the image is missing.
 *
 *   NO SERVICE — the browser-side path retries past the renderer's placeholder
 *     and then reports honestly when a capture is unavailable.
 */
function PageCapture({ url, siteName }: { url: string; siteName: string }) {
  const [attempt, setAttempt] = useState(0);
  const [failed, setFailed] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [verified, setVerified] = useState<CaptureOutcome | null>(null);
  const [verifying, setVerifying] = useState(isServiceConfigured());
  // The user's own key travels with the request when they have one, so a
  // bring-your-own-key subscriber spends their quota rather than ours.
  const apiKey = useApiKey((s) => s.apiKey);

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  // Server-side capture, when a service exists to do it.
  useEffect(() => {
    if (!isServiceConfigured()) return;
    let live = true;
    setVerifying(true);
    captureSite(url, serviceConfig(apiKey || undefined))
      .then((outcome) => {
        if (live) setVerified(outcome);
      })
      .finally(() => {
        if (live) setVerifying(false);
      });
    return () => {
      live = false;
    };
  }, [url, apiKey]);

  const serviceBlocked = verified && !verified.ok && 'fallbackSvg' in verified;
  const serviceOk = verified?.ok === true;

  return (
    <figure className="overflow-hidden rounded-xl border border-border shadow-card">
      {/* Browser chrome — the capture reads as "their actual site". */}
      <div className="flex items-center gap-2 border-b border-border bg-surface-2 px-3 py-2">
        <span className="flex gap-1.5">
          <i className="h-2.5 w-2.5 rounded-full bg-rose-300" />
          <i className="h-2.5 w-2.5 rounded-full bg-amber-300" />
          <i className="h-2.5 w-2.5 rounded-full bg-emerald-300" />
        </span>
        <span className="truncate rounded-md bg-surface px-2.5 py-0.5 text-[11px] tabular-nums text-muted">
          {url.replace(/^https?:\/\//, '')}
        </span>
      </div>
      <div className="relative h-[300px] bg-surface-2 sm:h-[360px]">
        {verifying ? (
          <div className="flex h-full flex-col items-center justify-center gap-2 text-muted">
            <Globe className="h-7 w-7 animate-pulse" />
            <p className="text-sm">Capturing the live page…</p>
          </div>
        ) : serviceOk && verified?.ok ? (
          <img
            src={verified.screenshot}
            alt={`Verified screenshot of ${siteName}`}
            className="h-full w-full object-cover object-top"
          />
        ) : serviceBlocked && verified && 'fallbackSvg' in verified ? (
          // A generated card, not the block page. The receipt inside it is the
          // proof of visit that keeps the rest of the audit credible.
          <div
            className="flex h-full w-full items-center justify-center bg-surface p-3"
            // The SVG is produced by our own service from structured fields,
            // every one of them escaped at the point of render (lib/fallback.ts).
            dangerouslySetInnerHTML={{ __html: verified.fallbackSvg }}
          />
        ) : failed ? (
          <div className="flex h-full flex-col items-center justify-center gap-2 text-muted">
            <Globe className="h-7 w-7" />
            <p className="text-sm">Capture unavailable — open the site directly.</p>
          </div>
        ) : (
          <img
            key={attempt}
            src={pageShotUrl(url, attempt)}
            alt={`Screenshot of ${siteName}`}
            className="h-full w-full object-cover object-top"
            onLoad={(e) => {
              const w = (e.target as HTMLImageElement).naturalWidth;
              if (w > 0 && w < SHOT_PLACEHOLDER_MAX_WIDTH) {
                if (attempt >= SHOT_MAX_ATTEMPTS) setFailed(true);
                else timer.current = setTimeout(() => setAttempt((a) => a + 1), SHOT_RETRY_MS);
              }
            }}
            onError={() => setFailed(true)}
          />
        )}
      </div>
      <figcaption className="border-t border-border bg-surface-2/60 px-3 py-1.5 text-[10px] text-faint">
        <span>
          {serviceOk && verified?.ok
            ? `Verified live capture — ${verified.receipt.finalUrl.replace(/^https?:\/\//, '')} answered ${
                verified.receipt.httpStatus ?? 'a response'
              } at ${verified.receipt.capturedAt.replace('T', ' ').slice(0, 16)} UTC.`
            : serviceBlocked && verified && 'caption' in verified
              ? verified.caption
              : failed
                ? 'Live capture unavailable. No substitute image is shown as evidence.'
                : 'Live capture of the audited page. Some sites serve anti-bot challenges to capture services.'}
        </span>
      </figcaption>
    </figure>
  );
}

function ScoreBar({ score }: { score: number }) {
  const tone = score >= 8 ? 'bg-emerald-500' : score >= 5 ? 'bg-amber-500' : 'bg-rose-500';
  return (
    <div className="h-1.5 w-full overflow-hidden rounded-full bg-surface-2">
      <div className={cn('h-full rounded-full', tone)} style={{ width: `${score * 10}%` }} />
    </div>
  );
}

export function SiteAuditView({ report, audit }: { report: Report; audit: SiteAuditContent }) {
  const date = new Date(report.createdAt).toLocaleDateString(undefined, {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  });
  const dialTone =
    audit.overall >= 80
      ? 'text-emerald-600'
      : audit.overall >= 50
        ? 'text-amber-600'
        : 'text-rose-600';

  return (
    <article className="brf-print-root mx-auto max-w-3xl">
      {/* ── Masthead ── */}
      <header className="border-y-[3px] border-double border-content/70 py-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-[11px] font-semibold uppercase tracking-[0.3em] text-muted">
            Stratemark · Site Audit
          </p>
          <button
            type="button"
            onClick={printScoped}
            className="brf-no-print inline-flex items-center gap-1.5 rounded-lg border border-border bg-surface px-3 py-1.5 text-[12px] font-medium text-content transition-colors hover:bg-surface-2"
            title="Print or save this audit as a PDF"
          >
            <Printer className="h-3.5 w-3.5" />
            PDF
          </button>
        </div>
        <div className="mt-2 flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="font-display text-3xl font-bold tracking-tight text-content sm:text-4xl">
              {audit.siteName}
            </h1>
            <p className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-[12px] text-muted">
              <a
                href={audit.url}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 text-primary-ink hover:underline"
              >
                <Globe className="h-3.5 w-3.5" />
                {audit.url.replace(/^https?:\/\//, '')}
              </a>
              <span className="inline-flex items-center gap-1.5">
                <CalendarDays className="h-3.5 w-3.5" />
                {date}
              </span>
            </p>
          </div>
          {/* The overall dial. */}
          <div className="text-right">
            <p
              className={cn('font-display text-5xl font-bold leading-none tabular-nums', dialTone)}
            >
              {audit.overall}
            </p>
            <p className="mt-1 text-[10px] font-semibold uppercase tracking-widest text-muted">
              overall / 100
            </p>
          </div>
        </div>
      </header>

      {/* ── The page itself ── */}
      <div className="mt-6">
        <PageCapture url={audit.url} siteName={audit.siteName} />
      </div>

      {/* ── Scorecard ── */}
      {audit.scores.length > 0 && (
        <section className="mt-8">
          <h2 className="mb-4 text-[11px] font-semibold uppercase tracking-[0.22em] text-muted">
            Scorecard
          </h2>
          <div className="grid gap-x-8 gap-y-4 sm:grid-cols-2">
            {audit.scores.map((s) => (
              <div key={s.area}>
                <div className="mb-1 flex items-baseline justify-between gap-2">
                  <span className="text-sm font-medium text-content">{AREA_LABEL[s.area]}</span>
                  <span className="font-display text-sm font-bold tabular-nums text-content">
                    {s.score}
                    <span className="text-faint">/10</span>
                  </span>
                </div>
                <ScoreBar score={s.score} />
                {s.verdict && (
                  <p className="mt-1.5 text-[12px] leading-snug text-muted">{s.verdict}</p>
                )}
              </div>
            ))}
          </div>
        </section>
      )}

      {/* ── Working / Missing ── */}
      <section className="mt-8 grid gap-4 sm:grid-cols-2">
        <div className="rounded-xl border border-emerald-200 bg-emerald-50/40 p-5 dark:border-emerald-900 dark:bg-emerald-950/20">
          <h2 className="mb-3 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.22em] text-emerald-700 dark:text-emerald-400">
            <CheckCircle2 className="h-3.5 w-3.5" />
            What's working
          </h2>
          <ul className="space-y-3">
            {audit.working.map((f, i) => (
              <li key={i}>
                <p className="text-sm font-semibold text-content">{f.title}</p>
                <p className="mt-0.5 text-[13px] leading-relaxed text-muted">{f.detail}</p>
              </li>
            ))}
            {audit.working.length === 0 && (
              <li className="text-sm italic text-muted">Nothing the sources could confirm.</li>
            )}
          </ul>
        </div>
        <div className="rounded-xl border border-rose-200 bg-rose-50/40 p-5 dark:border-rose-900 dark:bg-rose-950/20">
          <h2 className="mb-3 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.22em] text-rose-700 dark:text-rose-400">
            <XCircle className="h-3.5 w-3.5" />
            What's missing
          </h2>
          <ul className="space-y-3">
            {audit.missing.map((f, i) => (
              <li key={i}>
                <p className="text-sm font-semibold text-content">{f.title}</p>
                <p className="mt-0.5 text-[13px] leading-relaxed text-muted">{f.detail}</p>
                {f.impact && (
                  <p className="mt-1 text-[12px] font-medium text-rose-700 dark:text-rose-400">
                    Impact: {f.impact}
                  </p>
                )}
              </li>
            ))}
            {audit.missing.length === 0 && (
              <li className="text-sm italic text-muted">No confirmed gaps — rare air.</li>
            )}
          </ul>
        </div>
      </section>

      {/* ── Design style ── */}
      {(audit.designStyle.summary || audit.designStyle.notes.length > 0) && (
        <section className="mt-8">
          <h2 className="mb-4 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.22em] text-muted">
            <Palette className="h-3.5 w-3.5 text-primary-ink" />
            Design style
          </h2>
          <div className="panel p-5">
            <p className="text-sm leading-relaxed text-content/90">{audit.designStyle.summary}</p>
            {audit.designStyle.notes.length > 0 && (
              <ul className="mt-3 flex flex-wrap gap-2">
                {audit.designStyle.notes.map((n, i) => (
                  <li key={i} className="chip border-border bg-surface-2 text-muted">
                    {n}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </section>
      )}

      {/* ── Test first ── */}
      {audit.testFirst.length > 0 && (
        <section className="mt-8">
          <h2 className="mb-4 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.22em] text-muted">
            <FlaskConical className="h-3.5 w-3.5 text-primary-ink" />
            Test first
          </h2>
          <ol className="space-y-3">
            {audit.testFirst.map((f, i) => (
              <li key={i} className="panel flex items-start gap-3.5 p-4">
                <span className="mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-primary font-display text-sm font-bold text-white">
                  {i + 1}
                </span>
                <div>
                  <p className="text-sm font-semibold text-content">{f.title}</p>
                  <p className="mt-0.5 text-[13px] leading-relaxed text-muted">{f.detail}</p>
                </div>
              </li>
            ))}
          </ol>
        </section>
      )}

      {/* ── Sources ── */}
      {report.citations.length > 0 && (
        <footer className="mt-8 border-t border-border pt-4">
          <h2 className="mb-2 text-[10px] font-semibold uppercase tracking-[0.22em] text-muted">
            Sources ({report.citations.length})
          </h2>
          <div className="flex flex-wrap gap-x-4 gap-y-1.5">
            {report.citations.slice(0, 12).map((c, i) => (
              <a
                key={i}
                href={sourceHref(c.url, c.title)}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 text-[11px] text-primary-ink hover:underline"
                title={isDirectSource(c.url) ? 'Read the source' : 'Find the original story'}
              >
                <ExternalLink className="h-3 w-3" />
                {publisherOf(c.url, c.title)}
              </a>
            ))}
          </div>
          <p className="mt-3 text-[11px] leading-relaxed text-faint">
            Grounded teardown by the Stratemark desk — scores and findings come from what search
            evidence supports about the page, never from invented elements.
          </p>
        </footer>
      )}
    </article>
  );
}
