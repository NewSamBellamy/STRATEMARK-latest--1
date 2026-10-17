import { useMemo, useState } from 'react';
import { isDirectSource, sourceHref } from '@/lib/sourceHref';
import { Link, useParams } from 'react-router-dom';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { ArrowDown, ArrowLeft, ArrowUp, ExternalLink } from 'lucide-react';
import { publisherOf, type CardWithCompany } from '@mi/contracts';
import { buildCardView } from '@/features/card/card-view';
import { cn } from '@/lib/cn';
import { useCards, useReport } from '@/hooks/data';
import { SiteAuditView } from './SiteAuditView';
import { AiCover } from '@/components/media/AiCover';
import { printScoped } from '@/lib/print';
import { QueryBoundary } from '@/components/states/QueryBoundary';
import { formatRelative } from '@/lib/format';
import { ExportMenu } from '@/features/export/ExportMenu';
import { METRIC_COLORS, tint } from '@/lib/theme';
import { buildReportShare } from '@/lib/share/codec';
import { exportDeckPptx } from './pptx';

type SortKey = 'name' | 'market_share' | 'revenue' | 'value' | 'employees';

interface LandscapeRow {
  card: CardWithCompany;
  share: number | null;
  /** Card-face figures: the same slots, gates and display strings as the card itself. */
  revenue: { value: number | null; display: string };
  value: { value: number | null; display: string };
  team: { value: number | null; display: string };
}

/** A card slot falls back to other figures (a "company value" slot may show
 * Total raised); a column only takes the figure its header names. */
function faceSlot(view: ReturnType<typeof buildCardView>, key: string, types: readonly string[]) {
  const item = view.profileMetrics.find((m) => m.key === key);
  const known = !!item && item.display !== 'Unknown' && !!item.metric && types.includes(item.metric.metricType);
  return { value: known ? item!.metric?.value ?? null : null, display: known ? item!.display : 'Unknown' };
}

/**
 * Sortable landscape grid built from the deck's live cards. Every figure is
 * read through buildCardView, so the report can never disagree with a card.
 */
function LandscapeTable({ deckId }: { deckId: string }) {
  const cards = useCards(deckId);
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>({ key: 'value', dir: -1 });

  const rows = useMemo<LandscapeRow[]>(() => {
    const companies = (cards.data ?? []).filter((c) => c.card.cardType === 'company' && c.company);
    const built = companies.map((c) => {
      const view = buildCardView(c);
      const share = view.metrics.find((m) => m.metric.metricType === 'market_share' && m.metric.value != null && m.citations.length > 0);
      return {
        card: c,
        share: share?.metric.value ?? null,
        revenue: faceSlot(view, 'revenue', ['arr', 'revenue']),
        value: faceSlot(view, 'company_value', ['valuation', 'market_cap']),
        team: faceSlot(view, 'employees', ['employees']),
      };
    });
    const get = (r: LandscapeRow): number | string | null =>
      sort.key === 'name' ? r.card.company!.name.toLowerCase()
        : sort.key === 'market_share' ? r.share
          : sort.key === 'revenue' ? r.revenue.value
            : sort.key === 'employees' ? r.team.value
              : r.value.value;
    return built.sort((a, b) => {
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
        {sort.key === k && (sort.dir === 1 ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />)}
      </span>
    </th>
  );

  // A column nobody has a sourced figure for is noise, not information.
  const showShare = rows.some((r) => r.share != null);
  const maxShare = Math.max(...rows.map((r) => r.share ?? 0), 1);
  const cell = (d: { display: string }) => (
    <td className={cn('px-3 py-2 tabular-nums', d.display === 'Unknown' && 'text-faint')}>{d.display}</td>
  );

  return (
    <div className="panel mb-5 overflow-x-auto p-0">
      <table className="w-full text-sm">
        <thead className="border-b border-border">
          <tr>
            <Th k="name" label="Company" />
            {showShare && <Th k="market_share" label="Share" />}
            <Th k="revenue" label="Revenue" />
            <Th k="value" label="Valuation / cap" />
            <Th k="employees" label="Team" />
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.card.card.id} className="border-b border-border/60 last:border-0 hover:bg-surface-2/60">
              <td className="px-3 py-2 font-medium text-content">{r.card.company!.name}</td>
              {showShare && (
                <td className="px-3 py-2 tabular-nums">
                  <div className="flex items-center gap-2">
                    <span className="w-12">{r.share != null ? `${r.share}%` : '—'}</span>
                    {r.share != null && (
                      <span className="h-1.5 w-16 overflow-hidden rounded-full" style={{ background: tint(METRIC_COLORS.market_share, 0.12) }}>
                        <span
                          className="block h-full rounded-full"
                          style={{ width: `${(r.share / maxShare) * 100}%`, background: METRIC_COLORS.market_share }}
                        />
                      </span>
                    )}
                  </div>
                </td>
              )}
              {cell(r.revenue)}
              {cell(r.value)}
              {cell(r.team)}
            </tr>
          ))}
        </tbody>
      </table>
      <p className="border-t border-border px-3 py-2 text-[11px] text-faint">
        Live figures from this deck&apos;s cards, with the same sourcing rules. Unknown means no sourced figure yet.
      </p>
    </div>
  );
}

export default function ReportViewerPage() {
  const { reportId } = useParams();
  const report = useReport(reportId);
  const deckCards = useCards(report.data?.kind === 'deck' ? report.data.subjectId : undefined);
  const [exporting, setExporting] = useState(false);

  return (
    <div className="mx-auto max-w-4xl">
      <Link to="/reports" className="brf-no-print mb-4 inline-flex items-center gap-1.5 text-sm text-muted hover:text-content">
        <ArrowLeft className="h-4 w-4" />
        Reports
      </Link>

      <QueryBoundary query={report}>
        {(r) => {
          if (r.kind === 'site_audit' && r.audit) return <SiteAuditView report={r} audit={r.audit} />;
          // The deck's opening brief was written before research ran; its
          // "research in progress" footer is stale the moment research ends.
          const markdown = (typeof r.markdown === 'string' ? r.markdown : '')
            .split('\n').filter((line) => !/^\*?Grounded research in progress/i.test(line.trim())).join('\n');
          const citations = Array.isArray(r.citations) ? r.citations : [];
          return (
          <article className="brf-print-root panel p-6">
            <header className="mb-4 border-y-[3px] border-double border-content/70 py-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-[0.3em] text-muted">
                  Stratemark · {r.kind === 'deck' ? 'Market Report' : 'Company Report'}
                </p>
                <h1 className="mt-1 font-display text-2xl font-bold tracking-tight text-content sm:text-3xl">{r.title}</h1>
                <p className="mt-1 text-xs text-muted">
                  Generated {formatRelative(r.createdAt)} ·{' '}
                  {citations.length > 0
                    ? `${citations.length} ${citations.length === 1 ? 'source' : 'sources'}`
                    : r.kind === 'deck' ? 'research plan · figures below are live from the deck' : 'no sources attached'}
                </p>
              </div>
              <div className="brf-no-print flex flex-wrap gap-2">
                <ExportMenu
                  report={r.kind === 'deck' && citations.length === 0 ? { kind: 'deck', subjectId: r.subjectId } : undefined}
                  share={{
                    title: r.title,
                    subtitle: `Stratemark ${r.kind === 'deck' ? 'market report' : 'company report'}`,
                    build: async () =>
                      buildReportShare(
                        {
                          title: r.title,
                          kind: r.kind,
                          markdown,
                          citations,
                          createdAt: r.createdAt,
                        },
                        r.kind === 'deck' ? r.title.replace(/ — Market Report$/, '') : null,
                        (deckCards.data ?? []).filter((c) => c.card.cardType === 'company').slice(0, 3),
                      ),
                  }}
                  downloads={[
                    { key: 'pdf', label: 'PDF', hint: 'Print or save as PDF', icon: 'pdf', onSelect: () => printScoped() },
                    {
                      key: 'md',
                      label: 'Markdown',
                      icon: 'markdown',
                      onSelect: () => {
                        const blob = new Blob([`# ${r.title}\n\n${markdown}`], { type: 'text/markdown' });
                        const url = URL.createObjectURL(blob);
                        const a = document.createElement('a');
                        a.href = url;
                        a.download = `${r.title.replace(/[^a-z0-9]+/gi, '-').toLowerCase()}.md`;
                        a.click();
                        URL.revokeObjectURL(url);
                      },
                    },
                    ...(r.kind === 'deck'
                      ? [{
                          key: 'pptx',
                          label: exporting ? 'Building…' : 'PowerPoint (.pptx)',
                          hint: 'Title, landscape, one slide per key company',
                          icon: 'slides' as const,
                          disabled: exporting || !deckCards.data?.length,
                          onSelect: async () => {
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
                          },
                        }]
                      : []),
                  ]}
                />
              </div>
              </div>
            </header>

            {/* The report's face: generated from ITS OWN title + evidence, so a
                wall of text opens with an image instead (owner-key only;
                designed fallback otherwise). */}
            <div className="mb-5 h-[160px] overflow-hidden rounded-xl border border-border">
              <AiCover
                cacheKey={`report:${r.id}`}
                title={r.title}
                context={`Editorial cover illustration for a market-intelligence report titled "${r.title}". ${(r.evidenceDigest ?? markdown).slice(0, 240)}`}
                url={citations[0]?.url ?? ''}
                source="news"
              />
            </div>

            {r.kind === 'deck' && <LandscapeTable deckId={r.subjectId} />}

            {/* Reading measure: ~70ch, relaxed leading — a finished artifact
                reads like one (red team #10). */}
            <div className="markdown mx-auto max-w-[70ch] text-[15px] leading-[1.75]">
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
                        title={isDirectSource(c.url) ? 'Read the source' : 'Find the original story'}
                      >
                        <ExternalLink className="mt-0.5 h-3 w-3 shrink-0" />
                        <span className="line-clamp-1">{publisherOf(c.url, c.title)}</span>
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
