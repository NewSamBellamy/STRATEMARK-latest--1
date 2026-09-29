import { useMemo, useState } from 'react';
import { isDirectSource, sourceHref } from '@/lib/sourceHref';
import { Link, useParams } from 'react-router-dom';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import {
  ArrowDown,
  ArrowLeft,
  ArrowUp,
  Download,
  ExternalLink,
  Presentation,
  Printer,
  Share2,
} from 'lucide-react';
import {
  TIER_LABELS,
  type CardWithCompany,
  type MaturityTier,
  type MetricType,
} from '@mi/contracts';
import { useCards, useReport } from '@/hooks/data';
import { SiteAuditView } from './SiteAuditView';
import { printScoped } from '@/lib/print';
import { QueryBoundary } from '@/components/states/QueryBoundary';
import { formatMetricValue, formatRelative } from '@/lib/format';
import { METRIC_COLORS, TIER_COLORS, tint } from '@/lib/theme';
import { buildReportShare } from '@/lib/share/codec';
import { ShareDialog } from '@/features/share/ShareDialog';
import { exportDeckPptx } from './pptx';

type SortKey = 'name' | 'tier' | 'market_share' | 'arr' | 'value' | 'employees';

function metricValue(c: CardWithCompany, type: MetricType | 'value'): number | null {
  if (type === 'value') {
    const v = c.metrics.find(
      (m) => (m.metricType === 'valuation' || m.metricType === 'market_cap') && m.value != null,
    );
    return v?.value ?? null;
  }
  return c.metrics.find((m) => m.metricType === type && m.value != null)?.value ?? null;
}

/** Sortable landscape grid built from the deck's real data (audit: no raw LLM tables). */
function LandscapeTable({ deckId }: { deckId: string }) {
  const cards = useCards(deckId);
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>({ key: 'tier', dir: -1 });

  const rows = useMemo(() => {
    const companies = (cards.data ?? []).filter((c) => c.card.cardType === 'company' && c.company);
    const get = (c: CardWithCompany): number | string | null =>
      sort.key === 'name'
        ? c.company!.name.toLowerCase()
        : sort.key === 'tier'
          ? c.card.tier
          : metricValue(c, sort.key);
    return [...companies].sort((a, b) => {
      const av = get(a);
      const bv = get(b);
      if (av == null && bv == null) return 0;
      if (av == null) return 1;
      if (bv == null) return -1;
      return (av < bv ? -1 : av > bv ? 1 : 0) * sort.dir;
    });
  }, [cards.data, sort]);

  if (rows.length === 0) return null;

  const Th = ({ k, label }: { k: SortKey; label: string }) => (
    <th
      className="cursor-pointer select-none whitespace-nowrap px-3 py-2 text-left text-[10px] font-semibold uppercase tracking-widest text-muted hover:text-content"
      onClick={() => setSort((s) => ({ key: k, dir: s.key === k ? ((s.dir * -1) as 1 | -1) : -1 }))}
    >
      <span className="inline-flex items-center gap-1">
        {label}
        {sort.key === k &&
          (sort.dir === 1 ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />)}
      </span>
    </th>
  );

  const maxShare = Math.max(...rows.map((r) => metricValue(r, 'market_share') ?? 0), 1);

  return (
    <div className="panel mb-5 overflow-x-auto p-0">
      <table className="w-full text-sm">
        <thead className="border-b border-border">
          <tr>
            <Th k="name" label="Company" />
            <Th k="tier" label="Tier" />
            <Th k="market_share" label="Share" />
            <Th k="arr" label="ARR" />
            <Th k="value" label="Valuation/Cap" />
            <Th k="employees" label="Team" />
          </tr>
        </thead>
        <tbody>
          {rows.map((c) => {
            const share = metricValue(c, 'market_share');
            return (
              <tr
                key={c.card.id}
                className="border-b border-border/60 last:border-0 hover:bg-surface-2/60"
              >
                <td className="px-3 py-2 font-medium text-content">{c.company!.name}</td>
                <td className="px-3 py-2">
                  {c.card.tier != null && (
                    <span
                      className="inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-xs font-semibold text-content"
                      style={{
                        background: tint(TIER_COLORS[c.card.tier as MaturityTier], 0.1),
                        borderColor: tint(TIER_COLORS[c.card.tier as MaturityTier], 0.3),
                      }}
                    >
                      T{c.card.tier} {TIER_LABELS[c.card.tier as MaturityTier]}
                    </span>
                  )}
                </td>
                <td className="px-3 py-2 tabular-nums">
                  <div className="flex items-center gap-2">
                    <span className="w-12">{share != null ? `${share}%` : '—'}</span>
                    {share != null && (
                      <span
                        className="h-1.5 w-16 overflow-hidden rounded-full"
                        style={{ background: tint(METRIC_COLORS.market_share, 0.12) }}
                      >
                        <span
                          className="block h-full rounded-full"
                          style={{
                            width: `${(share / maxShare) * 100}%`,
                            background: METRIC_COLORS.market_share,
                          }}
                        />
                      </span>
                    )}
                  </div>
                </td>
                <td className="px-3 py-2 tabular-nums">
                  {formatMetricValue('arr', metricValue(c, 'arr'))}
                </td>
                <td className="px-3 py-2 tabular-nums">
                  {(() => {
                    const v = c.metrics.find(
                      (m) =>
                        (m.metricType === 'valuation' || m.metricType === 'market_cap') &&
                        m.value != null,
                    );
                    return v ? formatMetricValue(v.metricType, v.value) : 'Unknown';
                  })()}
                </td>
                <td className="px-3 py-2 tabular-nums">
                  {formatMetricValue('employees', metricValue(c, 'employees'))}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

export default function ReportViewerPage() {
  const { reportId } = useParams();
  const report = useReport(reportId);
  const deckCards = useCards(report.data?.kind === 'deck' ? report.data.subjectId : undefined);
  const [exporting, setExporting] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);

  return (
    <div className="mx-auto max-w-4xl">
      <Link
        to="/reports"
        className="brf-no-print mb-4 inline-flex items-center gap-1.5 text-sm text-muted hover:text-content"
      >
        <ArrowLeft className="h-4 w-4" />
        Reports
      </Link>

      <QueryBoundary query={report}>
        {(r) => {
          if (r.kind === 'site_audit' && r.audit)
            return <SiteAuditView report={r} audit={r.audit} />;
          const markdown = typeof r.markdown === 'string' ? r.markdown : '';
          const citations = Array.isArray(r.citations) ? r.citations : [];
          return (
            <article className="brf-print-root panel p-6">
              <header className="mb-4 border-y-[3px] border-double border-content/70 py-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <p className="text-[11px] font-semibold uppercase tracking-[0.3em] text-muted">
                      Stratemark · {r.kind === 'deck' ? 'Market Report' : 'Company Report'}
                    </p>
                    <h1 className="mt-1 font-display text-2xl font-bold tracking-tight text-content sm:text-3xl">
                      {r.title}
                    </h1>
                    <p className="mt-1 text-xs text-muted">
                      Generated {formatRelative(r.createdAt)} ·{' '}
                      {citations.length > 0
                        ? `${citations.length} ${citations.length === 1 ? 'source' : 'sources'}`
                        : 'Draft · no sources'}
                    </p>
                  </div>
                  <div className="brf-no-print flex flex-wrap gap-2">
                    {r.kind === 'deck' && (
                      <button
                        type="button"
                        className="btn-primary"
                        disabled={exporting || !deckCards.data?.length || citations.length === 0}
                        title="Boss-ready PowerPoint: title, landscape, one slide per key company"
                        onClick={async () => {
                          setExporting(true);
                          try {
                            await exportDeckPptx({
                              marketName: r.title.replace(/ — Market Report$/, ''),
                              cards: deckCards.data ?? [],
                              thesis: null,
                            });
                          } finally {
                            setExporting(false);
                          }
                        }}
                      >
                        <Presentation className="h-4 w-4" />
                        {exporting ? 'Building…' : 'Export .pptx'}
                      </button>
                    )}
                    <button
                      type="button"
                      className="btn-ghost"
                      onClick={printScoped}
                      title="Print or save as PDF"
                    >
                      <Printer className="h-4 w-4" />
                      PDF
                    </button>
                    <button
                      type="button"
                      className="btn-ghost"
                      onClick={() => setShareOpen(true)}
                      disabled={citations.length === 0}
                      title={
                        citations.length > 0
                          ? 'Share this cited report as a read-only Stratemark link'
                          : 'Add sources before sharing this draft'
                      }
                    >
                      <Share2 className="h-4 w-4" />
                      Share
                    </button>
                    <ShareDialog
                      open={shareOpen}
                      onOpenChange={setShareOpen}
                      title={r.title}
                      subtitle={`Stratemark ${r.kind === 'deck' ? 'market report' : 'company report'}`}
                      build={async () =>
                        buildReportShare(
                          {
                            title: r.title,
                            kind: r.kind,
                            markdown,
                            citations,
                            createdAt: r.createdAt,
                          },
                          r.kind === 'deck' ? r.title.replace(/ — Market Report$/, '') : null,
                          (deckCards.data ?? [])
                            .filter((c) => c.card.cardType === 'company')
                            .slice(0, 3),
                        )
                      }
                    />
                    <button
                      type="button"
                      className="btn-ghost"
                      onClick={() => {
                        const blob = new Blob([`# ${r.title}\n\n${markdown}`], {
                          type: 'text/markdown',
                        });
                        const url = URL.createObjectURL(blob);
                        const a = document.createElement('a');
                        a.href = url;
                        a.download = `${r.title.replace(/[^a-z0-9]+/gi, '-').toLowerCase()}.md`;
                        a.click();
                        URL.revokeObjectURL(url);
                      }}
                    >
                      <Download className="h-4 w-4" />
                      .md
                    </button>
                  </div>
                </div>
              </header>

              {citations.length === 0 && (
                <div className="mb-5 rounded-xl border border-amber-300/70 bg-amber-50 px-4 py-3 text-sm text-amber-900">
                  <strong>Draft — no sources attached.</strong> Treat this as working notes. Sharing
                  and presentation export stay disabled until the report has clickable evidence.
                </div>
              )}

              {r.kind === 'deck' && <LandscapeTable deckId={r.subjectId} />}

              <div className="markdown">
                {/* Strip a leading H1 if the model repeated the title — the header above owns it. */}
                <ReactMarkdown remarkPlugins={[remarkGfm]}>
                  {markdown.replace(/^#\s[^\n]*\n+/, '')}
                </ReactMarkdown>
              </div>

              {citations.length > 0 && (
                <footer className="mt-6 border-t border-border pt-4">
                  <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">
                    Sources ({citations.length})
                  </h2>
                  <ul className="space-y-1.5">
                    {citations.map((c, i) => (
                      <li key={i}>
                        <a
                          href={sourceHref(c.url, c.title)}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-start gap-1.5 text-xs text-primary-ink hover:underline"
                          title={
                            isDirectSource(c.url) ? 'Read the source' : 'Find the original story'
                          }
                        >
                          <ExternalLink className="mt-0.5 h-3 w-3 shrink-0" />
                          <span className="line-clamp-1">{c.title || c.url}</span>
                        </a>
                      </li>
                    ))}
                  </ul>
                </footer>
              )}
            </article>
          );
        }}
      </QueryBoundary>
    </div>
  );
}
