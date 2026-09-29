/**
 * The shared-research view — what a recipient sees when they open a share
 * link. The entire snapshot travels inside the URL; this page decodes it and
 * renders a clean, interactive, read-only preview: the same cards, metrics,
 * confidence badges, and sources — with the AI layer (fact-check, dig-deeper,
 * live desks, dashboards) removed. No account, no backend, no setup.
 */
import { useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { ExternalLink, Layers, Link2Off, MapPin } from 'lucide-react';
import {
  METRIC_TYPE_LABELS,
  TIER_LABELS,
  publisherOf,
  type CardWithCompany,
  type MaturityTier,
} from '@mi/contracts';
import { decodeSharePayload, sharedToCardWithCompany, type SharePayload } from '@/lib/share/codec';
import { GameCard } from '@/features/card/GameCard';
import { BriefingReport, type BriefingView } from '@/features/briefing/BriefingReport';
import { Logo } from '@/features/card/Logo';
import { ConfidenceBadge } from '@/features/card/ConfidenceBadge';
import { Modal } from '@/components/ui/Modal';
import { FullPageLoader } from '@/components/states/FullPageLoader';
import { formatMetricValue } from '@/lib/format';

/** Read-only card reader: evidence only, no AI actions. */
function SharedReader({ data, onClose }: { data: CardWithCompany; onClose: () => void }) {
  const { card, company, metrics, viceClaims } = data;
  const title = company?.name ?? card.title ?? 'Card';
  return (
    <Modal
      open
      onOpenChange={(o) => {
        if (!o) onClose();
      }}
      title={title}
      size="lg"
    >
      <div className="space-y-4">
        {company && (
          <div className="flex items-start gap-3 border-b border-border pb-4">
            <div className="grid h-12 w-12 shrink-0 place-items-center overflow-hidden rounded-[10px] border border-border bg-surface-2 p-1">
              <Logo
                name={company.name}
                website={company.websiteUrl}
                logoUrl={company.logoUrl}
                className="h-full w-full"
              />
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-[13px] leading-relaxed text-muted">{company.oneLiner}</p>
              <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[12px] text-faint">
                {company.hqLocation && (
                  <span className="inline-flex items-center gap-1">
                    <MapPin className="h-3 w-3" />
                    {company.hqLocation}
                  </span>
                )}
                {company.websiteUrl && (
                  <a
                    href={company.websiteUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 text-primary-ink hover:underline"
                  >
                    <ExternalLink className="h-3 w-3" />
                    {company.websiteUrl.replace(/^https?:\/\//, '')}
                  </a>
                )}
                {card.tier != null && (
                  <span className="font-medium text-muted">
                    Stage T{card.tier} · {TIER_LABELS[card.tier as MaturityTier]}
                  </span>
                )}
              </div>
            </div>
          </div>
        )}

        {card.summary && !company && (
          <p className="text-sm leading-relaxed text-content">{card.summary}</p>
        )}

        {metrics.length > 0 && (
          <div className="rounded-xl border border-border p-4">
            <h4 className="mb-3 font-display text-[13px] font-semibold text-content">
              Key metrics
            </h4>
            <ul className="space-y-2.5">
              {metrics.map((m) => (
                <li key={m.id} className="flex items-center justify-between gap-3 text-sm">
                  <span className="text-muted">{METRIC_TYPE_LABELS[m.metricType]}</span>
                  <span className="flex items-center gap-2">
                    <span className="font-semibold tabular-nums text-content">
                      {m.value != null && m.confidence !== 'unknown'
                        ? formatMetricValue(m.metricType, m.value)
                        : '—'}
                    </span>
                    <ConfidenceBadge
                      confidence={m.confidence}
                      note={null}
                      source={m.source}
                      citations={m.citations}
                      metricLabel={METRIC_TYPE_LABELS[m.metricType]}
                    />
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}

        {card.keyPoints.length > 0 && (
          <div className="rounded-xl border border-border bg-surface-2 p-4">
            <h4 className="mb-3 font-display text-[13px] font-semibold text-content">Key points</h4>
            <ol className="space-y-2.5">
              {card.keyPoints.map((k, i) => (
                <li key={i} className="flex gap-2.5 text-sm leading-relaxed text-content">
                  <span className="mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full bg-surface text-[11px] font-bold text-muted">
                    {i + 1}
                  </span>
                  {k}
                </li>
              ))}
            </ol>
          </div>
        )}

        {viceClaims.length > 0 && (
          <div className="rounded-xl border border-rose-200 bg-rose-50/50 p-4 dark:border-rose-900 dark:bg-rose-950/30">
            <h4 className="mb-3 font-display text-[13px] font-semibold text-content">
              Risk signals
            </h4>
            <ul className="space-y-2.5">
              {viceClaims.map((v) => (
                <li key={v.id} className="text-sm leading-relaxed text-content">
                  {v.claimText}
                  <a
                    href={v.sourceUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="ml-2 text-[11px] text-primary-ink hover:underline"
                  >
                    {publisherOf(v.sourceUrl, v.sourceTitle)}
                  </a>
                </li>
              ))}
            </ul>
          </div>
        )}

        {card.citations.length > 0 && (
          <div className="flex flex-wrap gap-x-4 gap-y-1.5 border-t border-border pt-3">
            {card.citations.map((c, i) => (
              <a
                key={i}
                href={c.url}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 text-[11px] text-primary-ink hover:underline"
              >
                <ExternalLink className="h-3 w-3" />
                {publisherOf(c.url, c.title)}
              </a>
            ))}
          </div>
        )}
      </div>
    </Modal>
  );
}

/**
 * A shared Daily Briefing: the cited editorial report first, then the evidence
 * cards it stands on. The AI layer never ships in a link.
 */
function SharedBriefingView({
  payload,
  cards,
}: {
  payload: SharePayload & { briefing: NonNullable<SharePayload['briefing']> };
  cards: CardWithCompany[];
}) {
  const b = payload.briefing;
  const [openIdx, setOpenIdx] = useState<number | null>(null);
  const view: BriefingView = {
    marketName: payload.market ?? 'Market briefing',
    generatedAt: b.at,
    windowHours: b.w,
    headline: b.h,
    insights: b.i,
    updates: b.u.map((upd) => ({
      companyName: upd.n,
      companyId: null,
      signal: upd.s === 'h' ? 'high' : 'notable',
      oneLiner: upd.o,
      detail: upd.d,
      publishedDate: upd.p,
      citations: upd.c.map((cit) => ({ title: cit.t, url: cit.u })),
    })),
  };
  return (
    <div className="min-h-screen bg-bg">
      <div className="mx-auto max-w-4xl px-4 py-8 sm:px-6">
        <BriefingReport view={view} shared />
        {cards.length > 0 && (
          <section className="mx-auto mt-10 max-w-3xl">
            <h2 className="mb-3 text-[11px] font-semibold uppercase tracking-[0.22em] text-muted">
              The deck behind this briefing
            </h2>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              {cards.map((c, i) => (
                <GameCard key={c.card.id} data={c} hideActions onOpen={() => setOpenIdx(i)} />
              ))}
            </div>
            {openIdx != null && cards[openIdx] && (
              <SharedReader data={cards[openIdx]!} onClose={() => setOpenIdx(null)} />
            )}
          </section>
        )}
        <footer className="mt-10 flex flex-col items-center gap-3 border-t border-border pt-5 text-center text-[11px] leading-relaxed text-faint">
          <p>
            Shared from STRATEMARK — a living market-intelligence deck. Every update carries the
            sources it was grounded in; live verification and the agentic research desk run in the
            full app.
          </p>
          <Link
            to="/"
            className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-surface px-3 py-1.5 text-[12px] font-medium text-content transition-colors hover:bg-surface-2"
          >
            <Layers className="h-3.5 w-3.5 text-primary-ink" />
            Research your own market
          </Link>
        </footer>
      </div>
    </div>
  );
}

/**
 * A shared report: the full editorial report rides the link — masthead,
 * markdown body, sources, and (when included) the face-value cards beside it.
 */
function SharedReportView({
  payload,
  cards,
}: {
  payload: SharePayload & { report: NonNullable<SharePayload['report']> };
  cards: CardWithCompany[];
}) {
  const r = payload.report;
  const [openIdx, setOpenIdx] = useState<number | null>(null);
  const kindLabel =
    r.k === 'deck' ? 'Market Report' : r.k === 'site_audit' ? 'Site Audit' : 'Company Report';
  return (
    <div className="min-h-screen bg-bg">
      <div className="mx-auto max-w-4xl px-4 py-8 sm:px-6">
        <article className="panel p-6">
          <header className="mb-4 border-y-[3px] border-double border-content/70 py-4">
            <p className="text-[11px] font-semibold uppercase tracking-[0.3em] text-muted">
              Stratemark · {kindLabel}
            </p>
            <h1 className="mt-1 font-display text-2xl font-bold tracking-tight text-content sm:text-3xl">
              {r.t}
            </h1>
            <p className="mt-1 text-xs text-muted">
              Generated{' '}
              {new Date(r.at).toLocaleDateString(undefined, {
                month: 'long',
                day: 'numeric',
                year: 'numeric',
              })}
              {r.c.length > 0 && <> · {r.c.length} sources</>}
              {payload.market && <> · {payload.market}</>}
            </p>
          </header>

          <div className="markdown">
            {/* Strip a leading H1 if the model repeated the title — the masthead owns it. */}
            <ReactMarkdown remarkPlugins={[remarkGfm]}>
              {r.md.replace(/^#\s[^\n]*\n+/, '')}
            </ReactMarkdown>
          </div>

          {r.c.length > 0 && (
            <div className="mt-6 flex flex-wrap gap-x-4 gap-y-1.5 border-t border-border pt-4">
              {r.c.map((c, i) => (
                <a
                  key={i}
                  href={c.u}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 text-[11px] text-primary-ink hover:underline"
                >
                  <ExternalLink className="h-3 w-3" />
                  {publisherOf(c.u, c.t)}
                </a>
              ))}
            </div>
          )}
        </article>

        {cards.length > 0 && (
          <section className="mt-8">
            <h2 className="mb-3 text-[11px] font-semibold uppercase tracking-[0.22em] text-muted">
              The cards behind this report
            </h2>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {cards.map((c, i) => (
                <GameCard key={c.card.id} data={c} hideActions onOpen={() => setOpenIdx(i)} />
              ))}
            </div>
            {openIdx != null && cards[openIdx] && (
              <SharedReader data={cards[openIdx]!} onClose={() => setOpenIdx(null)} />
            )}
          </section>
        )}

        <footer className="mt-10 flex flex-col items-center gap-3 border-t border-border pt-5 text-center text-[11px] leading-relaxed text-faint">
          <p>
            Shared from STRATEMARK — a living market-intelligence deck. This report was composed
            from sourced evidence; live verification and the agentic research desk run in the full
            app.
          </p>
          <Link
            to="/"
            className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-surface px-3 py-1.5 text-[12px] font-medium text-content transition-colors hover:bg-surface-2"
          >
            <Layers className="h-3.5 w-3.5 text-primary-ink" />
            Research your own market
          </Link>
        </footer>
      </div>
    </div>
  );
}

export default function SharePage() {
  const { blob } = useParams();
  const [payload, setPayload] = useState<SharePayload | null | 'loading'>('loading');

  useEffect(() => {
    let live = true;
    if (!blob) {
      setPayload(null);
      return;
    }
    void decodeSharePayload(blob).then((p) => {
      if (live) setPayload(p);
    });
    return () => {
      live = false;
    };
  }, [blob]);

  const cards = useMemo(
    () =>
      payload && payload !== 'loading'
        ? payload.cards.map((sc, i) => sharedToCardWithCompany(sc, i, payload.sharedAt))
        : [],
    [payload],
  );
  const [openIdx, setOpenIdx] = useState<number | null>(null);

  if (payload === 'loading') return <FullPageLoader label="Unpacking shared research…" />;

  if (!payload) {
    return (
      <div className="grid min-h-screen place-items-center bg-bg px-6">
        <div className="max-w-md text-center">
          <div className="mx-auto mb-4 grid h-12 w-12 place-items-center rounded-full bg-surface-2 text-muted">
            <Link2Off className="h-6 w-6" />
          </div>
          <h1 className="font-display text-xl font-semibold text-content">
            This share link didn’t survive the trip
          </h1>
          <p className="mt-2 text-sm leading-relaxed text-muted">
            The link looks incomplete — some messaging apps truncate long URLs. Ask the sender to
            re-share it, or to send it via email or a document instead.
          </p>
          <Link to="/" className="btn-primary mt-5 inline-flex">
            Open STRATEMARK
          </Link>
        </div>
      </div>
    );
  }

  if (payload.kind === 'briefing' && payload.briefing) {
    return (
      <SharedBriefingView
        payload={payload as SharePayload & { briefing: NonNullable<SharePayload['briefing']> }}
        cards={cards}
      />
    );
  }

  if (payload.kind === 'report' && payload.report) {
    return (
      <SharedReportView
        payload={payload as SharePayload & { report: NonNullable<SharePayload['report']> }}
        cards={cards}
      />
    );
  }

  const companyCount = payload.cards.filter((c) => c.company).length;
  const sharedDate = new Date(payload.sharedAt).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });

  return (
    <div className="min-h-screen bg-bg">
      <div className="mx-auto max-w-6xl px-4 py-8 sm:px-6">
        {/* Header: whose research, when — and a quiet path into the product. */}
        <header className="mb-6 flex flex-wrap items-end justify-between gap-4 border-b border-border pb-5">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-widest text-muted">
              Shared market research
            </p>
            <h1 className="mt-1 font-display text-2xl font-bold tracking-tight text-content sm:text-3xl">
              {payload.market ?? (payload.kind === 'card' ? 'Company snapshot' : 'Market deck')}
            </h1>
            <p className="mt-1 text-[12px] text-faint">
              {[
                payload.kind === 'deck' && companyCount > 0 ? `${companyCount} companies` : null,
                `snapshot · ${sharedDate}`,
                'sourced figures with confidence badges',
              ]
                .filter(Boolean)
                .join(' · ')}
            </p>
          </div>
          <Link
            to="/"
            className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-border bg-surface px-3 py-1.5 text-[12px] font-medium text-content transition-colors hover:bg-surface-2"
          >
            <Layers className="h-3.5 w-3.5 text-primary-ink" />
            Research your own market
          </Link>
        </header>

        {/* The cards — same components, click to explore the evidence. */}
        <div
          className={
            payload.kind === 'card'
              ? 'mx-auto grid max-w-sm grid-cols-1'
              : 'grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3'
          }
        >
          {cards.map((c, i) => (
            <GameCard key={c.card.id} data={c} hideActions onOpen={() => setOpenIdx(i)} />
          ))}
        </div>

        {openIdx != null && cards[openIdx] && (
          <SharedReader data={cards[openIdx]!} onClose={() => setOpenIdx(null)} />
        )}

        <footer className="mt-10 border-t border-border pt-5 text-center text-[11px] leading-relaxed text-faint">
          Snapshot shared from STRATEMARK — a living market-intelligence deck. Figures carry the
          confidence and sources they had when shared; live verification, freshness decay, and
          agentic research run in the full app.
        </footer>
      </div>
    </div>
  );
}
