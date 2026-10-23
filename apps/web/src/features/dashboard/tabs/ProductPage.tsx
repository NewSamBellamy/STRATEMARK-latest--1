/**
 * A product's own page, as a report: overview (what it is, who it is for), status
 * and timeline, key metrics, what's new (product-specific news), videos, reception,
 * its roadmap items and every source behind them, with a branded PDF.
 *
 * It opens from stored research (the product's record, the roadmap, stories that name
 * it) and fills in the rest only when asked: "Research this product" is one fan-out
 * (grounded brief, product news, product videos) that uses research credits and is
 * cached. Figures carry their source; anything nobody reports says "Not reported" and
 * is never estimated (AGENTS.md Rule 9).
 */
import * as DialogPrimitive from '@radix-ui/react-dialog';
import { ExternalLink, FileText, Loader2, Search, X } from 'lucide-react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { Product, ProductBrief, RoadmapItem } from '@mi/contracts';
import { publisherOf } from '@mi/contracts';
import { DialogOverlay } from '@/components/ui/Modal';
import { localDate } from '@/features/export/exportModel';
import { usePrintJob } from '@/features/export/usePrintJob';
import {
  buildProductReportModel,
  metricRows,
  productTimeline,
  relatedRoadmap,
  relatedStories,
  sentimentTally,
  type Sentiment,
} from '@/features/export/productReportModel';
import { useStoredLiveIntel } from '@/hooks/today';
import { qk } from '@/lib/query/keys';
import { formatDate } from '@/lib/format';
import { safeHttpUrl, sourceHref } from '@/lib/sourceHref';
import { SafeLink } from '@/components/SafeLink';
import { useRepository, useSupports } from '@/lib/repository/RepositoryProvider';
import { cn } from '@/lib/cn';

import { ProductPicture } from './ProductPicture';
import { ProductVideos } from './ProductVideos';
import { STATUS_LABEL, isPastDue, pictureCandidates } from '../productsReport';

const SENTIMENT_DOT: Record<Sentiment, string> = { positive: 'bg-emerald-500', neutral: 'bg-slate-400', negative: 'bg-rose-500' };
const HORIZON_LABEL: Record<RoadmapItem['horizon'], string> = { now: 'Now', next: 'Next', later: 'Later' };

function Section({ id, title, aside, children }: { id: string; title: string; aside?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section aria-label={title} id={`product-${id}`} className="scroll-mt-24">
      <div className="mb-2.5 flex items-baseline justify-between gap-3 border-b border-border pb-1.5">
        <h3 className="font-display text-[15px] font-semibold text-content">{title}</h3>
        {aside && <span className="text-[11px] text-faint">{aside}</span>}
      </div>
      {children}
    </section>
  );
}

const when = (iso: string | undefined): string | null => (iso && Number.isFinite(Date.parse(iso)) ? formatDate(iso) : null);

export function ProductPage({
  product, companyId, company, roadmap, siblings = [], onClose,
}: {
  product: Product;
  companyId: string;
  company: { name: string; logoUrl: string | null; websiteUrl: string | null };
  roadmap: readonly RoadmapItem[];
  /** The company's other product names, so a story about "Claude Code" is not shown on "Claude". */
  siblings?: readonly string[];
  onClose: () => void;
}) {
  const repo = useRepository();
  const qc = useQueryClient();
  const canResearch = useSupports('researchProductBrief');
  const printer = usePrintJob();
  const key = qk.productBrief(companyId, product.name);
  const stored = useQuery({ queryKey: key, queryFn: async () => (await repo.peekProductBrief?.(companyId, product.name)) ?? null });
  const research = useMutation({
    mutationFn: (force: boolean) => repo.researchProductBrief!({ companyId, productName: product.name, force }),
    onSuccess: (brief) => qc.setQueryData(key, brief),
  });
  const intel = useStoredLiveIntel(companyId);
  const brief: ProductBrief | null = stored.data ?? null;
  const stories = relatedStories(intel.data?.items ?? [], product.name, 6, siblings);
  const planned = relatedRoadmap(roadmap, product.name, siblings);
  const tally = sentimentTally(stories);
  const officialPage = safeHttpUrl(product.url);
  const model = buildProductReportModel({
    company: { name: company.name, logoUrl: company.logoUrl, website: company.websiteUrl, hq: null },
    product, brief, stories, roadmap: planned,
  });
  const metrics = metricRows(product, brief);
  const timeline = productTimeline(brief, []);
  const pictures = pictureCandidates({ product, brief, siblings, company });
  const subject = { name: company.name, website: company.websiteUrl, logoUrl: company.logoUrl };
  const extrasMissing = !!brief && (brief.news === undefined || brief.videos === undefined);
  const productSource = !officialPage ? safeHttpUrl(product.sourceUrl) : undefined;

  const report = () => printer.print({ kind: 'productReport', model }, `${company.name} ${product.name} - Stratemark product report ${localDate()}`);
  const busy = research.isPending;

  return (
    <DialogPrimitive.Root open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogPrimitive.Portal>
        <DialogOverlay />
        <DialogPrimitive.Content
          data-testid="product-sheet"
          aria-describedby={undefined}
          className="mi-modal-in fixed inset-y-0 right-0 z-50 flex w-full max-w-[56rem] flex-col border-l border-border bg-surface shadow-card focus:outline-none sm:w-[92vw]"
        >
          <header className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-border bg-surface/95 px-5 py-3 backdrop-blur">
            <div className="min-w-0 flex-1">
              <p className="truncate text-[10.5px] font-semibold uppercase tracking-[0.14em] text-faint">{company.name} · Product report</p>
              <DialogPrimitive.Title className="truncate font-display text-xl text-content sm:text-2xl">{product.name}</DialogPrimitive.Title>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <button type="button" className="btn-primary" onClick={report}><FileText className="h-4 w-4" /> Download report (PDF)</button>
              {canResearch && (
                <button type="button" className="btn-ghost" disabled={busy} onClick={() => research.mutate(!!brief)}
                  title="Researches this product: a grounded brief, its news and its videos. Uses research credits, so it only runs when you ask; the result is cached.">
                  {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
                  {busy ? 'Researching…' : brief ? 'Research again' : 'Research this product'}
                </button>
              )}
              {officialPage && (
                <a href={officialPage} target="_blank" rel="noopener noreferrer" className="btn-ghost"><ExternalLink className="h-4 w-4" /> Official page</a>
              )}
              <DialogPrimitive.Close className="rounded-lg p-1.5 text-muted transition-colors hover:bg-surface-2 hover:text-content">
                <X className="h-5 w-5" /><span className="sr-only">Close</span>
              </DialogPrimitive.Close>
            </div>
          </header>

          <div className="flex-1 overflow-y-auto">
            <ProductPicture candidates={pictures} product={product.name} company={subject} className="aspect-[21/9] w-full border-b border-border" />
            <div className="space-y-8 px-5 py-6">
              {busy && <p role="status" className="text-[13px] text-muted">Researching {product.name}: the grounded brief, news and videos run together.</p>}
              {research.isError && <p role="alert" className="text-[13px] text-negative">{research.error instanceof Error ? research.error.message : 'The research did not finish.'}</p>}

              <dl className="grid grid-cols-2 gap-px overflow-hidden rounded-xl border border-border bg-border sm:grid-cols-4" aria-label="At a glance">
                {[
                  { label: 'Status', value: product.status ? STATUS_LABEL[product.status] : null },
                  { label: 'Launched', value: metrics.find((m) => m.label === 'Launched')?.value ?? null },
                  { label: 'For', value: model.audience },
                  { label: 'Last researched', value: brief ? when(brief.generatedAt) : null },
                ].map((f) => (
                  <div key={f.label} className="bg-surface px-3.5 py-2.5">
                    <dt className="text-[10.5px] font-semibold uppercase tracking-[0.1em] text-muted">{f.label}</dt>
                    <dd className={cn('mt-0.5 line-clamp-3 text-[13px] leading-snug', f.value ? 'text-content' : 'text-faint')}>{f.value ?? 'Not reported'}</dd>
                  </div>
                ))}
              </dl>

              <Section id="overview" title="Overview">
                {brief?.overview.trim() && <p className="mb-2 text-[14px] leading-relaxed text-content">{brief.overview.trim()}</p>}
                <p className={cn('text-[14px] leading-relaxed', brief?.overview.trim() ? 'text-muted' : 'text-content/90')}>{product.description || 'Not reported.'}</p>
                {productSource && <p className="mt-1.5 text-[11px] text-faint">Reported by <SafeLink href={productSource} className="text-primary-ink hover:underline">{product.sourceTitle || publisherOf(productSource, null)}</SafeLink></p>}
                {product.revenueNote.trim() && <p className="mt-2 text-[13px] text-muted">Revenue role: {product.revenueNote.trim()}</p>}
              </Section>

              <Section id="metrics" title="Key metrics" aside="each figure carries its source">
                <dl className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                  {metrics.map((m, i) => (
                    <div key={`${m.label}-${i}`} className="panel px-3.5 py-3">
                      <dt className="text-[11px] font-semibold uppercase tracking-[0.1em] text-muted">{m.label}</dt>
                      <dd className={cn('mt-1 text-[14px] leading-snug', m.value ? 'text-content' : 'text-faint')}>{m.value ?? 'Not reported'}</dd>
                      {m.value && (m.asOf || m.source) && (
                        <p className="mt-1 text-[11px] text-faint">
                          {m.asOf}{m.asOf && m.source ? ' · ' : ''}
                          {m.source && <a href={sourceHref(m.source.url, m.source.title)} target="_blank" rel="noopener noreferrer" className="text-primary-ink hover:underline">{publisherOf(m.source.url, m.source.title)}</a>}
                        </p>
                      )}
                    </div>
                  ))}
                </dl>
                {!brief && <p className="mt-2 text-[12px] text-faint">{canResearch ? 'Usage, pricing and growth figures are filled in when you research this product.' : 'Usage, pricing and growth figures need a research key.'}</p>}
              </Section>

              <Section id="news" title="What's new" aside={brief?.newsCheckedAt ? `checked ${when(brief.newsCheckedAt)}` : undefined}>
                {model.news.length > 0 ? (
                  <ul className="space-y-2.5">
                    {model.news.map((n) => (
                      <li key={n.url} className="text-[13px] leading-snug">
                        <SafeLink href={n.url} className="font-medium text-content hover:text-primary-ink hover:underline">{n.title}</SafeLink>
                        <span className="block text-[11px] text-faint">{[n.publisher ?? publisherOf(n.url, null), n.date].filter(Boolean).join(' · ')}</span>
                      </li>
                    ))}
                  </ul>
                ) : brief?.news !== undefined ? (
                  <p className="text-[13px] text-muted">No recent news that names {product.name} was found{when(brief.newsCheckedAt) ? ` (checked ${when(brief.newsCheckedAt)})` : ''}. Rumours and stories about other products are not shown.</p>
                ) : (
                  <p className="text-[13px] text-muted">{canResearch ? `Product news is found when you research ${product.name}.` : 'Product news needs a research key.'}</p>
                )}
              </Section>

              <Section id="videos" title="Videos" aside={brief?.videosCheckedAt ? `checked ${when(brief.videosCheckedAt)}` : undefined}>
                {(brief?.videos?.length ?? 0) > 0 ? (
                  <ProductVideos videos={brief!.videos!} />
                ) : brief?.videos !== undefined ? (
                  <p className="text-[13px] text-muted">No verified YouTube video about {product.name} was found{when(brief.videosCheckedAt) ? ` (checked ${when(brief.videosCheckedAt)})` : ''}. Only videos that exist, can be embedded and name the product are shown.</p>
                ) : (
                  <p className="text-[13px] text-muted">{canResearch ? `Latest videos appear when you research ${product.name}.` : 'Videos need a research key.'}</p>
                )}
              </Section>

              <Section id="timeline" title="Status & timeline">
                <p className="mb-3 text-[13px] text-muted">
                  {product.status ? `${STATUS_LABEL[product.status]} as reported by the source.` : 'No source states this product\'s lifecycle stage.'}
                </p>
                {timeline.length > 0 ? (
                  <ol className="space-y-3 border-l border-border pl-4">
                    {timeline.map((t, i) => (
                      <li key={`${t.title}-${i}`} className="relative">
                        <span className="absolute -left-[21px] top-1.5 h-2.5 w-2.5 rounded-full border border-surface bg-primary" aria-hidden />
                        <p className="text-[11px] font-semibold uppercase tracking-[0.1em] text-muted">{t.date ?? 'Undated'}</p>
                        <p className="text-[14px] font-medium text-content">{t.title}</p>
                        {t.detail && <p className="text-[13px] leading-snug text-muted">{t.detail}</p>}
                        {t.sourceUrl && <SafeLink href={t.sourceUrl} className="text-[11px] text-primary-ink hover:underline">{publisherOf(t.sourceUrl, null)}</SafeLink>}
                      </li>
                    ))}
                  </ol>
                ) : (
                  <p className="text-[13px] text-muted">No dated milestones for this product yet.{canResearch ? ' Research it to build the timeline.' : ''}</p>
                )}
              </Section>

              <Section id="reception" title="How it is received">
                {brief?.sentiment && (brief.sentiment.summary.trim() || brief.sentiment.positive.length > 0 || brief.sentiment.negative.length > 0) ? (
                  <div className="space-y-3">
                    {brief.sentiment.summary.trim() && <p className="text-[14px] leading-relaxed text-content/90">{brief.sentiment.summary.trim()}</p>}
                    <div className="grid gap-3 sm:grid-cols-2">
                      {brief.sentiment.positive.length > 0 && (
                        <div className="panel p-3.5"><p className="mb-1 text-[11px] font-semibold uppercase tracking-[0.1em] text-muted">Praised for</p>
                          <ul className="list-disc space-y-1 pl-4 text-[13px] text-content/90">{brief.sentiment.positive.map((t) => <li key={t}>{t}</li>)}</ul></div>
                      )}
                      {brief.sentiment.negative.length > 0 && (
                        <div className="panel p-3.5"><p className="mb-1 text-[11px] font-semibold uppercase tracking-[0.1em] text-muted">Criticised for</p>
                          <ul className="list-disc space-y-1 pl-4 text-[13px] text-content/90">{brief.sentiment.negative.map((t) => <li key={t}>{t}</li>)}</ul></div>
                      )}
                    </div>
                    {brief.sentiment.sources.length > 0 && (
                      <p className="text-[11px] text-faint">Sources:{' '}
                        {brief.sentiment.sources.slice(0, 6).map((s, i) => (
                          <span key={s.url}>{i > 0 ? ', ' : ''}<a href={sourceHref(s.url, s.title)} target="_blank" rel="noopener noreferrer" className="text-primary-ink hover:underline">{publisherOf(s.url, s.title)}</a></span>
                        ))}
                      </p>
                    )}
                  </div>
                ) : (
                  <p className="text-[13px] text-muted">No reception research for this product yet.</p>
                )}
                {stories.length > 0 && (
                  <div className="mt-3">
                    <p className="mb-1 text-[11px] text-faint">In the news, as already stored for {company.name}: {tally.positive} positive, {tally.neutral} neutral, {tally.negative} negative.</p>
                    <ul className="space-y-1.5">
                      {stories.map((s) => (
                        <li key={s.url} className="flex items-start gap-2 text-[13px]">
                          <span className={cn('mt-1.5 h-2 w-2 shrink-0 rounded-full', SENTIMENT_DOT[s.sentiment])} aria-label={s.sentiment} role="img" />
                          <SafeLink href={s.url} className="text-content hover:text-primary-ink hover:underline">{s.title}</SafeLink>
                          <span className="shrink-0 text-[11px] text-faint">{s.publisher ?? publisherOf(s.url, null)}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </Section>

              <Section id="roadmap" title="Roadmap for this product">
                {planned.length > 0 ? (
                  <ul className="space-y-2.5">
                    {planned.map((r, i) => {
                      const src = safeHttpUrl(r.sourceUrl);
                      return (
                        <li key={`${r.title}-${i}`} className="panel px-3.5 py-3">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="chip py-0.5 text-[11px]">{HORIZON_LABEL[r.horizon]}</span>
                            <span className="text-[14px] font-medium text-content">{r.title}</span>
                            {r.date && <span className="text-[11px] font-semibold tabular-nums text-primary-ink">{r.date}</span>}
                            {isPastDue(r.date, new Date()) && <span className="rounded border border-amber-300 bg-amber-50 px-1 text-[10.5px] text-amber-700" title="The stated target date has passed; this research does not confirm whether it shipped.">past due</span>}
                          </div>
                          {r.detail && <p className="mt-1 text-[12.5px] leading-snug text-muted">{r.detail}</p>}
                          {src && <SafeLink href={src} className="mt-1 inline-block text-[11px] text-primary-ink hover:underline">{r.sourceTitle || publisherOf(src, null)}</SafeLink>}
                        </li>
                      );
                    })}
                  </ul>
                ) : (
                  <p className="text-[13px] text-muted">No public roadmap item names {product.name}. Nothing is inferred.</p>
                )}
              </Section>

              <Section id="sources" title="Sources">
                {model.footnotes.length > 0 ? (
                  <ol className="list-decimal space-y-1 pl-5 text-[12px] text-muted">
                    {model.footnotes.map((n) => (
                      <li key={n.url}><SafeLink href={n.url} className="text-primary-ink hover:underline">{n.title}</SafeLink></li>
                    ))}
                  </ol>
                ) : (
                  <p className="text-[13px] text-muted">No sources beyond the company's own page yet.</p>
                )}
                {extrasMissing && canResearch && (
                  <button type="button" className="btn-ghost mt-3" disabled={busy} onClick={() => research.mutate(false)}>
                    {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />} Find news and videos
                  </button>
                )}
              </Section>
            </div>
          </div>
          {printer.host}
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
