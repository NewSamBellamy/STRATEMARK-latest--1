/**
 * The Daily Briefing, opened — an editorial one-pager in the paper-of-record
 * register: masthead, lede, high-signal features with deterministic editorial
 * covers, a compact "also notable" wire, and sourced takeaways.
 *
 * "Download PDF" is the browser's print pipeline scoped to this element —
 * high-fidelity, zero dependencies.
 */
import { Link } from 'react-router-dom';
import { Activity, CalendarDays, ExternalLink, Printer, Radio } from 'lucide-react';
import { publisherOf } from '@mi/contracts';
import { EditorialCover } from '@/components/media/EditorialCover';
import { printScoped } from '@/lib/print';
import { isDirectSource, sourceHref } from '@/lib/sourceHref';
import { cn } from '@/lib/cn';

export interface BriefingViewUpdate {
  companyName: string;
  companyId: string | null;
  signal: 'high' | 'notable';
  oneLiner: string;
  detail: string;
  publishedDate: string | null;
  citations: Array<{ title: string; url: string }>;
}

export interface BriefingView {
  marketName: string;
  generatedAt: string;
  windowHours: number;
  headline: string;
  updates: BriefingViewUpdate[];
  insights: string[];
}

function Cover({ update, compact }: { update: BriefingViewUpdate; compact?: boolean }) {
  const url = update.citations[0]?.url ?? '';
  return <EditorialCover title={update.oneLiner} url={url} source="news" compact={compact} />;
}

function SourceLinks({ citations }: { citations: Array<{ title: string; url: string }> }) {
  if (citations.length === 0) return null;
  return (
    <span className="flex flex-wrap gap-x-3 gap-y-1">
      {citations.map((c, i) => (
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
    </span>
  );
}

export function BriefingReport({
  view,
  shared = false,
  actions,
}: {
  view: BriefingView;
  /** Recipient mode: deterministic covers, no dashboard links. */
  shared?: boolean;
  /** Owner-side buttons rendered in the masthead (share, regenerate…). */
  actions?: React.ReactNode;
}) {
  const highs = view.updates.filter((u) => u.signal === 'high');
  const notables = view.updates.filter((u) => u.signal === 'notable');
  const sourceCount = new Set(view.updates.flatMap((u) => u.citations.map((c) => c.url))).size;
  const date = new Date(view.generatedAt).toLocaleDateString(undefined, {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  });

  const CompanyTag = ({ u }: { u: BriefingViewUpdate }) =>
    !shared && u.companyId ? (
      <Link
        to={`/company/${u.companyId}/dashboard/overview`}
        className="text-[11px] font-bold uppercase tracking-widest text-primary-ink hover:underline"
      >
        {u.companyName}
      </Link>
    ) : (
      <span className="text-[11px] font-bold uppercase tracking-widest text-primary-ink">
        {u.companyName}
      </span>
    );

  return (
    <article className="brf-print-root mx-auto max-w-3xl">
      {/* ── Masthead ── */}
      <header className="border-y-[3px] border-double border-content/70 py-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-[11px] font-semibold uppercase tracking-[0.3em] text-muted">
            Stratemark · Daily Briefing
          </p>
          <div className="brf-no-print flex items-center gap-1.5">
            {actions}
            <button
              type="button"
              onClick={printScoped}
              className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-surface px-3 py-1.5 text-[12px] font-medium text-content transition-colors hover:bg-surface-2"
              title="Print or save this briefing as a PDF"
            >
              <Printer className="h-3.5 w-3.5" />
              PDF
            </button>
          </div>
        </div>
        <h1 className="mt-2 font-display text-3xl font-bold tracking-tight text-content sm:text-4xl">
          {view.marketName}
        </h1>
        <p className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-[12px] text-muted">
          <span className="inline-flex items-center gap-1.5">
            <CalendarDays className="h-3.5 w-3.5" />
            {date}
          </span>
          <span className="inline-flex items-center gap-1.5">
            <Radio className="h-3.5 w-3.5" />
            last {view.windowHours}h window
          </span>
          <span>
            {view.updates.length} sourced update{view.updates.length === 1 ? '' : 's'} ·{' '}
            {sourceCount} source{sourceCount === 1 ? '' : 's'}
          </span>
        </p>
      </header>

      {/* ── Lede ── */}
      <p className="mt-6 border-l-[3px] border-primary pl-4 font-display text-xl font-semibold leading-snug text-content sm:text-[22px]">
        {view.headline}
      </p>

      {/* ── High signal ── */}
      {highs.length > 0 && (
        <section className="mt-8">
          <h2 className="mb-4 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.22em] text-muted">
            <Activity className="h-3.5 w-3.5 text-primary-ink" />
            High signal
          </h2>
          <div className="space-y-5">
            {highs.map((u, i) => (
              <div key={i} className="panel overflow-hidden p-0">
                <div className="grid sm:grid-cols-[240px_1fr]">
                  <div className="h-[150px] sm:h-full">
                    <Cover update={u} />
                  </div>
                  <div className="p-5">
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                      <CompanyTag u={u} />
                      {u.publishedDate && (
                        <span className="text-[11px] tabular-nums text-faint">
                          {u.publishedDate}
                        </span>
                      )}
                    </div>
                    <h3 className="mt-1.5 font-display text-[17px] font-semibold leading-snug text-content">
                      {u.oneLiner}
                    </h3>
                    <p className="mt-2 text-sm leading-relaxed text-muted">{u.detail}</p>
                    <div className="mt-3">
                      <SourceLinks citations={u.citations} />
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* ── Also notable ── */}
      {notables.length > 0 && (
        <section className="mt-8">
          <h2 className="mb-3 text-[11px] font-semibold uppercase tracking-[0.22em] text-muted">
            Also notable
          </h2>
          <ul className="divide-y divide-border rounded-xl border border-border">
            {notables.map((u, i) => (
              <li key={i} className="flex items-start gap-3.5 p-4">
                <span className="hidden h-[56px] w-[88px] shrink-0 overflow-hidden rounded-lg border border-border sm:block">
                  <Cover update={u} compact />
                </span>
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                    <CompanyTag u={u} />
                    {u.publishedDate && (
                      <span className="text-[11px] tabular-nums text-faint">{u.publishedDate}</span>
                    )}
                  </div>
                  <p className="mt-0.5 text-sm font-medium text-content">{u.oneLiner}</p>
                  <p className="mt-1 text-[13px] leading-relaxed text-muted">{u.detail}</p>
                  <div className="mt-1.5">
                    <SourceLinks citations={u.citations} />
                  </div>
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}

      {view.updates.length === 0 && (
        <p className="mt-8 rounded-xl border border-border bg-surface-2/60 p-5 text-sm leading-relaxed text-muted">
          A quiet window — nothing credible was published about the tracked companies in the last{' '}
          {view.windowHours} hours. The desk reports silence honestly rather than inventing news to
          fill a page.
        </p>
      )}

      {/* ── Sourced takeaways ── */}
      {view.insights.length > 0 && (
        <section className="mt-8 rounded-xl border border-border bg-surface-2/60 p-5">
          <h2 className="mb-3 text-[11px] font-semibold uppercase tracking-[0.22em] text-muted">
            Analyst takeaways
          </h2>
          <ol className="space-y-2.5">
            {view.insights.map((s, i) => (
              <li key={i} className="flex gap-3 text-sm leading-relaxed text-content/90">
                <span
                  className={cn(
                    'mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full',
                    'bg-primary/10 text-[11px] font-bold text-primary-ink',
                  )}
                >
                  {i + 1}
                </span>
                {s}
              </li>
            ))}
          </ol>
        </section>
      )}

      <footer className="mt-8 border-t border-border pt-4 text-[11px] leading-relaxed text-faint">
        Composed by the Stratemark desk from a grounded search of the last {view.windowHours} hours.
        Every update carries its sources; anything without a credible citation was dropped, not
        paraphrased.
      </footer>
    </article>
  );
}

/** Map a stored DeckBriefing (or decoded share payload) into the view shape. */
export function toBriefingView(b: {
  marketName: string;
  generatedAt: string;
  windowHours: number;
  headline: string;
  insights: string[];
  updates: BriefingViewUpdate[];
}): BriefingView {
  return {
    marketName: b.marketName,
    generatedAt: b.generatedAt,
    windowHours: b.windowHours,
    headline: b.headline,
    updates: b.updates,
    insights: b.insights,
  };
}
